import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import sharp from "sharp";
import type { TerrainCell, WorldMap } from "../../src/domain/map-model.ts";
import { decodeSurfaceCandidates } from "../../src/save/script-data-decoder.ts";
import {
  readSaveRecordsWithSql,
  type SqlDatabaseConstructor,
} from "../../src/save/sqlite-records.ts";
import { normalizeTerrain } from "../../src/terrain/normalize-terrain.ts";
import { parseTileCatalogDocuments } from "../../src/terrain/tile-catalog.ts";
import type {
  ReferenceExtractionInputHashes,
  ReferenceExtractionInputOptions,
  ReferenceExtractionInputs,
  UuidIntersectionReport,
} from "./reference-extraction-types.ts";

export const CALIBRATED_REFERENCE_SOURCE = { width: 10_775, height: 8_480 } as const;
export const CALIBRATED_REFERENCE_BOUNDS = { minX: -72, minY: -56, maxX: 71, maxY: 55 } as const;
const PLAYABLE_INSET = 8;
export const CALIBRATED_PLAYABLE_BOUNDS = {
  minX: CALIBRATED_REFERENCE_BOUNDS.minX + PLAYABLE_INSET,
  minY: CALIBRATED_REFERENCE_BOUNDS.minY + PLAYABLE_INSET,
  maxX: CALIBRATED_REFERENCE_BOUNDS.maxX - PLAYABLE_INSET,
  maxY: CALIBRATED_REFERENCE_BOUNDS.maxY - PLAYABLE_INSET,
} as const;

export const CALIBRATED_REFERENCE_INPUT_HASHES: Readonly<ReferenceExtractionInputHashes> = {
  sourceImageSha256: "af20ef7b483d37d020e57091a68e115fb7f756fc525aa9628b7c99347b8ece74",
  referenceWorldSha256: "9524b4bddaeb3390e27916dde0d820b037cbdb8c8c89bcd790a2a30bd6430e27",
  buildInfoSha256: "425ee9051125d2e15e5a8df44a11424158837f2a24bb33668bccae59eb8c28a1",
  catalogSha256: "0ea22541a6626da3f0fa581f388f357f88febcac5cb60a8173100f1c7ab46383",
  defaultSaveSha256: "e6f85a908f529fb373ec6a64f85113da024a99edbd3b8eef7d87d938f6d76278",
};

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertExpectedHash(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(`${label} failed its hash check.`);
}

function sameBounds(left: WorldMap["bounds"], right: WorldMap["bounds"]): boolean {
  return left.minX === right.minX && left.minY === right.minY
    && left.maxX === right.maxX && left.maxY === right.maxY;
}

function cellKey(cell: TerrainCell): string {
  return `${cell.x},${cell.y}`;
}

function sameTerrainCell(left: TerrainCell | undefined, right: TerrainCell): boolean {
  return left !== undefined && left.x === right.x && left.y === right.y && left.uuid === right.uuid
    && left.rotation === right.rotation && left.xOffset === right.xOffset
    && left.yOffset === right.yOffset;
}

function assertReferenceMatchesDefault(reference: WorldMap, parsed: WorldMap): void {
  if (!sameBounds(parsed.bounds, CALIBRATED_PLAYABLE_BOUNDS)) {
    throw new Error("Parsed default-save bounds do not match the calibrated playable grid.");
  }
  const referenceByCoordinate = new Map(reference.cells.map((cell) => [cellKey(cell), cell]));
  if (parsed.cells.some((cell) => !sameTerrainCell(referenceByCoordinate.get(cellKey(cell)), cell))) {
    throw new Error("Checked-in reference world does not match the default save.");
  }
}

function assertCompleteReferenceGrid(world: WorldMap): void {
  const width = CALIBRATED_REFERENCE_BOUNDS.maxX - CALIBRATED_REFERENCE_BOUNDS.minX + 1;
  const height = CALIBRATED_REFERENCE_BOUNDS.maxY - CALIBRATED_REFERENCE_BOUNDS.minY + 1;
  const coordinates = new Set(world.cells.map(cellKey));
  if (world.cells.length !== width * height || coordinates.size !== world.cells.length || world.cells.some((cell) => (
    cell.x < CALIBRATED_REFERENCE_BOUNDS.minX || cell.x > CALIBRATED_REFERENCE_BOUNDS.maxX
    || cell.y < CALIBRATED_REFERENCE_BOUNDS.minY || cell.y > CALIBRATED_REFERENCE_BOUNDS.maxY
  ))) {
    throw new Error("Checked-in reference world does not contain the complete calibrated grid.");
  }
}

