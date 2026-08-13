import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import type { CellBounds, TerrainCell, WorldMap } from "../../src/domain/map-model.ts";
import type { CandidateDecision } from "./candidate-selector.ts";
import type { ReferenceTransform } from "./reference-transform.ts";

const OUTPUT_ERROR = "Reconstruction diagnostics require safe paths below the trusted local root.";

export interface ReconstructionSourceHashes {
  sourceImageSha256: string;
  referenceWorldSha256: string;
  targetWorldSha256: string;
  targetSaveSha256?: string;
}

export interface SerializedWorldProvenance {
  bytes: Uint8Array;
  sha256: string;
}

export interface ReconstructionMetric {
  mean: number;
  maximum: number;
  samples: number;
}

export interface ReconstructionCandidateProvenance {
  sha256: string;
  localFilename: string;
  sourceWorld: { x: number; y: number };
  sourceRotation?: 0 | 1 | 2 | 3;
  synthesized?: boolean;
  reasons?: string[];
}

export interface ReconstructionGroupResult {
  id: string;
  uuid: string;
  rotation: 0 | 1 | 2 | 3;
  offset: { x: number; y: number };
  footprint: { width: number; height: number };
  selectorStatus: "accepted" | "rejected";
  selectorReasons: string[];
  selected?: ReconstructionCandidateProvenance;
  rejectedCandidates: ReconstructionCandidateProvenance[];
  placedReferenceCells: { x: number; y: number }[];
  imageDifference: ReconstructionMetric;
  seam: ReconstructionMetric;
  seamEvidence: { expectedSamples: number };
}

export interface ReconstructionCoverageCell {
  x: number;
  y: number;
  uuid: string;
  rotation: 0 | 1 | 2 | 3;
  groupId: string;
}

export interface ReconstructionResult {
  sourceHashes: ReconstructionSourceHashes;
  canvas: { width: number; height: number };
  artifacts: {
    reconstruction: { path: string; sha256: string };
    difference: { path: string; sha256: string };
  };
  imageDifference: ReconstructionMetric;
  seam: ReconstructionMetric;
  seamEvidence: {
    state: "measured" | "no-internal-boundaries";
    expectedSamples: number;
    placedToPlaced: number;
    placedToMissing: number;
    missingToMissing: number;
  };
  groups: ReconstructionGroupResult[];
  coverageCells: {
    fullReference: ReconstructionCoverageCell[];
    playableReference: ReconstructionCoverageCell[];
    targetEligible: ReconstructionCoverageCell[];
  };
}

export interface ReconstructReferenceOptions {
  decisions: readonly CandidateDecision[];
  referenceWorld: WorldMap;
  targetWorld: WorldMap;
  targetEligibleUuids: readonly string[];
  playableBounds: CellBounds;
  sourceImagePath: string;
  sourceHashes: ReconstructionSourceHashes;
  worldProvenance: {
    referenceWorld: SerializedWorldProvenance;
    targetWorld: SerializedWorldProvenance;
  };
  targetSaveProvenance?: SerializedWorldProvenance;
  transform: ReferenceTransform;
  trustedLocalRoot: string;
  candidateRoot: string;
  reconstructionPath: string;
  differencePath: string;
  differenceAmplification: number;
}

interface MutableMetric {
  sum: number;
  maximum: number;
  samples: number;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(comparable(root), comparable(candidate));
  return difference !== "" && difference !== ".." && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference);
}

