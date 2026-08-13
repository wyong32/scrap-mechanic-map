import type { TerrainCell, WorldMap } from "../domain/map-model";
import { SaveParseError } from "../save/save-errors";
import type {
  LuaValue,
  NormalizedTerrainTransfer,
  SaveMetadata
} from "../save/save-protocol";

const RAW_OVERWORLD_WIDTH = 144;
const RAW_OVERWORLD_HEIGHT = 112;
const GRAPHICS_CELL_PADDING = 8;
const SAFE_COORDINATE = 1_000_000;
const MATERIALIZATION_ROWS_PER_YIELD = 8;
const MATERIALIZATION_CELLS_PER_YIELD = 4_096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TileCatalog {
  gameVersion: string;
  tiles: Record<string, { terrainType: string; poiType?: string }>;
}

function terrainError(message: string): never {
  throw new SaveParseError("DECODE_FAILED", {
    stage: "normalizing",
    message
  });
}

function table(value: LuaValue, label: string): Map<string, LuaValue> {
  if (!value || typeof value !== "object" || value.kind !== "table") {
    return terrainError(`${label} must be a Lua table.`);
  }
  const result = new Map<string, LuaValue>();
  for (const [key, entry] of value.entries) {
    if (typeof key === "string") result.set(key, entry);
  }
  return result;
}

function integer(value: LuaValue | undefined, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isSafeInteger(value)
  ) {
    return terrainError(`${label} must be a finite safe integer.`);
  }
  return value;
}

function arrayValue(value: LuaValue, index: number, label: string): LuaValue {
  if (!value || typeof value !== "object" || value.kind !== "array") {
    return terrainError(`${label} must be a Lua array.`);
  }
  const entry = index < 1 ? value.negativeValues[index] : value.values[index - 1];
  if (entry === undefined) return terrainError(`${label}[${index}] is missing.`);
  return entry;
}

function assertArrayRange(
  value: LuaValue,
  min: number,
  max: number,
  label: string
): void {
  if (!value || typeof value !== "object" || value.kind !== "array") {
    return terrainError(`${label} must be a Lua array.`);
  }
  const indices = [
    ...Object.keys(value.negativeValues).map(Number),
    ...Object.keys(value.values).map((key) => Number(key) + 1)
  ].sort((left, right) => left - right);
  if (
    indices.length !== max - min + 1
    || indices[0] !== min
    || indices.at(-1) !== max
    || indices.some((index, position) => index !== min + position)
  ) {
    return terrainError(`${label} range does not agree with terrain bounds.`);
  }
}

function matrixValue(
  matrix: LuaValue,
  y: number,
  x: number,
  label: string
): LuaValue {
  return arrayValue(arrayValue(matrix, y, label), x, `${label}[${y}]`);
}

function uuid(value: LuaValue, label: string): string {
  if (!value || typeof value !== "object" || value.kind !== "uuid") {
    return terrainError(`${label} must be a UUID.`);
  }
  const normalized = value.value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    return terrainError(`${label} contains an invalid UUID.`);
  }
  return normalized;
}

export function normalizeTerrain(
  decoded: LuaValue,
  metadata: SaveMetadata,
  catalog: TileCatalog
): WorldMap {
  return materializeTerrainTransfer(
    normalizeTerrainTransfer(decoded, metadata, catalog),
    metadata
  );
}

