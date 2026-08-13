import { createHash } from "node:crypto";
import type {
  ReconstructionCoverageCell,
  ReconstructionGroupResult,
  ReconstructionMetric,
  ReconstructionResult,
} from "./reconstruct-reference.ts";

export interface ReferenceQualityThresholds {
  maximumMeanImageDifference: number;
  maximumPixelImageDifference: number;
  maximumMeanSeamError: number;
  maximumSeamError: number;
  maximumGroupMeanImageDifference: number;
  maximumGroupPixelImageDifference: number;
  maximumGroupMeanSeamError: number;
  maximumGroupSeamError: number;
  minimumFullReferenceTypeCoverage: number;
  minimumFullReferenceRotationCoverage: number;
  minimumFullReferenceCellCoverage: number;
  minimumPlayableCellCoverage: number;
  minimumTargetEligibleCellCoverage: number;
}

export interface CoverageValue {
  covered: number;
  total: number;
  ratio: number;
}

export interface ReferenceCoverageReport {
  type: CoverageValue;
  rotation: CoverageValue;
  cell: CoverageValue;
}

export interface ReferenceQualityGroup extends ReconstructionGroupResult {
  status: "accepted" | "rejected";
  reasons: string[];
}

export interface ReferenceQualityReport {
  status: "passed" | "failed";
  reasons: string[];
  sourceHashes: ReconstructionResult["sourceHashes"];
  artifacts: ReconstructionResult["artifacts"];
  thresholds: ReferenceQualityThresholds;
  imageDifference: ReconstructionMetric;
  seam: ReconstructionMetric;
  seamEvidence: ReconstructionResult["seamEvidence"];
  coverage: {
    fullReference: ReferenceCoverageReport;
    playableReference: ReferenceCoverageReport;
    targetEligible: ReferenceCoverageReport;
  };
  groups: ReferenceQualityGroup[];
  canonicalJson: string;
  sha256: string;
}

const thresholdNames: readonly (keyof ReferenceQualityThresholds)[] = [
  "maximumMeanImageDifference",
  "maximumPixelImageDifference",
  "maximumMeanSeamError",
  "maximumSeamError",
  "maximumGroupMeanImageDifference",
  "maximumGroupPixelImageDifference",
  "maximumGroupMeanSeamError",
  "maximumGroupSeamError",
  "minimumFullReferenceTypeCoverage",
  "minimumFullReferenceRotationCoverage",
  "minimumFullReferenceCellCoverage",
  "minimumPlayableCellCoverage",
  "minimumTargetEligibleCellCoverage",
];

function validateThresholds(thresholds: ReferenceQualityThresholds): void {
  if (!thresholds || thresholdNames.some((name) => !Object.hasOwn(thresholds, name)
    || !Number.isFinite(thresholds[name]) || thresholds[name] < 0 || thresholds[name] > 1)) {
    throw new Error("Reference quality thresholds must all be explicit normalized values.");
  }
}

function validMetric(metric: ReconstructionMetric): boolean {
  return [metric.mean, metric.maximum].every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && Number.isSafeInteger(metric.samples) && metric.samples >= 0;
}

function validateMetrics(result: ReconstructionResult): void {
  if (!validMetric(result.imageDifference) || !validMetric(result.seam)
    || result.groups.some((group) => !validMetric(group.imageDifference) || !validMetric(group.seam))) {
    throw new Error("Reconstruction quality metrics are invalid.");
  }
}

