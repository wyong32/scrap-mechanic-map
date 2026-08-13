import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldMap } from "../../src/domain/map-model.ts";
import { createSaveFixture } from "../../src/save/fixtures/create-save-fixture.ts";
import {
  scriptDataWrapper,
  type FixtureValue,
} from "../../src/save/fixtures/encoded-values.ts";
import {
  buildDefaultSurfaceCaptureInventory,
  selectCapabilityTarget,
} from "./default-surface-job.ts";
import type { DefaultSurfaceCaptureInventory } from "./default-surface-types.ts";
import { runAuthenticMapCli } from "./cli.ts";

const GAME_ROOT = "G:\\共享文件\\Scrap Mechanic";
const DEFAULT_PATHS = {
  savePath: "public/data/default-save.db",
  buildInfoPath: "public/data/generated/build-info.json",
  catalogPath: "public/data/generated/tile-catalog.json",
  officialManifestPath: "public/atlas/official/official-tile-atlas.json",
  gameRoot: GAME_ROOT,
};
const temporaryDirectories: string[] = [];
const temporaryFiles: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
  await Promise.all(temporaryFiles.splice(0).map((path) =>
    rm(path, { force: true })
  ));
  vi.restoreAllMocks();
});

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function withHash<T extends Record<string, unknown>>(payload: T): T & { contentHash: string } {
  const contentHash = createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
  return canonicalize({ ...payload, contentHash }) as T & { contentHash: string };
}

function documentText(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function uuidBytes(uuid: string): number[] {
  return [...Buffer.from(uuid.replaceAll("-", ""), "hex").reverse()];
}

function oneCellTerrain(uuid: string, seed: number): FixtureValue {
  const scalarMatrix = (value: FixtureValue): FixtureValue => ({
    array: [{ array: [value], offset: 0 }],
    offset: 0,
  });
  return {
    entries: [
      ["bounds", { entries: [
        ["xMin", { int8: 0 }], ["xMax", { int8: 0 }],
        ["yMin", { int8: 0 }], ["yMax", { int8: 0 }],
      ] }],
      ["seed", { int32: seed }],
      ["uid", scalarMatrix({ uuidBytes: uuidBytes(uuid) })],
      ["xOffset", scalarMatrix({ int8: 0 })],
      ["yOffset", scalarMatrix({ int8: 0 })],
      ["rotation", scalarMatrix({ int8: 2 })],
      ["flags", scalarMatrix({ int8: 0 })],
    ],
  };
}

async function makeFixture(options: {
  renderMode: "terrain" | "isometric-thumbnail";
  reviewedLegacyTile: boolean;
}): Promise<Parameters<typeof buildDefaultSurfaceCaptureInventory>[0]> {
  const root = await mkdtemp(join(tmpdir(), "default-surface-inventory-"));
  temporaryDirectories.push(root);
  const generated = join(root, "generated");
  const gameRoot = join(root, "game");
  const uuid = "11111111-2222-4333-8444-555555555555";
  const relativePath = "Survival/Test/fixture.tile";
  const seed = 12345;
  await mkdir(generated, { recursive: true });
  await mkdir(join(gameRoot, "Survival", "Test"), { recursive: true });
  await writeFile(join(gameRoot, "Survival", "Test", `${uuid}.png`), "fixture-preview");
  const savePath = join(root, "fixture.db");
  await writeFile(savePath, await createSaveFixture({
    gameRows: [{ saveVersion: 28, seed }],
    scriptRows: [{ worldId: 1, data: scriptDataWrapper(oneCellTerrain(uuid, seed)) }],
  }));

  const legacyId = 7000001;
  const legacyBridge = options.reviewedLegacyTile ? [{
    legacyId,
    uuid,
    tilePath: relativePath,
    status: "active",
    evidence: "Survival/Test/fixture.lua:AddTile",
  }] : [];
  const catalog = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: [relativePath],
    legacyBridge,
    pois: [],
    tiles: [{
      uuid,
      relativePath,
      width: 2,
      height: 3,
      sourceCategory: "poi",
      sourceHash: "0".repeat(64),
    }],
  });
  const legacyAssets = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: ["fixture"],
    assets: options.reviewedLegacyTile ? [{
      key: `tile:${legacyId}`,
      url: `/legacy/img/tiles/${legacyId}.jpg`,
      width: 16,
      height: 16,
      sha256: "1".repeat(64),
      source: "the1killer/sm_overview",
    }] : [],
  });
  const catalogText = documentText(catalog);
  const legacyAssetsText = documentText(legacyAssets);
  const catalogPath = join(generated, "tile-catalog.json");
  const legacyAssetsPath = join(generated, "legacy-assets.json");
  await writeFile(catalogPath, catalogText);
  await writeFile(legacyAssetsPath, legacyAssetsText);
  const buildInfo = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: ["fixture"],
    files: [
      { name: "legacy-assets.json", contentHash: legacyAssets.contentHash, bytes: Buffer.byteLength(legacyAssetsText) },
      { name: "tile-catalog.json", contentHash: catalog.contentHash, bytes: Buffer.byteLength(catalogText) },
    ],
  });
  const buildInfoPath = join(generated, "build-info.json");
  await writeFile(buildInfoPath, documentText(buildInfo));

  const officialManifest = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    spriteSize: 256,
    pages: {},
    entries: {
      [uuid]: {
        uuid,
        page: "fixture.webp",
        x: 0,
        y: 0,
        width: 256,
        height: 256,
        spanWidth: 2,
        spanHeight: 3,
        renderMode: options.renderMode,
      },
    },
  });
  const officialManifestPath = join(root, "official-tile-atlas.json");
  await writeFile(officialManifestPath, documentText(officialManifest));
  return { savePath, buildInfoPath, catalogPath, officialManifestPath, gameRoot };
}

