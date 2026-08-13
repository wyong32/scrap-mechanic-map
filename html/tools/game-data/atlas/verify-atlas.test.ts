import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { AtlasManifest } from "./atlas-manifest.ts";
import {
  buildCoverageReport,
  loadGeneratedWorlds,
  verifyAtlasFiles,
  type VerifiedAtlasManifest
} from "./verify-atlas.ts";
import { buildAtlas } from "./pack-atlas.ts";
import { atlasKey } from "./atlas-manifest.ts";
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { WorldMap } from "../../../src/domain/map-model.ts";
import type { LegacyAssetRecord } from "../legacy/legacy-assets.ts";
import type { LegacyBridgeEntry } from "../legacy/legacy-bridge.ts";

const invalid = (): AtlasManifest => ({ schemaVersion: 1, gameVersion: "1.0.0", generatedFrom: [], contentHash: "invalid", pageSize: 4096, pages: {}, entries: {} });
function rehash(manifest: AtlasManifest): void {
  const { contentHash: _contentHash, ...unsigned } = manifest;
  manifest.contentHash = createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");
}
it("rejects fake manifests with invalid self hashes or no pages", async () => { const root = await mkdtemp(join(tmpdir(), "sm-verify-")); await expect(verifyAtlasFiles(root, invalid())).rejects.toThrow("contentHash"); });
it("rejects incompatible schema and game version before coverage can pass", async () => { const root = await mkdtemp(join(tmpdir(), "sm-verify-")); const manifest = invalid(); manifest.contentHash = ""; manifest.schemaVersion = 2 as 1; await expect(verifyAtlasFiles(root, manifest)).rejects.toThrow("metadata"); });
it("rejects key/path mismatch and traversal even with a recomputed self hash", async () => { const root = await mkdtemp(join(tmpdir(), "sm-verify-")); const png = join(root, "x.png"); await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toFile(png); const manifest = await buildAtlas([{ key: atlasKey("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", 0, 0, 0), imagePath: png, logicalSize: 256, sourceHash: "x" }], root); const page = Object.keys(manifest.pages)[0]; manifest.pages[page].path = "../escape.webp"; const { contentHash: _, ...unsigned } = manifest; manifest.contentHash = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"); await expect(verifyAtlasFiles(root, manifest)).rejects.toThrow("Unsafe atlas page path"); });

it("reports aggregate legacy and 1.0 UUID coverage without exposing UUID values", () => {
  const uuid = (index: number) =>
    `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  const worlds: WorldMap[] = [{
    id: "fixture",
    source: "fixed-region",
    gameVersion: "1.0.0",
    bounds: { minX: 0, minY: 0, maxX: 739, maxY: 0 },
    cells: Array.from({ length: 740 }, (_, index) => ({
      x: index,
      y: 0,
      uuid: uuid(index),
      rotation: 0,
      xOffset: 0,
      yOffset: 0,
      flags: 0,
      terrainType: "fixture"
    })),
    locations: [],
    connections: []
  }];
  const legacyBridge: LegacyBridgeEntry[] = Array.from(
    { length: 406 },
    (_, index) => ({
      legacyId: 1_000_000 + index,
      uuid: uuid(index),
      tilePath: `Survival/Terrain/Tiles/fixture-${index}.tile`,
      status: "active",
      evidence: "fixture.lua:AddTile"
    })
  );
  const legacyAssets: LegacyAssetRecord[] = Array.from(
    { length: 298 },
    (_, index) => ({
      key: `tile:${1_000_000 + index}`,
      url: `/legacy/img/tiles/${1_000_000 + index}.jpg`,
      width: 256,
      height: 256,
      sha256: "a".repeat(64),
      source: "the1killer/sm_overview"
    })
  );
  const report = buildCoverageReport({
    worlds,
    legacyBridge,
    legacyAssets
  });

  expect(report).toEqual({
    legacyAssetIds: 298,
    officialLegacyMappings: 406,
    legacyCoveredUuids: 298,
    oneDotZeroRenderedUuids: 0,
    fallbackUuids: 442
  });
  expect(JSON.stringify(report)).not.toContain(uuid(739));
});

it("does not certify a POI-only UUID when its observed rectangle falls back", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
  const world: WorldMap = {
    id: "incomplete-poi",
    source: "fixed-region",
    gameVersion: "1.0.0",
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    cells: [{
      x: 0,
      y: 0,
      uuid,
      xOffset: 0,
      yOffset: 0,
      rotation: 0,
      flags: 0,
      terrainType: "chemical",
      poiType: "POI_CHEMLAKE_MEDIUM"
    }],
    locations: [],
    connections: []
  };
  const report = buildCoverageReport({
    worlds: [world],
    legacyBridge: [{
      legacyId: 12103,
      uuid,
      tilePath: "Survival/Terrain/Tiles/incomplete-poi.tile",
      status: "active",
      evidence: "fixture.lua:AddTile"
    }],
    legacyAssets: [{
      key: "poi:chemlake_medium_3.jpg",
      url: "/legacy/img/poi/chemlake_medium_3.jpg",
      width: 512,
      height: 512,
      sha256: "a".repeat(64),
      source: "the1killer/sm_overview"
    }]
  });

  expect(report).toMatchObject({
    legacyCoveredUuids: 0,
    oneDotZeroRenderedUuids: 0,
    fallbackUuids: 1
  });
});

it("certifies a POI-only UUID only when every observed rectangle resolves", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
  const cells = Array.from({ length: 4 }, (_, index) => ({
    x: index % 2,
    y: Math.floor(index / 2),
    uuid,
    xOffset: 0,
    yOffset: 0,
    rotation: 0 as const,
    flags: 0,
    terrainType: "chemical",
    poiType: "POI_CHEMLAKE_MEDIUM"
  }));
  const complete: WorldMap = {
    id: "complete-poi",
    source: "fixed-region",
    gameVersion: "1.0.0",
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    cells,
    locations: [],
    connections: []
  };
  const incomplete: WorldMap = {
    ...complete,
    id: "incomplete-repeat",
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    cells: [cells[0]!]
  };
  const legacyBridge: LegacyBridgeEntry[] = [{
    legacyId: 12103,
    uuid,
    tilePath: "Survival/Terrain/Tiles/poi.tile",
    status: "active",
    evidence: "fixture.lua:AddTile"
  }];
  const legacyAssets: LegacyAssetRecord[] = [{
    key: "poi:chemlake_medium_3.jpg",
    url: "/legacy/img/poi/chemlake_medium_3.jpg",
    width: 512,
    height: 512,
    sha256: "a".repeat(64),
    source: "the1killer/sm_overview"
  }];

  expect(buildCoverageReport({
    worlds: [complete],
    legacyBridge,
    legacyAssets
  })).toMatchObject({
    legacyCoveredUuids: 1,
    fallbackUuids: 0
  });
  expect(buildCoverageReport({
    worlds: [complete, incomplete],
    legacyBridge,
    legacyAssets
  })).toMatchObject({
    legacyCoveredUuids: 0,
    fallbackUuids: 1
  });
});

const atlasEntry = {
  page: "terrain-0.webp",
  lowPage: "terrain-0-low.webp",
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  lowX: 0,
  lowY: 0,
  lowWidth: 1,
  lowHeight: 1,
  logicalSize: 2,
  sourceHash: "fixture"
};

function oneCellWorld(
  uuid: string,
  xOffset: number,
  yOffset: number,
  rotation: 0 | 1 | 2 | 3
): WorldMap {
  return {
    id: "key-contract",
    source: "fixed-region",
    gameVersion: "1.0.0",
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    cells: [{
      x: 0,
      y: 0,
      uuid,
      xOffset,
      yOffset,
      rotation,
      flags: 0,
      terrainType: "fixture"
    }],
    locations: [],
    connections: []
  };
}

function coverageForAtlasKey(
  world: WorldMap,
  key: ReturnType<typeof atlasKey>
) {
  return buildCoverageReport({
    worlds: [world],
    legacyBridge: [],
    legacyAssets: [],
    atlasManifest: {
      schemaVersion: 1,
      gameVersion: "1.0.0",
      generatedFrom: [],
      contentHash: "verified-by-caller",
      pageSize: 4096,
      pages: {},
      entries: { [key]: atlasEntry }
    } as unknown as VerifiedAtlasManifest
  });
}

it("does not count the same UUID with the wrong offset or rotation as a 1.0 render", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const world = oneCellWorld(uuid, 11, 22, 3);

  expect(coverageForAtlasKey(world, atlasKey(uuid, 10, 22, 3))).toMatchObject({
    oneDotZeroRenderedUuids: 0,
    fallbackUuids: 1
  });
  expect(coverageForAtlasKey(world, atlasKey(uuid, 11, 22, 2))).toMatchObject({
    oneDotZeroRenderedUuids: 0,
    fallbackUuids: 1
  });
});

it("counts a 1.0 render only when its canonical key matches the real cell", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const world = oneCellWorld(uuid, 11, 22, 3);

  expect(coverageForAtlasKey(world, atlasKey(uuid, 11, 22, 3))).toMatchObject({
    oneDotZeroRenderedUuids: 1,
    fallbackUuids: 0
  });
});

it("does not certify a UUID until every canonical offset and rotation variant is covered", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const first = oneCellWorld(uuid, 0, 0, 0);
  const second = {
    ...oneCellWorld(uuid, 1, 0, 3).cells[0]!,
    x: 1
  };
  const world = {
    ...first,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
    cells: [first.cells[0]!, second]
  };

  expect(
    coverageForAtlasKey(world, atlasKey(uuid, 0, 0, 0))
  ).toMatchObject({
    oneDotZeroRenderedUuids: 0,
    fallbackUuids: 1
  });
});

it.each(["non-square", "low-origin", "page-size"] as const)(
  "rejects a self-hashed atlas with invalid %s geometry",
  async (mutation) => {
    const root = await mkdtemp(join(tmpdir(), "sm-atlas-geometry-"));
    const png = join(root, "source.png");
    await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: "red"
      }
    }).png().toFile(png);
    const manifest = await buildAtlas([{
      key: atlasKey("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", 0, 0, 0),
      imagePath: png,
      logicalSize: 2,
      sourceHash: "fixture"
    }], root);
    const entry = Object.values(manifest.entries)[0]!;
    if (mutation === "non-square") {
      entry.height = 4;
      entry.lowHeight = 2;
    } else if (mutation === "low-origin") {
      entry.lowX = 1;
      entry.lowY = 1;
    } else {
      manifest.pageSize = 8192;
    }
    rehash(manifest);

    await expect(verifyAtlasFiles(root, manifest)).rejects.toThrow(
      /geometry|page/i
    );
  }
);

function canonicalizeGenerated(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeGenerated);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalizeGenerated((value as Record<string, unknown>)[key])
        ])
    );
  }
  return value;
}

function generated<T extends Record<string, unknown>>(payload: T) {
  const result = { ...payload, contentHash: "" };
  const { contentHash: _contentHash, ...unsigned } = result;
  result.contentHash = createHash("sha256")
    .update(JSON.stringify(canonicalizeGenerated(unsigned)))
    .digest("hex");
  return result;
}

function generatedWorldDocument() {
  return generated({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: ["fixture"],
    world: oneCellWorld(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      0,
      0,
      0
    )
  });
}

async function writeBuildInfo(
  output: string,
  files: Array<{ name: string; contentHash: string; bytes: number }>
) {
  const build = generated({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: ["fixture"],
    files
  });
  await writeFile(
    join(output, "build-info.json"),
    `${JSON.stringify(build)}\n`,
    "utf8"
  );
}

it("rejects a generated-world inventory path that traverses outside worlds/", async () => {
  const root = await mkdtemp(join(tmpdir(), "sm-world-path-"));
  const output = join(root, "generated");
  await mkdir(output);
  const document = generatedWorldDocument();
  const text = `${JSON.stringify(document)}\n`;
  await writeFile(join(root, "private.json"), text, "utf8");
  await writeBuildInfo(output, [{
    name: "worlds/../../private.json",
    contentHash: document.contentHash,
    bytes: Buffer.byteLength(text)
  }]);

  await expect(loadGeneratedWorlds(output)).rejects.toThrow(/unsafe|path/i);
});

it.each(["self-hash", "cross-hash", "bytes"] as const)(
  "rejects a generated world with an invalid %s contract",
  async (failure) => {
    const output = await mkdtemp(join(tmpdir(), "sm-world-contract-"));
    await mkdir(join(output, "worlds"));
    const document = generatedWorldDocument();
    if (failure === "self-hash") {
      document.contentHash = "0".repeat(64);
    }
    const text = `${JSON.stringify(document)}\n`;
    await writeFile(join(output, "worlds", "fixture.json"), text, "utf8");
    await writeBuildInfo(output, [{
      name: "worlds/fixture.json",
      contentHash: failure === "cross-hash"
        ? "f".repeat(64)
        : document.contentHash,
      bytes: Buffer.byteLength(text) + (failure === "bytes" ? 1 : 0)
    }]);

    await expect(loadGeneratedWorlds(output)).rejects.toThrow(
      /integrity|build-info|byte|match/i
    );
  }
);