function validateSeamEvidence(result: ReconstructionResult): void {
  const evidence = result.seamEvidence;
  const classes = evidence && [evidence.placedToPlaced, evidence.placedToMissing, evidence.missingToMissing];
  const invalidGroupEvidence = result.groups.some((group) =>
    !group.seamEvidence || !Number.isSafeInteger(group.seamEvidence.expectedSamples)
    || group.seamEvidence.expectedSamples < 0
    || group.seam.samples !== group.seamEvidence.expectedSamples);
  const contradictoryNoBoundaryGroup = evidence?.state === "no-internal-boundaries"
    && result.groups.some((group) => group.seamEvidence.expectedSamples !== 0
      || group.seam.samples !== 0 || group.seam.mean !== 0 || group.seam.maximum !== 0);
  if (!evidence || !Number.isSafeInteger(evidence.expectedSamples) || evidence.expectedSamples < 0
    || !classes || classes.some((value) => !Number.isSafeInteger(value) || value < 0)
    || classes.reduce((total, value) => total + value, 0) !== evidence.expectedSamples
    || (evidence.state === "measured"
      && (evidence.expectedSamples === 0 || result.seam.samples !== evidence.expectedSamples))
    || (evidence.state === "no-internal-boundaries"
      && (evidence.expectedSamples !== 0 || result.seam.samples !== 0))
    || invalidGroupEvidence || contradictoryNoBoundaryGroup
    || (evidence.state === "measured" && result.groups.some((group) =>
      group.selectorStatus === "accepted" && group.placedReferenceCells.length > 0
        && group.seamEvidence.expectedSamples === 0))) {
    throw new Error("Reconstruction seam evidence is incomplete or contradictory.");
  }
}

function value(covered: number, total: number): CoverageValue {
  return { covered, total, ratio: total === 0 ? 0 : covered / total };
}

function coordinateKey(value: { x: number; y: number }): string {
  return `${value.x},${value.y}`;
}

function coverage(
  cells: readonly ReconstructionCoverageCell[],
  accepted: ReadonlySet<string>,
  placed: ReadonlyMap<string, ReadonlySet<string>>,
  targetDomain = false,
): ReferenceCoverageReport {
  const types = new Set(cells.map(({ uuid }) => uuid));
  const rotations = new Set(cells.map(({ uuid, rotation }) => `${uuid}/r${rotation}`));
  const coveredCells = cells.filter((cell) => accepted.has(cell.groupId)
    && (targetDomain ? (placed.get(cell.groupId)?.size ?? 0) > 0
      : placed.get(cell.groupId)?.has(coordinateKey(cell))));
  const coveredTypes = new Set(coveredCells.map(({ uuid }) => uuid));
  const coveredRotations = new Set(coveredCells.map(({ uuid, rotation }) => `${uuid}/r${rotation}`));
  return {
    type: value(coveredTypes.size, types.size),
    rotation: value(coveredRotations.size, rotations.size),
    cell: value(coveredCells.length, cells.length),
  };
}

function validatePlacements(
  result: ReconstructionResult,
): Map<string, ReadonlySet<string>> {
  const referenceByCoordinate = new Map<string, ReconstructionCoverageCell>();
  for (const cell of result.coverageCells.fullReference) {
    const key = coordinateKey(cell);
    if (referenceByCoordinate.has(key)) throw new Error("Reference coverage contains a duplicate placement coordinate.");
    referenceByCoordinate.set(key, cell);
  }
  const placed = new Map<string, ReadonlySet<string>>();
  const occupied = new Set<string>();
  for (const group of result.groups) {
    const groupCoordinates = new Set<string>();
    for (const coordinate of group.placedReferenceCells) {
      const key = coordinateKey(coordinate);
      const reference = referenceByCoordinate.get(key);
      if (groupCoordinates.has(key) || occupied.has(key) || !reference || reference.groupId !== group.id) {
        throw new Error("Reconstruction placement records are duplicate, unknown, or contradictory.");
      }
      groupCoordinates.add(key);
      occupied.add(key);
    }
    placed.set(group.id, groupCoordinates);
  }
  for (const domain of [result.coverageCells.playableReference, result.coverageCells.targetEligible]) {
    const seen = new Set<string>();
    for (const cell of domain) {
      const key = coordinateKey(cell);
      if (seen.has(key)) throw new Error("Coverage domain contains a duplicate placement coordinate.");
      seen.add(key);
    }
  }
  return placed;
}

