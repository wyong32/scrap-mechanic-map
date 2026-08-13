import { describe, expect, it } from "vitest";
import type { ExtractionCandidate } from "./candidate-extractor.ts";
import {
  selectCandidateGroup,
  type CandidateSelectionThresholds,
} from "./candidate-selector.ts";

const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function solidCandidate(
  x: number,
  value: number,
  overrides: Partial<ExtractionCandidate> = {},
): ExtractionCandidate {
  return {
    uuid,
    rotation: 0,
    offset: { x: 0, y: 0 },
    footprint: { width: 1, height: 1 },
    world: { x, y: 0 },
    pixelEdges: { left: x * 4, top: 0, right: x * 4 + 4, bottom: 4 },
    sha256: x.toString(16).padStart(64, "0"),
    width: 4,
    height: 4,
    channels: 3,
    pixels: new Uint8Array(4 * 4 * 3).fill(value),
    localFilename: `${x}.png`,
    ...overrides,
  };
}

const thresholds: CandidateSelectionThresholds = {
  normalizedWidth: 4,
  normalizedHeight: 4,
  interiorInset: 1,
  edgeStripWidth: 1,
  maximumInteriorDistance: 0.06,
  maximumEdgeDistance: 0.06,
  minimumClusterSize: 2,
  maximumGroupSize: 256,
};

function patternedCandidate(x: number, bits: string): ExtractionCandidate {
  const pixels = new Uint8Array(10 * 3 * 3);
  for (let y = 0; y < 3; y += 1) {
    for (let column = 0; column < bits.length; column += 1) {
      pixels.fill(bits[column] === "1" ? 255 : 0, (y * 10 + column) * 3, (y * 10 + column + 1) * 3);
    }
  }
  return solidCandidate(x, 0, {
    width: 10,
    height: 3,
    pixelEdges: { left: x * 10, top: 0, right: x * 10 + 10, bottom: 3 },
    pixels,
  });
}

