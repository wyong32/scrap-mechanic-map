import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { TerrainCell, WorldMap } from "../../src/domain/map-model.ts";
import type { ExtractionCandidate } from "./candidate-extractor.ts";
import type { CandidateDecision } from "./candidate-selector.ts";
import { reconstructReference } from "./reconstruct-reference.ts";
import { createReferenceTransform } from "./reference-transform.ts";

const directories: string[] = [];
const uuidA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const uuidB = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const uuidC = "cccccccc-dddd-eeee-ffff-000000000000";

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function cell(
  x: number,
  y: number,
  uuid: string,
  rotation: 0 | 1 | 2 | 3,
  xOffset = 0,
  footprintWidth = 1,
): { terrain: TerrainCell; footprintWidth: number } {
  return {
    terrain: {
      x,
      y,
      uuid,
      rotation,
      xOffset,
      yOffset: 0,
      flags: 0,
      terrainType: "fixture",
    },
    footprintWidth,
  };
}

function accepted(
  source: ReturnType<typeof cell>,
  pixels: readonly number[],
  imageRotation = source.terrain.rotation,
): CandidateDecision {
  const width = source.terrain.x === 0 ? 3 : 2;
  const height = source.terrain.y === 0 ? 2 : 1;
  if (pixels.length !== width * height * 3) throw new Error("Fixture pixels do not match source edges.");
  const candidate: ExtractionCandidate = {
    uuid: source.terrain.uuid,
    rotation: source.terrain.rotation,
    offset: { x: source.terrain.xOffset, y: source.terrain.yOffset },
    footprint: { width: source.footprintWidth, height: 1 },
    world: { x: source.terrain.x, y: source.terrain.y },
    pixelEdges: {
      left: source.terrain.x === 0 ? 0 : 3,
      top: source.terrain.y === 0 ? 0 : 2,
      right: source.terrain.x === 0 ? 3 : 5,
      bottom: source.terrain.y === 0 ? 2 : 3,
    },
    sha256: createHash("sha256").update(Uint8Array.from(pixels)).digest("hex"),
    width,
    height,
    channels: 3,
    pixels: Uint8Array.from(pixels),
    localFilename: `${source.terrain.uuid}-${source.terrain.rotation}-${source.terrain.xOffset}.png`,
  };
  return {
    status: "accepted",
    selected: candidate,
    cluster: [candidate],
    scores: [],
    rejections: [],
    reasons: [],
    image: {
      width,
      height,
      channels: 3,
      rotation: imageRotation,
      synthesized: imageRotation !== candidate.rotation,
      pixels: Uint8Array.from(pixels),
    },
  };
}

