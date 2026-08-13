import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGameData, computeBundleContentHash, supportedFixedWorldIds } from "./build-data.ts";
import type { GeneratedCatalog } from "./extract-catalog.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sm-map-build-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const catalog: GeneratedCatalog = {
  tiles: [{ uuid: "tile-a", relativePath: "Survival/Terrain/Tiles/tile-a.tile", width: 1, height: 1, sourceCategory: "other", sourceHash: "abc" }],
  pois: [{ poiType: "POI_TEST", tileUuid: "tile-a", relativePath: "Survival/Terrain/Tiles/tile-a.tile" }],
  legacyBridge: [{ legacyId: 1000001, uuid: "11111111-2222-4333-8444-555555555555", tilePath: "Survival/Terrain/Tiles/tile-a.tile", status: "active", evidence: "Survival/Scripts/terrain/overworld/type_meadow.lua:AddTile" }],
  worlds: supportedFixedWorldIds.map((id) => ({ id, nameKey: id, group: "fixture", relativePath: `Survival/Terrain/Worlds/${id}.world`, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, cells: [{ x: 0, y: 0, relativePath: "Survival/Terrain/Tiles/tile-a.tile", tileUuid: "tile-a", offsetX: 0, offsetY: 0, rotation: 0 }], emptyCells: [], connections: [] })),
};

async function fileBytes(directory: string, file: string): Promise<Buffer> {
  return readFile(join(directory, file));
}

function assertNoPrivateKeys(value: unknown): void {
  const forbidden = /steam|player|inventory|container|creation|save(path|file)?/i;
  if (Array.isArray(value)) return value.forEach(assertNoPrivateKeys);
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      expect(key).not.toMatch(forbidden);
      assertNoPrivateKeys(nested);
    }
  }
}

describe("buildGameData", () => {
  it("writes byte-stable, self-verifying and privacy-safe generated bundles", async () => {
    const gameRoot = await temporaryDirectory();
    const first = join(await temporaryDirectory(), "generated");
    const second = join(await temporaryDirectory(), "generated");

    await buildGameData({ gameRoot, outputDirectory: first, catalog });
    await buildGameData({ gameRoot, outputDirectory: second, catalog });

    const files = ["reference-world.json", "regions.json", "locations.json", "tile-catalog.json", "build-info.json", ...supportedFixedWorldIds.map((id) => `worlds/${id}.json`)];
    for (const file of files) {
      expect(await fileBytes(first, file)).toEqual(await fileBytes(second, file));
      const payload = JSON.parse(await fileBytes(first, file).then((bytes) => bytes.toString("utf8"))) as Record<string, unknown>;
      expect(payload.schemaVersion).toBe(1);
      expect(payload.gameVersion).toBe("1.0.0");
      expect(payload.generatedFrom).toBeInstanceOf(Array);
      expect(payload.contentHash).toBe(computeBundleContentHash(payload));
      assertNoPrivateKeys(payload);
    }

    const regions = JSON.parse((await fileBytes(first, "regions.json")).toString("utf8")) as { regions: Array<{ id: string }> };
    const locations = JSON.parse((await fileBytes(first, "locations.json")).toString("utf8")) as { locations: Array<{ regionId: string }> };
    const reference = JSON.parse(
      (await fileBytes(first, "reference-world.json")).toString("utf8")
    ) as {
      world: {
        bounds: { minX: number; minY: number; maxX: number; maxY: number };
        cells: unknown[];
      };
    };
    expect(reference.world.bounds).toEqual({
      minX: -72,
      minY: -56,
      maxX: 71,
      maxY: 55
    });
    expect(reference.world.cells).toEqual([]);
    const regionIds = new Set(regions.regions.map((region) => region.id));
    expect(locations.locations.every((location) => regionIds.has(location.regionId))).toBe(true);
    expect(Object.hasOwn(regions, "fixedWorlds")).toBe(false);
    const tileCatalog = JSON.parse((await fileBytes(first, "tile-catalog.json")).toString("utf8")) as { legacyBridge?: unknown[] };
    expect(tileCatalog.legacyBridge).toEqual(catalog.legacyBridge);
    await expect(readFile(join(first, "legacy-assets.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("refuses an output path inside the read-only game root", async () => {
    const gameRoot = await temporaryDirectory();
    await expect(buildGameData({ gameRoot, outputDirectory: join(gameRoot, "generated"), catalog })).rejects.toThrow("outside the game root");
  });
  it("records the local game-data source as reference-world provenance", async () => {
    const gameRoot = await temporaryDirectory();
    const outputDirectory = join(await temporaryDirectory(), "generated");

    await buildGameData({ gameRoot, outputDirectory, catalog });

    const reference = JSON.parse(
      (await fileBytes(outputDirectory, "reference-world.json")).toString("utf8")
    ) as { generatedFrom: string[] };
    expect(reference.generatedFrom).toEqual(["html/tools/game-data/source/reference-world.json"]);
  }, 30_000);

  it("adds official POI types to reviewed reference cells by tile UUID", async () => {
    const gameRoot = await temporaryDirectory();
    const outputDirectory = join(await temporaryDirectory(), "generated");
    const referenceWorld = {
      id: "reference-surface",
      source: "reference" as const,
      gameVersion: "1.0.0",
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      cells: [{
        x: 0,
        y: 0,
        uuid: "TILE-A",
        rotation: 0 as const,
        xOffset: 0,
        yOffset: 0,
        flags: 0,
        terrainType: "poi"
      }],
      locations: [],
      connections: []
    };

    await buildGameData({
      gameRoot,
      outputDirectory,
      catalog,
      referenceWorld
    });

    const reference = JSON.parse(
      (await fileBytes(outputDirectory, "reference-world.json")).toString("utf8")
    ) as { world: { cells: Array<{ poiType?: string }> } };
    expect(reference.world.cells[0]?.poiType).toBe("POI_TEST");
  }, 30_000);
});
