import { describe, expect, it } from "vitest";
import type { ReconstructionResult } from "./reconstruct-reference.ts";
import { evaluateReconstruction } from "./quality-report.ts";

function resultFixture(): ReconstructionResult {
  return {
    sourceHashes: {
      targetSaveSha256: "2".repeat(64),
      sourceImageSha256: "0".repeat(64),
      referenceWorldSha256: "1".repeat(64),
      targetWorldSha256: "5".repeat(64),
    },
    canvas: { width: 4, height: 2 },
    artifacts: {
      reconstruction: { path: "trusted/reconstruction.webp", sha256: "3".repeat(64) },
      difference: { path: "trusted/difference.png", sha256: "4".repeat(64) },
    },
    imageDifference: { mean: 0.04, maximum: 0.2, samples: 24 },
    seam: { mean: 0.03, maximum: 0.1, samples: 4 },
    seamEvidence: {
      state: "measured",
      expectedSamples: 4,
      placedToPlaced: 4,
      placedToMissing: 0,
      missingToMissing: 0,
    },
    groups: [
      {
        id: "b/r0/ox0/oy0",
        uuid: "b",
        rotation: 0,
        offset: { x: 0, y: 0 },
        footprint: { width: 1, height: 1 },
        selectorStatus: "accepted",
        selectorReasons: [],
        selected: {
          sha256: "b".repeat(64),
          localFilename: "b.png",
          sourceWorld: { x: 1, y: 0 },
          sourceRotation: 0,
          synthesized: false,
        },
        rejectedCandidates: [],
        placedReferenceCells: [{ x: 1, y: 0 }],
        imageDifference: { mean: 0.2, maximum: 0.3, samples: 3 },
        seam: { mean: 0.02, maximum: 0.04, samples: 2 },
        seamEvidence: { expectedSamples: 2 },
      },
      {
        id: "a/r1/ox0/oy0",
        uuid: "a",
        rotation: 1,
        offset: { x: 0, y: 0 },
        footprint: { width: 1, height: 1 },
        selectorStatus: "accepted",
        selectorReasons: [],
        selected: {
          sha256: "a".repeat(64),
          localFilename: "a.png",
          sourceWorld: { x: 0, y: 0 },
          sourceRotation: 1,
          synthesized: false,
        },
        rejectedCandidates: [{
          sha256: "c".repeat(64),
          localFilename: "a-rejected.png",
          sourceWorld: { x: 2, y: 0 },
          reasons: ["outlier"],
        }],
        placedReferenceCells: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
        imageDifference: { mean: 0.01, maximum: 0.02, samples: 6 },
        seam: { mean: 0.2, maximum: 0.3, samples: 2 },
        seamEvidence: { expectedSamples: 2 },
      },
      {
        id: "c/r0/ox0/oy0",
        uuid: "c",
        rotation: 0,
        offset: { x: 0, y: 0 },
        footprint: { width: 1, height: 1 },
        selectorStatus: "rejected",
        selectorReasons: ["insufficient-consistent-candidates"],
        rejectedCandidates: [{
          sha256: "d".repeat(64),
          localFilename: "c.png",
          sourceWorld: { x: 1, y: 1 },
          reasons: ["insufficient-consistent-candidates"],
        }],
        placedReferenceCells: [],
        imageDifference: { mean: 0, maximum: 0, samples: 0 },
        seam: { mean: 0, maximum: 0, samples: 0 },
        seamEvidence: { expectedSamples: 0 },
      },
    ],
    coverageCells: {
      fullReference: [
        { x: 0, y: 0, uuid: "a", rotation: 1, groupId: "a/r1/ox0/oy0" },
        { x: 1, y: 0, uuid: "b", rotation: 0, groupId: "b/r0/ox0/oy0" },
        { x: 0, y: 1, uuid: "a", rotation: 1, groupId: "a/r1/ox0/oy0" },
        { x: 1, y: 1, uuid: "c", rotation: 0, groupId: "c/r0/ox0/oy0" },
      ],
      playableReference: [
        { x: 0, y: 0, uuid: "a", rotation: 1, groupId: "a/r1/ox0/oy0" },
        { x: 1, y: 0, uuid: "b", rotation: 0, groupId: "b/r0/ox0/oy0" },
      ],
      targetEligible: [
        { x: 20, y: 30, uuid: "b", rotation: 0, groupId: "b/r0/ox0/oy0" },
        { x: 21, y: 30, uuid: "c", rotation: 0, groupId: "c/r0/ox0/oy0" },
      ],
    },
  };
}