describe("selectCandidateGroup", () => {
  it("chooses the deterministic medoid of the largest consistent cluster", () => {
    // Break caught: selection averages pixels, accepts the outlier, or picks a non-medoid sample.
    const candidates = [solidCandidate(3, 255), solidCandidate(2, 11), solidCandidate(0, 0), solidCandidate(1, 10)];

    const decision = selectCandidateGroup(candidates, thresholds);

    expect(decision.status).toBe("accepted");
    expect(decision.selected?.world).toEqual({ x: 1, y: 0 });
    expect(decision.cluster.map(({ world }) => world.x)).toEqual([0, 1, 2]);
    expect(decision.scores).toHaveLength(6);
    expect(decision.rejections).toEqual([{
      candidate: expect.objectContaining({ world: { x: 3, y: 0 } }),
      reasons: expect.arrayContaining(["outside-largest-consistent-cluster"]),
    }]);
    expect([...decision.image!.pixels]).toEqual([...solidCandidate(1, 10).pixels]);
  });

  it("rejects a lone crop that has no consistent peer", () => {
    // Break caught: a singleton is silently treated as verified despite the caller's minimum cluster size.
    const decision = selectCandidateGroup([solidCandidate(0, 0), solidCandidate(1, 255)], thresholds);

    expect(decision.status).toBe("rejected");
    expect(decision.reasons).toContain("insufficient-consistent-candidates");
    expect(decision.scores).toHaveLength(1);
    expect(decision.rejections).toHaveLength(2);
  });

  it("refuses to group distinct offsets of the same UUID and rotation", () => {
    // Break caught: different image fragments of one multi-cell asset are eligible for one medoid.
    const first = solidCandidate(0, 10, { footprint: { width: 2, height: 1 } });
    const second = solidCandidate(1, 10, {
      offset: { x: 1, y: 0 },
      footprint: { width: 2, height: 1 },
    });

    expect(() => selectCandidateGroup([first, second], thresholds)).toThrow("offset/footprint");
  });

  it("rejects crops whose matching interiors hide excessive edge error", () => {
    // Break caught: edge strips are omitted or folded into an interior-only acceptance score.
    const first = solidCandidate(0, 10);
    const edgePixels = new Uint8Array(first.pixels);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (x === 0 || x === 3 || y === 0 || y === 3) {
          edgePixels.fill(255, (y * 4 + x) * 3, (y * 4 + x + 1) * 3);
        }
      }
    }
    const decision = selectCandidateGroup([
      first,
      solidCandidate(1, 10, { pixels: edgePixels }),
    ], thresholds);

    expect(decision.status).toBe("rejected");
    expect(decision.scores[0]).toMatchObject({ interiorDistance: 0 });
    expect(Math.max(...Object.values(decision.scores[0]!.edgeDistances))).toBeGreaterThan(0.9);
    expect(decision.reasons).toContain("insufficient-consistent-candidates");
    expect(decision.rejections.every(({ reasons }) => reasons.includes("excessive-edge-distance"))).toBe(true);
  });

  it("requires every pair in a selected cluster to be mutually consistent", () => {
    // Break caught: transitive connected-component grouping admits two crops that exceed the threshold.
    const decision = selectCandidateGroup(
      [solidCandidate(0, 0), solidCandidate(1, 10), solidCandidate(2, 20)],
      { ...thresholds, maximumInteriorDistance: 0.05, maximumEdgeDistance: 0.05 },
    );

    expect(decision.status).toBe("accepted");
    expect(decision.cluster.map(({ world }) => world.x)).toEqual([0, 1]);
    expect(decision.rejections[0]).toMatchObject({
      candidate: { world: { x: 2, y: 0 } },
      reasons: expect.arrayContaining(["outside-largest-consistent-cluster"]),
    });
  });

  it("finds the exact maximum mutually consistent subset independent of input order", () => {
    // Break caught: sorted greedy scans consume one-edge leaves and miss the larger core clique.
    const candidates = [
      patternedCandidate(0, "0000001100"),
      patternedCandidate(1, "0000010101"),
      patternedCandidate(2, "0000011010"),
      patternedCandidate(3, "0000000000"),
      patternedCandidate(4, "0000000001"),
      patternedCandidate(5, "0000000010"),
    ];
    const exactThresholds: CandidateSelectionThresholds = {
      ...thresholds,
      normalizedWidth: 10,
      normalizedHeight: 3,
      interiorInset: 0,
      maximumInteriorDistance: 0.201,
      maximumEdgeDistance: 1,
      minimumClusterSize: 3,
    };

    const forward = selectCandidateGroup(candidates, exactThresholds);
    const reverse = selectCandidateGroup([...candidates].reverse(), exactThresholds);

    expect(forward.cluster.map(({ world }) => world.x)).toEqual([3, 4, 5]);
    expect(reverse.cluster.map(({ world }) => world.x)).toEqual([3, 4, 5]);
    expect(reverse.selected?.world).toEqual(forward.selected?.world);
  });

  it("fails closed above the caller-supplied exact-search group bound", () => {
    // Break caught: oversized groups silently fall back to an inexact greedy selector.
    expect(() => selectCandidateGroup(
      [solidCandidate(0, 0), solidCandidate(1, 0), solidCandidate(2, 0)],
      { ...thresholds, maximumGroupSize: 2 },
    )).toThrow("exact-search bound");
  });

  it("rotates a selected square crop by exact quarter turns", () => {
    // Break caught: synthesis interpolates, rotates the wrong direction, or permits a non-square crop.
    const pixels = new Uint8Array([
      255, 0, 0, 0, 255, 0,
      0, 0, 255, 255, 255, 255,
    ]);
    const candidate = solidCandidate(0, 0, {
      width: 2,
      height: 2,
      pixelEdges: { left: 0, top: 0, right: 2, bottom: 2 },
      pixels,
    });
    const decision = selectCandidateGroup([candidate], {
      ...thresholds,
      normalizedWidth: 2,
      normalizedHeight: 2,
      interiorInset: 0,
      minimumClusterSize: 1,
      targetRotation: 1,
    });

    expect(decision.status).toBe("accepted");
    expect(decision.image).toEqual({
      width: 2,
      height: 2,
      channels: 3,
      rotation: 1,
      synthesized: true,
      pixels: new Uint8Array([
        0, 0, 255, 255, 0, 0,
        255, 255, 255, 0, 255, 0,
      ]),
    });
  });
});
