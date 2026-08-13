import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import initSqlJs from "sql.js";
import type { WorldMap } from "../../src/domain/map-model.ts";
import { decodeSurfaceCandidates } from "../../src/save/script-data-decoder.ts";
import {
  readSaveRecordsWithSql,
  type SqlDatabaseConstructor,
} from "../../src/save/sqlite-records.ts";
import { normalizeTerrain } from "../../src/terrain/normalize-terrain.ts";
import { parseTileCatalogDocuments } from "../../src/terrain/tile-catalog.ts";
import type {
  DefaultSurfaceCaptureInventory,
  DefaultSurfaceCaptureTarget,
} from "./default-surface-types.ts";

interface CatalogTile {
  uuid: string;
  relativePath: string;
  width: number;
  height: number;
}

interface CatalogDocument {
  gameVersion: string;
  tiles: CatalogTile[];
}

interface BuildDocument {
  gameVersion: string;
  files: Array<{ name: string; contentHash: string; bytes: number }>;
}

interface LegacyAssetsDocument {
  schemaVersion: number;
  gameVersion: string;
  contentHash: string;
  assets: Array<{ key: string }>;
}

interface OfficialManifestDocument {
  schemaVersion: number;
  gameVersion: string;
  contentHash: string;
  entries: Record<string, {
    uuid: string;
    spanWidth: number;
    spanHeight: number;
    renderMode: "terrain" | "isometric-thumbnail";
  }>;
}

const PIXELS_PER_CELL = 256 as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function contentHash(value: Record<string, unknown>): string {
  const { contentHash: _contentHash, ...payload } = value;
  return digest(JSON.stringify(canonicalize(payload)));
}

