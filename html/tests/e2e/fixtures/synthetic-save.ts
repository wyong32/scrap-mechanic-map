import { expect, test as base } from "@playwright/test";
import { mkdir, rm, truncate, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import initSqlJs from "sql.js";

const TILE_UUIDS = [
  "009e5e43-37f6-43b9-bb98-6489f6e8e58f",
  "0123c758-c3d4-45fb-a9a8-ad1b54578012",
  "013e980d-2425-4275-9c4b-c0eee0dba7f1",
  "01582735-15b6-4058-9a39-3a96f5d7c985"
];
const DEFAULT_SEED = 424242;
const MAX_SAVE_FILE_BYTES = 256 * 1024 * 1024;
export const SYNTHETIC_PRIVACY_SEED = 919191;
export const SYNTHETIC_DECODED_SENTINEL = 731;
export const SYNTHETIC_BINARY_SENTINEL = new Uint8Array([
  222, 173, 190, 239, 17, 34, 51, 68
]);

type FixtureValue =
  | null
  | boolean
  | number
  | string
  | { int32: number }
  | { uuidBytes: number[] }
  | { array: FixtureValue[]; offset: number }
  | { entries: Array<[FixtureValue, FixtureValue]> };

class BitWriter {
  private readonly bits: number[] = [];

  write(value: number, count: number): void {
    for (let bit = count - 1; bit >= 0; bit -= 1) {
      this.bits.push((value >>> bit) & 1);
    }
  }

  writeUint32(value: number): void {
    this.write((value >>> 16) & 0xffff, 16);
    this.write(value & 0xffff, 16);
  }

  align(): void {
    while (this.bits.length % 8 !== 0) this.bits.push(0);
  }

  bytes(): Uint8Array {
    this.align();
    const output = new Uint8Array(this.bits.length / 8);
    this.bits.forEach((bit, index) => {
      output[index >>> 3] |= bit << (7 - (index & 7));
    });
    return output;
  }
}

function floatBytes(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setFloat32(0, value, false);
  return output;
}

function writeValue(writer: BitWriter, value: FixtureValue): void {
  if (value === null) {
    writer.write(1, 8);
  } else if (typeof value === "boolean") {
    writer.write(2, 8);
    writer.write(value ? 1 : 0, 1);
  } else if (typeof value === "number") {
    writer.write(3, 8);
    for (const byte of floatBytes(value)) writer.write(byte, 8);
  } else if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    writer.write(4, 8);
    writer.writeUint32(bytes.length);
    writer.align();
    for (const byte of bytes) writer.write(byte, 8);
  } else if ("int32" in value) {
    writer.write(6, 8);
    writer.writeUint32(value.int32 >>> 0);
  } else if ("uuidBytes" in value) {
    writer.write(100, 8);
    writer.writeUint32(10001);
    for (const byte of value.uuidBytes) writer.write(byte, 8);
  } else if ("array" in value) {
    writer.write(5, 8);
    writer.writeUint32(value.array.length);
    writer.write(1, 1);
    writer.writeUint32(value.offset >>> 0);
    value.array.forEach((entry) => writeValue(writer, entry));
  } else {
    writer.write(5, 8);
    writer.writeUint32(value.entries.length);
    writer.write(0, 1);
    value.entries.forEach(([key, entry]) => {
      writeValue(writer, key);
      writeValue(writer, entry);
    });
  }
}

function luaObject(value: FixtureValue): Uint8Array {
  const writer = new BitWriter();
  writeValue(writer, value);
  return new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, ...writer.bytes()]);
}

function rawLz4Literal(input: Uint8Array): Uint8Array {
  const extension: number[] = [];
  let length = input.length;
  const tokenLength = Math.min(15, length);
  if (length >= 15) {
    length -= 15;
    while (length >= 255) {
      extension.push(255);
      length -= 255;
    }
    extension.push(length);
  }
  return new Uint8Array([tokenLength << 4, ...extension, ...input]);
}

function scriptDataWrapperBytes(payload: Uint8Array): Uint8Array {
  const compressed = rawLz4Literal(payload);
  const output = new Uint8Array(29 + compressed.length);
  output.set([
    0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x4d, 0xef,
    0x80, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde
  ]);
  const view = new DataView(output.buffer);
  view.setUint16(16, 4, false);
  view.setUint32(18, 0x78563412, true);
  view.setUint16(22, 1, false);
  output[24] = 2;
  view.setUint32(25, compressed.length, false);
  output.set(compressed, 29);
  return output;
}

function scriptDataWrapper(value: FixtureValue): Uint8Array {
  return scriptDataWrapperBytes(luaObject(value));
}

function uuidBytes(uuid: string): number[] {
  return (uuid.match(/[0-9a-f]{2}/gi) ?? []).map((part) => Number.parseInt(part, 16)).reverse();
}

function matrix(
  values: FixtureValue[],
  width = 2,
  height = 2,
  minX = 0,
  minY = 0
): FixtureValue {
  if (values.length !== width * height) {
    throw new Error("Synthetic terrain matrix does not match its bounds.");
  }
  return {
    array: Array.from({ length: height }, (_, row) => ({
      array: values.slice(row * width, (row + 1) * width),
      offset: minX
    })),
    offset: minY
  };
}

export interface SyntheticTerrainCell {
  uuid: string;
  xOffset: number;
  yOffset: number;
  rotation: 0 | 1 | 2 | 3;
  flags: number;
}

export interface SyntheticTerrainGrid {
  minX: number;
  minY: number;
  width: number;
  height: number;
  cells: readonly SyntheticTerrainCell[];
}

