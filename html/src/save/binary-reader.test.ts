import { describe, expect, it } from "vitest";
import { BinaryReader } from "./binary-reader";
import { SaveParseError } from "./save-errors";

describe("BinaryReader", () => {
  it("reads little-endian signed and unsigned primitives and advances exactly", () => {
    const reader = new BinaryReader(new Uint8Array([
      0xfe, 0xff,
      0x78, 0x56, 0x34, 0x12,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f
    ]), "reader-test");

    expect(reader.readInt16LE()).toBe(-2);
    expect(reader.offset).toBe(2);
    expect(reader.readUint32LE()).toBe(0x12345678);
    expect(reader.offset).toBe(6);
    expect(reader.readFloat64LE()).toBe(1);
    expect(reader.offset).toBe(14);
  });

  it("reads big-endian values needed by the verified Lua format", () => {
    const reader = new BinaryReader(new Uint8Array([
      0x12, 0x34, 0x56, 0x78,
      0xbf, 0xc0, 0x00, 0x00
    ]), "reader-test");

    expect(reader.readUint32BE()).toBe(0x12345678);
    expect(reader.readFloat32BE()).toBe(-1.5);
  });

  it("reads raw bytes and a little-endian UTF-8 length-prefixed string", () => {
    const reader = new BinaryReader(new Uint8Array([
      2, 0, 0, 0, 0xc3, 0xa9, 9, 8
    ]), "reader-test");

    expect(reader.readUtf8StringLE()).toBe("é");
    expect([...reader.readBytes(2)]).toEqual([9, 8]);
    expect(reader.offset).toBe(8);
  });

  it("does not advance after a bounds failure and reports stage and byte offset", () => {
    const reader = new BinaryReader(new Uint8Array([1, 2, 3]), "reader-test");
    reader.readUint8();

    expect(() => reader.readUint32LE()).toThrowError(SaveParseError);
    expect(reader.offset).toBe(1);
    try {
      reader.readUint32LE();
    } catch (error) {
      expect(error).toMatchObject({
        code: "DECODE_FAILED",
        stage: "reader-test",
        offset: 1
      });
    }
  });

  it("checks huge and remaining+1 bit-byte reads before allocation", () => {
    const huge = new BinaryReader(new Uint8Array([1]), "reader-test");
    expect(() => huge.readBitBytes(0xffff_ffff)).toThrowError(
      expect.objectContaining({ code: "DECODE_FAILED", offset: 0 })
    );
    expect(huge.bitOffset).toBe(0);

    const over = new BinaryReader(new Uint8Array([1, 2]), "reader-test");
    expect(() => over.readBitBytes(3)).toThrowError(
      expect.objectContaining({ code: "DECODE_FAILED", offset: 0 })
    );
    expect(over.bitOffset).toBe(0);
  });

  it("accepts a bit-byte read exactly at the remaining boundary", () => {
    const reader = new BinaryReader(new Uint8Array([1, 2, 3]), "reader-test");
    expect([...reader.readBitBytes(3)]).toEqual([1, 2, 3]);
    expect(reader.bitOffset).toBe(24);
  });
});
