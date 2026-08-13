import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { WorldMap } from "../../src/domain/map-model.ts";
import { createSaveFixture } from "../../src/save/fixtures/create-save-fixture.ts";
import {
  scriptDataWrapper,
  type FixtureValue,
} from "../../src/save/fixtures/encoded-values.ts";
import {
  CALIBRATED_REFERENCE_INPUT_HASHES,
  compareUuidSets,
  loadReferenceExtractionInputs,
} from "./reference-inputs.ts";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function world(uuids: string[], bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }): WorldMap {
  return {
    id: "fixture",
    source: "save",
    gameVersion: "1.0.0",
    bounds,
    cells: uuids.map((uuid, index) => ({
      x: index,
      y: 0,
      uuid,
      rotation: 0,
      xOffset: 0,
      yOffset: 0,
      flags: 0,
      terrainType: "fixture",
    })),
    locations: [],
    connections: [],
  };
}

const localDefaultSavePath = "local-assets/default-save.db";
const hasLocalDefaultSave = await access(localDefaultSavePath).then(
  () => true,
  () => false,
);
const checkedInOptions = {
  sourceImagePath: "public/assets/reference-surface-1.0.webp",
  referenceWorldPath: "public/data/generated/reference-world.json",
  defaultSavePath: localDefaultSavePath,
  targetSavePath: localDefaultSavePath,
  buildInfoPath: "public/data/generated/build-info.json",
  catalogPath: "public/data/generated/tile-catalog.json",
};

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function uuidBytes(uuid: string): number[] {
  return [...Buffer.from(uuid.replaceAll("-", ""), "hex").reverse()];
}

function scalarMatrix(value: FixtureValue, xMin: number, xMax: number, yMin: number, yMax: number): FixtureValue {
  return {
    array: Array.from({ length: yMax - yMin + 1 }, () => ({
      array: Array.from({ length: xMax - xMin + 1 }, () => value),
      offset: xMin,
    })),
    offset: yMin,
  };
}

function terrainWithRawBounds(uuid: string, xMin: number, xMax: number): FixtureValue {
  const yMin = -56;
  const yMax = 55;
  return {
    entries: [
      ["bounds", { entries: [
        ["xMin", { int8: xMin }], ["xMax", { int8: xMax }],
        ["yMin", { int8: yMin }], ["yMax", { int8: yMax }],
      ] }],
      ["seed", { int32: 9 }],
      ["uid", scalarMatrix({ uuidBytes: uuidBytes(uuid) }, xMin, xMax, yMin, yMax)],
      ["xOffset", scalarMatrix({ int8: 0 }, xMin, xMax, yMin, yMax)],
      ["yOffset", scalarMatrix({ int8: 0 }, xMin, xMax, yMin, yMax)],
      ["rotation", scalarMatrix({ int8: 0 }, xMin, xMax, yMin, yMax)],
      ["flags", scalarMatrix({ int8: 0 }, xMin, xMax, yMin, yMax)],
    ],
  };
}

describe("compareUuidSets", () => {
  it("returns a deterministic sorted UUID partition", () => {
    expect(compareUuidSets(
      world(["cccc", "aaaa", "bbbb", "aaaa"]),
      world(["dddd", "bbbb", "bbbb", "aaaa"]),
    )).toEqual({
      shared: ["aaaa", "bbbb"],
      referenceOnly: ["cccc"],
      targetOnly: ["dddd"],
    });
  });
});

