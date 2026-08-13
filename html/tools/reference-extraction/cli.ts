import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  CALIBRATED_REFERENCE_INPUT_HASHES,
  CALIBRATED_REFERENCE_BOUNDS,
  CALIBRATED_REFERENCE_SOURCE,
  CALIBRATED_PLAYABLE_BOUNDS,
  compareUuidSets as compareWorldUuidSets,
  loadReferenceExtractionInputs,
} from "./reference-inputs.ts";
import type { ReferenceExtractionInputs } from "./reference-extraction-types.ts";
import type { WorldMap } from "../../src/domain/map-model.ts";
import { extractCandidates, type ExtractionCandidate } from "./candidate-extractor.ts";
import {
  selectCandidateGroup,
  CandidateDecision,
  CandidateSelectionThresholds,
} from "./candidate-selector.ts";
import { createReferenceTransform } from "./reference-transform.ts";
import {
  reconstructReference,
  type ReconstructionResult,
} from "./reconstruct-reference.ts";
import {
  evaluateReconstruction,
  ReferenceQualityReport,
  ReferenceQualityThresholds,
} from "./quality-report.ts";

export const DEFAULT_REFERENCE_ORIENTATION = "x-right-y-up" as const;
const DEFAULT_DIFFERENCE_AMPLIFICATION = 4;
const TARGET_PREVIEW_CELL_SIZE = 32;
const DEFAULT_EXPECTED_SHARED_UUIDS = 429;
const PROMOTION_LOCK_STALE_MS = 10 * 60 * 1000;
const PROMOTION_LOCK_TIMEOUT_MS = 30 * 1000;
const PROMOTION_LOCK_POLL_MS = 25;

export const DEFAULT_CANDIDATE_THRESHOLDS: Readonly<CandidateSelectionThresholds> = {
  normalizedWidth: 64,
  normalizedHeight: 64,
  interiorInset: 8,
  edgeStripWidth: 8,
  maximumInteriorDistance: 0.06,
  maximumEdgeDistance: 0.08,
  minimumClusterSize: 2,
  maximumGroupSize: 256,
};

export const DEFAULT_REFERENCE_QUALITY_THRESHOLDS: Readonly<ReferenceQualityThresholds> = {
  maximumMeanImageDifference: 0.18,
  maximumPixelImageDifference: 1,
  maximumMeanSeamError: 0.18,
  maximumSeamError: 1,
  maximumGroupMeanImageDifference: 0.12,
  maximumGroupPixelImageDifference: 0.8,
  maximumGroupMeanSeamError: 0.12,
  maximumGroupSeamError: 0.8,
  minimumFullReferenceTypeCoverage: 0.65,
  minimumFullReferenceRotationCoverage: 0.7,
  minimumFullReferenceCellCoverage: 0.8,
  minimumPlayableCellCoverage: 0.8,
  minimumTargetEligibleCellCoverage: 0.8,
};

export interface ReferenceExtractionCliOptions {
  targetSavePath: string;
  defaultSavePath?: string;
}

export interface ReferenceExtractionExecutionOptions extends ReferenceExtractionCliOptions {
  projectRoot: string;
  localOutputRoot: string;
}

export interface ReferenceExtractionRun extends ReferenceExtractionExecutionOptions {
  sourceHash: string;
  expectedSharedUuids: number;
  stagingDirectory: string;
  finalDirectory: string;
}

interface FileArtifactSummary {
  path: string;
  bytes: number;
  sha256: string;
}

interface CandidateManifestRecord extends FileArtifactSummary {
  width: number;
  height: number;
  provenance: {
    uuid: string;
    rotation: 0 | 1 | 2 | 3;
    offset: { x: number; y: number };
    footprint: { width: number; height: number };
    sourceWorld: { x: number; y: number };
    orientation: typeof DEFAULT_REFERENCE_ORIENTATION;
  };
}

interface CandidateTreeSummary {
  path: "candidates";
  files: number;
  bytes: number;
  sha256: string;
  records: CandidateManifestRecord[];
}

export interface ReferenceExtractionPipeline {
  loadInputs: typeof loadReferenceExtractionInputs;
  extractCandidates: typeof extractCandidates;
  selectCandidates: (
    candidates: readonly ExtractionCandidate[],
    thresholds: CandidateSelectionThresholds,
  ) => CandidateDecision[];
  reconstruct: typeof reconstructReference;
  evaluate: (
    result: ReconstructionResult,
    thresholds: ReferenceQualityThresholds,
  ) => ReferenceQualityReport;
  renderTargetPreview: (
    inputs: ReferenceExtractionInputs,
    acceptedDecisions: readonly CandidateDecision[],
  ) => Promise<Uint8Array>;
}

interface ReferenceExtractionSummary {
  schemaVersion: 2;
  rootManifestSha256: string;
  rootManifestBytes: number;
  status: "passed" | "failed";
  reasons: string[];
  checkedInputHashes: typeof CALIBRATED_REFERENCE_INPUT_HASHES;
  provenance: {
    sourceImage: {
      sha256: string;
      width: number;
      height: number;
      bounds: WorldMap["bounds"];
    };
    referenceWorld: { fileSha256: string; canonicalSha256: string };
    buildInfo: { sha256: string };
    catalog: { sha256: string };
    defaultSave: { sha256: string };
    targetSave: { sha256: string };
    targetWorld: { canonicalSha256: string };
  };
  orientation: typeof DEFAULT_REFERENCE_ORIENTATION;
  inventory: {
    expectedShared: number;
    sharedCount: number;
    shared: string[];
    referenceOnlyCount: number;
    referenceOnly: string[];
    targetOnlyCount: number;
    targetOnly: string[];
  };
  candidates: number;
  candidateGroups: number;
  selectorAcceptedGroups: number;
  selectorRejectedGroups: number;
  qualityAcceptedGroups: number;
  qualityRejectedGroups: number;
  qualityAcceptedCells: number;
  qualityRejectedCells: number;
  thresholds: {
    candidate: CandidateSelectionThresholds;
    quality: ReferenceQualityThresholds;
  };
  coverage: ReferenceQualityReport["coverage"];
  artifacts: {
    candidates: CandidateTreeSummary;
    referenceWorld: FileArtifactSummary;
    targetWorld: FileArtifactSummary;
    reconstruction: FileArtifactSummary;
    difference: FileArtifactSummary;
    targetPreview: FileArtifactSummary;
    qualityReport: FileArtifactSummary;
  };
}

interface PromotionHooks {
  beforePointerRename?: () => void | Promise<void>;
  onLockAcquired?: () => void | Promise<void>;
  onLockWaiting?: () => void | Promise<void>;
  beforeStaleLockRemoval?: () => void | Promise<void>;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
  lockStaleMs?: number;
  lockTimeoutMs?: number;
  lockPollMs?: number;
  onSync?: (kind: "file" | "directory", path: string) => void | Promise<void>;
}

