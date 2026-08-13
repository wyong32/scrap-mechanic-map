import { expect, it } from "vitest";
import type {
  LuaValue,
  NormalizedTerrainTransfer,
  SaveMetadata
} from "../save/save-protocol";
import {
  materializeTerrainTransfer,
  materializeTerrainTransferAsync,
  normalizeTerrain,
  normalizeTerrainTransfer,
  terrainTransferables,
  type TileCatalog
} from "./normalize-terrain";

const UUIDS = [
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2",
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3",
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee4"
];
const metadata: SaveMetadata = { fileName: "private.db", saveVersion: 28, seed: 42 };
const catalog: TileCatalog = {
  gameVersion: "1.0.0",
  tiles: Object.fromEntries(
    UUIDS.map((uuid, index) => [
      uuid,
      { terrainType: `terrain-${index}`, ...(index === 2 ? { poiType: "quest" } : {}) }
    ])
  )
};

function array(values: LuaValue[], offset = 1): LuaValue {
  const negativeValues: Record<number, LuaValue> = {};
  const positive: LuaValue[] = [];
  values.forEach((value, index) => {
    const key = offset + index;
    if (key < 1) negativeValues[key] = value;
    else positive[key - 1] = value;
  });
  return { kind: "array", values: positive, negativeValues };
}

function matrix(rows: LuaValue[][], yOffset = 0, xOffset = 0): LuaValue {
  return array(rows.map((row) => array(row, xOffset)), yOffset);
}

function root(overrides: Record<string, LuaValue> = {}): LuaValue {
  const values: Record<string, LuaValue> = {
    bounds: {
      kind: "table",
      entries: [["xMin", 0], ["xMax", 1], ["yMin", 0], ["yMax", 1]]
    },
    seed: 42,
    uid: matrix([
      UUIDS.slice(0, 2).map((uuid) => ({ kind: "uuid", value: uuid })),
      UUIDS.slice(2, 4).map((uuid) => ({ kind: "uuid", value: uuid }))
    ], 0, 0),
    xOffset: matrix([[10, 11], [12, 13]], 0, 0),
    yOffset: matrix([[-10, -11], [-12, -13]], 0, 0),
    rotation: matrix([[0, 1], [2, 3]], 0, 0),
    flags: matrix([[0, 1], [2, 3]], 0, 0),
    ...overrides
  };
  return { kind: "table", entries: Object.entries(values) };
}

