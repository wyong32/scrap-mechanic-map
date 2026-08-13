import { BinaryReader } from "./binary-reader";
import { SaveParseError } from "./save-errors";
import type { LuaValue } from "./save-protocol";

const MAX_DEPTH = 256;
const MAX_TABLE_ENTRIES = 2_000_000;
const MAX_STRING_BYTES = 1024 * 1024;
const MAX_DECODE_NODES = 250_000;
const MAX_ARRAY_INDEX = 100_000;

interface DecodeBudget {
  nodes: number;
}

function decodeError(reader: BinaryReader, message: string, offset = reader.offset): never {
  throw new SaveParseError("DECODE_FAILED", {
    stage: "lua-value",
    offset,
    message
  });
}

function decodeUtf8(reader: BinaryReader): string {
  const length = reader.readUint32BitsBE();
  reader.alignBitsToByte();
  const offset = reader.offset;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      reader.readBitBytes(length, MAX_STRING_BYTES)
    );
  } catch (error) {
    if (error instanceof SaveParseError) throw error;
    return decodeError(reader, "Lua string contains invalid UTF-8.", offset);
  }
}

function decodeUuid(reader: BinaryReader): LuaValue {
  const hex = [...reader.readBitBytes(16)]
    .reverse()
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    kind: "uuid",
    value: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  };
}

function decodeTable(
  reader: BinaryReader,
  references: LuaValue[],
  depth: number,
  budget: DecodeBudget
): LuaValue {
  const count = reader.readUint32BitsBE();
  if (count > MAX_TABLE_ENTRIES) decodeError(reader, `Lua table count ${count} exceeds the safety limit.`);
  const isArray = reader.readBits(1) === 1;
  const minimumChildNodes = isArray ? count : count * 2;
  if (minimumChildNodes > MAX_DECODE_NODES - budget.nodes) {
    decodeError(reader, "Lua object exceeds the cumulative node safety limit.");
  }
  if (!isArray) {
    const table: LuaValue = { kind: "table", entries: [] };
    references.push(table);
    for (let index = 0; index < count; index += 1) {
      table.entries.push([
        decodeLuaValue(reader, references, depth + 1, budget),
        decodeLuaValue(reader, references, depth + 1, budget)
      ]);
    }
    return table;
  }

  const offset = reader.readSignedBits(32);
  const lastIndex = count === 0 ? offset : offset + count - 1;
  if (
    offset < -MAX_ARRAY_INDEX
    || offset > MAX_ARRAY_INDEX
    || lastIndex < -MAX_ARRAY_INDEX
    || lastIndex > MAX_ARRAY_INDEX
  ) {
    decodeError(reader, "Lua array range exceeds the safe collection index limit.");
  }
  const array: LuaValue = { kind: "array", values: [], negativeValues: {} };
  references.push(array);
  for (let index = 0; index < count; index += 1) {
    const arrayIndex = offset + index;
    const value = decodeLuaValue(reader, references, depth + 1, budget);
    if (arrayIndex < 1) array.negativeValues[arrayIndex] = value;
    else array.values[arrayIndex - 1] = value;
  }
  return array;
}

export function decodeLuaValue(
  reader: BinaryReader,
  references: LuaValue[] = [],
  depth = 0,
  budget: DecodeBudget = { nodes: 0 }
): LuaValue {
  if (depth > MAX_DEPTH) decodeError(reader, "Lua value nesting exceeds the safety limit.");
  if (budget.nodes >= MAX_DECODE_NODES) {
    decodeError(reader, "Lua object exceeds the cumulative node safety limit.");
  }
  budget.nodes += 1;
  const tagOffset = reader.offset;
  const tag = reader.readBits(8);
  switch (tag) {
    case 1: return null;
    case 2: return reader.readBits(1) === 1;
    case 3: return reader.readFloat32BitsBE();
    case 4: return decodeUtf8(reader);
    case 5: return decodeTable(reader, references, depth, budget);
    case 6: return reader.readSignedBits(32);
    case 7: return reader.readSignedBits(16);
    case 8: return reader.readSignedBits(8);
    case 11: return reader.readFloat64BitsBE();
    case 100: {
      const userdataType = reader.readUint32BitsBE();
      if (userdataType === 10001) return decodeUuid(reader);
      if (userdataType === 10003) {
        return {
          kind: "vec3",
          x: reader.readFloat32BitsBE(),
          y: reader.readFloat32BitsBE(),
          z: reader.readFloat32BitsBE()
        };
      }
      return decodeError(reader, `Unsupported userdata type ${userdataType}.`, tagOffset);
    }
    case 101:
      return decodeError(
        reader,
        "WeakScriptRef cannot be resolved outside the game Lua VM.",
        tagOffset
      );
    default:
      return decodeError(reader, `Unknown value tag 0x${tag.toString(16)}.`, tagOffset);
  }
}

export function decodeLuaObject(bytes: Uint8Array): LuaValue {
  const header = new BinaryReader(bytes, "lua-value");
  const magic = header.readBytes(3);
  if (magic[0] !== 0x4c || magic[1] !== 0x55 || magic[2] !== 0x41) {
    decodeError(header, "Lua object magic is invalid.", 0);
  }
  if (header.readUint32BE() !== 1) decodeError(header, "Lua object version is unsupported.", 3);

  const reader = new BinaryReader(bytes.subarray(7), "lua-value");
  const value = decodeLuaValue(reader, []);
  reader.alignBitsToByte();
  if (reader.bitOffset !== reader.bytes.byteLength * 8) {
    decodeError(reader, "Lua object contains trailing non-alignment data.");
  }
  return value;
}
