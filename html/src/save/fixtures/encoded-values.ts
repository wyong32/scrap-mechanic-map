class BitWriter {
  private readonly bits: number[] = [];

  write(value: number, count: number): void {
    for (let bit = count - 1; bit >= 0; bit -= 1) {
      this.bits.push((value >>> bit) & 1);
    }
  }

  writeUint32(value: number): void {
    this.write((value >>> 16) & 0xffff, 16);
    this.write(value & 0xffff, 16);
  }

  align(): void {
    while (this.bits.length % 8 !== 0) this.bits.push(0);
  }

  bytes(): Uint8Array {
    this.align();
    const output = new Uint8Array(this.bits.length / 8);
    this.bits.forEach((bit, index) => {
      output[index >>> 3] |= bit << (7 - (index & 7));
    });
    return output;
  }
}

export type FixtureValue =
  | null | boolean | number | string
  | { int8: number } | { int16: number } | { int32: number } | { double: number }
  | { uuidBytes: number[] }
  | { vec3: [number, number, number] }
  | { array: FixtureValue[]; offset: number }
  | { entries: Array<[FixtureValue, FixtureValue]> };

function floatBytes(value: number, bits: 32 | 64): Uint8Array {
  const output = new Uint8Array(bits / 8);
  const view = new DataView(output.buffer);
  if (bits === 32) view.setFloat32(0, value, false);
  else view.setFloat64(0, value, false);
  return output;
}

function writeValue(writer: BitWriter, value: FixtureValue): void {
  if (value === null) {
    writer.write(1, 8);
  } else if (typeof value === "boolean") {
    writer.write(2, 8);
    writer.write(value ? 1 : 0, 1);
  } else if (typeof value === "number") {
    writer.write(3, 8);
    for (const byte of floatBytes(value, 32)) writer.write(byte, 8);
  } else if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    writer.write(4, 8);
    writer.writeUint32(bytes.length);
    writer.align();
    for (const byte of bytes) writer.write(byte, 8);
  } else if ("int8" in value) {
    writer.write(8, 8);
    writer.write(value.int8 & 0xff, 8);
  } else if ("int16" in value) {
    writer.write(7, 8);
    writer.write(value.int16 & 0xffff, 16);
  } else if ("int32" in value) {
    writer.write(6, 8);
    writer.writeUint32(value.int32 >>> 0);
  } else if ("double" in value) {
    writer.write(11, 8);
    for (const byte of floatBytes(value.double, 64)) writer.write(byte, 8);
  } else if ("uuidBytes" in value) {
    writer.write(100, 8);
    writer.writeUint32(10001);
    for (const byte of value.uuidBytes) writer.write(byte, 8);
  } else if ("vec3" in value) {
    writer.write(100, 8);
    writer.writeUint32(10003);
    for (const component of value.vec3) {
      for (const byte of floatBytes(component, 32)) writer.write(byte, 8);
    }
  } else if ("array" in value) {
    writer.write(5, 8);
    writer.writeUint32(value.array.length);
    writer.write(1, 1);
    writer.writeUint32(value.offset >>> 0);
    value.array.forEach((entry) => writeValue(writer, entry));
  } else {
    writer.write(5, 8);
    writer.writeUint32(value.entries.length);
    writer.write(0, 1);
    value.entries.forEach(([key, entry]) => {
      writeValue(writer, key);
      writeValue(writer, entry);
    });
  }
}

export function luaObject(value: FixtureValue): Uint8Array {
  const writer = new BitWriter();
  writeValue(writer, value);
  return new Uint8Array([0x4c, 0x55, 0x41, 0, 0, 0, 1, ...writer.bytes()]);
}

export function rawLz4Literal(input: Uint8Array): Uint8Array {
  const extension: number[] = [];
  let length = input.length;
  const tokenLength = Math.min(15, length);
  if (length >= 15) {
    length -= 15;
    while (length >= 255) {
      extension.push(255);
      length -= 255;
    }
    extension.push(length);
  }
  return new Uint8Array([(tokenLength << 4), ...extension, ...input]);
}

export function scriptDataWrapper(value: FixtureValue): Uint8Array {
  const compressed = rawLz4Literal(luaObject(value));
  const output = new Uint8Array(29 + compressed.length);
  output.set([
    0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x4d, 0xef,
    0x80, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde
  ]);
  new DataView(output.buffer).setUint16(16, 4, false);
  // ScriptData's 4-byte key is UID-dependent and opaque; it is not the world ID.
  new DataView(output.buffer).setUint32(18, 0x78563412, true);
  new DataView(output.buffer).setUint16(22, 1, false);
  // BlobData flags are an opaque u8; the observed terrain record uses 2.
  output[24] = 2;
  new DataView(output.buffer).setUint32(25, compressed.length, false);
  output.set(compressed, 29);
  return output;
}