async function resolveNearestExisting(path: string): Promise<string> {
  const tail: string[] = [];
  let candidate = resolve(path);
  while (true) {
    try {
      return resolve(await realpath(candidate), ...tail);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
      const parent = dirname(candidate);
      if (code !== "ENOENT" || parent === candidate) throw error;
      tail.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

async function safeOutputPath(trustedLocalRoot: string, outputPath: string): Promise<string> {
  try {
    const requestedRoot = resolve(trustedLocalRoot);
    const root = resolve(await realpath(requestedRoot));
    const rootStats = await lstat(requestedRoot);
    const requested = resolve(outputPath);
    const canonical = await resolveNearestExisting(requested);
    if (comparable(root) !== comparable(requestedRoot) || rootStats.isSymbolicLink()
      || !rootStats.isDirectory() || !isWithin(root, canonical)
      || comparable(requested) !== comparable(canonical)) {
      throw new Error(OUTPUT_ERROR);
    }
    return requested;
  } catch (error) {
    if (error instanceof Error && error.message === OUTPUT_ERROR) throw error;
    throw new Error(OUTPUT_ERROR, { cause: error });
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function verifyWorldProvenance(
  world: WorldMap,
  provenance: SerializedWorldProvenance,
  expectedSha256: string,
): void {
  const actualHash = sha256(provenance.bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(provenance.bytes).toString("utf8"));
  } catch {
    throw new Error("Serialized world provenance is invalid.");
  }
  if (actualHash !== provenance.sha256 || actualHash !== expectedSha256
    || JSON.stringify(parsed) !== JSON.stringify(world)) {
    throw new Error("Serialized world provenance does not match the reconstructed world.");
  }
}

function verifyTargetSaveProvenance(options: ReconstructReferenceOptions): string | undefined {
  if (options.targetEligibleUuids.length === 0 && !options.targetSaveProvenance) return undefined;
  const provenance = options.targetSaveProvenance;
  const actualHash = provenance && sha256(provenance.bytes);
  if (!provenance || actualHash !== provenance.sha256
    || provenance.sha256 !== options.sourceHashes.targetSaveSha256) {
    throw new Error("target save provenance is required and must match its attested hash.");
  }
  return actualHash;
}

function groupId(value: Pick<TerrainCell, "uuid" | "rotation" | "xOffset" | "yOffset">): string {
  return `${value.uuid}/r${value.rotation}/ox${value.xOffset}/oy${value.yOffset}`;
}

function decisionIdentity(decision: CandidateDecision) {
  const candidate = decision.selected ?? decision.cluster[0] ?? decision.rejections[0]?.candidate;
  if (!candidate) throw new Error("A candidate decision has no group identity.");
  const rotation = decision.status === "accepted" && decision.image
    ? decision.image.rotation
    : candidate.rotation;
  return {
    id: `${candidate.uuid}/r${rotation}/ox${candidate.offset.x}/oy${candidate.offset.y}`,
    rotation,
    candidate,
  };
}

function observedFootprints(cells: readonly TerrainCell[]): Map<string, { width: number; height: number }> {
  const footprints = new Map<string, { width: number; height: number }>();
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell.xOffset) || !Number.isSafeInteger(cell.yOffset)
      || cell.xOffset < 0 || cell.yOffset < 0) {
      throw new Error("Reference world contains an invalid footprint offset.");
    }
    const key = `${cell.uuid}/r${cell.rotation}`;
    const footprint = footprints.get(key) ?? { width: 1, height: 1 };
    footprint.width = Math.max(footprint.width, cell.xOffset + 1);
    footprint.height = Math.max(footprint.height, cell.yOffset + 1);
    footprints.set(key, footprint);
  }
  return footprints;
}

async function verifySelectedCandidate(
  candidateRoot: string,
  candidate: NonNullable<CandidateDecision["selected"]>,
  referenceCells: ReadonlyMap<string, TerrainCell>,
  transform: ReferenceTransform,
): Promise<void> {
  const sourceCell = referenceCells.get(`${candidate.world.x},${candidate.world.y}`);
  if (!sourceCell || sourceCell.uuid !== candidate.uuid || sourceCell.rotation !== candidate.rotation
    || sourceCell.xOffset !== candidate.offset.x || sourceCell.yOffset !== candidate.offset.y) {
    throw new Error("Selected candidate source-world provenance does not match the verified reference world.");
  }
  const expectedEdges = transform.cellPixelEdges(candidate.world.x, candidate.world.y);
  if (Object.entries(expectedEdges).some(([key, value]) => candidate.pixelEdges[key as keyof typeof expectedEdges] !== value)) {
    throw new Error("Selected candidate crop edges do not match its verified source-world transform.");
  }
  let bytes: Uint8Array;
  try {
    const candidatePath = await safeOutputPath(candidateRoot, resolve(candidateRoot, candidate.localFilename));
    bytes = await readFile(candidatePath);
  } catch (error) {
    throw new Error("Selected candidate file is unavailable or unsafe.", { cause: error });
  }
  if (sha256(bytes) !== candidate.sha256) throw new Error("Selected candidate file failed its hash check.");
  const expectedWidth = expectedEdges.right - expectedEdges.left;
  const expectedHeight = expectedEdges.bottom - expectedEdges.top;
  const { data, info } = await sharp(bytes, { failOn: "error" })
    .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width !== candidate.width || info.height !== candidate.height
    || candidate.width !== expectedWidth || candidate.height !== expectedHeight) {
    throw new Error("Selected candidate file dimensions do not match its recorded source extraction.");
  }
  if (!Buffer.from(data).equals(Buffer.from(candidate.pixels))) {
    throw new Error("Selected candidate file pixels do not match verified candidate metadata.");
  }
}