it("normalizes exact terrain cells in stable row-major order", () => {
  const world = normalizeTerrain(root(), metadata, catalog);

  expect(world.bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  expect(world.cells.map(({ x, y, uuid, rotation, xOffset, yOffset, flags, terrainType, poiType }) => ({
    x, y, uuid, rotation, xOffset, yOffset, flags, terrainType, poiType
  }))).toEqual([
    { x: 0, y: 0, uuid: UUIDS[0], rotation: 0, xOffset: 10, yOffset: -10, flags: 0, terrainType: "terrain-0", poiType: undefined },
    { x: 1, y: 0, uuid: UUIDS[1], rotation: 1, xOffset: 11, yOffset: -11, flags: 1, terrainType: "terrain-1", poiType: undefined },
    { x: 0, y: 1, uuid: UUIDS[2], rotation: 2, xOffset: 12, yOffset: -12, flags: 2, terrainType: "terrain-2", poiType: "quest" },
    { x: 1, y: 1, uuid: UUIDS[3], rotation: 3, xOffset: 13, yOffset: -13, flags: 3, terrainType: "terrain-3", poiType: undefined }
  ]);
});

it("trims the verified eight-cell graphics padding from a 144 by 112 overworld", () => {
  const rawWidth = 144;
  const rawHeight = 112;
  const repeatedUuid = { kind: "uuid", value: UUIDS[0] } satisfies LuaValue;
  const rows = Array.from({ length: rawHeight }, () =>
    Array.from({ length: rawWidth }, () => repeatedUuid)
  );
  const numbers = Array.from({ length: rawHeight }, () =>
    Array.from({ length: rawWidth }, () => 0)
  );
  const decoded = root({
    bounds: {
      kind: "table",
      entries: [["xMin", -72], ["xMax", 71], ["yMin", -56], ["yMax", 55]]
    },
    uid: matrix(rows, -56, -72),
    xOffset: matrix(numbers, -56, -72),
    yOffset: matrix(numbers, -56, -72),
    rotation: matrix(numbers, -56, -72),
    flags: matrix(numbers, -56, -72)
  });

  const world = normalizeTerrain(decoded, metadata, catalog);

  expect(world.bounds).toEqual({ minX: -64, minY: -48, maxX: 63, maxY: 47 });
  expect(world.cells).toHaveLength(12_288);
  expect(world.cells[0]).toMatchObject({ x: -64, y: -48, uuid: UUIDS[0] });
  expect(world.cells.at(-1)).toMatchObject({ x: 63, y: 47, uuid: UUIDS[0] });
});

it.each([
  ["metadata seed differs", { seed: 43 }, "Terrain seed does not match save metadata"],
  ["rotation is outside 0..3", { rotation: matrix([[0, 4], [2, 3]], 0, 0) }, "rotation"],
  ["matrix coordinate is missing", { flags: matrix([[0], [2, 3]], 0, 0) }, "flags"],
  ["UUID is malformed", { uid: matrix([[{ kind: "uuid", value: "bad" }, { kind: "uuid", value: UUIDS[1] }], [{ kind: "uuid", value: UUIDS[2] }, { kind: "uuid", value: UUIDS[3] }]], 0, 0) }, "UUID"]
] as const)("rejects %s without producing a partial world", (_name, override, message) => {
  const nextMetadata = "seed" in override
    ? { ...metadata, seed: override.seed }
    : metadata;
  const terrainOverride = "seed" in override ? {} : override;
  expect(() => normalizeTerrain(root(terrainOverride), nextMetadata, catalog)).toThrow(message);
});

it("rejects an unknown exact tile UUID with the recoverable code", () => {
  try {
    normalizeTerrain(root(), metadata, { ...catalog, tiles: { [UUIDS[0]]: catalog.tiles[UUIDS[0]]! } });
    throw new Error("expected normalization to fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "UNKNOWN_TILE_UUID" });
  }
});

it("rejects terrain matrices whose dimensions exceed the declared bounds", () => {
  const extraRow = array([
    array([0, 1], 0),
    array([2, 3], 0),
    array([4, 5], 0)
  ], 0);

  expect(() => normalizeTerrain(root({ flags: extraRow }), metadata, catalog))
    .toThrow("flags row range");
});

it("normalizes raw Lua into transferable typed buffers before materializing cells", () => {
  const transfer = normalizeTerrainTransfer(root(), metadata, catalog);

  expect(transfer).not.toHaveProperty("kind");
  expect(transfer.uuidIndexes).toBeInstanceOf(Uint16Array);
  expect(transfer.xOffsets).toBeInstanceOf(Int32Array);
  expect(transfer.yOffsets).toBeInstanceOf(Int32Array);
  expect(transfer.rotations).toBeInstanceOf(Uint8Array);
  expect(transfer.flags).toBeInstanceOf(Int32Array);
  expect(terrainTransferables(transfer)).toEqual([
    transfer.uuidIndexes.buffer,
    transfer.xOffsets.buffer,
    transfer.yOffsets.buffer,
    transfer.rotations.buffer,
    transfer.flags.buffer
  ]);
  expect(materializeTerrainTransfer(transfer).cells).toHaveLength(4);
});

it("cancels materialization within a single wide terrain row", async () => {
  const width = 4_097;
  const transfer: NormalizedTerrainTransfer = {
    gameVersion: catalog.gameVersion,
    bounds: { minX: 0, minY: 0, maxX: width - 1, maxY: 0 },
    uuids: [UUIDS[0]],
    terrainTypes: ["terrain-0"],
    poiTypes: [null],
    uuidIndexes: new Uint16Array(width),
    xOffsets: new Int32Array(width),
    yOffsets: new Int32Array(width),
    rotations: new Uint8Array(width),
    flags: new Int32Array(width)
  };
  let current = true;
  const staleTimer = setTimeout(() => {
    current = false;
  }, 0);

  try {
    await expect(
      materializeTerrainTransferAsync(transfer, metadata, () => current)
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    clearTimeout(staleTimer);
  }
});

it.each([
  ["truncated columns", (value: ReturnType<typeof normalizeTerrainTransfer>) => ({ ...value, flags: new Int32Array(3) })],
  ["invalid UUID indexes", (value: ReturnType<typeof normalizeTerrainTransfer>) => ({ ...value, uuidIndexes: new Uint16Array([0, 0, 0, 9]) })],
  ["invalid rotations", (value: ReturnType<typeof normalizeTerrainTransfer>) => ({ ...value, rotations: new Uint8Array([0, 1, 2, 4]) })]
] as const)("rejects malformed normalized transfers: %s", (_name, mutate) => {
  const transfer = mutate(normalizeTerrainTransfer(root(), metadata, catalog));
  expect(() => materializeTerrainTransfer(transfer, metadata)).toThrow();
});
