import { describe, expect, it } from "vitest";
import { readFixedWorld } from "./world-reader.ts";

describe("readFixedWorld", () => {
  it("normalizes world cells, bounds, rotations and portal connections", () => {
    const world = readFixedWorld(
      JSON.stringify({
        cellData: [
          { x: 3, y: 1, path: "$SURVIVAL_DATA/Terrain/Tiles/b.tile", offsetX: 1, offsetY: 2, rotation: 3 },
          { x: -1, y: 2, path: "$SURVIVAL_DATA/Terrain/Tiles/a.tile", offsetX: 0, offsetY: 0, rotation: 0 },
        ],
        portalData: [{ id: 9, zoneA: 2, zoneB: 5 }],
      }),
      { id: "growlab_01", nameKey: "growlab_01", group: "grow-labs" },
      (path) => ({ uuid: path.endsWith("a.tile") ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", width: 2, height: 3 }),
    );

    expect(world.bounds).toEqual({ minX: -1, minY: 1, maxX: 3, maxY: 2 });
    expect(world.cells).toEqual([
      { x: -1, y: 2, relativePath: "Survival/Terrain/Tiles/a.tile", tileUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", offsetX: 0, offsetY: 0, rotation: 0 },
      { x: 3, y: 1, relativePath: "Survival/Terrain/Tiles/b.tile", tileUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", offsetX: 1, offsetY: 2, rotation: 3 },
    ]);
    expect(world.connections).toEqual([{ id: 9, fromZone: 2, toZone: 5 }]);
  });

  it("rejects rotations outside quarter turns", () => {
    expect(() => readFixedWorld(JSON.stringify({ cellData: [{ x: 0, y: 0, path: "$SURVIVAL_DATA/Terrain/Tiles/a.tile", rotation: 4 }] }), { id: "bad", nameKey: "bad", group: "test" }, () => ({ uuid: "a", width: 1, height: 1 }))).toThrow(/rotation/i);
  });

  it("keeps empty placeholders separate and rejects unresolved, duplicate and out-of-range cells", () => {
    const identity = { id: "bad", nameKey: "bad", group: "test" };
    const resolver = () => ({ uuid: "a", width: 1, height: 1 });
    expect(readFixedWorld(JSON.stringify({ cellData: [{ x: 0, y: 0, path: "" }, { x: 1, y: 0, path: "$SURVIVAL_DATA/Terrain/Tiles/a.tile" }] }), identity, resolver).emptyCells).toEqual([{ x: 0, y: 0 }]);
    expect(() => readFixedWorld(JSON.stringify({ cellData: [{ x: 0, y: 0, path: "$MOD_DATA/a.tile" }] }), identity, resolver)).toThrow(/unsupported/i);
    expect(() => readFixedWorld(JSON.stringify({ cellData: [{ x: 0, y: 0, path: "$SURVIVAL_DATA/Terrain/Tiles/a.tile" }, { x: 0, y: 0, path: "$SURVIVAL_DATA/Terrain/Tiles/a.tile" }] }), identity, resolver)).toThrow(/duplicate/i);
    expect(() => readFixedWorld(JSON.stringify({ cellData: [{ x: 0, y: 0, path: "$SURVIVAL_DATA/Terrain/Tiles/a.tile", offsetX: 1 }] }), identity, resolver)).toThrow(/offset/i);
  });

  it("rejects fractional and duplicate portals", () => {
    const identity = { id: "bad", nameKey: "bad", group: "test" };
    const resolver = () => ({ uuid: "a", width: 1, height: 1 });
    expect(() => readFixedWorld(JSON.stringify({ portalData: [{ id: 1.5, zoneA: 0, zoneB: 1 }] }), identity, resolver)).toThrow(/portal/i);
    expect(() => readFixedWorld(JSON.stringify({ portalData: [{ id: 1, zoneA: 0, zoneB: 1 }, { id: 1, zoneA: 1, zoneB: 2 }] }), identity, resolver)).toThrow(/duplicate/i);
  });
});
