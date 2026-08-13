import { describe, expect, it } from "vitest";
import { luaObject, rawLz4Literal, scriptDataWrapper } from "./fixtures/encoded-values";
import { decodeScriptData, decodeSurfaceCandidates } from "./script-data-decoder";

describe("ScriptData wrapper decoding", () => {
  it("strictly decodes a literal-only raw LZ4 block after the verified 29-byte wrapper", () => {
    expect(decodeScriptData(scriptDataWrapper({ int8: 7 }))).toBe(7);
  });

  it("tries candidates in supplied longest-first order until a complete terrain root validates", () => {
    const terrain = scriptDataWrapper({
      entries: [
        ["bounds", { entries: [] }],
        ["seed", { int32: 1 }],
        ["uid", { array: [], offset: 1 }],
        ["xOffset", { array: [], offset: 1 }],
        ["yOffset", { array: [], offset: 1 }],
        ["rotation", { array: [], offset: 1 }],
        ["flags", { array: [], offset: 1 }]
      ]
    });
    expect(decodeSurfaceCandidates([
      new Uint8Array(terrain.length + 10),
      terrain
    ])).toMatchObject({ kind: "table" });
  });

  it("accepts the documented UUIDv5 BlobData UID variant", () => {
    const bytes = scriptDataWrapper(null);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    expect(decodeScriptData(bytes)).toBeNull();
  });

  it.each([
    [new Uint8Array(28), "truncated wrapper"],
    [scriptDataWrapper(null).subarray(0, -1), "truncated payload"],
    [(() => {
      const wrapper = scriptDataWrapper(null);
      new DataView(wrapper.buffer).setUint32(25, wrapper.length, false);
      return wrapper;
    })(), "mismatched compressed size"],
    [(() => {
      const compressed = rawLz4Literal(luaObject(null));
      const wrapper = new Uint8Array(30 + compressed.length);
      wrapper.set(scriptDataWrapper(null).subarray(0, 29));
      new DataView(wrapper.buffer).setUint32(25, compressed.length + 1, false);
      wrapper.set(compressed, 29);
      return wrapper;
    })(), "trailing payload"],
    [(() => {
      const wrapper = scriptDataWrapper(null);
      wrapper[29] = 0x00;
      return wrapper;
    })(), "invalid raw block"]
  ])("rejects %s", (bytes) => {
    expect(() => decodeScriptData(bytes)).toThrowError(
      expect.objectContaining({ code: expect.stringMatching(/DECOMPRESSION_FAILED|DECODE_FAILED/) })
    );
  });

  it.each([
    ["nil uid", (bytes: Uint8Array) => bytes.fill(0, 0, 16)],
    ["unsupported uid version", (bytes: Uint8Array) => { bytes[6] = (bytes[6]! & 0x0f) | 0x30; }],
    ["non-RFC uid variant", (bytes: Uint8Array) => { bytes[8] = bytes[8]! & 0x3f; }],
    ["wrong key size", (bytes: Uint8Array) => new DataView(bytes.buffer).setUint16(16, 3, false)],
    ["wrong world id", (bytes: Uint8Array) => new DataView(bytes.buffer).setUint16(22, 2, false)],
  ])("rejects wrapper corruption: %s", (_name, mutate) => {
    const bytes = scriptDataWrapper(null);
    mutate(bytes);
    expect(() => decodeScriptData(bytes)).toThrowError(
      expect.objectContaining({ code: "DECODE_FAILED", stage: "script-data" })
    );
  });

  it.each([
    ["extended literal length", new Uint8Array([0xf0, 0xff])],
    ["extended match length", new Uint8Array([0x1f, 0x41, 0x01, 0x00])],
    ["zero match offset", new Uint8Array([0x10, 0x41, 0x00, 0x00])],
    ["too-large match offset", new Uint8Array([0x10, 0x41, 0x02, 0x00])]
  ])("rejects truncated or invalid LZ4: %s", (_name, payload) => {
    const wrapper = scriptDataWrapper(null).slice(0, 29 + payload.length);
    new DataView(wrapper.buffer).setUint32(25, payload.length, false);
    wrapper.set(payload, 29);
    expect(() => decodeScriptData(wrapper)).toThrowError(
      expect.objectContaining({ code: "DECOMPRESSION_FAILED" })
    );
  });

  it("accepts exactly 1 MiB of validated LZ4 output but rejects one byte more", () => {
    function repeatedOutput(length: number): Uint8Array {
      const matchLength = length - 2;
      let extensionLength = matchLength - 19;
      const extensions: number[] = [];
      while (extensionLength >= 255) {
        extensions.push(255);
        extensionLength -= 255;
      }
      extensions.push(extensionLength);
      return new Uint8Array([
        0x1f, 0x41, 0x01, 0x00, ...extensions,
        0x10, 0x41
      ]);
    }
    function wrapper(payload: Uint8Array): Uint8Array {
      const value = new Uint8Array(29 + payload.length);
      value.set(scriptDataWrapper(null).subarray(0, 29));
      new DataView(value.buffer).setUint32(25, payload.length, false);
      value.set(payload, 29);
      return value;
    }

    expect(() => decodeScriptData(wrapper(repeatedOutput(1024 * 1024)))).toThrowError(
      expect.objectContaining({ code: "DECODE_FAILED" })
    );
    expect(() => decodeScriptData(wrapper(repeatedOutput(1024 * 1024 + 1)))).toThrowError(
      expect.objectContaining({ code: "DECOMPRESSION_FAILED" })
    );
  });
});