function parseDocument<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} is invalid JSON.`);
  }
}

function assertSelfHash(
  value: { schemaVersion: number; contentHash: string } & Record<string, unknown>,
  label: string,
): void {
  if (value.schemaVersion !== 1 || value.contentHash !== contentHash(value)) {
    throw new Error(`${label} failed its integrity check.`);
  }
}

function assertSafeTile(tile: CatalogTile): void {
  if (
    typeof tile.uuid !== "string"
    || !UUID_PATTERN.test(tile.uuid.toLowerCase())
    || typeof tile.relativePath !== "string"
    || !tile.relativePath.startsWith("Survival/")
    || tile.relativePath.includes("\\")
    || tile.relativePath.includes("..")
    || /^[A-Za-z]:/.test(tile.relativePath)
    || !Number.isSafeInteger(tile.width)
    || !Number.isSafeInteger(tile.height)
    || tile.width <= 0
    || tile.height <= 0
  ) {
    throw new Error("Default surface catalog contains an unsafe capture tile.");
  }
}

function resolvePreviewPath(gameRoot: string, tile: CatalogTile): string {
  const root = resolve(gameRoot);
  const preview = resolve(root, dirname(tile.relativePath), `${tile.uuid.toLowerCase()}.png`);
  const belowRoot = relative(root, preview);
  if (belowRoot.startsWith("..") || /^[A-Za-z]:/.test(belowRoot)) {
    throw new Error("Default surface preview path leaves the game root.");
  }
  return preview;
}

async function loadReviewedLegacyIds(
  buildInfoPath: string,
  buildText: string,
): Promise<Set<number>> {
  const build = parseDocument<BuildDocument>(buildText, "Build info");
  const legacyAssetsPath = resolve(dirname(buildInfoPath), "legacy-assets.json");
  const legacyText = await readFile(legacyAssetsPath, "utf8");
  const legacy = parseDocument<LegacyAssetsDocument & Record<string, unknown>>(
    legacyText,
    "Legacy asset manifest",
  );
  assertSelfHash(legacy, "Legacy asset manifest");
  const listed = build.files?.find(({ name }) => name === "legacy-assets.json");
  if (
    !listed
    || listed.contentHash !== legacy.contentHash
    || listed.bytes !== Buffer.byteLength(legacyText.replace(/\r\n/g, "\n"))
    || legacy.gameVersion !== build.gameVersion
    || !Array.isArray(legacy.assets)
  ) {
    throw new Error("Legacy asset manifest does not match build-info.");
  }
  return new Set(legacy.assets.flatMap(({ key }) => {
    if (typeof key !== "string" || !/^tile:\d+$/.test(key)) return [];
    const id = Number(key.slice(5));
    return Number.isSafeInteger(id) ? [id] : [];
  }));
}

export async function buildDefaultSurfaceCaptureInventory(options: {
  savePath: string;
  buildInfoPath: string;
  catalogPath: string;
  officialManifestPath: string;
  gameRoot: string;
}): Promise<{
  inventory: DefaultSurfaceCaptureInventory;
  world: WorldMap;
}> {
  const [saveBytes, buildText, catalogText, officialText] = await Promise.all([
    readFile(options.savePath),
    readFile(options.buildInfoPath, "utf8"),
    readFile(options.catalogPath, "utf8"),
    readFile(options.officialManifestPath, "utf8"),
  ]);
  const SQL = await initSqlJs({
    locateFile: () => resolve("node_modules/sql.js/dist/sql-wasm.wasm"),
  });
  const records = readSaveRecordsWithSql(
    SQL.Database as SqlDatabaseConstructor,
    saveBytes,
  );
  const decoded = decodeSurfaceCandidates(records.surfaceCandidates);
  const catalog = await parseTileCatalogDocuments(buildText, catalogText);
  const world = normalizeTerrain(decoded, {
    fileName: "default-save.db",
    saveVersion: 28,
    seed: records.seed,
  }, catalog);

  const rawCatalog = parseDocument<CatalogDocument>(catalogText, "Tile catalog");
  const official = parseDocument<OfficialManifestDocument & Record<string, unknown>>(
    officialText,
    "Official tile atlas manifest",
  );
  assertSelfHash(official, "Official tile atlas manifest");
  if (
    rawCatalog.gameVersion !== "1.0.0"
    || official.gameVersion !== rawCatalog.gameVersion
    || !Array.isArray(rawCatalog.tiles)
    || !official.entries
  ) {
    throw new Error("Default surface inputs do not describe the reviewed 1.0 build.");
  }
  const reviewedLegacyIds = await loadReviewedLegacyIds(
    options.buildInfoPath,
    buildText,
  );
  const reviewedLegacyUuids = new Set(
    catalog.legacyBridge
      .filter(({ legacyId }) => reviewedLegacyIds.has(legacyId))
      .map(({ uuid }) => uuid.toLowerCase()),
  );
  const catalogByUuid = new Map<string, CatalogTile>();
  for (const tile of rawCatalog.tiles) {
    const uuid = tile.uuid?.toLowerCase();
    if (uuid && !catalogByUuid.has(uuid)) catalogByUuid.set(uuid, tile);
  }
  const grouped = new Map<string, {
    occurrences: number;
    rotations: Set<0 | 1 | 2 | 3>;
  }>();
  for (const cell of world.cells) {
    const group = grouped.get(cell.uuid) ?? { occurrences: 0, rotations: new Set() };
    group.occurrences += 1;
    group.rotations.add(cell.rotation);
    grouped.set(cell.uuid, group);
  }

  const targets: DefaultSurfaceCaptureTarget[] = [];
  for (const [uuid, group] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const tile = catalogByUuid.get(uuid);
    const atlasEntry = official.entries[uuid];
    if (!tile || atlasEntry?.renderMode !== "isometric-thumbnail" || reviewedLegacyUuids.has(uuid)) {
      continue;
    }
    assertSafeTile(tile);
    if (
      atlasEntry.uuid.toLowerCase() !== uuid
      || atlasEntry.spanWidth !== tile.width
      || atlasEntry.spanHeight !== tile.height
    ) {
      throw new Error("Official tile atlas does not match the capture catalog.");
    }
    let previewBytes: Buffer;
    try {
      previewBytes = await readFile(resolvePreviewPath(options.gameRoot, tile));
    } catch (error) {
      throw new Error("Official source preview is unavailable.", { cause: error });
    }
    targets.push({
      uuid,
      sourceTileRelativePath: tile.relativePath,
      widthCells: tile.width,
      heightCells: tile.height,
      outputPixels: {
        width: tile.width * PIXELS_PER_CELL,
        height: tile.height * PIXELS_PER_CELL,
      },
      usedRotations: [...group.rotations].sort((left, right) => left - right),
      occurrences: group.occurrences,
      sourcePreviewSha256: digest(previewBytes),
    });
  }
  const payload = {
    schemaVersion: 1,
    gameVersion: "1.0.0",
    saveSha256: digest(saveBytes),
    saveSeed: records.seed,
    pixelsPerCell: PIXELS_PER_CELL,
    targets,
  } as const;
  return {
    inventory: {
      ...payload,
      contentHash: digest(JSON.stringify(canonicalize(payload))),
    },
    world,
  };
}

export function selectCapabilityTarget(
  inventory: DefaultSurfaceCaptureInventory,
): DefaultSurfaceCaptureTarget {
  const selected = [...inventory.targets].sort((left, right) =>
    right.widthCells * right.heightCells - left.widthCells * left.heightCells
    || left.uuid.localeCompare(right.uuid)
  )[0];
  if (!selected) throw new Error("Default surface capture inventory is empty.");
  return selected;
}
