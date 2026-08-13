import lz4 from "lz4js";
import { SaveParseError } from "./save-errors";
import { decodeLuaObject } from "./lua-value-decoder";
import type { LuaValue } from "./save-protocol";

const PREFIX_BYTES = 29;
const UID_OFFSET = 0;
const UID_BYTES = 16;
const KEY_SIZE_OFFSET = 16;
const WORLD_ID_OFFSET = 22;
const COMPRESSED_SIZE_OFFSET = 25;
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024;
const TERRAIN_KEY_BYTES = 4;
const TERRAIN_WORLD_ID = 1;

function wrapperError(message: string, offset?: number): never {
  throw new SaveParseError("DECODE_FAILED", {
    stage: "script-data",
    offset,
    message
  });
}

function decompressionError(message: string, offset?: number): never {
  throw new SaveParseError("DECOMPRESSION_FAILED", {
    stage: "script-data",
    offset,
    message
  });
}

function validateRawLz4(bytes: Uint8Array): number {
  let source = 0;
  let target = 0;
  while (source < bytes.length) {
    const tokenOffset = source;
    const token = bytes[source++]!;
    let literals = token >>> 4;
    if (literals === 15) {
      let extension: number;
      do {
        if (source >= bytes.length) decompressionError("Truncated LZ4 literal length.", tokenOffset);
        extension = bytes[source++]!;
        literals += extension;
      } while (extension === 255);
    }
    if (source + literals > bytes.length) decompressionError("LZ4 literal overruns its payload.", source);
    if (target + literals > MAX_UNCOMPRESSED_BYTES) decompressionError("Terrain data exceeds the 1 MiB limit.", source);
    source += literals;
    target += literals;
    if (source === bytes.length) return target;

    if (source + 2 > bytes.length) decompressionError("Truncated LZ4 match offset.", source);
    const matchOffset = bytes[source]! | (bytes[source + 1]! << 8);
    source += 2;
    if (matchOffset === 0 || matchOffset > target) {
      decompressionError("Invalid LZ4 match offset.", source - 2);
    }
    let matchLength = token & 15;
    if (matchLength === 15) {
      let extension: number;
      do {
        if (source >= bytes.length) decompressionError("Truncated LZ4 match length.", source);
        extension = bytes[source++]!;
        matchLength += extension;
      } while (extension === 255);
    }
    matchLength += 4;
    if (target + matchLength > MAX_UNCOMPRESSED_BYTES) {
      decompressionError("Terrain data exceeds the 1 MiB limit.", source);
    }
    target += matchLength;
  }
  return decompressionError("Empty LZ4 payload.");
}

function decompressStrict(payload: Uint8Array): Uint8Array {
  const expectedLength = validateRawLz4(payload);
  const output = new Uint8Array(MAX_UNCOMPRESSED_BYTES);
  let written: number;
  try {
    written = lz4.decompressBlock(payload, output, 0, payload.length, 0);
  } catch {
    return decompressionError("Unable to decompress the terrain LZ4 block.");
  }
  if (written !== expectedLength) {
    return decompressionError("LZ4 output length does not match the validated block.");
  }
  return output.slice(0, written);
}

export function decodeScriptData(blob: Uint8Array): LuaValue {
  if (blob.byteLength < PREFIX_BYTES) {
    return wrapperError("ScriptData wrapper is truncated.", blob.byteLength);
  }
  const view = new DataView(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength
  );
  let uidIsNonZero = false;
  for (let index = UID_OFFSET; index < UID_OFFSET + UID_BYTES; index += 1) {
    if (blob[index] !== 0) {
      uidIsNonZero = true;
      break;
    }
  }
  if (!uidIsNonZero) wrapperError("ScriptData UID must not be nil.", UID_OFFSET);
  const uidVersion = blob[6]! >>> 4;
  if (uidVersion !== 4 && uidVersion !== 5) {
    wrapperError(`ScriptData UID has unsupported UUID version ${uidVersion}.`, 6);
  }
  if ((blob[8]! & 0xc0) !== 0x80) {
    wrapperError("ScriptData UID has an invalid RFC 4122 variant.", 8);
  }
  const keySize = view.getUint16(KEY_SIZE_OFFSET, false);
  if (keySize !== TERRAIN_KEY_BYTES) {
    wrapperError(`Unsupported ScriptData key size ${keySize}.`, KEY_SIZE_OFFSET);
  }
  const worldId = view.getUint16(WORLD_ID_OFFSET, false);
  if (worldId !== TERRAIN_WORLD_ID) {
    wrapperError(`Unexpected ScriptData world ID ${worldId}.`, WORLD_ID_OFFSET);
  }
  const compressedSize = view.getUint32(COMPRESSED_SIZE_OFFSET, false);
  if (compressedSize !== blob.byteLength - PREFIX_BYTES) {
    return decompressionError("ScriptData compressed size does not match its payload.", COMPRESSED_SIZE_OFFSET);
  }
  return decodeLuaObject(decompressStrict(blob.subarray(PREFIX_BYTES)));
}

const TERRAIN_KEYS = new Set(["bounds", "seed", "uid", "xOffset", "yOffset", "rotation", "flags"]);

function isTerrainRoot(value: LuaValue): boolean {
  if (!value || typeof value !== "object" || value.kind !== "table") return false;
  const keys = new Set(
    value.entries
      .map(([key]) => key)
      .filter((key): key is string => typeof key === "string")
  );
  return [...TERRAIN_KEYS].every((key) => keys.has(key));
}

export function decodeSurfaceCandidates(candidates: Uint8Array[]): LuaValue {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const value = decodeScriptData(candidate);
      if (isTerrainRoot(value)) return value;
      lastError = new SaveParseError("DECODE_FAILED", {
        stage: "script-data",
        message: "Decoded ScriptData is not a terrain root."
      });
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof SaveParseError) throw lastError;
  throw new SaveParseError("MISSING_SURFACE_DATA", {
    stage: "script-data",
    message: "No complete surface terrain candidate was found."
  });
}
