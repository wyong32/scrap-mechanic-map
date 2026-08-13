import { describe, expect, it } from "vitest";
import { LuaTableReaderError, parseLuaDeclarations } from "./lua-table-reader.ts";

describe("parseLuaDeclarations", () => {
  it("reads a data-only table with content paths, entries, offsets and trailing commas", () => {
    const result = parseLuaDeclarations(
      `-- tile metadata\nlocal $CONTENT_DATA = "$SURVIVAL_DATA"\nlocal tiles = {\n  ["c0ffee00-0000-4000-8000-000000000001"] = { path = $CONTENT_DATA .. "/Terrain/Tiles/a.tile", offsetX = -2, offsetY = 3, },\n}`,
      "fixture.lua",
    );

    expect((result.tiles as Record<string, unknown>)["c0ffee00-0000-4000-8000-000000000001"]).toEqual({
      path: "$SURVIVAL_DATA/Terrain/Tiles/a.tile",
      offsetX: -2,
      offsetY: 3,
    });
  });

  it("rejects duplicate UUID table keys", () => {
    expect(() =>
      parseLuaDeclarations(`tiles = { ["c0ffee00-0000-4000-8000-000000000001"] = {}, ["c0ffee00-0000-4000-8000-000000000001"] = {} }`, "dupe.lua"),
    ).toThrow(/dupe\.lua:1:.*duplicate UUID/i);
  });

  it("rejects executable calls with source diagnostics", () => {
    expect(() => parseLuaDeclarations("tiles = loadfile('evil.lua')", "unsafe.lua")).toThrow(LuaTableReaderError);
    expect(() => parseLuaDeclarations("tiles = loadfile('evil.lua')", "unsafe.lua")).toThrow(/unsafe\.lua:1:\d+/);
  });

  it.each([
    "local other = 'nope'",
    "$CONTENT_DATA = 4",
    "local tiles = {}\nlocal tiles = {}",
    "function nope() end",
    "return {}",
    "if true then end",
    "tiles = { value = 1.2.3 }",
    "tiles = { path = 'a' .. 3 }",
  ])("rejects non-declarative subset input with source diagnostics: %s", (source) => {
    expect(() => parseLuaDeclarations(source, "reject.lua")).toThrow(/reject\.lua:\d+:\d+:/);
  });
});