export interface ReferenceExtractionCliDependencies {
  projectRoot?: string;
  localOutputRoot?: string;
  sourceHash?: string;
  expectedSharedUuids?: number;
  execute?: (options: ReferenceExtractionRun) => Promise<void>;
  pipeline?: ReferenceExtractionPipeline;
  promotion?: PromotionHooks;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function parseReferenceExtractionArgs(args: readonly string[]): ReferenceExtractionCliOptions {
  const targets: string[] = [];
  const defaultSaves: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--target" && argument !== "--default-save") {
      throw new Error(`Unsupported reference extraction option: ${argument ?? ""}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(argument === "--target"
        ? "Missing required option: --target <save.db>"
        : "Missing option value: --default-save <save.db>");
    }
    if (argument === "--target") targets.push(value);
    else defaultSaves.push(value);
    index += 1;
  }
  if (targets.length === 0) throw new Error("Missing required option: --target <save.db>");
  if (targets.length !== 1) throw new Error("The --target option must be supplied exactly once.");
  if (defaultSaves.length > 1) {
    throw new Error("The --default-save option must be supplied at most once.");
  }
  return {
    targetSavePath: targets[0]!,
    ...(defaultSaves[0] ? { defaultSavePath: defaultSaves[0] } : {}),
  };
}

async function referenceDefaultSavePath(options: ReferenceExtractionRun): Promise<string> {
  const usesLocalDefault = options.defaultSavePath === undefined;
  const path = usesLocalDefault
    ? resolve(options.projectRoot, "local-assets", "default-save.db")
    : resolve(options.defaultSavePath!);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("not a regular file");
    }
    return path;
  } catch (error) {
    if (usesLocalDefault) {
      throw new Error(
        "Reference extraction default save is missing at local-assets/default-save.db; provide --default-save <save.db>.",
        { cause: error },
      );
    }
    throw new Error(`Reference extraction default save is unavailable: ${path}`, { cause: error });
  }
}

async function validateLocalOutputRoot(projectRoot: string, requestedRoot: string): Promise<string> {
  const expectedRoot = resolve(projectRoot, "local-assets", "reference-extraction");
  const expectedParent = resolve(projectRoot, "local-assets");
  if (comparable(resolve(requestedRoot)) !== comparable(expectedRoot)) {
    throw new Error("Reference extraction output is fixed at local-assets/reference-extraction.");
  }
  try {
    const [canonicalProject, projectStats] = await Promise.all([
      realpath(projectRoot),
      lstat(projectRoot),
    ]);
    if (comparable(canonicalProject) !== comparable(resolve(projectRoot))
      || projectStats.isSymbolicLink() || !projectStats.isDirectory()) {
      throw new Error("Reference extraction output is fixed at local-assets/reference-extraction.");
    }
    await mkdir(expectedParent).catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    });
    const [canonicalParent, parentStats] = await Promise.all([
      realpath(expectedParent),
      lstat(expectedParent),
    ]);
    if (comparable(canonicalParent) !== comparable(expectedParent)
      || parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
      throw new Error("Reference extraction output is fixed at local-assets/reference-extraction.");
    }
    await mkdir(expectedRoot).catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    });
    const [canonicalRoot, rootStats] = await Promise.all([realpath(expectedRoot), lstat(expectedRoot)]);
    if (comparable(canonicalRoot) !== comparable(expectedRoot)
      || rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new Error("Reference extraction output is fixed at local-assets/reference-extraction.");
    }
    return canonicalRoot;
  } catch (error) {
    if (error instanceof Error && error.message.includes("local-assets/reference-extraction")) throw error;
    throw new Error("Reference extraction output is fixed at local-assets/reference-extraction.", { cause: error });
  }
}

function validatedSourceHash(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Reference extraction requires a verified lowercase source hash.");
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalWorldBytes(world: ReferenceExtractionInputs["referenceWorld"]): Uint8Array {
  return Buffer.from(JSON.stringify(world));
}

function groupedCandidates(candidates: readonly ExtractionCandidate[]): ExtractionCandidate[][] {
  const groups = new Map<string, ExtractionCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.uuid}/r${candidate.rotation}/ox${candidate.offset.x}/oy${candidate.offset.y}`
      + `/span${candidate.footprint.width}x${candidate.footprint.height}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group);
}

export async function renderTargetPreview(
  inputs: ReferenceExtractionInputs,
  acceptedDecisions: readonly CandidateDecision[],
): Promise<Uint8Array> {
  const { bounds } = inputs.targetWorld;
  const columns = bounds.maxX - bounds.minX + 1;
  const rows = bounds.maxY - bounds.minY + 1;
  const width = columns * TARGET_PREVIEW_CELL_SIZE;
  const height = rows * TARGET_PREVIEW_CELL_SIZE;
  const canvas = new Uint8Array(width * height * 4);
  const decisions = new Map<string, CandidateDecision>();
  for (const decision of acceptedDecisions) {
    const candidate = decision.selected;
    if (!candidate || !decision.image) continue;
    const rotation = decision.image.rotation;
    const key = `${candidate.uuid}/r${rotation}/ox${candidate.offset.x}/oy${candidate.offset.y}`;
    decisions.set(key, decision);
  }
  for (const cell of [...inputs.targetWorld.cells].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const decision = decisions.get(`${cell.uuid}/r${cell.rotation}/ox${cell.xOffset}/oy${cell.yOffset}`);
    if (!decision?.image) continue;
    const resized = await sharp(decision.image.pixels, {
      raw: { width: decision.image.width, height: decision.image.height, channels: 3 },
    }).resize(TARGET_PREVIEW_CELL_SIZE, TARGET_PREVIEW_CELL_SIZE, { kernel: "nearest" })
      .ensureAlpha().raw().toBuffer();
    const left = (cell.x - bounds.minX) * TARGET_PREVIEW_CELL_SIZE;
    const top = (bounds.maxY - cell.y) * TARGET_PREVIEW_CELL_SIZE;
    for (let row = 0; row < TARGET_PREVIEW_CELL_SIZE; row += 1) {
      const targetOffset = ((top + row) * width + left) * 4;
      const sourceOffset = row * TARGET_PREVIEW_CELL_SIZE * 4;
      canvas.set(resized.subarray(sourceOffset, sourceOffset + TARGET_PREVIEW_CELL_SIZE * 4), targetOffset);
    }
  }
  return sharp(canvas, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

interface StagedQualityReport {
  status: "passed" | "failed";
  reasons: string[];
  sourceHashes: {
    sourceImageSha256: string;
    referenceWorldSha256: string;
    targetWorldSha256: string;
    targetSaveSha256: string;
  };
  thresholds: ReferenceQualityThresholds;
  imageDifference: { mean: number; maximum: number; samples: number };
  seam: { mean: number; maximum: number; samples: number };
  seamEvidence: {
    state: "measured" | "no-internal-boundaries";
    expectedSamples: number;
    placedToPlaced: number;
    placedToMissing: number;
    missingToMissing: number;
  };
  coverage: Record<"fullReference" | "playableReference" | "targetEligible", {
    type: { covered: number; total: number; ratio: number };
    rotation: { covered: number; total: number; ratio: number };
    cell: { covered: number; total: number; ratio: number };
  }>;
  coverageEvidence: Record<"fullReference" | "playableReference" | "targetEligible", Array<{
    x: number;
    y: number;
    uuid: string;
    rotation: 0 | 1 | 2 | 3;
    groupId: string;
  }>>;
  groups: Array<{
    id: string;
    uuid: string;
    rotation: 0 | 1 | 2 | 3;
    offset: { x: number; y: number };
    footprint: { width: number; height: number };
    selectorStatus: "accepted" | "rejected";
    selectorReasons: string[];
    selected?: unknown;
    rejectedCandidates: unknown[];
    status: "accepted" | "rejected";
    reasons: string[];
    placedReferenceCells: Array<{ x: number; y: number }>;
    imageDifference: { mean: number; maximum: number; samples: number };
    seam: { mean: number; maximum: number; samples: number };
    seamEvidence: { expectedSamples: number };
  }>;
  artifacts: Record<string, { path: string; sha256: string }>;
}

class ReferenceQualityGateError extends Error {
  constructor(readonly summary: ReferenceExtractionSummary) {
    super("Reference extraction failed its quality gate.");
  }
}

const ROOT_MANIFEST_HASH_PLACEHOLDER = "0".repeat(64);

function summaryBytes(summary: ReferenceExtractionSummary): Uint8Array {
  return Buffer.from(`${JSON.stringify(summary, null, 2)}\n`);
}

function rootManifestHash(summary: ReferenceExtractionSummary): string {
  return sha256(summaryBytes({ ...summary, rootManifestSha256: ROOT_MANIFEST_HASH_PLACEHOLDER }));
}

function sealSummary(summary: ReferenceExtractionSummary): Uint8Array {
  for (;;) {
    const measured = summaryBytes(summary).byteLength;
    if (summary.rootManifestBytes === measured) break;
    summary.rootManifestBytes = measured;
  }
  summary.rootManifestSha256 = rootManifestHash(summary);
  const bytes = summaryBytes(summary);
  if (bytes.byteLength !== summary.rootManifestBytes) {
    throw new Error("Reference extraction root manifest byte attestation did not stabilize.");
  }
  return bytes;
}

function safeArtifactPath(path: unknown): path is string {
  if (typeof path !== "string" || path === "" || isAbsolute(path) || path.includes(":")
    || path.includes("\\")) return false;
  const parts = path.split("/");
  return !parts.includes("") && !parts.includes(".") && !parts.includes("..");
}

function validFileArtifact(value: unknown): value is FileArtifactSummary {
  const artifact = value as Partial<FileArtifactSummary> | undefined;
  return exactObjectKeys(value, ["path", "bytes", "sha256"])
    && safeArtifactPath(artifact?.path)
    && Number.isSafeInteger(artifact?.bytes) && (artifact?.bytes ?? -1) >= 0
    && /^[0-9a-f]{64}$/.test(artifact?.sha256 ?? "");
}

function validCandidateArtifact(value: unknown): value is CandidateTreeSummary {
  const artifact = value as Partial<CandidateTreeSummary> | undefined;
  return exactObjectKeys(value, ["path", "files", "bytes", "sha256", "records"])
    && artifact?.path === "candidates"
    && Number.isSafeInteger(artifact.files) && (artifact.files ?? -1) >= 0
    && Number.isSafeInteger(artifact.bytes) && (artifact.bytes ?? -1) >= 0
    && /^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")
    && Array.isArray(artifact.records)
    && artifact.records.length === artifact.files
    && artifact.records.every((record, index) => validCandidateManifestRecord(record)
      && (index === 0 || artifact.records![index - 1]!.path.localeCompare(record.path) < 0))
    && artifact.bytes === artifact.records.reduce((total, record) => total + record.bytes, 0)
    && artifact.sha256 === sha256(Buffer.from(JSON.stringify(artifact.records)));
}

function validCandidateManifestRecord(value: unknown): value is CandidateManifestRecord {
  const record = value as Partial<CandidateManifestRecord> | undefined;
  const provenance = record?.provenance;
  return Boolean(record
      && exactObjectKeys(record, ["path", "bytes", "sha256", "width", "height", "provenance"])
      && safeArtifactPath(record.path)
      && record.path.endsWith(".png")
      && Number.isSafeInteger(record.bytes) && (record.bytes ?? 0) > 0
      && /^[0-9a-f]{64}$/.test(record.sha256 ?? "")
      && Number.isSafeInteger(record.width) && (record.width ?? 0) > 0
      && Number.isSafeInteger(record.height) && (record.height ?? 0) > 0
      && exactObjectKeys(provenance, ["uuid", "rotation", "offset", "footprint", "sourceWorld", "orientation"])
      && typeof provenance?.uuid === "string" && provenance.uuid !== ""
      && [0, 1, 2, 3].includes(provenance.rotation as number)
      && exactObjectKeys(provenance.offset, ["x", "y"])
      && Number.isSafeInteger(provenance.offset?.x) && Number.isSafeInteger(provenance.offset?.y)
      && exactObjectKeys(provenance.footprint, ["width", "height"])
      && Number.isSafeInteger(provenance.footprint?.width) && provenance.footprint!.width > 0
      && Number.isSafeInteger(provenance.footprint?.height) && provenance.footprint!.height > 0
      && exactObjectKeys(provenance.sourceWorld, ["x", "y"])
      && Number.isSafeInteger(provenance.sourceWorld?.x) && Number.isSafeInteger(provenance.sourceWorld?.y)
      && provenance.orientation === DEFAULT_REFERENCE_ORIENTATION);
}

function candidateProvenanceFromPath(path: string): CandidateManifestRecord["provenance"] {
  const match = /^([^/]+)\/r([0-3])-ox([+-]\d+)-oy([+-]\d+)-span([1-9]\d*)x([1-9]\d*)-x([+-]\d+)-y([+-]\d+)-(x-right-y-up)\.png$/.exec(path);
  if (!match) throw new Error("Reference extraction candidate path does not encode canonical provenance.");
  return {
    uuid: match[1]!,
    rotation: Number(match[2]) as 0 | 1 | 2 | 3,
    offset: { x: Number(match[3]), y: Number(match[4]) },
    footprint: { width: Number(match[5]), height: Number(match[6]) },
    sourceWorld: { x: Number(match[7]), y: Number(match[8]) },
    orientation: match[9] as typeof DEFAULT_REFERENCE_ORIENTATION,
  };
}

function expectedCandidateDimensions(
  provenance: CandidateManifestRecord["provenance"],
  source: ReferenceExtractionSummary["provenance"]["sourceImage"],
): { width: number; height: number } {
  const transform = createReferenceTransform({
    imageWidth: source.width,
    imageHeight: source.height,
    bounds: source.bounds,
    orientation: provenance.orientation,
  });
  const edges = transform.cellPixelEdges(provenance.sourceWorld.x, provenance.sourceWorld.y);
  return { width: edges.right - edges.left, height: edges.bottom - edges.top };
}

function exactObjectKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}

function validBounds(value: unknown): value is WorldMap["bounds"] {
  const bounds = value as Partial<WorldMap["bounds"]> | undefined;
  return exactObjectKeys(value, ["minX", "minY", "maxX", "maxY"])
    && [bounds?.minX, bounds?.minY, bounds?.maxX, bounds?.maxY].every(Number.isSafeInteger)
    && bounds!.minX! <= bounds!.maxX! && bounds!.minY! <= bounds!.maxY!;
}

function sameBounds(left: WorldMap["bounds"], right: WorldMap["bounds"]): boolean {
  return left.minX === right.minX && left.minY === right.minY
    && left.maxX === right.maxX && left.maxY === right.maxY;
}

function validMetric(value: unknown): boolean {
  const metric = value as { mean?: unknown; maximum?: unknown; samples?: unknown } | undefined;
  return exactObjectKeys(value, ["mean", "maximum", "samples"])
    && Boolean(metric && typeof metric.mean === "number" && Number.isFinite(metric.mean)
    && metric.mean >= 0 && metric.mean <= 1
    && typeof metric.maximum === "number" && Number.isFinite(metric.maximum)
    && metric.maximum >= 0 && metric.maximum <= 1
    && metric.mean <= metric.maximum
    && Number.isSafeInteger(metric.samples) && (metric.samples as number) >= 0
    && ((metric.samples as number) > 0 || (metric.mean === 0 && metric.maximum === 0)));
}

function validCandidateProvenance(value: unknown, requireReasons: boolean): boolean {
  const candidate = value as {
    sha256?: unknown;
    localFilename?: unknown;
    sourceWorld?: { x?: unknown; y?: unknown };
    sourceRotation?: unknown;
    synthesized?: unknown;
    reasons?: unknown;
  } | undefined;
  const optionalKeys = [
    ...(candidate && Object.hasOwn(candidate, "sourceRotation") ? ["sourceRotation"] : []),
    ...(candidate && Object.hasOwn(candidate, "synthesized") ? ["synthesized"] : []),
    ...(candidate && Object.hasOwn(candidate, "reasons") ? ["reasons"] : []),
  ];
  return Boolean(candidate
    && exactObjectKeys(candidate, ["sha256", "localFilename", "sourceWorld", ...optionalKeys])
    && typeof candidate.sha256 === "string" && /^[0-9a-f]{64}$/.test(candidate.sha256)
    && safeArtifactPath(candidate.localFilename)
    && exactObjectKeys(candidate.sourceWorld, ["x", "y"])
    && Number.isSafeInteger(candidate.sourceWorld?.x) && Number.isSafeInteger(candidate.sourceWorld?.y)
    && (candidate.sourceRotation === undefined || [0, 1, 2, 3].includes(candidate.sourceRotation as number))
    && (candidate.synthesized === undefined || typeof candidate.synthesized === "boolean")
    && (!requireReasons || Array.isArray(candidate.reasons))
    && (candidate.reasons === undefined
      || (Array.isArray(candidate.reasons)
        && candidate.reasons.length > 0
        && candidate.reasons.every((reason) => typeof reason === "string"))));
}

function validCoverage(value: unknown): boolean {
  const domains = ["fullReference", "playableReference", "targetEligible"] as const;
  const metrics = ["type", "rotation", "cell"] as const;
  if (!exactObjectKeys(value, domains)) return false;
  const coverage = value as StagedQualityReport["coverage"];
  return domains.every((domain) => exactObjectKeys(coverage[domain], metrics)
    && metrics.every((metric) => {
      const entry = coverage[domain][metric];
      return exactObjectKeys(entry, ["covered", "ratio", "total"])
        && Number.isSafeInteger(entry.covered) && Number.isSafeInteger(entry.total)
        && entry.covered >= 0 && entry.total >= entry.covered
        && Number.isFinite(entry.ratio) && entry.ratio >= 0 && entry.ratio <= 1
        && entry.ratio === (entry.total === 0 ? 0 : entry.covered / entry.total);
    }));
}

function validCoverageEvidence(value: unknown): value is StagedQualityReport["coverageEvidence"] {
  const domains = ["fullReference", "playableReference", "targetEligible"] as const;
  if (!exactObjectKeys(value, domains)) return false;
  const evidence = value as StagedQualityReport["coverageEvidence"];
  return domains.every((domain) => Array.isArray(evidence[domain])
    && evidence[domain].every((cell, index) => exactObjectKeys(cell, ["x", "y", "uuid", "rotation", "groupId"])
      && Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y)
      && typeof cell.uuid === "string" && cell.uuid !== ""
      && [0, 1, 2, 3].includes(cell.rotation)
      && cell.groupId.startsWith(`${cell.uuid}/r${cell.rotation}/`)
      && (index === 0 || evidence[domain][index - 1]!.y < cell.y
        || (evidence[domain][index - 1]!.y === cell.y && evidence[domain][index - 1]!.x < cell.x)))
    && new Set(evidence[domain].map(({ x, y }) => `${x},${y}`)).size === evidence[domain].length);
}

function derivedCoverage(
  cells: readonly StagedQualityReport["coverageEvidence"]["fullReference"][number][],
  groups: readonly StagedQualityReport["groups"][number][],
  targetDomain = false,
): StagedQualityReport["coverage"]["fullReference"] {
  const accepted = new Map(groups.filter((group) => group.status === "accepted")
    .map((group) => [group.id, new Set(group.placedReferenceCells.map(({ x, y }) => `${x},${y}`))]));
  const covered = cells.filter((cell) => accepted.has(cell.groupId)
    && (targetDomain ? accepted.get(cell.groupId)!.size > 0
      : accepted.get(cell.groupId)!.has(`${cell.x},${cell.y}`)));
  const metric = (count: number, total: number) => ({ count, total, ratio: total === 0 ? 0 : count / total });
  const totalTypes = new Set(cells.map((cell) => cell.uuid)).size;
  const totalRotations = new Set(cells.map((cell) => `${cell.uuid}/r${cell.rotation}`)).size;
  const coveredTypes = new Set(covered.map((cell) => cell.uuid)).size;
  const coveredRotations = new Set(covered.map((cell) => `${cell.uuid}/r${cell.rotation}`)).size;
  const type = metric(coveredTypes, totalTypes);
  const rotation = metric(coveredRotations, totalRotations);
  const cell = metric(covered.length, cells.length);
  return {
    type: { covered: type.count, total: type.total, ratio: type.ratio },
    rotation: { covered: rotation.count, total: rotation.total, ratio: rotation.ratio },
    cell: { covered: cell.count, total: cell.total, ratio: cell.ratio },
  };
}

function validDerivedCoverage(report: StagedQualityReport): boolean {
  const evidence = report.coverageEvidence;
  const playable = evidence.fullReference.filter((cell) => cell.x >= CALIBRATED_PLAYABLE_BOUNDS.minX
    && cell.x <= CALIBRATED_PLAYABLE_BOUNDS.maxX && cell.y >= CALIBRATED_PLAYABLE_BOUNDS.minY
    && cell.y <= CALIBRATED_PLAYABLE_BOUNDS.maxY);
  return JSON.stringify(evidence.playableReference) === JSON.stringify(playable)
    && JSON.stringify(report.coverage.fullReference)
      === JSON.stringify(derivedCoverage(evidence.fullReference, report.groups))
    && JSON.stringify(report.coverage.playableReference)
      === JSON.stringify(derivedCoverage(evidence.playableReference, report.groups))
    && JSON.stringify(report.coverage.targetEligible)
      === JSON.stringify(derivedCoverage(evidence.targetEligible, report.groups, true));
}

function worldCoverageCells(
  world: WorldMap,
  eligibleUuids?: ReadonlySet<string>,
): StagedQualityReport["coverageEvidence"]["fullReference"] {
  return world.cells
    .filter((cell) => !eligibleUuids || eligibleUuids.has(cell.uuid))
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      uuid: cell.uuid,
      rotation: cell.rotation,
      groupId: `${cell.uuid}/r${cell.rotation}/ox${cell.xOffset}/oy${cell.yOffset}`,
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function parseAttestedWorld(bytes: Uint8Array, expectedHash: string): WorldMap {
  if (sha256(bytes) !== expectedHash) {
    throw new Error("Reference extraction complete report has inconsistent provenance evidence.");
  }
  let world: WorldMap;
  try {
    world = JSON.parse(Buffer.from(bytes).toString("utf8")) as WorldMap;
  } catch (error) {
    throw new Error("Reference extraction complete report has invalid world provenance.", { cause: error });
  }
  if (!world || !Array.isArray(world.cells) || !world.bounds) {
    throw new Error("Reference extraction complete report has invalid world provenance.");
  }
  return world;
}

function validThresholds(value: unknown): boolean {
  if (!exactObjectKeys(value, Object.keys(DEFAULT_REFERENCE_QUALITY_THRESHOLDS))) return false;
  const thresholds = value as ReferenceQualityThresholds;
  return Object.entries(DEFAULT_REFERENCE_QUALITY_THRESHOLDS)
    .every(([name, expected]) => thresholds[name as keyof ReferenceQualityThresholds] === expected);
}

function validSeamEvidence(value: unknown, seamSamples: number): boolean {
  if (!exactObjectKeys(value, [
    "state", "expectedSamples", "placedToPlaced", "placedToMissing", "missingToMissing",
  ])) return false;
  const evidence = value as StagedQualityReport["seamEvidence"];
  const classes = [evidence.placedToPlaced, evidence.placedToMissing, evidence.missingToMissing];
  return [evidence.expectedSamples, ...classes].every((entry) => Number.isSafeInteger(entry) && entry >= 0)
    && classes.reduce((total, entry) => total + entry, 0) === evidence.expectedSamples
    && evidence.expectedSamples === seamSamples
    && ((evidence.state === "measured" && evidence.expectedSamples > 0)
      || (evidence.state === "no-internal-boundaries" && evidence.expectedSamples === 0));
}

function validQualityGroups(value: unknown): value is StagedQualityReport["groups"] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((entry: unknown) => {
    const group = entry as StagedQualityReport["groups"][number] | undefined;
    const expectedKeys = [
      "id", "uuid", "rotation", "offset", "footprint", "selectorStatus", "selectorReasons",
      ...(group && Object.hasOwn(group, "selected") ? ["selected"] : []),
      "rejectedCandidates", "placedReferenceCells", "imageDifference", "seam", "seamEvidence",
      "status", "reasons",
    ];
    if (!group || !exactObjectKeys(group, expectedKeys)
      || typeof group.id !== "string" || group.id === "" || ids.has(group.id)
      || typeof group.uuid !== "string" || group.uuid === ""
      || ![0, 1, 2, 3].includes(group.rotation)
      || !exactObjectKeys(group.offset, ["x", "y"])
      || !Number.isSafeInteger(group.offset.x) || !Number.isSafeInteger(group.offset.y)
      || !exactObjectKeys(group.footprint, ["width", "height"])
      || !Number.isSafeInteger(group.footprint.width) || group.footprint.width <= 0
      || !Number.isSafeInteger(group.footprint.height) || group.footprint.height <= 0
      || (group.selectorStatus !== "accepted" && group.selectorStatus !== "rejected")
      || (group.status !== "accepted" && group.status !== "rejected")
      || !Array.isArray(group.selectorReasons) || !group.selectorReasons.every((reason) => typeof reason === "string")
      || !Array.isArray(group.reasons) || !group.reasons.every((reason) => typeof reason === "string")
      || !Array.isArray(group.rejectedCandidates)
      || !group.rejectedCandidates.every((candidate) => validCandidateProvenance(candidate, true))
      || !Array.isArray(group.placedReferenceCells)
      || !group.placedReferenceCells.every((coordinate) => exactObjectKeys(coordinate, ["x", "y"])
        && Number.isSafeInteger(coordinate.x) && Number.isSafeInteger(coordinate.y))
      || !validMetric(group.imageDifference) || !validMetric(group.seam)
      || !exactObjectKeys(group.seamEvidence, ["expectedSamples"])
      || !Number.isSafeInteger(group.seamEvidence.expectedSamples) || group.seamEvidence.expectedSamples < 0
      || group.seam.samples !== group.seamEvidence.expectedSamples
      || group.id !== `${group.uuid}/r${group.rotation}/ox${group.offset.x}/oy${group.offset.y}`
      || new Set(group.placedReferenceCells.map(({ x, y }) => `${x},${y}`)).size
        !== group.placedReferenceCells.length
      || group.placedReferenceCells.some((coordinate, index) => index > 0
        && (coordinate.y < group.placedReferenceCells[index - 1]!.y
          || (coordinate.y === group.placedReferenceCells[index - 1]!.y
            && coordinate.x < group.placedReferenceCells[index - 1]!.x)))
      || (group.selectorStatus === "accepted"
        ? !validCandidateProvenance(group.selected, false)
          || !(group.selected as { localFilename: string }).localFilename.startsWith(`${group.uuid}/`)
        : Object.hasOwn(group, "selected") || group.status !== "rejected"
          || group.placedReferenceCells.length !== 0
          || group.imageDifference.samples !== 0 || group.seam.samples !== 0)
      || group.rejectedCandidates.some((candidate) =>
        !(candidate as { localFilename: string }).localFilename.startsWith(`${group.uuid}/`))) return false;
    ids.add(group.id);
    return true;
  });
}

function expectedGroupReasons(group: StagedQualityReport["groups"][number]): string[] {
  const reasons = [...group.selectorReasons];
  if (group.selectorStatus === "accepted") {
    if (group.imageDifference.mean > DEFAULT_REFERENCE_QUALITY_THRESHOLDS.maximumGroupMeanImageDifference) {
      reasons.push("group-image-difference-exceeded");
    }
    if (group.imageDifference.maximum > DEFAULT_REFERENCE_QUALITY_THRESHOLDS.maximumGroupPixelImageDifference) {
      reasons.push("group-maximum-image-difference-exceeded");
    }
    if (group.seam.mean > DEFAULT_REFERENCE_QUALITY_THRESHOLDS.maximumGroupMeanSeamError) {
      reasons.push("group-seam-error-exceeded");
    }
    if (group.seam.maximum > DEFAULT_REFERENCE_QUALITY_THRESHOLDS.maximumGroupSeamError) {
      reasons.push("group-maximum-seam-error-exceeded");
    }
    if (group.placedReferenceCells.length === 0) reasons.push("no-reference-cells-placed");
  }
  return reasons;
}

function expectedGlobalReasons(report: StagedQualityReport): string[] {
  const thresholds = DEFAULT_REFERENCE_QUALITY_THRESHOLDS;
  const reasons: string[] = [];
  if (report.imageDifference.mean > thresholds.maximumMeanImageDifference) {
    reasons.push("mean-image-difference-exceeded");
  }
  if (report.imageDifference.maximum > thresholds.maximumPixelImageDifference) {
    reasons.push("maximum-image-difference-exceeded");
  }
  if (report.seam.mean > thresholds.maximumMeanSeamError) reasons.push("mean-seam-error-exceeded");
  if (report.seam.maximum > thresholds.maximumSeamError) reasons.push("maximum-seam-error-exceeded");
  if (report.coverage.fullReference.type.ratio < thresholds.minimumFullReferenceTypeCoverage) {
    reasons.push("full-reference-type-coverage-below-minimum");
  }
  if (report.coverage.fullReference.rotation.ratio < thresholds.minimumFullReferenceRotationCoverage) {
    reasons.push("full-reference-rotation-coverage-below-minimum");
  }
  if (report.coverage.fullReference.cell.ratio < thresholds.minimumFullReferenceCellCoverage) {
    reasons.push("full-reference-cell-coverage-below-minimum");
  }
  if (report.coverage.playableReference.cell.ratio < thresholds.minimumPlayableCellCoverage) {
    reasons.push("playable-reference-cell-coverage-below-minimum");
  }
  if (report.coverage.targetEligible.cell.ratio < thresholds.minimumTargetEligibleCellCoverage) {
    reasons.push("target-eligible-cell-coverage-below-minimum");
  }
  return reasons;
}

function validQualityOutcomes(report: StagedQualityReport): boolean {
  if (!validQualityGroups(report.groups)) return false;
  const reasons = expectedGlobalReasons(report);
  return report.status === (reasons.length === 0 ? "passed" : "failed")
    && JSON.stringify(report.reasons) === JSON.stringify(reasons)
    && validDerivedCoverage(report)
    && report.groups.every((group) => {
      const groupReasons = expectedGroupReasons(group);
      return group.status === (group.selectorStatus === "accepted" && groupReasons.length === 0
        ? "accepted" : "rejected")
        && JSON.stringify(group.reasons) === JSON.stringify(groupReasons);
    });
}

function validStringArray(value: unknown, expectedCount: unknown): value is string[] {
  return Array.isArray(value) && value.length === expectedCount
    && value.every((entry) => typeof entry === "string")
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1]!.localeCompare(entry) <= 0);
}

function validSummary(value: unknown, sourceHash: string): value is ReferenceExtractionSummary {
  const summary = value as Partial<ReferenceExtractionSummary> | undefined;
  const inventory = summary?.inventory;
  const provenance = summary?.provenance;
  const artifacts = summary?.artifacts;
  const counters = summary && [summary.candidates, summary.candidateGroups,
    summary.selectorAcceptedGroups, summary.selectorRejectedGroups,
    summary.qualityAcceptedGroups, summary.qualityRejectedGroups,
    summary.qualityAcceptedCells, summary.qualityRejectedCells];
  return Boolean(summary
    && exactObjectKeys(summary, [
      "schemaVersion", "rootManifestSha256", "rootManifestBytes", "status", "reasons", "checkedInputHashes", "provenance",
      "orientation", "inventory", "candidates", "candidateGroups", "selectorAcceptedGroups",
      "selectorRejectedGroups", "qualityAcceptedGroups", "qualityRejectedGroups",
      "qualityAcceptedCells", "qualityRejectedCells", "thresholds", "coverage", "artifacts",
    ])
    && summary.schemaVersion === 2
    && /^[0-9a-f]{64}$/.test(summary.rootManifestSha256 ?? "")
    && Number.isSafeInteger(summary.rootManifestBytes) && (summary.rootManifestBytes ?? 0) > 0
    && summary.rootManifestSha256 === rootManifestHash(summary as ReferenceExtractionSummary)
    && (summary.status === "passed" || summary.status === "failed")
    && Array.isArray(summary.reasons) && summary.reasons.every((reason) => typeof reason === "string")
    && ((summary.status === "passed" && summary.reasons.length === 0)
      || (summary.status === "failed" && summary.reasons.length > 0))
    && JSON.stringify(summary.checkedInputHashes) === JSON.stringify(CALIBRATED_REFERENCE_INPUT_HASHES)
    && summary.orientation === DEFAULT_REFERENCE_ORIENTATION
    && exactObjectKeys(provenance, [
      "sourceImage", "referenceWorld", "buildInfo", "catalog", "defaultSave", "targetSave", "targetWorld",
    ])
    && exactObjectKeys(provenance?.sourceImage, ["sha256", "width", "height", "bounds"])
    && Number.isSafeInteger(provenance?.sourceImage?.width) && (provenance?.sourceImage?.width ?? 0) > 0
    && Number.isSafeInteger(provenance?.sourceImage?.height) && (provenance?.sourceImage?.height ?? 0) > 0
    && validBounds(provenance?.sourceImage?.bounds)
    && exactObjectKeys(provenance?.referenceWorld, ["fileSha256", "canonicalSha256"])
    && exactObjectKeys(provenance?.buildInfo, ["sha256"])
    && exactObjectKeys(provenance?.catalog, ["sha256"])
    && exactObjectKeys(provenance?.defaultSave, ["sha256"])
    && exactObjectKeys(provenance?.targetSave, ["sha256"])
    && exactObjectKeys(provenance?.targetWorld, ["canonicalSha256"])
    && provenance?.sourceImage?.sha256 === sourceHash
    && (sourceHash !== CALIBRATED_REFERENCE_INPUT_HASHES.sourceImageSha256
      || (provenance.sourceImage.width === CALIBRATED_REFERENCE_SOURCE.width
        && provenance.sourceImage.height === CALIBRATED_REFERENCE_SOURCE.height
        && sameBounds(provenance.sourceImage.bounds, CALIBRATED_REFERENCE_BOUNDS)))
    && provenance.referenceWorld?.fileSha256 === CALIBRATED_REFERENCE_INPUT_HASHES.referenceWorldSha256
    && provenance.buildInfo?.sha256 === CALIBRATED_REFERENCE_INPUT_HASHES.buildInfoSha256
    && provenance.catalog?.sha256 === CALIBRATED_REFERENCE_INPUT_HASHES.catalogSha256
    && provenance.defaultSave?.sha256 === CALIBRATED_REFERENCE_INPUT_HASHES.defaultSaveSha256
    && [provenance.referenceWorld?.canonicalSha256, provenance.targetSave?.sha256,
      provenance.targetWorld?.canonicalSha256].every((hash) => /^[0-9a-f]{64}$/.test(hash ?? ""))
    && exactObjectKeys(inventory, [
      "expectedShared", "sharedCount", "shared", "referenceOnlyCount", "referenceOnly",
      "targetOnlyCount", "targetOnly",
    ])
    && Number.isSafeInteger(inventory?.expectedShared) && (inventory?.expectedShared ?? 0) > 0
    && inventory?.sharedCount === inventory?.expectedShared
    && validStringArray(inventory?.shared, inventory?.sharedCount)
    && Number.isSafeInteger(inventory?.referenceOnlyCount) && (inventory?.referenceOnlyCount ?? -1) >= 0
    && validStringArray(inventory?.referenceOnly, inventory?.referenceOnlyCount)
    && Number.isSafeInteger(inventory?.targetOnlyCount) && (inventory?.targetOnlyCount ?? -1) >= 0
    && validStringArray(inventory?.targetOnly, inventory?.targetOnlyCount)
    && counters?.every((counter) => Number.isSafeInteger(counter) && (counter ?? -1) >= 0)
    && summary.selectorAcceptedGroups! + summary.selectorRejectedGroups! === summary.candidateGroups
    && summary.qualityAcceptedGroups! + summary.qualityRejectedGroups! === summary.candidateGroups
    && summary.thresholds
    && exactObjectKeys(summary.thresholds, ["candidate", "quality"])
    && JSON.stringify(summary.thresholds.candidate) === JSON.stringify(DEFAULT_CANDIDATE_THRESHOLDS)
    && JSON.stringify(summary.thresholds.quality) === JSON.stringify(DEFAULT_REFERENCE_QUALITY_THRESHOLDS)
    && validCoverage(summary.coverage)
    && exactObjectKeys(artifacts, [
      "candidates", "referenceWorld", "targetWorld", "reconstruction", "difference", "targetPreview", "qualityReport",
    ])
    && validCandidateArtifact(artifacts?.candidates)
    && validFileArtifact(artifacts?.referenceWorld)
    && validFileArtifact(artifacts?.targetWorld)
    && validFileArtifact(artifacts?.reconstruction)
    && validFileArtifact(artifacts?.difference)
    && validFileArtifact(artifacts?.targetPreview)
    && validFileArtifact(artifacts?.qualityReport)
    && artifacts?.reconstruction.path === "default-reconstruction.webp"
    && artifacts?.referenceWorld.path === "reference-world.json"
    && artifacts?.targetWorld.path === "target-world.json"
    && artifacts?.difference.path === "default-difference.png"
    && artifacts?.targetPreview.path.endsWith("-preview.png")
    && artifacts?.qualityReport.path === "quality-report.json");
}

function summaryInvalidReason(value: unknown, sourceHash: string): string {
  const summary = value as Partial<ReferenceExtractionSummary> | undefined;
  if (!summary) return "missing";
  if (summary.rootManifestSha256 !== rootManifestHash(summary as ReferenceExtractionSummary)) return "root-manifest-hash";
  if (summary.provenance?.sourceImage?.sha256 !== sourceHash) return "source";
  if (!validCoverage(summary.coverage)) return "coverage";
  if (!validCandidateArtifact(summary.artifacts?.candidates)) return "candidates";
  const inventory = summary.inventory;
  if (!inventory || inventory.sharedCount !== inventory.expectedShared
    || !validStringArray(inventory.shared, inventory.sharedCount)) return "inventory";
  if (summary.selectorAcceptedGroups! + summary.selectorRejectedGroups! !== summary.candidateGroups
    || summary.qualityAcceptedGroups! + summary.qualityRejectedGroups! !== summary.candidateGroups) {
    return "counts";
  }
  if (!summary.thresholds || JSON.stringify(summary.thresholds.candidate) !== JSON.stringify(DEFAULT_CANDIDATE_THRESHOLDS)
    || JSON.stringify(summary.thresholds.quality) !== JSON.stringify(DEFAULT_REFERENCE_QUALITY_THRESHOLDS)) {
    return "thresholds";
  }
  if (!summary.artifacts || !validFileArtifact(summary.artifacts.reconstruction)
    || !validFileArtifact(summary.artifacts.referenceWorld)
    || !validFileArtifact(summary.artifacts.targetWorld)
    || !validFileArtifact(summary.artifacts.difference)
    || !validFileArtifact(summary.artifacts.targetPreview)
    || !validFileArtifact(summary.artifacts.qualityReport)) return "artifacts";
  return "schema";
}

async function fileArtifact(stagingDirectory: string, path: string): Promise<FileArtifactSummary> {
  const bytes = await readFile(join(stagingDirectory, ...path.split("/")));
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function candidateTreeArtifact(stagingDirectory: string): Promise<CandidateTreeSummary> {
  const root = join(stagingDirectory, "candidates");
  const records: CandidateManifestRecord[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    if (directory !== root && entries.length === 0) {
      throw new Error("Reference extraction candidate tree contains an unmanifested empty directory.");
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new Error("Reference extraction candidate tree contains an unsafe entry.");
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        const localPath = relative(root, path).split(sep).join("/");
        const bytes = await readFile(path);
        const metadata = await sharp(bytes, { failOn: "error" }).metadata();
        if (metadata.format !== "png" || !metadata.width || !metadata.height) {
          throw new Error("Reference extraction candidate manifest contains an invalid PNG.");
        }
        records.push({
          path: localPath,
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          width: metadata.width,
          height: metadata.height,
          provenance: candidateProvenanceFromPath(localPath),
        });
      }
    }
  };
  await walk(root);
  records.sort((left, right) => left.path.localeCompare(right.path));
  return {
    path: "candidates",
    files: records.length,
    bytes: records.reduce((total, entry) => total + entry.bytes, 0),
    sha256: sha256(Buffer.from(JSON.stringify(records))),
    records,
  };
}

function validCandidateManifestProvenance(
  candidate: CandidateTreeSummary,
  source: ReferenceExtractionSummary["provenance"]["sourceImage"],
  referenceWorld: WorldMap,
): boolean {
  const worldCells = new Map(referenceWorld.cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
  return candidate.records.every((record) => {
    const provenance = record.provenance;
    const cell = worldCells.get(`${provenance.sourceWorld.x},${provenance.sourceWorld.y}`);
    const expectedDimensions = expectedCandidateDimensions(provenance, source);
    return cell?.uuid === provenance.uuid && cell.rotation === provenance.rotation
      && cell.xOffset === provenance.offset.x && cell.yOffset === provenance.offset.y
      && provenance.offset.x >= 0 && provenance.offset.y >= 0
      && provenance.offset.x < provenance.footprint.width
      && provenance.offset.y < provenance.footprint.height
      && record.width === expectedDimensions.width && record.height === expectedDimensions.height;
  });
}

async function assertExactRunManifest(
  stagingDirectory: string,
  summary: ReferenceExtractionSummary,
): Promise<void> {
  const expectedFiles = new Set([
    "run-summary.json",
    summary.artifacts.referenceWorld.path,
    summary.artifacts.targetWorld.path,
    summary.artifacts.reconstruction.path,
    summary.artifacts.difference.path,
    summary.artifacts.targetPreview.path,
    summary.artifacts.qualityReport.path,
  ]);
  const entries = await readdir(stagingDirectory, { withFileTypes: true });
  const rootFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const rootDirectories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (entries.some((entry) => entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
    || rootDirectories.length !== 1 || rootDirectories[0] !== "candidates"
    || rootFiles.length !== expectedFiles.size
    || rootFiles.some((path) => !expectedFiles.has(path))
    || [...expectedFiles].some((path) => path.includes("/") || !rootFiles.includes(path))) {
    throw new Error("Reference extraction run tree does not match its exact root manifest.");
  }
}

async function assertSafeCanonicalDirectory(
  trustedRoot: string,
  directory: string,
  allowCreate: boolean,
): Promise<string> {
  const trusted = resolve(await realpath(trustedRoot));
  let canonical: string;
  try {
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("unsafe");
    canonical = resolve(await realpath(directory));
  } catch (error) {
    if (!allowCreate || !(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new Error("Reference extraction promotion requires a safe canonical directory.", { cause: error });
    }
    const parent = dirname(directory);
    const canonicalParent = resolve(await realpath(parent));
    const parentMetadata = await lstat(parent);
    if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
      throw new Error("Reference extraction promotion requires a safe canonical directory.");
    }
    canonical = resolve(canonicalParent, basename(directory));
  }
  const difference = relative(comparable(trusted), comparable(canonical));
  if (difference === "" || difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
    throw new Error("Reference extraction promotion requires a safe canonical directory.");
  }
  return canonical;
}

async function verifyImageFormat(path: string, expected: "webp" | "png"): Promise<void> {
  try {
    // Decode from owned bytes so libvips cannot retain a Windows file handle across promotion.
    const metadata = await sharp(await readFile(path)).metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height) throw new Error("format");
  } catch (error) {
    throw new Error(`Reference extraction required ${expected.toUpperCase()} artifact is invalid.`, { cause: error });
  }
}

interface VerifiedStagedOutput {
  report: StagedQualityReport;
  summary: ReferenceExtractionSummary;
}

interface CurrentRunPointer {
  schemaVersion: 2;
  runDirectory: string;
  rootManifestSha256: string;
}

async function verifyStagedOutput(
  stagingDirectory: string,
  sourceHash: string,
  expectedSharedUuids: number,
): Promise<VerifiedStagedOutput> {
  let report: StagedQualityReport;
  try {
    report = JSON.parse(await readFile(join(stagingDirectory, "quality-report.json"), "utf8")) as StagedQualityReport;
  } catch (error) {
    throw new Error("Reference extraction quality report is unavailable or invalid.", { cause: error });
  }
  const requiredArtifacts = ["reconstruction", "difference", "targetPreview"] as const;
  if (!exactObjectKeys(report, [
    "status", "reasons", "sourceHashes", "thresholds", "imageDifference", "seam", "seamEvidence",
    "coverage", "coverageEvidence", "groups", "artifacts",
  ])
    || !exactObjectKeys(report.sourceHashes, [
      "sourceImageSha256", "referenceWorldSha256", "targetWorldSha256", "targetSaveSha256",
    ])
    || report.sourceHashes?.sourceImageSha256 !== sourceHash
    || !/^[0-9a-f]{64}$/.test(report.sourceHashes?.referenceWorldSha256 ?? "")
    || !/^[0-9a-f]{64}$/.test(report.sourceHashes?.targetWorldSha256 ?? "")
    || !/^[0-9a-f]{64}$/.test(report.sourceHashes?.targetSaveSha256 ?? "")
    || !Array.isArray(report.reasons) || !Array.isArray(report.groups)
    || !validThresholds(report.thresholds)
      || !validMetric(report.imageDifference) || !validMetric(report.seam)
    || !validSeamEvidence(report.seamEvidence, report.seam?.samples)
    || !validCoverage(report.coverage)
    || !validCoverageEvidence(report.coverageEvidence)
      || !exactObjectKeys(report.artifacts, requiredArtifacts)) {
    throw new Error("Reference extraction complete report is unavailable or invalid.");
  }
  if (!validQualityOutcomes(report)) {
    throw new Error("Reference extraction complete report has inconsistent quality evidence.");
  }
  for (const artifact of Object.values(report.artifacts)) {
    const parts = artifact?.path?.split("/") ?? [];
    if (!exactObjectKeys(artifact, ["path", "sha256"])
      || !artifact || typeof artifact.path !== "string" || isAbsolute(artifact.path)
      || artifact.path === "" || parts.includes("..") || parts.includes("")
      || artifact.path.includes(":") || artifact.path.includes("\\")
      || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error("Reference extraction quality report contains an unsafe artifact.");
    }
    let bytes: Uint8Array;
    try {
      bytes = await readFile(join(stagingDirectory, artifact.path));
    } catch (error) {
      throw new Error("Reference extraction quality report references a missing artifact.", { cause: error });
    }
    if (sha256(bytes) !== artifact.sha256) {
      throw new Error("Reference extraction quality report contains an artifact hash mismatch.");
    }
  }
  let summary: unknown;
  let rawSummary: Uint8Array;
  try {
    rawSummary = await readFile(join(stagingDirectory, "run-summary.json"));
    summary = JSON.parse(Buffer.from(rawSummary).toString("utf8"));
  } catch (error) {
    throw new Error("Reference extraction complete report is unavailable or invalid.", { cause: error });
  }
  if (!validSummary(summary, sourceHash)) {
    throw new Error(
      `Reference extraction complete report is unavailable or invalid (${summaryInvalidReason(summary, sourceHash)}).`,
    );
  }
  if (summary.rootManifestBytes !== rawSummary.byteLength) {
    throw new Error("Reference extraction root manifest byte attestation is invalid.");
  }
  await assertExactRunManifest(stagingDirectory, summary);
  if (summary.inventory.expectedShared !== expectedSharedUuids
    || summary.inventory.sharedCount !== expectedSharedUuids) {
    throw new Error("Reference extraction complete report has an unexpected shared UUID inventory.");
  }
  if (summary.status !== report.status
    || JSON.stringify(summary.reasons) !== JSON.stringify(report.reasons)
    || JSON.stringify(summary.thresholds.quality) !== JSON.stringify(report.thresholds)
    || JSON.stringify(summary.coverage) !== JSON.stringify(report.coverage)) {
    throw new Error("Reference extraction complete report has inconsistent quality evidence.");
  }
  if (summary.provenance.referenceWorld.canonicalSha256 !== report.sourceHashes.referenceWorldSha256
    || summary.provenance.targetWorld.canonicalSha256 !== report.sourceHashes.targetWorldSha256
    || summary.provenance.targetSave.sha256 !== report.sourceHashes.targetSaveSha256) {
    throw new Error("Reference extraction complete report has inconsistent provenance evidence.");
  }
  let referenceWorldBytes: Uint8Array;
  let targetWorldBytes: Uint8Array;
  try {
    [referenceWorldBytes, targetWorldBytes] = await Promise.all([
      readFile(join(stagingDirectory, "reference-world.json")),
      readFile(join(stagingDirectory, "target-world.json")),
    ]);
  } catch (error) {
    throw new Error("Reference extraction complete report has invalid world provenance.", { cause: error });
  }
  const referenceWorld = parseAttestedWorld(
    referenceWorldBytes,
    summary.provenance.referenceWorld.canonicalSha256,
  );
  const targetWorld = parseAttestedWorld(targetWorldBytes, summary.provenance.targetWorld.canonicalSha256);
  if (!sameBounds(summary.provenance.sourceImage.bounds, referenceWorld.bounds)) {
    throw new Error("Reference extraction complete report has inconsistent source geometry provenance.");
  }
  const playableReference = {
    ...referenceWorld,
    cells: referenceWorld.cells.filter((cell) => cell.x >= CALIBRATED_PLAYABLE_BOUNDS.minX
      && cell.x <= CALIBRATED_PLAYABLE_BOUNDS.maxX
      && cell.y >= CALIBRATED_PLAYABLE_BOUNDS.minY
      && cell.y <= CALIBRATED_PLAYABLE_BOUNDS.maxY),
  };
  const inventory = compareWorldUuidSets(playableReference, targetWorld);
  if (summary.inventory.sharedCount !== inventory.shared.length
    || summary.inventory.referenceOnlyCount !== inventory.referenceOnly.length
    || summary.inventory.targetOnlyCount !== inventory.targetOnly.length
    || JSON.stringify(summary.inventory.shared) !== JSON.stringify(inventory.shared)
    || JSON.stringify(summary.inventory.referenceOnly) !== JSON.stringify(inventory.referenceOnly)
    || JSON.stringify(summary.inventory.targetOnly) !== JSON.stringify(inventory.targetOnly)
    || inventory.shared.length !== expectedSharedUuids) {
    throw new Error("Reference extraction complete report has an unexpected UUID inventory.");
  }
  const shared = new Set(inventory.shared);
  const expectedFullEvidence = worldCoverageCells(referenceWorld);
  const expectedTargetEvidence = worldCoverageCells(targetWorld, shared);
  if (JSON.stringify(report.coverageEvidence.fullReference) !== JSON.stringify(expectedFullEvidence)
    || JSON.stringify(report.coverageEvidence.targetEligible) !== JSON.stringify(expectedTargetEvidence)) {
    throw new Error("Reference extraction complete report has inconsistent quality evidence.");
  }
  const actualArtifacts = {
    candidates: await candidateTreeArtifact(stagingDirectory),
    referenceWorld: await fileArtifact(stagingDirectory, "reference-world.json"),
    targetWorld: await fileArtifact(stagingDirectory, "target-world.json"),
    reconstruction: await fileArtifact(stagingDirectory, report.artifacts.reconstruction!.path),
    difference: await fileArtifact(stagingDirectory, report.artifacts.difference!.path),
    targetPreview: await fileArtifact(stagingDirectory, report.artifacts.targetPreview!.path),
    qualityReport: await fileArtifact(stagingDirectory, "quality-report.json"),
  };
  if (JSON.stringify(actualArtifacts) !== JSON.stringify(summary.artifacts)
    || summary.artifacts.reconstruction.sha256 !== report.artifacts.reconstruction!.sha256
    || summary.artifacts.difference.sha256 !== report.artifacts.difference!.sha256
    || summary.artifacts.targetPreview.sha256 !== report.artifacts.targetPreview!.sha256) {
    throw new Error("Reference extraction complete report contains an artifact attestation mismatch.");
  }
  if (summary.artifacts.referenceWorld.sha256 !== summary.provenance.referenceWorld.canonicalSha256
    || summary.artifacts.targetWorld.sha256 !== summary.provenance.targetWorld.canonicalSha256) {
    throw new Error("Reference extraction complete report has inconsistent provenance evidence.");
  }
  if (!validCandidateManifestProvenance(actualArtifacts.candidates, summary.provenance.sourceImage, referenceWorld)) {
    throw new Error("Reference extraction candidate manifest has inconsistent provenance or dimensions.");
  }
  const candidateRecords = new Map(actualArtifacts.candidates.records.map((record) => [record.path, record]));
  const selectedReferences = report.groups.flatMap((group) => group.selected ? [{ group, candidate: group.selected }] : []) as Array<{
    group: StagedQualityReport["groups"][number];
    candidate: {
      sha256: string;
      localFilename: string;
      sourceWorld: { x: number; y: number };
      sourceRotation?: number;
    };
  }>;
  const rejectedReferences = report.groups.flatMap((group) => group.rejectedCandidates.map((candidate) => ({
    group,
    candidate,
  }))) as typeof selectedReferences;
  const referencedCandidates = [...selectedReferences, ...rejectedReferences];
  if (referencedCandidates.some(({ group, candidate }) => {
    const record = candidateRecords.get(candidate.localFilename);
    return !record || record.sha256 !== candidate.sha256
      || record.provenance.uuid !== group.uuid
      || record.provenance.rotation !== group.rotation
      || record.provenance.offset.x !== group.offset.x
      || record.provenance.offset.y !== group.offset.y
      || record.provenance.footprint.width !== group.footprint.width
      || record.provenance.footprint.height !== group.footprint.height
      || JSON.stringify(record.provenance.sourceWorld) !== JSON.stringify(candidate.sourceWorld)
      || (candidate.sourceRotation !== undefined
        && record.provenance.rotation !== candidate.sourceRotation);
  })) {
    throw new Error("Reference extraction candidate provenance does not match the candidate manifest.");
  }
  const acceptedCells = report.groups.filter((group) => group.status === "accepted")
    .reduce((total, group) => total + group.placedReferenceCells.length, 0);
  if (summary.candidates !== actualArtifacts.candidates.files
    || summary.candidateGroups !== report.groups.length
    || summary.selectorAcceptedGroups !== report.groups
      .filter((group) => (group.selectorStatus ?? group.status) === "accepted").length
    || summary.selectorRejectedGroups !== report.groups
      .filter((group) => (group.selectorStatus ?? group.status) === "rejected").length
    || summary.qualityAcceptedGroups !== report.groups.filter((group) => group.status === "accepted").length
    || summary.qualityRejectedGroups !== report.groups.filter((group) => group.status === "rejected").length
    || summary.qualityAcceptedCells !== acceptedCells
    || summary.qualityRejectedCells !== report.coverage.fullReference.cell.total - acceptedCells) {
    throw new Error("Reference extraction complete report has inconsistent candidate and selection counts.");
  }
  await Promise.all([
    verifyImageFormat(join(stagingDirectory, summary.artifacts.reconstruction.path), "webp"),
    verifyImageFormat(join(stagingDirectory, summary.artifacts.difference.path), "png"),
    verifyImageFormat(join(stagingDirectory, summary.artifacts.targetPreview.path), "png"),
  ]);
  return { report, summary };
}

export async function resolveReferenceExtractionCurrentRun(
  finalDirectory: string,
  sourceHash: string,
  expectedSharedUuids = DEFAULT_EXPECTED_SHARED_UUIDS,
  trustedLocalRoot = dirname(finalDirectory),
): Promise<string> {
  const canonicalFinal = await assertSafeCanonicalDirectory(trustedLocalRoot, finalDirectory, false);
  const runsDirectory = join(canonicalFinal, "runs");
  await assertSafeCanonicalDirectory(trustedLocalRoot, runsDirectory, false);
  let pointer: CurrentRunPointer;
  try {
    pointer = JSON.parse(await readFile(join(canonicalFinal, "current.json"), "utf8")) as CurrentRunPointer;
  } catch (error) {
    throw new Error("Reference extraction current pointer is unavailable or invalid.", { cause: error });
  }
  if (!exactObjectKeys(pointer, ["schemaVersion", "runDirectory", "rootManifestSha256"])
    || pointer.schemaVersion !== 2
    || !/^[0-9a-f]{64}$/.test(pointer.rootManifestSha256)
    || pointer.runDirectory !== `runs/${pointer.rootManifestSha256}`) {
    throw new Error("Reference extraction current pointer is unavailable or invalid.");
  }
  const runDirectory = join(canonicalFinal, "runs", pointer.rootManifestSha256);
  const rootDifference = relative(canonicalFinal, resolve(runDirectory));
  if (rootDifference.startsWith(`..${sep}`) || isAbsolute(rootDifference)) {
    throw new Error("Reference extraction current pointer escapes its output directory.");
  }
  let metadata;
  try {
    metadata = await lstat(runDirectory);
  } catch (error) {
    throw new Error("Reference extraction current run is unavailable.", { cause: error });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Reference extraction current run is unsafe.");
  }
  const canonicalRun = resolve(await realpath(runDirectory));
  if (comparable(canonicalRun) !== comparable(resolve(runDirectory))) {
    throw new Error("Reference extraction current run is unsafe.");
  }
  const verified = await verifyStagedOutput(runDirectory, sourceHash, expectedSharedUuids);
  if (verified.summary.rootManifestSha256 !== pointer.rootManifestSha256) {
    throw new Error("Reference extraction current pointer does not match its verified run.");
  }
  return runDirectory;
}

function safeRelativeArtifact(stagingDirectory: string, path: string): string {
  const difference = relative(stagingDirectory, resolve(path));
  if (!difference || difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
    throw new Error("Reference extraction produced an artifact outside its staging directory.");
  }
  return difference.split(sep).join("/");
}

async function executeInjectedPipeline(
  options: ReferenceExtractionRun,
  pipeline: ReferenceExtractionPipeline,
): Promise<void> {
  const started = Date.now();
  const sourceImagePath = resolve(options.projectRoot, "public", "assets", "reference-surface-1.0.webp");
  const referenceWorldPath = resolve(options.projectRoot, "public", "data", "generated", "reference-world.json");
  const defaultSavePath = await referenceDefaultSavePath(options);
  const targetSavePath = resolve(options.targetSavePath);
  const inputs = await pipeline.loadInputs({
    sourceImagePath,
    referenceWorldPath,
    defaultSavePath,
    targetSavePath,
    buildInfoPath: resolve(options.projectRoot, "public", "data", "generated", "build-info.json"),
    catalogPath: resolve(options.projectRoot, "public", "data", "generated", "tile-catalog.json"),
    expectedInputHashes: CALIBRATED_REFERENCE_INPUT_HASHES,
  });
  if (inputs.source.sha256 !== options.sourceHash) {
    throw new Error("Reference extraction source hash does not match the output isolation key.");
  }
  if (inputs.uuidIntersection.shared.length !== options.expectedSharedUuids) {
    throw new Error(
      `Reference extraction requires the reviewed target with exactly ${options.expectedSharedUuids} shared UUIDs.`,
    );
  }
  const candidateRoot = join(options.stagingDirectory, "candidates");
  await mkdir(candidateRoot);
  const candidates = await pipeline.extractCandidates({
    inputs,
    sourceImagePath,
    orientation: DEFAULT_REFERENCE_ORIENTATION,
    trustedLocalRoot: options.localOutputRoot,
    maximumFootprintSpan: 16,
  }, candidateRoot);
  const decisions = pipeline.selectCandidates(candidates, { ...DEFAULT_CANDIDATE_THRESHOLDS });
  const transform = createReferenceTransform({
    imageWidth: inputs.source.width,
    imageHeight: inputs.source.height,
    bounds: inputs.source.bounds,
    orientation: DEFAULT_REFERENCE_ORIENTATION,
  });
  const referenceWorldBytes = canonicalWorldBytes(inputs.referenceWorld);
  const referenceWorldSha256 = sha256(referenceWorldBytes);
  const targetWorldBytes = canonicalWorldBytes(inputs.targetWorld);
  const targetWorldSha256 = sha256(targetWorldBytes);
  await Promise.all([
    writeFile(join(options.stagingDirectory, "reference-world.json"), referenceWorldBytes),
    writeFile(join(options.stagingDirectory, "target-world.json"), targetWorldBytes),
  ]);
  const reconstruction = await pipeline.reconstruct({
    decisions,
    referenceWorld: inputs.referenceWorld,
    targetWorld: inputs.targetWorld,
    targetEligibleUuids: inputs.uuidIntersection.shared,
    playableBounds: inputs.defaultWorld.bounds,
    sourceImagePath,
    sourceHashes: {
      sourceImageSha256: inputs.source.sha256,
      referenceWorldSha256,
      targetWorldSha256,
      targetSaveSha256: inputs.targetSaveSha256,
    },
    worldProvenance: {
      referenceWorld: {
        bytes: referenceWorldBytes,
        sha256: referenceWorldSha256,
      },
      targetWorld: { bytes: targetWorldBytes, sha256: targetWorldSha256 },
    },
    targetSaveProvenance: {
      bytes: await readFile(targetSavePath),
      sha256: inputs.targetSaveSha256,
    },
    transform,
    trustedLocalRoot: options.localOutputRoot,
    candidateRoot,
    reconstructionPath: join(options.stagingDirectory, "default-reconstruction.webp"),
    differencePath: join(options.stagingDirectory, "default-difference.png"),
    differenceAmplification: DEFAULT_DIFFERENCE_AMPLIFICATION,
  });
  const report = pipeline.evaluate(reconstruction, { ...DEFAULT_REFERENCE_QUALITY_THRESHOLDS });
  if (report.groups.length !== decisions.length) {
    throw new Error("Reference quality report does not account for every candidate group.");
  }
  const accepted = decisions.filter((decision) => decision.status === "accepted");
  const qualityAcceptedGroupIds = new Set(report.groups
    .filter((group) => group.status === "accepted")
    .map((group) => group.id));
  const previewDecisions = accepted.filter((decision) => {
    const candidate = decision.selected;
    const rotation = decision.image?.rotation;
    return candidate !== undefined && rotation !== undefined
      && qualityAcceptedGroupIds.has(
        `${candidate.uuid}/r${rotation}/ox${candidate.offset.x}/oy${candidate.offset.y}`,
      );
  });
  const preview = await pipeline.renderTargetPreview(inputs, previewDecisions);
  const previewName = `${basename(options.targetSavePath, ".db") || "target"}-preview.png`;
  if (preview) await writeFile(join(options.stagingDirectory, previewName), preview);
  const artifacts = Object.fromEntries(Object.entries(report.artifacts).map(([name, artifact]) => [name, {
    path: safeRelativeArtifact(options.stagingDirectory, artifact.path),
    sha256: artifact.sha256,
  }]));
  if (preview) artifacts.targetPreview = { path: previewName, sha256: sha256(preview) };
  const reportDocument: StagedQualityReport = {
    status: report.status,
    reasons: [...report.reasons],
    sourceHashes: {
      ...report.sourceHashes,
      targetSaveSha256: report.sourceHashes.targetSaveSha256 ?? inputs.targetSaveSha256,
    },
    thresholds: { ...report.thresholds },
    imageDifference: { ...report.imageDifference },
    seam: { ...report.seam },
    seamEvidence: { ...report.seamEvidence },
    coverage: report.coverage,
    coverageEvidence: Object.fromEntries(Object.entries(reconstruction.coverageCells).map(([domain, cells]) => [
      domain,
      [...cells].sort((left, right) => left.y - right.y || left.x - right.x),
    ])) as StagedQualityReport["coverageEvidence"],
    groups: report.groups,
    artifacts,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(reportDocument, null, 2)}\n`);
  await writeFile(join(options.stagingDirectory, "quality-report.json"), reportBytes);
  const sorted = (values: readonly string[]) => [...values].sort((left, right) => left.localeCompare(right));
  const summary: ReferenceExtractionSummary = {
    schemaVersion: 2,
    rootManifestSha256: ROOT_MANIFEST_HASH_PLACEHOLDER,
    rootManifestBytes: 0,
    status: report.status,
    reasons: [...report.reasons],
    checkedInputHashes: { ...CALIBRATED_REFERENCE_INPUT_HASHES },
    provenance: {
      sourceImage: {
        sha256: inputs.source.sha256,
        width: inputs.source.width,
        height: inputs.source.height,
        bounds: { ...inputs.source.bounds },
      },
      referenceWorld: {
        fileSha256: CALIBRATED_REFERENCE_INPUT_HASHES.referenceWorldSha256,
        canonicalSha256: referenceWorldSha256,
      },
      buildInfo: { sha256: CALIBRATED_REFERENCE_INPUT_HASHES.buildInfoSha256 },
      catalog: { sha256: CALIBRATED_REFERENCE_INPUT_HASHES.catalogSha256 },
      defaultSave: { sha256: CALIBRATED_REFERENCE_INPUT_HASHES.defaultSaveSha256 },
      targetSave: { sha256: inputs.targetSaveSha256 },
      targetWorld: { canonicalSha256: targetWorldSha256 },
    },
    orientation: DEFAULT_REFERENCE_ORIENTATION,
    inventory: {
      expectedShared: options.expectedSharedUuids,
      sharedCount: inputs.uuidIntersection.shared.length,
      shared: sorted(inputs.uuidIntersection.shared),
      referenceOnlyCount: inputs.uuidIntersection.referenceOnly.length,
      referenceOnly: sorted(inputs.uuidIntersection.referenceOnly),
      targetOnlyCount: inputs.uuidIntersection.targetOnly.length,
      targetOnly: sorted(inputs.uuidIntersection.targetOnly),
    },
    candidates: candidates.length,
    candidateGroups: decisions.length,
    selectorAcceptedGroups: accepted.length,
    selectorRejectedGroups: decisions.length - accepted.length,
    qualityAcceptedGroups: report.groups.filter((group) => group.status === "accepted").length,
    qualityRejectedGroups: report.groups.filter((group) => group.status === "rejected").length,
    qualityAcceptedCells: report.groups.filter((group) => group.status === "accepted")
      .reduce((total, group) => total + group.placedReferenceCells.length, 0),
    qualityRejectedCells: inputs.referenceWorld.cells.length - report.groups
      .filter((group) => group.status === "accepted")
      .reduce((total, group) => total + group.placedReferenceCells.length, 0),
    thresholds: {
      candidate: { ...DEFAULT_CANDIDATE_THRESHOLDS },
      quality: { ...DEFAULT_REFERENCE_QUALITY_THRESHOLDS },
    },
    coverage: report.coverage,
    artifacts: {
      candidates: await candidateTreeArtifact(options.stagingDirectory),
      referenceWorld: await fileArtifact(options.stagingDirectory, "reference-world.json"),
      targetWorld: await fileArtifact(options.stagingDirectory, "target-world.json"),
      reconstruction: await fileArtifact(options.stagingDirectory, artifacts.reconstruction!.path),
      difference: await fileArtifact(options.stagingDirectory, artifacts.difference!.path),
      targetPreview: await fileArtifact(options.stagingDirectory, artifacts.targetPreview!.path),
      qualityReport: {
        path: "quality-report.json",
        bytes: reportBytes.byteLength,
        sha256: sha256(reportBytes),
      },
    },
  };
  await writeFile(join(options.stagingDirectory, "run-summary.json"), sealSummary(summary));
  console.log(`Reference extraction pipeline completed in ${Date.now() - started} ms.`);
}

const defaultPipeline: ReferenceExtractionPipeline = {
  loadInputs: loadReferenceExtractionInputs,
  extractCandidates,
  selectCandidates(candidates, thresholds) {
    return groupedCandidates(candidates).map((group) => selectCandidateGroup(group, thresholds));
  },
  reconstruct: reconstructReference,
  evaluate: evaluateReconstruction,
  renderTargetPreview,
};

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

interface PromotionLockDocument {
  pid: number;
  createdAt: number;
  token: string;
}

async function readPromotionLock(lockPath: string): Promise<PromotionLockDocument | undefined> {
  try {
    const document = JSON.parse(await readFile(lockPath, "utf8")) as Partial<PromotionLockDocument>;
    return Number.isSafeInteger(document.pid) && Number.isFinite(document.createdAt)
      && typeof document.token === "string" && document.token !== ""
      ? document as PromotionLockDocument : undefined;
  } catch {
    return undefined;
  }
}

async function lockIsStale(lockPath: string, hooks: PromotionHooks): Promise<boolean> {
  try {
    const [document, metadata] = await Promise.all([readPromotionLock(lockPath), stat(lockPath)]);
    if (!document) return false;
    const now = hooks.now?.() ?? Date.now();
    const staleMs = hooks.lockStaleMs ?? PROMOTION_LOCK_STALE_MS;
    if (now - Math.max(metadata.mtimeMs, document.createdAt) <= staleMs) return false;
    return !(await (hooks.isProcessAlive ?? defaultProcessAlive)(document.pid));
  } catch {
    return false;
  }
}

async function acquirePromotionMutex(
  lockPath: string,
  deadline: number,
  hooks: PromotionHooks,
): Promise<() => Promise<void>> {
  const mutexPath = `${lockPath}.reclaim`;
  const pollMs = hooks.lockPollMs ?? PROMOTION_LOCK_POLL_MS;
  for (;;) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(mutexPath, "wx");
      await handle.writeFile(`${process.pid}\n`);
      await handle.sync();
      return async () => {
        await handle?.close();
        // The still-existing exclusive pathname prevents any replacement
        // between close and unlink. Abandoned mutexes fail closed on timeout.
        await rm(mutexPath, { force: true });
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      await hooks.onLockWaiting?.();
      if ((hooks.now?.() ?? Date.now()) >= deadline) {
        throw new Error("Reference extraction promotion lock timed out.");
      }
      await delay(pollMs);
    }
  }
}

