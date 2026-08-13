import { describe, expect, it, vi } from "vitest";
import {
  detectBrowserCapabilities,
  MAX_SAVE_FILE_BYTES,
  readAndValidateSaveFile,
  validateSaveFileEnvironment,
  validateSaveFileMetadata,
  validateSqliteHeader,
  type BrowserCapabilities
} from "./validate-save-file";
import { SaveParseError } from "./save-errors";

const supportedBrowser: BrowserCapabilities = {
  worker: true,
  webAssembly: true,
  canvas: true
};

function sqliteHeader(): Uint8Array {
  return new TextEncoder().encode("SQLite format 3\0");
}

function memoryFile(bytes: Uint8Array, name: string): File {
  return {
    size: bytes.byteLength,
    name,
    slice(start: number, end?: number) {
      const copy = bytes.slice(start, end);
      return { arrayBuffer: async () => copy.buffer } as Blob;
    }
  } as unknown as File;
}

describe("save file validation", () => {
  it("rejects an empty file from metadata without reading bytes", () => {
    const empty = { size: 0, name: "empty.db" } as File;

    expect(() => validateSaveFileMetadata(empty, supportedBrowser)).toThrowError(
      expect.objectContaining<Partial<SaveParseError>>({ code: "EMPTY_FILE" })
    );
  });

  it("rejects a 256 MB plus one byte file from metadata without allocating it", () => {
    const tooLarge = {
      size: MAX_SAVE_FILE_BYTES + 1,
      name: "too-large.db",
      slice: () => {
        throw new Error("must not read a rejected file");
      }
    } as unknown as File;

    expect(() => validateSaveFileMetadata(tooLarge, supportedBrowser)).toThrowError(
      expect.objectContaining<Partial<SaveParseError>>({ code: "FILE_TOO_LARGE" })
    );
  });

  it("rejects headers that are not the exact SQLite magic", () => {
    expect(() => validateSqliteHeader(new Uint8Array(16))).toThrowError(
      expect.objectContaining<Partial<SaveParseError>>({ code: "NOT_SQLITE" })
    );
    expect(() => validateSqliteHeader(new TextEncoder().encode("SQLite format 3x"))).toThrowError(
      expect.objectContaining<Partial<SaveParseError>>({ code: "NOT_SQLITE" })
    );
  });

  it("accepts the exact SQLite format 3 null-terminated magic", () => {
    expect(() => validateSqliteHeader(sqliteHeader())).not.toThrow();
  });

  it("reads only the first sixteen bytes before rejecting an invalid header", async () => {
    const slices: Array<[number, number | undefined]> = [];
    const file = {
      size: 64,
      name: "not-a-save.db",
      slice(start: number, end?: number) {
        slices.push([start, end]);
        const bytes = new Uint8Array(16);
        return { arrayBuffer: async () => bytes.buffer } as Blob;
      }
    } as unknown as File;

    await expect(readAndValidateSaveFile(file, supportedBrowser)).rejects.toMatchObject({
      code: "NOT_SQLITE"
    });
    expect(slices).toEqual([[0, 16]]);
  });

  it("reads the whole file only after its header passes validation", async () => {
    const bytes = new Uint8Array(32);
    bytes.set(sqliteHeader());
    const slices: Array<[number, number | undefined]> = [];
    const file = {
      size: bytes.byteLength,
      name: "valid.db",
      slice(start: number, end?: number) {
        slices.push([start, end]);
        const copy = bytes.slice(start, end);
        return { arrayBuffer: async () => copy.buffer } as Blob;
      }
    } as unknown as File;

    await expect(readAndValidateSaveFile(file, supportedBrowser)).resolves.toEqual(bytes);
    expect(slices).toEqual([[0, 16], [0, bytes.byteLength]]);
  });

  it("captures the validated file size once for both the full read and recheck", async () => {
    const bytes = new Uint8Array(32);
    bytes.set(sqliteHeader());
    let sizeReads = 0;
    const file = {
      get size() {
        sizeReads += 1;
        return bytes.byteLength;
      },
      name: "stable-size.db",
      slice(start: number, end?: number) {
        const copy = bytes.slice(start, end);
        return { arrayBuffer: async () => copy.buffer } as Blob;
      }
    } as unknown as File;

    await expect(readAndValidateSaveFile(file, supportedBrowser)).resolves.toEqual(bytes);
    expect(sizeReads).toBe(1);
  });

  it("rejects a full read whose byte length differs from the validated size", async () => {
    const bytes = new Uint8Array(32);
    bytes.set(sqliteHeader());
    const file = {
      size: bytes.byteLength,
      name: "short-full-read.db",
      slice(start: number, end?: number) {
        const copy =
          start === 0 && end === 16
            ? bytes.slice(0, 16)
            : bytes.slice(0, bytes.byteLength - 1);
        return { arrayBuffer: async () => copy.buffer } as Blob;
      }
    } as unknown as File;

    await expect(readAndValidateSaveFile(file, supportedBrowser)).rejects.toMatchObject({
      code: "NOT_SQLITE"
    });
  });

  it("rechecks the SQLite header in the complete read", async () => {
    const bytes = new Uint8Array(32);
    bytes.set(sqliteHeader());
    const changed = bytes.slice();
    changed[0] = 0;
    const file = {
      size: bytes.byteLength,
      name: "changed-full-read.db",
      slice(start: number, end?: number) {
        const copy =
          start === 0 && end === 16 ? bytes.slice(0, 16) : changed.slice(start, end);
        return { arrayBuffer: async () => copy.buffer } as Blob;
      }
    } as unknown as File;

    await expect(readAndValidateSaveFile(file, supportedBrowser)).rejects.toMatchObject({
      code: "NOT_SQLITE"
    });
  });

  it("requires an actual non-null Canvas 2D context", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);

    expect(detectBrowserCapabilities().canvas).toBe(false);
    expect(getContext).toHaveBeenCalledWith("2d");
    getContext.mockRestore();
  });

  it("treats Canvas context creation failures as unsupported", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => {
        throw new Error("Canvas disabled");
      });

    expect(detectBrowserCapabilities().canvas).toBe(false);
    getContext.mockRestore();
  });

  it.each<keyof BrowserCapabilities>(["worker", "webAssembly", "canvas"])(
    "rejects a browser without %s support",
    (missingCapability) => {
      const browser = { ...supportedBrowser, [missingCapability]: false };
      expect(() => validateSaveFileEnvironment(browser)).toThrowError(
        expect.objectContaining<Partial<SaveParseError>>({ code: "UNSUPPORTED_BROWSER" })
      );
    }
  );
});