function inside(cell: TerrainCell, bounds: CellBounds): boolean {
  return cell.x >= bounds.minX && cell.x <= bounds.maxX
    && cell.y >= bounds.minY && cell.y <= bounds.maxY;
}

function addMetric(metric: MutableMetric, value: number): void {
  metric.sum += value;
  metric.maximum = Math.max(metric.maximum, value);
  metric.samples += 1;
}

function finishMetric(metric: MutableMetric): ReconstructionMetric {
  return {
    mean: metric.samples === 0 ? 0 : metric.sum / metric.samples,
    maximum: metric.maximum,
    samples: metric.samples,
  };
}

function pixelDifference(left: Uint8Array, right: Uint8Array, pixel: number): number {
  const offset = pixel * 4;
  const leftAlpha = left[offset + 3]! / 255;
  const rightAlpha = right[offset + 3]! / 255;
  const color = (Math.abs(left[offset]! * leftAlpha - right[offset]! * rightAlpha)
    + Math.abs(left[offset + 1]! * leftAlpha - right[offset + 1]! * rightAlpha)
    + Math.abs(left[offset + 2]! * leftAlpha - right[offset + 2]! * rightAlpha)) / (3 * 255);
  const alpha = Math.abs(leftAlpha - rightAlpha);
  return Math.max(color, alpha);
}

function edgeDifference(
  reconstructed: Uint8Array,
  source: Uint8Array,
  firstPixel: number,
  secondPixel: number,
): number {
  let sum = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const reconstructedGradient = reconstructed[firstPixel * 4 + channel]!
      * reconstructed[firstPixel * 4 + 3]! / 255
      - reconstructed[secondPixel * 4 + channel]! * reconstructed[secondPixel * 4 + 3]! / 255;
    const sourceGradient = source[firstPixel * 4 + channel]! * source[firstPixel * 4 + 3]! / 255
      - source[secondPixel * 4 + channel]! * source[secondPixel * 4 + 3]! / 255;
    sum += Math.abs(reconstructedGradient - sourceGradient) / 510;
  }
  const reconstructedAlphaGradient = reconstructed[firstPixel * 4 + 3]!
    - reconstructed[secondPixel * 4 + 3]!;
  const sourceAlphaGradient = source[firstPixel * 4 + 3]! - source[secondPixel * 4 + 3]!;
  return Math.max(sum / 3, Math.abs(reconstructedAlphaGradient - sourceAlphaGradient) / 510);
}

function provenance(decision: CandidateDecision): Pick<ReconstructionGroupResult, "selected" | "rejectedCandidates"> {
  const selected = decision.selected && decision.image ? {
    sha256: decision.selected.sha256,
    localFilename: decision.selected.localFilename,
    sourceWorld: { ...decision.selected.world },
    sourceRotation: decision.selected.rotation,
    synthesized: decision.image.synthesized,
  } : undefined;
  return {
    ...(selected ? { selected } : {}),
    rejectedCandidates: decision.rejections.map(({ candidate, reasons }) => ({
      sha256: candidate.sha256,
      localFilename: candidate.localFilename,
      sourceWorld: { ...candidate.world },
      reasons: [...reasons],
    })).sort((left, right) => left.localFilename.localeCompare(right.localFilename)),
  };
}

function coverageCell(cell: TerrainCell): ReconstructionCoverageCell {
  return { x: cell.x, y: cell.y, uuid: cell.uuid, rotation: cell.rotation, groupId: groupId(cell) };
}