function rejected(source: ReturnType<typeof cell>): CandidateDecision {
  const width = source.terrain.x === 0 ? 3 : 2;
  const height = source.terrain.y === 0 ? 2 : 1;
  const decision = accepted(source, new Array(width * height * 3).fill(90));
  return {
    ...decision,
    status: "rejected",
    selected: undefined,
    image: undefined,
    reasons: ["fixture-rejection"],
    rejections: [{ candidate: decision.cluster[0]!, reasons: ["fixture-rejection"] }],
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reference-reconstruction-"));
  directories.push(root);
  const trustedLocalRoot = join(root, "trusted");
  const outputDirectory = join(trustedLocalRoot, "diagnostics");
  const candidateRoot = join(trustedLocalRoot, "candidates");
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(candidateRoot, { recursive: true });
  const sourceImagePath = join(root, "source.png");
  const reconstructionPath = join(outputDirectory, "reference.webp");
  const differencePath = join(outputDirectory, "difference.png");
  const sourcePixels = Buffer.from([
    10, 0, 0, 20, 0, 0, 0, 30, 0, 0, 40, 0, 0, 50, 0,
    11, 0, 0, 21, 0, 0, 0, 31, 0, 0, 41, 0, 0, 51, 0,
    0, 0, 60, 0, 0, 70, 200, 200, 200, 201, 201, 201, 202, 202, 202,
  ]);
  await sharp(sourcePixels, { raw: { width: 5, height: 3, channels: 3 } })
    .png()
    .toFile(sourceImagePath);
  const sourceBytes = await readFile(sourceImagePath);
  const topLeft = cell(0, 0, uuidA, 0);
  const topRight = cell(1, 0, uuidB, 1, 1, 2);
  const bottomLeft = cell(0, 1, uuidB, 1, 0, 2);
  const bottomRight = cell(1, 1, uuidC, 0);
  const referenceWorld: WorldMap = {
    id: "fixture",
    source: "reference",
    gameVersion: "1",
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    cells: [topLeft.terrain, topRight.terrain, bottomLeft.terrain, bottomRight.terrain],
    locations: [],
    connections: [],
  };
  const worldBytes = Buffer.from(JSON.stringify(referenceWorld));
  const worldSha256 = createHash("sha256").update(worldBytes).digest("hex");
  const targetSaveBytes = Buffer.from("fixture-target-save");
  const targetSaveSha256 = createHash("sha256").update(targetSaveBytes).digest("hex");
  const options = {
    decisions: [
      accepted(topRight, [0, 30, 0, 0, 50, 0, 0, 31, 0, 0, 51, 0]),
      accepted(topLeft, [10, 0, 0, 10, 0, 0, 20, 0, 0, 11, 0, 0, 11, 0, 0, 21, 0, 0]),
      accepted(bottomLeft, [0, 0, 60, 0, 0, 60, 0, 0, 70]),
      rejected(bottomRight),
    ],
    referenceWorld,
    targetWorld: referenceWorld,
    targetEligibleUuids: [uuidB, uuidC],
    playableBounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
    sourceImagePath,
    sourceHashes: {
      sourceImageSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      referenceWorldSha256: worldSha256,
      targetWorldSha256: worldSha256,
      targetSaveSha256,
    },
    worldProvenance: {
      referenceWorld: {
        bytes: worldBytes,
        sha256: worldSha256,
      },
      targetWorld: {
        bytes: worldBytes,
        sha256: worldSha256,
      },
    },
    targetSaveProvenance: {
      bytes: targetSaveBytes,
      sha256: targetSaveSha256,
    },
    transform: createReferenceTransform({
      imageWidth: 5,
      imageHeight: 3,
      bounds: referenceWorld.bounds,
      orientation: "x-right-y-down" as const,
    }),
    trustedLocalRoot,
    candidateRoot,
    reconstructionPath,
    differencePath,
    differenceAmplification: 4,
  };
  for (const decision of options.decisions) {
    for (const candidate of decision.cluster) {
      const candidatePath = join(candidateRoot, candidate.localFilename);
      await mkdir(dirname(candidatePath), { recursive: true });
      const bytes = await sharp(candidate.pixels, {
        raw: { width: candidate.width, height: candidate.height, channels: 3 },
      }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
      candidate.sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(candidatePath, bytes);
    }
  }
  return { options, sourceBytes, sourceImagePath, reconstructionPath, differencePath, candidateRoot, root };
}

function refreshWorldProvenance(options: Awaited<ReturnType<typeof fixture>>["options"]): void {
  const referenceBytes = Buffer.from(JSON.stringify(options.referenceWorld));
  const targetBytes = Buffer.from(JSON.stringify(options.targetWorld));
  const referenceHash = createHash("sha256").update(referenceBytes).digest("hex");
  const targetHash = createHash("sha256").update(targetBytes).digest("hex");
  options.worldProvenance.referenceWorld = { bytes: referenceBytes, sha256: referenceHash };
  options.worldProvenance.targetWorld = { bytes: targetBytes, sha256: targetHash };
  options.sourceHashes.referenceWorldSha256 = referenceHash;
  options.sourceHashes.targetWorldSha256 = targetHash;
}

describe("reconstructReference", () => {
  it("places the matching rotation and offset pieces on exact variable transform edges", async () => {
    // Break caught: reconstruction assumes a fixed cell size or collapses rotation/offset groups.
    const { options, reconstructionPath } = await fixture();

    const result = await reconstructReference(options);
    const reconstructionBytes = await readFile(reconstructionPath);
    const { data, info } = await sharp(reconstructionBytes).raw().toBuffer({ resolveWithObject: true });

    expect(info).toMatchObject({ width: 5, height: 3, channels: 4 });
    expect([...data]).toEqual([
      10, 0, 0, 255, 10, 0, 0, 255, 20, 0, 0, 255, 0, 30, 0, 255, 0, 50, 0, 255,
      11, 0, 0, 255, 11, 0, 0, 255, 21, 0, 0, 255, 0, 31, 0, 255, 0, 51, 0, 255,
      0, 0, 60, 255, 0, 0, 60, 255, 0, 0, 70, 255, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(result.canvas).toEqual({ width: 5, height: 3 });
    expect(result.groups.find(({ uuid, offset }) => uuid === uuidB && offset.x === 1)?.placedReferenceCells)
      .toEqual([{ x: 1, y: 0 }]);
  });

  it("writes deterministic lossless WebP and amplified PNG diagnostics without changing the source", async () => {
    // Break caught: encoder settings vary, difference pixels are not amplified, or the source is overwritten.
    const first = await fixture();
    const firstResult = await reconstructReference(first.options);
    const firstReconstruction = await readFile(first.reconstructionPath);
    const firstDifference = await readFile(first.differencePath);
    const sourceAfter = await readFile(first.sourceImagePath);
    const second = await fixture();
    const secondResult = await reconstructReference(second.options);

    expect(firstResult.artifacts.reconstruction.sha256).toBe(
      createHash("sha256").update(firstReconstruction).digest("hex"),
    );
    expect(firstResult.artifacts.reconstruction.sha256).toBe(secondResult.artifacts.reconstruction.sha256);
    expect(firstResult.artifacts.difference.sha256).toBe(secondResult.artifacts.difference.sha256);
    expect(sourceAfter).toEqual(first.sourceBytes);
    expect(await sharp(firstDifference).metadata()).toMatchObject({ width: 5, height: 3, format: "png" });
    const differencePixels = await sharp(firstDifference).removeAlpha().raw().toBuffer();
    expect([...differencePixels.subarray(39, 45)]).toEqual([255, 255, 255, 255, 255, 255]);
  });

  it("uses a synthesized image for its target rotation while retaining source-rotation provenance", async () => {
    // Break caught: a synthesized rotation is indexed by its source rotation and never reaches matching target cells.
    const { options } = await fixture();
    const target = options.referenceWorld.cells[3]!;
    target.uuid = uuidA;
    target.rotation = 1;
    const source = cell(0, 0, uuidA, 0);
    options.decisions[1] = accepted(source,
      [10, 0, 0, 10, 0, 0, 20, 0, 0, 11, 0, 0, 11, 0, 0, 21, 0, 0], 1);
    options.decisions = options.decisions.filter((decision) =>
      decision.selected?.uuid !== uuidC && decision.cluster[0]?.uuid !== uuidC);
    const synthesizedCandidate = options.decisions[1]!.selected!;
    const synthesizedBytes = await sharp(synthesizedCandidate.pixels, {
      raw: { width: synthesizedCandidate.width, height: synthesizedCandidate.height, channels: 3 },
    }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    synthesizedCandidate.sha256 = createHash("sha256").update(synthesizedBytes).digest("hex");
    await writeFile(join(options.candidateRoot, synthesizedCandidate.localFilename), synthesizedBytes);
    refreshWorldProvenance(options);

    const result = await reconstructReference(options);
    const synthesized = result.groups.find(({ uuid }) => uuid === uuidA)!;

    expect(synthesized).toMatchObject({
      id: `${uuidA}/r1/ox0/oy0`,
      rotation: 1,
      selected: { sourceRotation: 0, synthesized: true },
      placedReferenceCells: [{ x: 1, y: 1 }],
    });
  });

  it("scores shared edges between adjacent cells that reuse one selected group", async () => {
    // Break caught: same-group neighbors are skipped and reusable-tile seams falsely report zero samples.
    const { options } = await fixture();
    const repeated = options.referenceWorld.cells[1]!;
    repeated.uuid = uuidA;
    repeated.rotation = 0;
    repeated.xOffset = 0;
    options.decisions = options.decisions.filter((decision) => decision.selected?.uuid === uuidA);
    refreshWorldProvenance(options);

    const result = await reconstructReference(options);

    expect(result.groups.find(({ uuid }) => uuid === uuidA)?.seam.samples).toBeGreaterThan(0);
  });

  it("scores alpha-only visibility mismatches and renders them visibly in the difference image", async () => {
    // Break caught: transparent omissions or opaque-black placements compare equal because only RGB is scored.
    const missing = await fixture();
    const opaqueBlack = Buffer.from(new Array(5 * 3).fill(0).flatMap(() => [0, 0, 0, 255]));
    await sharp(opaqueBlack, { raw: { width: 5, height: 3, channels: 4 } }).png()
      .toFile(missing.sourceImagePath);
    missing.options.sourceHashes.sourceImageSha256 = createHash("sha256")
      .update(await readFile(missing.sourceImagePath)).digest("hex");
    missing.options.decisions = [];

    const missingResult = await reconstructReference(missing.options);
    const missingDifference = await sharp(await readFile(missing.differencePath)).removeAlpha().raw().toBuffer();

    expect(missingResult.imageDifference).toMatchObject({ mean: 1, maximum: 1 });
    expect([...missingDifference.subarray(0, 3)]).toEqual([255, 255, 255]);

    const extra = await fixture();
    const transparentBlack = Buffer.from(new Array(5 * 3).fill(0).flatMap(() => [0, 0, 0, 0]));
    await sharp(transparentBlack, { raw: { width: 5, height: 3, channels: 4 } }).png()
      .toFile(extra.sourceImagePath);
    extra.options.sourceHashes.sourceImageSha256 = createHash("sha256")
      .update(await readFile(extra.sourceImagePath)).digest("hex");
    extra.options.decisions = [extra.options.decisions[1]!];

    const extraResult = await reconstructReference(extra.options);

    expect(extraResult.groups[0]!.imageDifference).toMatchObject({ mean: 1, maximum: 1 });

    const hiddenRgb = await fixture();
    const transparentColor = Buffer.from(new Array(5 * 3).fill(0).flatMap(() => [220, 130, 40, 0]));
    await sharp(transparentColor, { raw: { width: 5, height: 3, channels: 4 } }).png()
      .toFile(hiddenRgb.sourceImagePath);
    hiddenRgb.options.sourceHashes.sourceImageSha256 = createHash("sha256")
      .update(await readFile(hiddenRgb.sourceImagePath)).digest("hex");
    hiddenRgb.options.decisions = [];

    expect((await reconstructReference(hiddenRgb.options)).imageDifference.mean).toBe(0);
  });

  it("scores placed-to-missing and missing-to-missing transform boundaries with explicit evidence", async () => {
    // Break caught: sparse reconstruction skips exposed/missing edges and reports a misleading zero-sample seam.
    const { options } = await fixture();
    options.decisions = [options.decisions[1]!];

    const result = await reconstructReference(options);

    expect(result.seamEvidence).toEqual({
      state: "measured",
      expectedSamples: 8,
      placedToPlaced: 0,
      placedToMissing: 5,
      missingToMissing: 3,
    });
    expect(result.seam.samples).toBe(8);
    expect(result.seam.maximum).toBeGreaterThan(0);
    expect(result.groups[0]!.seam.samples).toBe(5);
    expect(result.groups[0]!.seam.maximum).toBeGreaterThan(0);
  });

  it("normalizes the worst possible opposing seam gradients to one", async () => {
    // Break caught: opposite full-range gradients produce 2.0 and invalidate normalized quality metrics.
    const { options, sourceImagePath, candidateRoot } = await fixture();
    const sourcePixels = Buffer.alloc(5 * 3 * 3);
    for (let y = 0; y < 3; y += 1) {
      const offset = (y * 5 + 3) * 3;
      sourcePixels.fill(255, offset, offset + 3);
    }
    await sharp(sourcePixels, { raw: { width: 5, height: 3, channels: 3 } }).png()
      .toFile(sourceImagePath);
    options.sourceHashes.sourceImageSha256 = createHash("sha256")
      .update(await readFile(sourceImagePath)).digest("hex");
    for (const decision of options.decisions.filter(({ status }) => status === "accepted")) {
      const candidate = decision.selected!;
      candidate.pixels.fill(0);
      decision.image!.pixels.fill(0);
      if (candidate.world.x === 0 && candidate.world.y === 0) {
        for (let y = 0; y < candidate.height; y += 1) {
          const offset = (y * candidate.width + candidate.width - 1) * 3;
          candidate.pixels.fill(255, offset, offset + 3);
          decision.image!.pixels.fill(255, offset, offset + 3);
        }
      }
      const bytes = await sharp(candidate.pixels, {
        raw: { width: candidate.width, height: candidate.height, channels: 3 },
      }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
      candidate.sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(candidateRoot, candidate.localFilename), bytes);
    }

    const result = await reconstructReference(options);

    expect(result.seam.maximum).toBe(1);
  });

  it("fails closed on source substitution and destinations outside the trusted local root", async () => {
    // Break caught: reconstruction trusts caller metadata or writes diagnostics to an unrelated/public path.
    const sourceMismatch = await fixture();
    sourceMismatch.options.sourceHashes.sourceImageSha256 = "0".repeat(64);
    await expect(reconstructReference(sourceMismatch.options)).rejects.toThrow("hash");

    const unsafe = await fixture();
    unsafe.options.reconstructionPath = join(unsafe.root, "outside.webp");
    await expect(reconstructReference(unsafe.options)).rejects.toThrow("trusted local root");
  });

  it("verifies immutable world provenance, candidate files, dimensions, pixels, and observed footprints", async () => {
    // Break caught: copied hashes and candidate metadata attest mutable or missing inputs that were never reconstructed.
    const mutatedWorld = await fixture();
    mutatedWorld.options.referenceWorld.cells[0]!.uuid = uuidC;
    await expect(reconstructReference(mutatedWorld.options)).rejects.toThrow("world provenance");

    const substitutedProvenance = await fixture();
    substitutedProvenance.options.worldProvenance.targetWorld.sha256 = "f".repeat(64);
    await expect(reconstructReference(substitutedProvenance.options)).rejects.toThrow("world provenance");

    const substitutedTargetSave = await fixture();
    substitutedTargetSave.options.targetSaveProvenance.bytes = Buffer.from("different-target-save");
    substitutedTargetSave.options.targetSaveProvenance.sha256 = createHash("sha256")
      .update(substitutedTargetSave.options.targetSaveProvenance.bytes).digest("hex");
    await expect(reconstructReference(substitutedTargetSave.options)).rejects.toThrow("target save provenance");

    const missingCandidate = await fixture();
    const missing = missingCandidate.options.decisions[0]!.selected!;
    await rm(join(missingCandidate.candidateRoot, missing.localFilename));
    await expect(reconstructReference(missingCandidate.options)).rejects.toThrow("candidate file");

    const alteredCandidate = await fixture();
    const altered = alteredCandidate.options.decisions[0]!.selected!;
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "black" } })
      .png().toFile(join(alteredCandidate.candidateRoot, altered.localFilename));
    await expect(reconstructReference(alteredCandidate.options)).rejects.toThrow("candidate file");

    const wrongDimensions = await fixture();
    const dimensionCandidate = wrongDimensions.options.decisions[0]!.selected!;
    const dimensionBytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "black" } })
      .png().toBuffer();
    await writeFile(join(wrongDimensions.candidateRoot, dimensionCandidate.localFilename), dimensionBytes);
    dimensionCandidate.sha256 = createHash("sha256").update(dimensionBytes).digest("hex");
    await expect(reconstructReference(wrongDimensions.options)).rejects.toThrow("dimensions");

    const staleFootprint = await fixture();
    staleFootprint.options.decisions[0]!.selected!.footprint = { width: 3, height: 1 };
    await expect(reconstructReference(staleFootprint.options)).rejects.toThrow("footprint");

    const shiftedEdges = await fixture();
    const shifted = shiftedEdges.options.decisions[0]!.selected!;
    shifted.pixelEdges = { ...shifted.pixelEdges, left: shifted.pixelEdges.left + 1, right: shifted.pixelEdges.right + 1 };
    await expect(reconstructReference(shiftedEdges.options)).rejects.toThrow("crop edges");

    const movedSourceWorld = await fixture();
    movedSourceWorld.options.decisions[0]!.selected!.world = { x: 0, y: 0 };
    await expect(reconstructReference(movedSourceWorld.options)).rejects.toThrow("source-world");
  });

  it("omits an unverified caller target-save hash when target eligibility is not requested", async () => {
    // Break caught: spreading caller hashes attests a target save even though no target-save bytes were supplied.
    const { options } = await fixture();
    options.targetEligibleUuids = [];
    delete (options as Partial<typeof options>).targetSaveProvenance;
    options.sourceHashes.targetSaveSha256 = "f".repeat(64);

    const result = await reconstructReference(options);

    expect(result.sourceHashes).not.toHaveProperty("targetSaveSha256");
  });
});