async function syncPath(path: string, kind: "file" | "directory", hooks: PromotionHooks): Promise<void> {
  // A writable directory handle is required for FlushFileBuffers on Windows.
  const handle = await open(path, "r+");
  try {
    await handle.sync();
    await hooks.onSync?.(kind, path);
  } finally {
    await handle.close();
  }
}

async function syncTree(directory: string, hooks: PromotionHooks): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error("Reference extraction promotion tree contains an unsafe entry.");
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await syncTree(path, hooks);
    else await syncPath(path, "file", hooks);
  }
  await syncPath(directory, "directory", hooks);
}

async function acquirePromotionLock(
  finalDirectory: string,
  hooks: PromotionHooks,
): Promise<() => Promise<void>> {
  const lockPath = `${finalDirectory}.promotion.lock`;
  const start = hooks.now?.() ?? Date.now();
  const timeoutMs = hooks.lockTimeoutMs ?? PROMOTION_LOCK_TIMEOUT_MS;
  const deadline = start + timeoutMs;
  const pollMs = hooks.lockPollMs ?? PROMOTION_LOCK_POLL_MS;
  for (;;) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    const token = randomBytes(16).toString("hex");
    const releaseMutex = await acquirePromotionMutex(lockPath, deadline, hooks);
    let mutexReleased = false;
    const releaseAttemptMutex = async () => {
      if (mutexReleased) return;
      mutexReleased = true;
      await releaseMutex();
    };
    try {
      if (await lockIsStale(lockPath, hooks)) {
        await hooks.beforeStaleLockRemoval?.();
        await rm(lockPath, { force: true });
      }
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        createdAt: hooks.now?.() ?? Date.now(),
        token,
      })}\n`);
      await handle.sync();
      await releaseAttemptMutex();
      await hooks.onLockAcquired?.();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await handle?.close();
        const releaseOwnerMutex = await acquirePromotionMutex(lockPath, deadline, hooks);
        try {
          const owned = await readPromotionLock(lockPath);
          if (owned?.token === token) await rm(lockPath, { force: true });
        } finally {
          await releaseOwnerMutex();
        }
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await releaseAttemptMutex();
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      await hooks.onLockWaiting?.();
      const now = hooks.now?.() ?? Date.now();
      if (now - start >= timeoutMs) throw new Error("Reference extraction promotion lock timed out.");
      await delay(pollMs);
    }
  }
}

async function installStagedOutput(
  stagingDirectory: string,
  finalDirectory: string,
  verified: ReferenceExtractionSummary,
  trustedLocalRoot: string,
  hooks: PromotionHooks = {},
): Promise<void> {
  const canonicalFinal = await assertSafeCanonicalDirectory(trustedLocalRoot, finalDirectory, true);
  if (comparable(canonicalFinal) !== comparable(resolve(finalDirectory))) {
    throw new Error("Reference extraction promotion requires a safe canonical directory.");
  }
  let finalExisted = true;
  try {
    await lstat(canonicalFinal);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") finalExisted = false;
    else throw error;
  }
  if (!finalExisted) {
    try {
      await mkdir(canonicalFinal);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
    await syncPath(dirname(canonicalFinal), "directory", hooks);
  }
  await assertSafeCanonicalDirectory(trustedLocalRoot, canonicalFinal, false);
  const release = await acquirePromotionLock(finalDirectory, hooks);
  let pointerPath = "";
  try {
    const runsDirectory = join(canonicalFinal, "runs");
    const runDirectory = join(runsDirectory, verified.rootManifestSha256);
    await mkdir(runsDirectory, { recursive: true });
    await assertSafeCanonicalDirectory(trustedLocalRoot, runsDirectory, false);
    let existingRun = false;
    try {
      const metadata = await lstat(runDirectory);
      existingRun = metadata.isDirectory() && !metadata.isSymbolicLink();
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (existingRun) {
      const existing = await verifyStagedOutput(
        runDirectory,
        verified.provenance.sourceImage.sha256,
        verified.inventory.expectedShared,
      );
      if (existing.summary.rootManifestSha256 !== verified.rootManifestSha256) {
        throw new Error("Reference extraction content-addressed run collision.");
      }
      // A byte-identical run may pre-date the current durability contract.
      await syncTree(runDirectory, hooks);
      await syncPath(runsDirectory, "directory", hooks);
      await rm(stagingDirectory, { recursive: true, force: true });
    } else {
      await syncTree(stagingDirectory, hooks);
      await rename(stagingDirectory, runDirectory);
      await syncPath(runsDirectory, "directory", hooks);
    }
    const pointerName = `.current-${randomBytes(8).toString("hex")}.tmp`;
    pointerPath = join(canonicalFinal, pointerName);
    const handle = await open(pointerPath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify({
        schemaVersion: 2,
        runDirectory: `runs/${verified.rootManifestSha256}`,
        rootManifestSha256: verified.rootManifestSha256,
      })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await hooks.beforePointerRename?.();
    await rename(pointerPath, join(canonicalFinal, "current.json"));
    pointerPath = "";
    await syncPath(canonicalFinal, "directory", hooks);
    await resolveReferenceExtractionCurrentRun(
      canonicalFinal,
      verified.provenance.sourceImage.sha256,
      verified.inventory.expectedShared,
      trustedLocalRoot,
    );
  } finally {
    if (pointerPath) await rm(pointerPath, { force: true }).catch(() => undefined);
    await release();
  }
}

export async function runReferenceExtractionCli(
  args = process.argv.slice(2),
  dependencies: ReferenceExtractionCliDependencies = {},
): Promise<void> {
  const options = parseReferenceExtractionArgs(args);
  const projectRoot = resolve(dependencies.projectRoot ?? ".");
  const localOutputRoot = await validateLocalOutputRoot(
    projectRoot,
    dependencies.localOutputRoot ?? resolve(projectRoot, "local-assets", "reference-extraction"),
  );
  const sourceHash = validatedSourceHash(
    dependencies.sourceHash ?? CALIBRATED_REFERENCE_INPUT_HASHES.sourceImageSha256,
  );
  const expectedSharedUuids = dependencies.expectedSharedUuids ?? DEFAULT_EXPECTED_SHARED_UUIDS;
  if (!Number.isSafeInteger(expectedSharedUuids) || expectedSharedUuids <= 0) {
    throw new Error("Reference extraction expected shared UUID count must be a positive integer.");
  }
  const finalDirectory = join(localOutputRoot, sourceHash);
  const stagingDirectory = join(localOutputRoot, `.${sourceHash}.staging-${randomBytes(8).toString("hex")}`);
  await mkdir(stagingDirectory);
  try {
    const run = {
      ...options,
      projectRoot,
      localOutputRoot,
      sourceHash,
      expectedSharedUuids,
      stagingDirectory,
      finalDirectory,
    };
    if (dependencies.execute) await dependencies.execute(run);
    else await executeInjectedPipeline(run, dependencies.pipeline ?? defaultPipeline);
    const verified = await verifyStagedOutput(stagingDirectory, sourceHash, expectedSharedUuids);
    if (verified.report.status === "failed") throw new ReferenceQualityGateError(verified.summary);
    await installStagedOutput(
      stagingDirectory,
      finalDirectory,
      verified.summary,
      localOutputRoot,
      dependencies.promotion,
    );
  } catch (error) {
    if (error instanceof ReferenceQualityGateError) {
      await installStagedOutput(
        stagingDirectory,
        `${finalDirectory}.failed`,
        error.summary,
        localOutputRoot,
        dependencies.promotion,
      );
    } else {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReferenceExtractionCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