export async function reconstructReference(options: ReconstructReferenceOptions): Promise<ReconstructionResult> {
  if (!Number.isFinite(options.differenceAmplification) || options.differenceAmplification <= 0) {
    throw new Error("Difference amplification must be an explicit positive value.");
  }
  const [reconstructionPath, differencePath] = await Promise.all([
    safeOutputPath(options.trustedLocalRoot, options.reconstructionPath),
    safeOutputPath(options.trustedLocalRoot, options.differencePath),
  ]);
  if (comparable(reconstructionPath) === comparable(differencePath)
    || comparable(resolve(options.sourceImagePath)) === comparable(reconstructionPath)
    || comparable(resolve(options.sourceImagePath)) === comparable(differencePath)) {
    throw new Error("Reconstruction input and diagnostic paths must be distinct.");
  }
  const sourceBytes = await readFile(options.sourceImagePath);
  if (sha256(sourceBytes) !== options.sourceHashes.sourceImageSha256) {
    throw new Error("Reconstruction source image failed its validated hash check.");
  }
  verifyWorldProvenance(options.referenceWorld, options.worldProvenance.referenceWorld,
    options.sourceHashes.referenceWorldSha256);
  verifyWorldProvenance(options.targetWorld, options.worldProvenance.targetWorld,
    options.sourceHashes.targetWorldSha256);
  const verifiedTargetSaveSha256 = verifyTargetSaveProvenance(options);
  const { data: source, info } = await sharp(sourceBytes, { failOn: "error" })
    .ensureAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const columnEdges = options.transform.columnEdges();
  const rowEdges = options.transform.rowEdges();
  const width = columnEdges.at(-1);
  const height = rowEdges.at(-1);
  if (width !== info.width || height !== info.height || info.channels !== 4) {
    throw new Error("Reconstruction transform does not cover the validated source canvas.");
  }

  const decisionMap = new Map<string, CandidateDecision>();
  const groups = new Map<string, ReconstructionGroupResult>();
  const footprints = observedFootprints(options.referenceWorld.cells);
  const referenceCells = new Map(options.referenceWorld.cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
  for (const decision of options.decisions) {
    const { id, rotation, candidate } = decisionIdentity(decision);
    if (decisionMap.has(id)) throw new Error("Candidate decisions contain a duplicate group.");
    if (decision.status === "accepted" && (!decision.selected || !decision.image
      || decision.image.channels !== 3 || decision.image.width <= 0 || decision.image.height <= 0
      || decision.image.pixels.length !== decision.image.width * decision.image.height * 3)) {
      throw new Error("Accepted candidate image does not preserve its target rotation.");
    }
    const observed = footprints.get(`${candidate.uuid}/r${rotation}`);
    if (!observed || observed.width !== candidate.footprint.width
      || observed.height !== candidate.footprint.height
      || candidate.offset.x >= observed.width || candidate.offset.y >= observed.height) {
      throw new Error("Candidate footprint does not match the observed reference-world group.");
    }
    if (decision.status === "accepted") {
      await verifySelectedCandidate(options.candidateRoot, decision.selected!, referenceCells, options.transform);
    }
    decisionMap.set(id, decision);
    groups.set(id, {
      id,
      uuid: candidate.uuid,
      rotation,
      offset: { ...candidate.offset },
      footprint: { ...candidate.footprint },
      selectorStatus: decision.status,
      selectorReasons: [...decision.reasons],
      ...provenance(decision),
      placedReferenceCells: [],
      imageDifference: { mean: 0, maximum: 0, samples: 0 },
      seam: { mean: 0, maximum: 0, samples: 0 },
      seamEvidence: { expectedSamples: 0 },
    });
  }

  const reconstruction = new Uint8Array(width * height * 4);
  const owner = new Array<string | undefined>(width * height);
  for (const cell of [...options.referenceWorld.cells].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const id = groupId(cell);
    const decision = decisionMap.get(id);
    if (!decision || decision.status !== "accepted" || !decision.image) continue;
    const edges = options.transform.cellPixelEdges(cell.x, cell.y);
    const cellWidth = edges.right - edges.left;
    const cellHeight = edges.bottom - edges.top;
    const resized = await sharp(decision.image.pixels, {
      raw: { width: decision.image.width, height: decision.image.height, channels: 3 },
    }).resize(cellWidth, cellHeight, { kernel: "nearest" }).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < cellHeight; y += 1) {
      const sourceOffset = y * cellWidth * 4;
      const targetOffset = ((edges.top + y) * width + edges.left) * 4;
      reconstruction.set(resized.subarray(sourceOffset, sourceOffset + cellWidth * 4), targetOffset);
      for (let x = edges.left; x < edges.right; x += 1) owner[(edges.top + y) * width + x] = id;
    }
    groups.get(id)!.placedReferenceCells.push({ x: cell.x, y: cell.y });
  }

  const globalDifference: MutableMetric = { sum: 0, maximum: 0, samples: 0 };
  const groupDifference = new Map<string, MutableMetric>();
  const difference = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const value = pixelDifference(reconstruction, source, pixel);
    addMetric(globalDifference, value);
    const id = owner[pixel];
    if (id) {
      const metric = groupDifference.get(id) ?? { sum: 0, maximum: 0, samples: 0 };
      addMetric(metric, value);
      groupDifference.set(id, metric);
    }
    const offset = pixel * 4;
    const visibleDifference = Math.min(255, Math.round(value * 255 * options.differenceAmplification));
    difference.fill(visibleDifference, offset, offset + 3);
    difference[offset + 3] = 255;
  }

  const globalSeam: MutableMetric = { sum: 0, maximum: 0, samples: 0 };
  const groupSeam = new Map<string, MutableMetric>();
  const groupExpectedSeams = new Map<string, number>();
  const seamClasses = { placedToPlaced: 0, placedToMissing: 0, missingToMissing: 0 };
  const scoreSeam = (first: number, second: number) => {
    const firstOwner = owner[first];
    const secondOwner = owner[second];
    if (firstOwner && secondOwner) seamClasses.placedToPlaced += 1;
    else if (firstOwner || secondOwner) seamClasses.placedToMissing += 1;
    else seamClasses.missingToMissing += 1;
    const value = edgeDifference(reconstruction, source, first, second);
    addMetric(globalSeam, value);
    for (const id of new Set([firstOwner, secondOwner].filter((entry): entry is string => entry !== undefined))) {
      groupExpectedSeams.set(id, (groupExpectedSeams.get(id) ?? 0) + 1);
      const metric = groupSeam.get(id) ?? { sum: 0, maximum: 0, samples: 0 };
      addMetric(metric, value);
      groupSeam.set(id, metric);
    }
  };
  for (const edge of columnEdges.slice(1, -1)) {
    for (let y = 0; y < height; y += 1) scoreSeam(y * width + edge - 1, y * width + edge);
  }
  for (const edge of rowEdges.slice(1, -1)) {
    for (let x = 0; x < width; x += 1) scoreSeam((edge - 1) * width + x, edge * width + x);
  }
  for (const [id, group] of groups) {
    group.imageDifference = finishMetric(groupDifference.get(id) ?? { sum: 0, maximum: 0, samples: 0 });
    group.seam = finishMetric(groupSeam.get(id) ?? { sum: 0, maximum: 0, samples: 0 });
    group.seamEvidence = { expectedSamples: groupExpectedSeams.get(id) ?? 0 };
  }

  const reconstructionBytes = await sharp(reconstruction, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true, effort: 6 }).toBuffer();
  const differenceBytes = await sharp(difference, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  await Promise.all([writeFile(reconstructionPath, reconstructionBytes), writeFile(differencePath, differenceBytes)]);
  const targetEligible = new Set(options.targetEligibleUuids);
  const expectedSeamSamples = (columnEdges.length - 2) * height + (rowEdges.length - 2) * width;
  return {
    sourceHashes: {
      sourceImageSha256: sha256(sourceBytes),
      referenceWorldSha256: options.worldProvenance.referenceWorld.sha256,
      targetWorldSha256: options.worldProvenance.targetWorld.sha256,
      ...(verifiedTargetSaveSha256 ? { targetSaveSha256: verifiedTargetSaveSha256 } : {}),
    },
    canvas: { width, height },
    artifacts: {
      reconstruction: { path: reconstructionPath, sha256: sha256(reconstructionBytes) },
      difference: { path: differencePath, sha256: sha256(differenceBytes) },
    },
    imageDifference: finishMetric(globalDifference),
    seam: finishMetric(globalSeam),
    seamEvidence: expectedSeamSamples === 0
      ? { state: "no-internal-boundaries", expectedSamples: 0, ...seamClasses }
      : { state: "measured", expectedSamples: expectedSeamSamples, ...seamClasses },
    groups: [...groups.values()].sort((left, right) => left.id.localeCompare(right.id)),
    coverageCells: {
      fullReference: options.referenceWorld.cells.map(coverageCell),
      playableReference: options.referenceWorld.cells.filter((cell) => inside(cell, options.playableBounds)).map(coverageCell),
      targetEligible: options.targetWorld.cells.filter((cell) => targetEligible.has(cell.uuid)).map(coverageCell),
    },
  };
}