describe.skipIf(!hasLocalDefaultSave)("loadReferenceExtractionInputs with private local save", () => {
  it("loads matching checked-in inputs without exposing source paths", async () => {
    const inputs = await loadReferenceExtractionInputs(checkedInOptions);

    expect(inputs.source).toMatchObject({
      width: 10_775,
      height: 8_480,
      bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 },
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(inputs.referenceWorld.bounds).toEqual({ minX: -72, minY: -56, maxX: 71, maxY: 55 });
    expect(inputs.referenceWorld.cells).toHaveLength(16_128);
    expect(inputs.defaultWorld.bounds).toEqual({ minX: -64, minY: -48, maxX: 63, maxY: 47 });
    expect(inputs.defaultWorld.cells).toHaveLength(12_288);
    expect(inputs.targetWorld.cells).toHaveLength(12_288);
    expect(inputs.targetSaveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inputs.uuidIntersection.referenceOnly).toEqual([]);
    expect(inputs.uuidIntersection.targetOnly).toEqual([]);
    expect(JSON.stringify(inputs)).not.toContain("F:\\");
  });

  it("rejects a mismatched expected source-image hash before returning inputs", async () => {
    await expect(loadReferenceExtractionInputs({
      ...checkedInOptions,
      expectedInputHashes: {
        ...CALIBRATED_REFERENCE_INPUT_HASHES,
        sourceImageSha256: "0".repeat(64),
      },
    })).rejects.toThrow("Reference source image failed its hash check.");
  });

  it("rejects a complete-bounds reference document with a missing outer coordinate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reference-inputs-"));
    fixtureDirectories.push(directory);
    const referenceWorldPath = join(directory, "reference-world.json");
    const text = await readFile(checkedInOptions.referenceWorldPath, "utf8");
    const document = JSON.parse(text) as { world: WorldMap };
    document.world.cells = document.world.cells.filter(({ x, y }) => x !== -72 || y !== -56);
    const altered = JSON.stringify(document);
    await writeFile(referenceWorldPath, altered);

    await expect(loadReferenceExtractionInputs({
      ...checkedInOptions,
      referenceWorldPath,
      expectedInputHashes: {
        ...CALIBRATED_REFERENCE_INPUT_HASHES,
        referenceWorldSha256: sha256(altered),
      },
    })).rejects.toThrow("Checked-in reference world does not contain the complete calibrated grid.");
  });

  it("rejects a parsed default world whose bounds differ from the derived playable bounds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reference-inputs-"));
    fixtureDirectories.push(directory);
    const defaultSavePath = join(directory, "altered-default.db");
    const uuid = "ff81a193-30e6-42d2-b597-78dfe47fdf2b";
    const bytes = await createSaveFixture({
      gameRows: [{ saveVersion: 28, seed: 9 }],
      scriptRows: [{ worldId: 1, data: scriptDataWrapper(terrainWithRawBounds(uuid, -72, 72)) }],
    });
    await writeFile(defaultSavePath, bytes);

    await expect(loadReferenceExtractionInputs({
      ...checkedInOptions,
      defaultSavePath,
      targetSavePath: defaultSavePath,
      expectedInputHashes: {
        ...CALIBRATED_REFERENCE_INPUT_HASHES,
        defaultSaveSha256: sha256(bytes),
      },
    })).rejects.toThrow("Parsed default-save bounds do not match the calibrated playable grid.");
  });

  it("fails closed when source dimensions do not match the calibrated reference", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reference-inputs-"));
    fixtureDirectories.push(directory);
    const sourceImagePath = join(directory, "wrong-size.webp");
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "black" } })
      .webp()
      .toFile(sourceImagePath);

    await expect(loadReferenceExtractionInputs({
      ...checkedInOptions,
      sourceImagePath,
      expectedInputHashes: {
        ...CALIBRATED_REFERENCE_INPUT_HASHES,
        sourceImageSha256: sha256(await readFile(sourceImagePath)),
      },
    }))
      .rejects.toThrow("Reference source image dimensions are unexpected.");
  });

  it("fails closed when checked-in reference bounds are not calibrated", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reference-inputs-"));
    fixtureDirectories.push(directory);
    const referenceWorldPath = join(directory, "reference-world.json");
    const document = JSON.parse(await readFile(checkedInOptions.referenceWorldPath, "utf8")) as {
      world: WorldMap;
    };
    document.world.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    await writeFile(referenceWorldPath, JSON.stringify(document));

    await expect(loadReferenceExtractionInputs({
      ...checkedInOptions,
      referenceWorldPath,
      expectedInputHashes: {
        ...CALIBRATED_REFERENCE_INPUT_HASHES,
        referenceWorldSha256: sha256(await readFile(referenceWorldPath)),
      },
    }))
      .rejects.toThrow("Reference world bounds are unexpected.");
  });
});