export function normalizeTerrainTransfer(
  decoded: LuaValue,
  metadata: SaveMetadata,
  catalog: TileCatalog
): NormalizedTerrainTransfer {
  const root = table(decoded, "Terrain root");
  const bounds = table(root.get("bounds") ?? null, "Terrain bounds");
  const rawMinX = integer(bounds.get("xMin"), "bounds.xMin");
  const rawMaxX = integer(bounds.get("xMax"), "bounds.xMax");
  const rawMinY = integer(bounds.get("yMin"), "bounds.yMin");
  const rawMaxY = integer(bounds.get("yMax"), "bounds.yMax");
  if ([rawMinX, rawMaxX, rawMinY, rawMaxY].some((value) => Math.abs(value) > SAFE_COORDINATE)) {
    return terrainError("Terrain bounds exceed the supported coordinate range.");
  }
  const rawWidth = rawMaxX - rawMinX + 1;
  const rawHeight = rawMaxY - rawMinY + 1;
  if (rawWidth <= 0 || rawHeight <= 0) {
    return terrainError("Terrain bounds are empty or reversed.");
  }
  const savedSeed = integer(root.get("seed"), "Terrain seed");
  if (savedSeed !== metadata.seed) {
    return terrainError("Terrain seed does not match save metadata.");
  }

  const padding =
    rawWidth === RAW_OVERWORLD_WIDTH && rawHeight === RAW_OVERWORLD_HEIGHT
      ? GRAPHICS_CELL_PADDING
      : 0;
  const minX = rawMinX + padding;
  const maxX = rawMaxX - padding;
  const minY = rawMinY + padding;
  const maxY = rawMaxY - padding;
  const matrices = {
    uid: root.get("uid") ?? null,
    xOffset: root.get("xOffset") ?? null,
    yOffset: root.get("yOffset") ?? null,
    rotation: root.get("rotation") ?? null,
    flags: root.get("flags") ?? null
  };
  for (const [name, matrix] of Object.entries(matrices)) {
    assertArrayRange(matrix, rawMinY, rawMaxY, `${name} row`);
    for (let y = rawMinY; y <= rawMaxY; y += 1) {
      const row = arrayValue(matrix, y, name);
      assertArrayRange(row, rawMinX, rawMaxX, `${name}[${y}] column`);
    }
  }
  for (let y = rawMinY; y <= rawMaxY; y += 1) {
    for (let x = rawMinX; x <= rawMaxX; x += 1) {
      for (const [name, matrix] of Object.entries(matrices)) {
        matrixValue(matrix, y, x, name);
      }
    }
  }
  const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
  const uuidIndexes = new Uint16Array(cellCount);
  const xOffsets = new Int32Array(cellCount);
  const yOffsets = new Int32Array(cellCount);
  const rotations = new Uint8Array(cellCount);
  const flags = new Int32Array(cellCount);
  const uuids: string[] = [];
  const terrainTypes: string[] = [];
  const poiTypes: Array<string | null> = [];
  const uuidDictionary = new Map<string, number>();
  const unknown = new Set<string>();
  let cellIndex = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const normalizedUuid = uuid(matrixValue(matrices.uid, y, x, "uid"), `uid[${y}][${x}]`);
      const tile = catalog.tiles[normalizedUuid];
      if (!tile) unknown.add(normalizedUuid);
      const rotation = integer(
        matrixValue(matrices.rotation, y, x, "rotation"),
        `rotation[${y}][${x}]`
      );
      if (rotation < 0 || rotation > 3) {
        return terrainError(`rotation[${y}][${x}] must be an integer from 0 to 3.`);
      }
      const xOffset = integer(matrixValue(matrices.xOffset, y, x, "xOffset"), `xOffset[${y}][${x}]`);
      const yOffset = integer(matrixValue(matrices.yOffset, y, x, "yOffset"), `yOffset[${y}][${x}]`);
      const cellFlags = integer(matrixValue(matrices.flags, y, x, "flags"), `flags[${y}][${x}]`);
      if ([xOffset, yOffset, cellFlags].some((value) => value < -2_147_483_648 || value > 2_147_483_647)) {
        return terrainError(`Terrain cell ${x},${y} contains an integer outside the signed 32-bit range.`);
      }
      let uuidIndex = uuidDictionary.get(normalizedUuid);
      if (uuidIndex === undefined) {
        uuidIndex = uuids.length;
        if (uuidIndex > 65_535) return terrainError("Terrain UUID dictionary exceeds Uint16 capacity.");
        uuidDictionary.set(normalizedUuid, uuidIndex);
        uuids.push(normalizedUuid);
        terrainTypes.push(tile?.terrainType ?? "unknown");
        poiTypes.push(tile?.poiType ?? null);
      }
      uuidIndexes[cellIndex] = uuidIndex;
      xOffsets[cellIndex] = xOffset;
      yOffsets[cellIndex] = yOffset;
      rotations[cellIndex] = rotation;
      flags[cellIndex] = cellFlags;
      cellIndex += 1;
    }
  }

  if (unknown.size > 0) {
    throw new SaveParseError("UNKNOWN_TILE_UUID", {
      stage: "normalizing",
      message: `The save references ${unknown.size} tile UUID(s) absent from the 1.0 catalog.`
    });
  }

  return {
    gameVersion: catalog.gameVersion,
    bounds: { minX, minY, maxX, maxY },
    uuids,
    terrainTypes,
    poiTypes,
    uuidIndexes,
    xOffsets,
    yOffsets,
    rotations,
    flags
  };
}

export function terrainTransferables(
  terrain: NormalizedTerrainTransfer
): ArrayBuffer[] {
  return [
    terrain.uuidIndexes.buffer as ArrayBuffer,
    terrain.xOffsets.buffer as ArrayBuffer,
    terrain.yOffsets.buffer as ArrayBuffer,
    terrain.rotations.buffer as ArrayBuffer,
    terrain.flags.buffer as ArrayBuffer
  ];
}

export function materializeTerrainTransfer(
  terrain: NormalizedTerrainTransfer,
  metadata: SaveMetadata = { fileName: "", saveVersion: 28, seed: 0 }
): WorldMap {
  validateTerrainTransfer(terrain);
  const width = terrain.bounds.maxX - terrain.bounds.minX + 1;
  const cells: TerrainCell[] = Array.from(
    { length: terrain.uuidIndexes.length },
    (_, index) => {
      const uuidIndex = terrain.uuidIndexes[index]!;
      const poiType = terrain.poiTypes[uuidIndex];
      return {
        x: terrain.bounds.minX + index % width,
        y: terrain.bounds.minY + Math.floor(index / width),
        uuid: terrain.uuids[uuidIndex]!,
        rotation: terrain.rotations[index]! as 0 | 1 | 2 | 3,
        xOffset: terrain.xOffsets[index]!,
        yOffset: terrain.yOffsets[index]!,
        flags: terrain.flags[index]!,
        terrainType: terrain.terrainTypes[uuidIndex]!,
        ...(poiType ? { poiType } : {})
      };
    }
  );
  const world: WorldMap = {
    id: "personal-surface",
    source: "save",
    gameVersion: terrain.gameVersion,
    saveVersion: metadata.saveVersion,
    seed: metadata.seed,
    bounds: terrain.bounds,
    cells,
    locations: [],
    connections: []
  };
  return world;
}

