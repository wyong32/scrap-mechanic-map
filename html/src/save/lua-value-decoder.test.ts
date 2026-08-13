import { describe, expect, it } from "vitest";
import { luaObject, type FixtureValue } from "./fixtures/encoded-values";
import { decodeLuaObject } from "./lua-value-decoder";

describe("Scrap Mechanic Lua object decoding", () => {
  it.each([
    [new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, 1]), null],
    [new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, 2, 0x80]), true],
    [luaObject({ int8: -5 }), -5],
    [luaObject({ int16: -129 }), -129],
    [luaObject({ int32: 70_000 }), 70_000],
    [luaObject(1.5), 1.5],
    [luaObject({ double: Math.PI }), Math.PI],
    [luaObject("机械"), "机械"]
  ])("decodes a literal primitive fixture", (bytes, expected) => {
    expect(decodeLuaObject(bytes)).toEqual(expected);
  });

  it("decodes negative-index arrays without losing later positive indexes", () => {
    expect(decodeLuaObject(luaObject({
      array: [{ int8: 3 }, { int8: 4 }, { int8: 5 }, { int8: 6 }],
      offset: -1
    }))).toEqual({
      kind: "array",
      negativeValues: { "-1": 3, "0": 4 },
      values: [5, 6]
    });
  });

  it("decodes string-key tables, UUIDs and vec3 values", () => {
    const value = decodeLuaObject(luaObject({
      entries: [
        ["uid", { uuidBytes: [...Array(16).keys()] }],
        ["position", { vec3: [1, -2, 3.5] }]
      ]
    }));

    expect(value).toEqual({
      kind: "table",
      entries: [
        ["uid", { kind: "uuid", value: "0f0e0d0c-0b0a-0908-0706-050403020100" }],
        ["position", { kind: "vec3", x: 1, y: -2, z: 3.5 }]
      ]
    });
  });

  it.each([
    [new Uint8Array([0x58, 0x55, 0x41, 0, 0, 0, 1, 1]), "magic"],
    [new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 2, 1]), "version"],
    [new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, 99]), "tag"],
    [new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, 101]), "reference"],
    [new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, 1, 1]), "trailing"]
  ])("rejects malformed %s data with an offset-aware decode error", (bytes) => {
    expect(() => decodeLuaObject(bytes)).toThrowError(
      expect.objectContaining({ code: "DECODE_FAILED", stage: "lua-value" })
    );
  });

  it("rejects huge and remaining+1 Lua string lengths before allocation", () => {
    const huge = new Uint8Array([
      0x4c, 0x55, 0x41, 0, 0, 0, 1,
      4, 0xff, 0xff, 0xff, 0xff
    ]);
    const over = new Uint8Array([
      0x4c, 0x55, 0x41, 0, 0, 0, 1,
      4, 0, 0, 0, 2, 0x41
    ]);
    for (const bytes of [huge, over]) {
      expect(() => decodeLuaObject(bytes)).toThrowError(
        expect.objectContaining({ code: "DECODE_FAILED", stage: "lua-value" })
      );
    }
  });

  it("accepts a Lua string exactly at the remaining boundary", () => {
    expect(decodeLuaObject(new Uint8Array([
      0x4c, 0x55, 0x41, 0, 0, 0, 1,
      4, 0, 0, 0, 1, 0x41
    ]))).toBe("A");
  });

  it("rejects non-zero intra-string alignment padding", () => {
    const bytes = luaObject({ array: [true, "a"], offset: 1 });
    bytes[22] |= 1;
    expect(() => decodeLuaObject(bytes)).toThrowError(
      expect.objectContaining({ code: "DECODE_FAILED", stage: "lua-value" })
    );
  });

  it.each([
    0x7fff_ffff,
    -0x8000_0000
  ])("rejects an extreme array offset %s without creating a sparse array", (offset) => {
    expect(() => decodeLuaObject(luaObject({
      array: [{ int8: 1 }],
      offset
    }))).toThrowError(expect.objectContaining({
      code: "DECODE_FAILED",
      stage: "lua-value"
    }));
  });

  it("rejects offset-plus-count outside the safe collection range", () => {
    expect(() => decodeLuaObject(luaObject({
      array: [{ int8: 1 }, { int8: 2 }],
      offset: 100_000
    }))).toThrowError(expect.objectContaining({
      code: "DECODE_FAILED",
      stage: "lua-value"
    }));
  });

  it("enforces one cumulative node budget across nested collections", () => {
    const child = (): FixtureValue => ({
      array: Array.from({ length: 50_000 }, () => null),
      offset: 1
    });
    const oversized: FixtureValue = {
      array: [child(), child(), child(), child(), child()],
      offset: 1
    };
    expect(() => decodeLuaObject(luaObject(oversized))).toThrowError(
      expect.objectContaining({ code: "DECODE_FAILED", stage: "lua-value" })
    );
  });
});