function parseReferenceWorld(text: string): WorldMap {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("Checked-in reference world is unavailable or invalid JSON.");
  }
  const world = (document as { world?: unknown }).world;
  if (!world || typeof world !== "object") {
    throw new Error("Checked-in reference world is unavailable or invalid JSON.");
  }
  return world as WorldMap;
}

async function readWorld(
  bytes: Uint8Array,
  catalog: Awaited<ReturnType<typeof parseTileCatalogDocuments>>,
): Promise<WorldMap> {
  const SQL = await initSqlJs({
    locateFile: () => resolve("node_modules/sql.js/dist/sql-wasm.wasm"),
  });
  const records = readSaveRecordsWithSql(SQL.Database as SqlDatabaseConstructor, bytes);
  return normalizeTerrain(decodeSurfaceCandidates(records.surfaceCandidates), {
    fileName: "local-save.db",
    saveVersion: 28,
    seed: records.seed,
  }, catalog);
}

export function compareUuidSets(reference: WorldMap, target: WorldMap): UuidIntersectionReport {
  const referenceUuids = new Set(reference.cells.map(({ uuid }) => uuid));
  const targetUuids = new Set(target.cells.map(({ uuid }) => uuid));
  const sorted = (values: Iterable<string>) => [...values].sort((left, right) => left.localeCompare(right));
  return {
    shared: sorted([...referenceUuids].filter((uuid) => targetUuids.has(uuid))),
    referenceOnly: sorted([...referenceUuids].filter((uuid) => !targetUuids.has(uuid))),
    targetOnly: sorted([...targetUuids].filter((uuid) => !referenceUuids.has(uuid))),
  };
}

export async function loadReferenceExtractionInputs(
  options: ReferenceExtractionInputOptions,
): Promise<ReferenceExtractionInputs> {
  const [sourceBytes, referenceBytes, buildBytes, catalogBytes, defaultSaveBytes, targetSaveBytes] = await Promise.all([
    readFile(options.sourceImagePath),
    readFile(options.referenceWorldPath),
    readFile(options.buildInfoPath),
    readFile(options.catalogPath),
    readFile(options.defaultSavePath),
    options.targetSavePath === options.defaultSavePath
      ? Promise.resolve<Buffer | undefined>(undefined)
      : readFile(options.targetSavePath),
  ]);
  const expectedHashes = options.expectedInputHashes ?? CALIBRATED_REFERENCE_INPUT_HASHES;
  assertExpectedHash(sha256(sourceBytes), expectedHashes.sourceImageSha256, "Reference source image");
  assertExpectedHash(sha256(referenceBytes), expectedHashes.referenceWorldSha256, "Reference world");
  assertExpectedHash(sha256(buildBytes), expectedHashes.buildInfoSha256, "Build info");
  assertExpectedHash(sha256(catalogBytes), expectedHashes.catalogSha256, "Tile catalog");
  assertExpectedHash(sha256(defaultSaveBytes), expectedHashes.defaultSaveSha256, "Default save");
  const referenceText = referenceBytes.toString("utf8");
  const buildText = buildBytes.toString("utf8");
  const catalogText = catalogBytes.toString("utf8");
  const sourceMetadata = await sharp(sourceBytes).metadata();
  if (sourceMetadata.width !== CALIBRATED_REFERENCE_SOURCE.width
    || sourceMetadata.height !== CALIBRATED_REFERENCE_SOURCE.height) {
    throw new Error("Reference source image dimensions are unexpected.");
  }
  const referenceWorld = parseReferenceWorld(referenceText);
  if (!sameBounds(referenceWorld.bounds, CALIBRATED_REFERENCE_BOUNDS)) {
    throw new Error("Reference world bounds are unexpected.");
  }
  assertCompleteReferenceGrid(referenceWorld);
  const catalog = await parseTileCatalogDocuments(buildText, catalogText);
  const defaultWorld = await readWorld(defaultSaveBytes, catalog);
  assertReferenceMatchesDefault(referenceWorld, defaultWorld);
  const targetWorld = options.targetSavePath === options.defaultSavePath
    ? defaultWorld
    : await readWorld(targetSaveBytes!, catalog);
  return {
    source: {
      sha256: sha256(sourceBytes),
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      bounds: CALIBRATED_REFERENCE_BOUNDS,
    },
    referenceWorld,
    defaultWorld,
    targetWorld,
    targetSaveSha256: sha256(targetSaveBytes ?? defaultSaveBytes),
    catalog,
    uuidIntersection: compareUuidSets(defaultWorld, targetWorld),
  };
}