const thresholds = {
  maximumMeanImageDifference: 0.1,
  maximumPixelImageDifference: 0.5,
  maximumMeanSeamError: 0.1,
  maximumSeamError: 0.5,
  maximumGroupMeanImageDifference: 0.1,
  maximumGroupPixelImageDifference: 0.5,
  maximumGroupMeanSeamError: 0.1,
  maximumGroupSeamError: 0.5,
  minimumFullReferenceTypeCoverage: 0.3,
  minimumFullReferenceRotationCoverage: 0.3,
  minimumFullReferenceCellCoverage: 0.2,
  minimumPlayableCellCoverage: 0.4,
  minimumTargetEligibleCellCoverage: 0.4,
};

describe("evaluateReconstruction", () => {
  it("rejects each group that exceeds either explicit contribution threshold", () => {
    // Break caught: a locally bad group survives because only whole-image averages are gated.
    const report = evaluateReconstruction(resultFixture(), thresholds);

    expect(report.groups.map(({ id, status, reasons }) => ({ id, status, reasons }))).toEqual([
      {
        id: "a/r1/ox0/oy0",
        status: "rejected",
        reasons: ["group-seam-error-exceeded"],
      },
      {
        id: "b/r0/ox0/oy0",
        status: "rejected",
        reasons: ["group-image-difference-exceeded"],
      },
      {
        id: "c/r0/ox0/oy0",
        status: "rejected",
        reasons: ["insufficient-consistent-candidates"],
      },
    ]);
    expect(report.coverage.fullReference.cell).toEqual({ covered: 0, total: 4, ratio: 0 });
    expect(report.status).toBe("failed");
  });

  it("counts type, rotation, and cells only from placed groups that survive quality gates", () => {
    // Break caught: UUID recognition is counted as coverage even when no qualified image was placed.
    const input = resultFixture();
    input.groups[0]!.imageDifference.mean = 0.02;
    input.groups[1]!.seam.mean = 0.02;

    const report = evaluateReconstruction(input, thresholds);

    expect(report.coverage.fullReference).toEqual({
      type: { covered: 2, total: 3, ratio: 2 / 3 },
      rotation: { covered: 2, total: 3, ratio: 2 / 3 },
      cell: { covered: 3, total: 4, ratio: 0.75 },
    });
    expect(report.coverage.playableReference.cell).toEqual({ covered: 2, total: 2, ratio: 1 });
    expect(report.coverage.targetEligible.cell).toEqual({ covered: 1, total: 2, ratio: 0.5 });
    expect(report.status).toBe("passed");
  });

  it("counts exact placed reference coordinates and rejects contradictory placement records", () => {
    // Break caught: placing one occurrence grants coverage to every cell sharing the accepted group key.
    const partial = resultFixture();
    partial.groups[0]!.imageDifference.mean = 0.02;
    partial.groups[1]!.seam.mean = 0.02;
    partial.groups[1]!.placedReferenceCells = [{ x: 0, y: 0 }];

    const report = evaluateReconstruction(partial, thresholds);

    expect(report.coverage.fullReference.cell).toEqual({ covered: 2, total: 4, ratio: 0.5 });
    expect(report.coverage.playableReference.cell).toEqual({ covered: 2, total: 2, ratio: 1 });
    expect(report.coverage.targetEligible.cell).toEqual({ covered: 1, total: 2, ratio: 0.5 });

    const duplicate = resultFixture();
    duplicate.groups[1]!.placedReferenceCells.push({ x: 0, y: 0 });
    expect(() => evaluateReconstruction(duplicate, thresholds)).toThrow("placement");

    const unknown = resultFixture();
    unknown.groups[1]!.placedReferenceCells = [{ x: 99, y: 99 }];
    expect(() => evaluateReconstruction(unknown, thresholds)).toThrow("placement");
  });

  it("fails closed on maximum seam and group outliers even when their means pass", () => {
    // Break caught: a small but severe seam or pixel defect hides beneath an acceptable mean.
    const input = resultFixture();
    input.imageDifference.maximum = 0.2;
    input.seam.mean = 0.01;
    input.seam.maximum = 0.8;
    input.groups[0]!.imageDifference.mean = 0.02;
    input.groups[0]!.imageDifference.maximum = 0.8;
    input.groups[1]!.seam.mean = 0.02;
    input.groups[1]!.seam.maximum = 0.8;

    const report = evaluateReconstruction(input, thresholds);

    expect(report.reasons).toContain("maximum-seam-error-exceeded");
    expect(report.groups.find(({ id }) => id.startsWith("a/"))?.reasons)
      .toContain("group-maximum-seam-error-exceeded");
    expect(report.groups.find(({ id }) => id.startsWith("b/"))?.reasons)
      .toContain("group-maximum-image-difference-exceeded");
  });

  it("emits canonical JSON with stable ordering, hashes, thresholds, and compact provenance", () => {
    // Break caught: report order depends on decision insertion order or omits immutable input provenance.
    const first = resultFixture();
    first.groups[0]!.imageDifference.mean = 0.02;
    first.groups[1]!.seam.mean = 0.02;
    const second = resultFixture();
    second.groups[0]!.imageDifference.mean = 0.02;
    second.groups[1]!.seam.mean = 0.02;
    second.groups.reverse();
    second.artifacts.reconstruction.path = "another/local/root/reconstruction.webp";
    second.artifacts.difference.path = "another/local/root/difference.png";

    const forward = evaluateReconstruction(first, thresholds);
    const reverse = evaluateReconstruction(second, { ...thresholds });

    expect(reverse.canonicalJson).toBe(forward.canonicalJson);
    expect(reverse.sha256).toBe(forward.sha256);
    expect(JSON.parse(forward.canonicalJson)).toMatchObject({
      sourceHashes: {
        sourceImageSha256: "0".repeat(64),
        referenceWorldSha256: "1".repeat(64),
        targetWorldSha256: "5".repeat(64),
        targetSaveSha256: "2".repeat(64),
      },
      thresholds,
      groups: [{ id: "a/r1/ox0/oy0" }, { id: "b/r0/ox0/oy0" }, { id: "c/r0/ox0/oy0" }],
    });
    expect(forward.canonicalJson).not.toContain("pixels");
    expect(forward.canonicalJson).not.toContain("trusted/");
  });

  it("fails closed when a threshold is missing or outside the normalized range", () => {
    // Break caught: permissive defaults or NaN silently disable a quality gate.
    expect(() => evaluateReconstruction(resultFixture(), {
      ...thresholds,
      maximumMeanSeamError: Number.NaN,
    })).toThrow("thresholds");
    const missing = { ...thresholds } as Partial<typeof thresholds>;
    delete missing.minimumPlayableCellCoverage;
    expect(() => evaluateReconstruction(resultFixture(), missing as typeof thresholds)).toThrow("thresholds");
  });

  it("fails closed when reconstruction metrics are non-finite or malformed", () => {
    // Break caught: NaN comparisons evaluate false and allow a corrupt reconstruction to pass every gate.
    const nonFinite = resultFixture();
    nonFinite.imageDifference.mean = Number.NaN;
    expect(() => evaluateReconstruction(nonFinite, thresholds)).toThrow("metrics");

    const negativeSamples = resultFixture();
    negativeSamples.groups[0]!.seam.samples = -1;
    expect(() => evaluateReconstruction(negativeSamples, thresholds)).toThrow("metrics");
  });

  it("rejects missing seam evidence unless no internal boundary is explicit", () => {
    // Break caught: sparse output passes seam gates by reporting zero samples as zero error.
    const missing = resultFixture();
    missing.seam = { mean: 0, maximum: 0, samples: 0 };
    missing.seamEvidence = {
      state: "measured", expectedSamples: 4, placedToPlaced: 4, placedToMissing: 0, missingToMissing: 0,
    };
    expect(() => evaluateReconstruction(missing, thresholds)).toThrow("seam evidence");

    const missingGroupEvidence = resultFixture();
    missingGroupEvidence.groups[0]!.seam = { mean: 0, maximum: 0, samples: 1 };
    expect(() => evaluateReconstruction(missingGroupEvidence, thresholds)).toThrow("seam evidence");

    const noEdges = resultFixture();
    noEdges.seam = { mean: 0, maximum: 0, samples: 0 };
    noEdges.seamEvidence = {
      state: "no-internal-boundaries", expectedSamples: 0, placedToPlaced: 0, placedToMissing: 0, missingToMissing: 0,
    };
    noEdges.groups = [];
    noEdges.coverageCells = { fullReference: [], playableReference: [], targetEligible: [] };
    const permissive = Object.fromEntries(Object.entries(thresholds).map(([name, threshold]) => [
      name,
      name.startsWith("minimum") ? 0 : threshold,
    ])) as typeof thresholds;
    expect(evaluateReconstruction(noEdges, permissive).seamEvidence.state).toBe("no-internal-boundaries");

    const contradictoryGroup = resultFixture();
    contradictoryGroup.seam = { mean: 0, maximum: 0, samples: 0 };
    contradictoryGroup.seamEvidence = {
      state: "no-internal-boundaries", expectedSamples: 0, placedToPlaced: 0, placedToMissing: 0, missingToMissing: 0,
    };
    contradictoryGroup.groups = [{
      ...contradictoryGroup.groups[1]!,
      placedReferenceCells: [{ x: 0, y: 0 }],
      seam: { mean: 0, maximum: 0, samples: 1 },
      seamEvidence: { expectedSamples: 1 },
    }];
    contradictoryGroup.coverageCells = {
      fullReference: [{ x: 0, y: 0, uuid: "a", rotation: 1, groupId: "a/r1/ox0/oy0" }],
      playableReference: [{ x: 0, y: 0, uuid: "a", rotation: 1, groupId: "a/r1/ox0/oy0" }],
      targetEligible: [],
    };
    expect(() => evaluateReconstruction(contradictoryGroup, permissive)).toThrow("seam evidence");
  });
});