describe("buildDefaultSurfaceCaptureInventory", () => {
  it("derives a deterministic public inventory from the checked-in default save", async () => {
    const { inventory, world } = await buildDefaultSurfaceCaptureInventory(DEFAULT_PATHS);
    const official = JSON.parse(
      await readFile(DEFAULT_PATHS.officialManifestPath, "utf8"),
    ) as { entries: Record<string, { renderMode: string }> };
    const catalog = JSON.parse(
      await readFile(DEFAULT_PATHS.catalogPath, "utf8"),
    ) as {
      legacyBridge: Array<{ legacyId: number; uuid: string }>;
    };
    const legacyAssets = JSON.parse(
      await readFile(join(dirname(DEFAULT_PATHS.buildInfoPath), "legacy-assets.json"), "utf8"),
    ) as { assets: Array<{ key: string }> };
    const worldUuids = new Set(world.cells.map((cell) => cell.uuid));
    const reviewedIds = new Set(legacyAssets.assets
      .filter(({ key }) => key.startsWith("tile:"))
      .map(({ key }) => Number(key.slice(5))));
    const reviewedUuids = new Set(catalog.legacyBridge
      .filter(({ legacyId }) => reviewedIds.has(legacyId))
      .map(({ uuid }) => uuid.toLowerCase()));

    expect(world.source).toBe("save");
    expect(world.seed).toBe(inventory.saveSeed);
    expect(inventory.pixelsPerCell).toBe(256);
    expect(inventory.targets.length).toBeGreaterThan(0);
    expect(inventory.targets).toEqual(
      [...inventory.targets].sort((a, b) => a.uuid.localeCompare(b.uuid)),
    );
    expect(inventory.targets.every((target) =>
      target.outputPixels.width === target.widthCells * 256
      && target.outputPixels.height === target.heightCells * 256
    )).toBe(true);
    for (const target of inventory.targets) {
      expect(official.entries[target.uuid]?.renderMode).toBe("isometric-thumbnail");
      expect(worldUuids.has(target.uuid)).toBe(true);
      expect(target.sourceTileRelativePath).toMatch(/^Survival\//);
      expect(target.sourceTileRelativePath).not.toMatch(/\\|\.\.|^[A-Za-z]:/);
      expect(reviewedUuids.has(target.uuid)).toBe(false);
    }
    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain("G:\\");
    expect(serialized).not.toContain("F:\\");
  });

  it.each([
    ["terrain-mode official previews", { renderMode: "terrain" as const, reviewedLegacyTile: false }],
    ["UUIDs with reviewed real legacy tiles", { renderMode: "isometric-thumbnail" as const, reviewedLegacyTile: true }],
  ])("filters %s", async (_label, options) => {
    const { inventory, world } = await buildDefaultSurfaceCaptureInventory(
      await makeFixture(options),
    );

    expect(world.cells).toHaveLength(1);
    expect(inventory.targets).toEqual([]);
  });

  it("reports an unavailable installed preview without leaking its path", async () => {
    const paths = await makeFixture({
      renderMode: "isometric-thumbnail",
      reviewedLegacyTile: false,
    });
    const previewPath = join(
      paths.gameRoot,
      "Survival",
      "Test",
      "11111111-2222-4333-8444-555555555555.png",
    );
    await rm(previewPath);

    let message = "";
    try {
      await buildDefaultSurfaceCaptureInventory(paths);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/official source preview.*unavailable/i);
    expect(message).not.toContain(paths.gameRoot);
    expect(message).not.toContain(previewPath);
    expect(message).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});

describe("selectCapabilityTarget", () => {
  it("chooses greatest cell area and lexicographically smallest UUID on a tie", () => {
    const target = (uuid: string, widthCells: number, heightCells: number) => ({
      uuid,
      sourceTileRelativePath: `Survival/Test/${uuid}.tile`,
      widthCells,
      heightCells,
      outputPixels: { width: widthCells * 256, height: heightCells * 256 },
      usedRotations: [0] as const,
      occurrences: 1,
      sourcePreviewSha256: "0".repeat(64),
    });
    const inventory = {
      schemaVersion: 1,
      gameVersion: "1.0.0",
      saveSha256: "1".repeat(64),
      saveSeed: 1,
      pixelsPerCell: 256,
      targets: [
        target("bbbbbbbb-0000-4000-8000-000000000000", 4, 4),
        target("cccccccc-0000-4000-8000-000000000000", 8, 1),
        target("aaaaaaaa-0000-4000-8000-000000000000", 2, 8),
      ],
      contentHash: "2".repeat(64),
    } satisfies DefaultSurfaceCaptureInventory;

    expect(selectCapabilityTarget(inventory).uuid).toBe(
      "aaaaaaaa-0000-4000-8000-000000000000",
    );
  });
});

describe("surface-inventory CLI", () => {
  it("writes canonical JSON and reports public capture statistics without the game root", async () => {
    const output = "public/data/generated/.default-surface-cli-test.json";
    temporaryFiles.push(output);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runAuthenticMapCli([
      "surface-inventory",
      "--game-root", GAME_ROOT,
      "--save", DEFAULT_PATHS.savePath,
      "--output", output,
    ]);

    const text = await readFile(output, "utf8");
    const inventory = JSON.parse(text) as DefaultSurfaceCaptureInventory;
    expect(text.endsWith("\n")).toBe(true);
    expect(inventory.targets.length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledOnce();
    const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      targets: number;
      totalCanonicalCells: number;
      largestTargetDimensions: string;
      output: string;
    };
    expect(report).toEqual({
      targets: inventory.targets.length,
      totalCanonicalCells: expect.any(Number),
      largestTargetDimensions: expect.stringMatching(/^\d+x\d+$/),
      output,
    });
    expect(report.totalCanonicalCells).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(GAME_ROOT);
    expect(JSON.stringify(report)).not.toContain("G:\\");
  });

  it("rejects an absolute output path before creating it", async () => {
    const root = await mkdtemp(join(tmpdir(), "default-surface-absolute-output-"));
    temporaryDirectories.push(root);
    const output = join(root, "inventory.json");

    await expect(runAuthenticMapCli([
      "surface-inventory",
      "--game-root", GAME_ROOT,
      "--save", DEFAULT_PATHS.savePath,
      "--output", output,
    ])).rejects.toThrow(/relative JSON path below public\/data\/generated/i);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal outside the generated public directory", async () => {
    const output = "public/data/generated/../.default-surface-traversal-test.json";
    const resolvedOutput = "public/data/.default-surface-traversal-test.json";
    temporaryFiles.push(resolvedOutput);

    await expect(runAuthenticMapCli([
      "surface-inventory",
      "--game-root", GAME_ROOT,
      "--save", DEFAULT_PATHS.savePath,
      "--output", output,
    ])).rejects.toThrow(/relative JSON path below public\/data\/generated/i);
    await expect(readFile(resolvedOutput)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an output below the supplied game root without creating it", async () => {
    const gameRoot = process.cwd();
    const output = "public/data/generated/.default-surface-game-root-output-test.json";
    temporaryFiles.push(output);

    await expect(runAuthenticMapCli([
      "surface-inventory",
      "--game-root", gameRoot,
      "--save", DEFAULT_PATHS.savePath,
      "--output", output,
    ])).rejects.toThrow(/relative JSON path below public\/data\/generated/i);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create an output file when the capture inventory is empty", async () => {
    const fixture = await makeFixture({
      renderMode: "terrain",
      reviewedLegacyTile: false,
    });
    const projectRoot = await mkdtemp(join(tmpdir(), "default-surface-empty-project-"));
    temporaryDirectories.push(projectRoot);
    const generated = join(projectRoot, "public", "data", "generated");
    const atlas = join(projectRoot, "public", "atlas", "official");
    const wasmDirectory = join(projectRoot, "node_modules", "sql.js", "dist");
    await Promise.all([
      mkdir(generated, { recursive: true }),
      mkdir(atlas, { recursive: true }),
      mkdir(wasmDirectory, { recursive: true }),
    ]);
    await Promise.all([
      copyFile(fixture.buildInfoPath, join(generated, "build-info.json")),
      copyFile(fixture.catalogPath, join(generated, "tile-catalog.json")),
      copyFile(
        join(dirname(fixture.buildInfoPath), "legacy-assets.json"),
        join(generated, "legacy-assets.json"),
      ),
      copyFile(
        fixture.officialManifestPath,
        join(atlas, "official-tile-atlas.json"),
      ),
      copyFile(
        resolve("node_modules/sql.js/dist/sql-wasm.wasm"),
        join(wasmDirectory, "sql-wasm.wasm"),
      ),
    ]);
    const output = "public/data/generated/empty-inventory.json";
    const absoluteOutput = join(projectRoot, output);
    const originalCwd = process.cwd();
    try {
      process.chdir(projectRoot);
      await expect(runAuthenticMapCli([
        "surface-inventory",
        "--game-root", fixture.gameRoot,
        "--save", fixture.savePath,
        "--output", output,
      ])).rejects.toThrow(/inventory is empty/i);
    } finally {
      process.chdir(originalCwd);
    }

    await expect(readFile(absoluteOutput)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