function terrainGridValue(
  seed: number,
  grid: SyntheticTerrainGrid,
  unknown = false
): FixtureValue {
  const uuids = grid.cells.map((cell) => cell.uuid);
  if (unknown) uuids[0] = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const maxX = grid.minX + grid.width - 1;
  const maxY = grid.minY + grid.height - 1;
  const asMatrix = (values: FixtureValue[]) =>
    matrix(
      values,
      grid.width,
      grid.height,
      grid.minX,
      grid.minY
    );
  return {
    entries: [
      ["bounds", { entries: [["xMin", { int32: grid.minX }], ["xMax", { int32: maxX }], ["yMin", { int32: grid.minY }], ["yMax", { int32: maxY }]] }],
      ["seed", { int32: seed }],
      ["uid", asMatrix(uuids.map((uuid) => ({ uuidBytes: uuidBytes(uuid) })))],
      ["xOffset", asMatrix(grid.cells.map((cell) => ({ int32: cell.xOffset })))],
      ["yOffset", asMatrix(grid.cells.map((cell) => ({ int32: cell.yOffset })))],
      ["rotation", asMatrix(grid.cells.map((cell) => ({ int32: cell.rotation })))],
      ["flags", asMatrix(grid.cells.map((cell) => ({ int32: cell.flags })))]
    ]
  };
}

function terrainValue(seed: number, layout = 0, unknown = false): FixtureValue {
  const uuids = layout === 0 ? [...TILE_UUIDS] : [...TILE_UUIDS].reverse();
  const offsets = layout === 0 ? [101, 202, 303, 404] : [404, 303, 202, 101];
  return terrainGridValue(seed, {
    minX: 0,
    minY: 0,
    width: 2,
    height: 2,
    cells: uuids.map((uuid, index) => ({
      uuid,
      xOffset: offsets[index]!,
      yOffset: index,
      rotation: index as 0 | 1 | 2 | 3,
      flags: SYNTHETIC_DECODED_SENTINEL + index
    }))
  }, unknown);
}

export interface SyntheticSaveOptions {
  name: string;
  seed?: number;
  version?: 27 | 28;
  terrain?: "valid" | "unknown-uuid" | "truncated-lua";
  layout?: 0 | 1;
  grid?: SyntheticTerrainGrid;
}

export interface SyntheticSave {
  path: string;
  name: string;
  seed: number;
}

export class SyntheticSaveManager {
  private readonly files: string[] = [];

  constructor(private readonly directory: string) {}

  async create(options: SyntheticSaveOptions): Promise<SyntheticSave> {
    const seed = options.seed ?? DEFAULT_SEED;
    const terrain = options.terrain ?? "valid";
    const blob = terrain === "truncated-lua"
      ? scriptDataWrapperBytes(new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, 5]))
      : terrain === "unknown-uuid"
        ? scriptDataWrapper(
            options.grid
              ? terrainGridValue(seed, options.grid, true)
              : terrainValue(seed, options.layout ?? 0, true)
          )
        : scriptDataWrapper(
            options.grid
              ? terrainGridValue(seed, options.grid)
              : terrainValue(seed, options.layout ?? 0)
          );
    const SQL = await initSqlJs({
      locateFile: () => fileURLToPath(new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url))
    });
    const database = new SQL.Database();
    try {
      database.run("CREATE TABLE Game (savegameversion INTEGER NOT NULL, seed INTEGER NOT NULL)");
      database.run("CREATE TABLE ScriptData (worldId INTEGER NOT NULL, data BLOB NOT NULL)");
      database.run("CREATE TABLE SyntheticSentinel (value BLOB NOT NULL)");
      database.run("INSERT INTO Game VALUES (?, ?)", [options.version ?? 28, seed]);
      database.run("INSERT INTO ScriptData VALUES (?, ?)", [1, blob]);
      database.run("INSERT INTO SyntheticSentinel VALUES (?)", [Uint8Array.from(SYNTHETIC_BINARY_SENTINEL)]);
      const path = join(this.directory, options.name);
      await mkdir(this.directory, { recursive: true });
      await writeFile(path, database.export());
      this.files.push(path);
      return { path, name: options.name, seed };
    } finally {
      database.close();
    }
  }

  async createEmpty(name: string): Promise<SyntheticSave> {
    return this.write(name, new Uint8Array());
  }

  async createText(name: string): Promise<SyntheticSave> {
    return this.write(name, new TextEncoder().encode("this is not a SQLite database"));
  }

  async createOversized(name: string): Promise<SyntheticSave> {
    const path = join(this.directory, name);
    await mkdir(this.directory, { recursive: true });
    await writeFile(path, new Uint8Array());
    await truncate(path, MAX_SAVE_FILE_BYTES + 1);
    this.files.push(path);
    return { path, name, seed: DEFAULT_SEED };
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.files.map((path) => rm(path, { force: true })));
    this.files.length = 0;
  }

  private async write(name: string, bytes: Uint8Array): Promise<SyntheticSave> {
    const path = join(this.directory, name);
    await mkdir(this.directory, { recursive: true });
    await writeFile(path, bytes);
    this.files.push(path);
    return { path, name, seed: DEFAULT_SEED };
  }
}

export const test = base.extend<{ syntheticSaves: SyntheticSaveManager }>({
  syntheticSaves: async ({}, use, testInfo) => {
    const manager = new SyntheticSaveManager(testInfo.outputPath("synthetic-saves"));
    try {
      await use(manager);
    } finally {
      await manager.cleanup();
    }
  }
});

export { expect };