export async function materializeTerrainTransferAsync(
  terrain: NormalizedTerrainTransfer,
  metadata: SaveMetadata,
  isCurrent: () => boolean
): Promise<WorldMap> {
  validateTerrainTransfer(terrain);
  const width = terrain.bounds.maxX - terrain.bounds.minX + 1;
  const height = terrain.bounds.maxY - terrain.bounds.minY + 1;
  const cells: TerrainCell[] = [];
  let rowsSinceYield = 0;
  let cellsSinceYield = 0;
  const yieldAndCheckCurrent = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!isCurrent()) {
      throw new DOMException("Terrain materialization was replaced.", "AbortError");
    }
    rowsSinceYield = 0;
    cellsSinceYield = 0;
  };

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const uuidIndex = terrain.uuidIndexes[index]!;
      const poiType = terrain.poiTypes[uuidIndex];
      cells.push({
        x: terrain.bounds.minX + column,
        y: terrain.bounds.minY + row,
        uuid: terrain.uuids[uuidIndex]!,
        rotation: terrain.rotations[index]! as 0 | 1 | 2 | 3,
        xOffset: terrain.xOffsets[index]!,
        yOffset: terrain.yOffsets[index]!,
        flags: terrain.flags[index]!,
        terrainType: terrain.terrainTypes[uuidIndex]!,
        ...(poiType ? { poiType } : {})
      });
      cellsSinceYield += 1;
      if (cellsSinceYield >= MATERIALIZATION_CELLS_PER_YIELD) {
        await yieldAndCheckCurrent();
      }
    }
    rowsSinceYield += 1;
    if (rowsSinceYield >= MATERIALIZATION_ROWS_PER_YIELD) {
      await yieldAndCheckCurrent();
    }
  }
  if (!isCurrent()) throw new DOMException("Terrain materialization was replaced.", "AbortError");
  return {
    id: "personal-surface",
    source: "save",
    gameVersion: terrain.gameVersion,
    saveVersion: metadata.saveVersion,
    seed: metadata.seed,
    bounds: terrain.bounds,
    cells,
    locations: [],
    connections: []
  };
}

export function validateTerrainTransfer(
  terrain: NormalizedTerrainTransfer
): void {
  const { minX, minY, maxX, maxY } = terrain.bounds;
  if (
    ![minX, minY, maxX, maxY].every(Number.isSafeInteger)
    || maxX < minX
    || maxY < minY
    || [minX, minY, maxX, maxY].some((value) => Math.abs(value) > SAFE_COORDINATE)
  ) {
    return terrainError("Normalized terrain bounds are invalid.");
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const expected = width * height;
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > 2_000_000) {
    return terrainError("Normalized terrain cell count is unsafe.");
  }
  if (
    !(terrain.uuidIndexes instanceof Uint16Array)
    || !(terrain.xOffsets instanceof Int32Array)
    || !(terrain.yOffsets instanceof Int32Array)
    || !(terrain.rotations instanceof Uint8Array)
    || !(terrain.flags instanceof Int32Array)
    || [
      terrain.uuidIndexes.length,
      terrain.xOffsets.length,
      terrain.yOffsets.length,
      terrain.rotations.length,
      terrain.flags.length
    ].some((length) => length !== expected)
  ) {
    return terrainError("Normalized terrain columns do not match bounds.");
  }
  const dictionaryLength = terrain.uuids.length;
  if (
    dictionaryLength <= 0
    || dictionaryLength > 65_536
    || terrain.terrainTypes.length !== dictionaryLength
    || terrain.poiTypes.length !== dictionaryLength
  ) {
    return terrainError("Normalized terrain dictionaries are inconsistent.");
  }
  for (let index = 0; index < dictionaryLength; index += 1) {
    if (!UUID_PATTERN.test(terrain.uuids[index] ?? "")) {
      return terrainError("Normalized terrain contains a malformed UUID.");
    }
    if (typeof terrain.terrainTypes[index] !== "string") {
      return terrainError("Normalized terrain contains an invalid terrain type.");
    }
    const poi = terrain.poiTypes[index];
    if (poi !== null && typeof poi !== "string") {
      return terrainError("Normalized terrain contains an invalid POI type.");
    }
  }
  for (let index = 0; index < expected; index += 1) {
    if (terrain.uuidIndexes[index]! >= dictionaryLength) {
      return terrainError("Normalized terrain contains an invalid UUID index.");
    }
    if (terrain.rotations[index]! > 3) {
      return terrainError("Normalized terrain contains an invalid rotation.");
    }
  }
}