function qualityGroup(group: ReconstructionGroupResult, thresholds: ReferenceQualityThresholds): ReferenceQualityGroup {
  const reasons = [...group.selectorReasons];
  if (group.selectorStatus === "accepted") {
    if (group.imageDifference.mean > thresholds.maximumGroupMeanImageDifference) {
      reasons.push("group-image-difference-exceeded");
    }
    if (group.imageDifference.maximum > thresholds.maximumGroupPixelImageDifference) {
      reasons.push("group-maximum-image-difference-exceeded");
    }
    if (group.seam.mean > thresholds.maximumGroupMeanSeamError) reasons.push("group-seam-error-exceeded");
    if (group.seam.maximum > thresholds.maximumGroupSeamError) {
      reasons.push("group-maximum-seam-error-exceeded");
    }
    if (group.placedReferenceCells.length === 0) reasons.push("no-reference-cells-placed");
  }
  return {
    ...group,
    selectorReasons: [...group.selectorReasons],
    rejectedCandidates: group.rejectedCandidates.map((candidate) => ({
      ...candidate,
      sourceWorld: { ...candidate.sourceWorld },
      ...(candidate.reasons ? { reasons: [...candidate.reasons] } : {}),
    })),
    placedReferenceCells: [...group.placedReferenceCells]
      .sort((left, right) => left.y - right.y || left.x - right.x),
    status: group.selectorStatus === "accepted" && reasons.length === 0 ? "accepted" : "rejected",
    reasons,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function evaluateReconstruction(
  result: ReconstructionResult,
  thresholds: ReferenceQualityThresholds,
): ReferenceQualityReport {
  validateThresholds(thresholds);
  validateMetrics(result);
  validateSeamEvidence(result);
  const placed = validatePlacements(result);
  const groups = result.groups.map((group) => qualityGroup(group, thresholds))
    .sort((left, right) => left.id.localeCompare(right.id));
  const accepted = new Set(groups.filter(({ status }) => status === "accepted").map(({ id }) => id));
  const coverageReport = {
    fullReference: coverage(result.coverageCells.fullReference, accepted, placed),
    playableReference: coverage(result.coverageCells.playableReference, accepted, placed),
    targetEligible: coverage(result.coverageCells.targetEligible, accepted, placed, true),
  };
  const reasons: string[] = [];
  if (result.imageDifference.mean > thresholds.maximumMeanImageDifference) {
    reasons.push("mean-image-difference-exceeded");
  }
  if (result.imageDifference.maximum > thresholds.maximumPixelImageDifference) {
    reasons.push("maximum-image-difference-exceeded");
  }
  if (result.seam.mean > thresholds.maximumMeanSeamError) reasons.push("mean-seam-error-exceeded");
  if (result.seam.maximum > thresholds.maximumSeamError) reasons.push("maximum-seam-error-exceeded");
  if (coverageReport.fullReference.type.ratio < thresholds.minimumFullReferenceTypeCoverage) {
    reasons.push("full-reference-type-coverage-below-minimum");
  }
  if (coverageReport.fullReference.rotation.ratio < thresholds.minimumFullReferenceRotationCoverage) {
    reasons.push("full-reference-rotation-coverage-below-minimum");
  }
  if (coverageReport.fullReference.cell.ratio < thresholds.minimumFullReferenceCellCoverage) {
    reasons.push("full-reference-cell-coverage-below-minimum");
  }
  if (coverageReport.playableReference.cell.ratio < thresholds.minimumPlayableCellCoverage) {
    reasons.push("playable-reference-cell-coverage-below-minimum");
  }
  if (coverageReport.targetEligible.cell.ratio < thresholds.minimumTargetEligibleCellCoverage) {
    reasons.push("target-eligible-cell-coverage-below-minimum");
  }
  const canonicalArtifacts = {
    reconstruction: { sha256: result.artifacts.reconstruction.sha256 },
    difference: { sha256: result.artifacts.difference.sha256 },
  };
  const canonicalDocument = {
    status: reasons.length === 0 ? "passed" as const : "failed" as const,
    reasons,
    sourceHashes: { ...result.sourceHashes },
    artifacts: canonicalArtifacts,
    thresholds: { ...thresholds },
    imageDifference: result.imageDifference,
    seam: result.seam,
    seamEvidence: result.seamEvidence,
    coverage: coverageReport,
    groups,
  };
  const canonicalJson = JSON.stringify(canonicalize(canonicalDocument));
  return {
    ...canonicalDocument,
    artifacts: result.artifacts,
    canonicalJson,
    sha256: createHash("sha256").update(canonicalJson).digest("hex"),
  };
}
