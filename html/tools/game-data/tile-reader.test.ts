import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readTileHeader } from "./tile-reader.ts";

describe("readTileHeader", () => {
  it("reads an RFC-order UUID and little-endian scalar fields from a TILE binary header", () => {
    const bytes = Buffer.from([0x54, 0x49, 0x4c, 0x45, 0x0f, 0, 0, 0, 0xd5, 0x1e, 0xbb, 0xba, 0xdc, 0xa0, 0x47, 0x44, 0xaa, 0xc0, 0xe4, 0x06, 0xcf, 0xec, 0x2f, 0xb9, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(readTileHeader(bytes, "fixture.tile")).toEqual({ uuid: "d51ebbba-dca0-4744-aac0-e406cfec2fb9", width: 1, height: 1, version: 15 });
  });

  it.skipIf(!process.env.SM_GAME_ROOT)("matches a real 1.0 installed tile header", async () => {
    const gameTile = resolve(process.env.SM_GAME_ROOT!, "Survival/DungeonTiles/Warehouse_Interior_ConstructionFloor_01.tile");
    const header = readTileHeader(await readFile(gameTile), gameTile);
    expect(header.uuid).toBe("3f6460cf-db7c-44c0-a91e-a42c617a1750");
    expect(header.version).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.SM_GAME_ROOT)("cross-checks a real header against the shipped legacy UUID mapping", async () => {
    const gameRoot = process.env.SM_GAME_ROOT!;
    const [tile, poiLua] = await Promise.all([
      readFile(resolve(gameRoot, "Survival/Terrain/Tiles/poi/Random_Road_64_01.tile")),
      readFile(resolve(gameRoot, "Survival/Scripts/terrain/overworld/poi.lua"), "utf8"),
    ]);
    expect(readTileHeader(tile).uuid).toBe("f3535095-b884-4596-a432-0aee1b5d742a");
    expect(poiLua).toContain('sm.uuid.new( "f3535095-b884-4596-a432-0aee1b5d742a" )');
  });

  it("rejects an implausible zero version", () => {
    const bytes = Buffer.alloc(40);
    bytes.write("TILE");
    bytes.writeUInt32LE(1, 32);
    bytes.writeUInt32LE(1, 36);
    expect(() => readTileHeader(bytes, "zero.tile")).toThrow(/version/i);
  });

  it("rejects unsupported version and dimension bounds", () => {
    const bytes = Buffer.alloc(40); bytes.write("TILE"); bytes.writeUInt32LE(16, 4); bytes.writeUInt32LE(1, 32); bytes.writeUInt32LE(1, 36);
    expect(() => readTileHeader(bytes, "large-version.tile")).toThrow(/version/i);
    bytes.writeUInt32LE(15, 4); bytes.writeUInt32LE(33, 32);
    expect(() => readTileHeader(bytes, "large-size.tile")).toThrow(/dimensions/i);
  });
});
