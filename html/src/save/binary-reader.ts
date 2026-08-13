import { SaveParseError } from "./save-errors";

export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly stage: string;
  private readonly view: DataView;
  private byteOffset = 0;
  private currentBitOffset = 0;

  constructor(bytes: Uint8Array, stage = "binary-reader") {
    this.bytes = bytes;
    this.stage = stage;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.byteOffset + Math.floor(this.currentBitOffset / 8);
  }

  get bitOffset(): number {
    return this.byteOffset * 8 + this.currentBitOffset;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  get remainingBits(): number {
    return this.bytes.byteLength * 8 - this.bitOffset;
  }

  private fail(message: string, offset = this.offset): never {
    throw new SaveParseError("DECODE_FAILED", {
      stage: this.stage,
      offset,
      message
    });
  }

  private ensureByteAligned(): void {
    if (this.currentBitOffset !== 0) this.fail("Byte read attempted from an unaligned bit offset.");
  }

  private ensure(length: number): void {
    this.ensureByteAligned();
    if (!Number.isInteger(length) || length < 0 || this.byteOffset + length > this.bytes.byteLength) {
      this.fail(`Read of ${length} bytes exceeds the available data.`);
    }
  }

  readUint8(): number {
    this.ensure(1);
    return this.bytes[this.byteOffset++]!;
  }

  readInt8(): number {
    const value = this.readUint8();
    return value >= 0x80 ? value - 0x100 : value;
  }

  readUint16LE(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.byteOffset, true);
    this.byteOffset += 2;
    return value;
  }

  readInt16LE(): number {
    this.ensure(2);
    const value = this.view.getInt16(this.byteOffset, true);
    this.byteOffset += 2;
    return value;
  }

  readUint32LE(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.byteOffset, true);
    this.byteOffset += 4;
    return value;
  }

  readInt32LE(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.byteOffset, true);
    this.byteOffset += 4;
    return value;
  }

  readFloat64LE(): number {
    this.ensure(8);
    const value = this.view.getFloat64(this.byteOffset, true);
    this.byteOffset += 8;
    return value;
  }

  readUint32BE(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.byteOffset, false);
    this.byteOffset += 4;
    return value;
  }

  readFloat32BE(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.byteOffset, false);
    this.byteOffset += 4;
    return value;
  }

  readBytes(length: number): Uint8Array {
    this.ensure(length);
    const value = this.bytes.slice(this.byteOffset, this.byteOffset + length);
    this.byteOffset += length;
    return value;
  }

  readUtf8StringLE(): string {
    const length = this.readUint32LE();
    const start = this.offset;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.readBytes(length));
    } catch (error) {
      if (error instanceof SaveParseError) throw error;
      this.fail("String contains invalid UTF-8.", start);
    }
  }

  readBits(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      this.fail(`Invalid bit count ${count}.`);
    }
    const start = this.bitOffset;
    if (start + count > this.bytes.byteLength * 8) {
      this.fail(`Read of ${count} bits exceeds the available data.`, Math.floor(start / 8));
    }
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const absolute = start + index;
      value = value * 2
        + ((this.bytes[absolute >>> 3]! >>> (7 - (absolute & 7))) & 1);
    }
    this.currentBitOffset += count;
    return value;
  }

  readSignedBits(count: number): number {
    const value = this.readBits(count);
    const sign = 2 ** (count - 1);
    return value >= sign ? value - 2 ** count : value;
  }

  readUint32BitsBE(): number {
    return this.readBits(16) * 0x10000 + this.readBits(16);
  }

  readFloat32BitsBE(): number {
    const value = new Uint8Array(4);
    for (let index = 0; index < 4; index += 1) value[index] = this.readBits(8);
    return new DataView(value.buffer).getFloat32(0, false);
  }

  readFloat64BitsBE(): number {
    const value = new Uint8Array(8);
    for (let index = 0; index < 8; index += 1) value[index] = this.readBits(8);
    return new DataView(value.buffer).getFloat64(0, false);
  }

  alignBitsToByte(requireZero = true): void {
    const remainder = this.currentBitOffset & 7;
    if (remainder === 0) return;
    const padding = this.readBits(8 - remainder);
    if (requireZero && padding !== 0) this.fail("Non-zero alignment padding.");
  }

  readBitBytes(length: number, maxLength = Number.MAX_SAFE_INTEGER): Uint8Array {
    if (!Number.isInteger(length) || length < 0) this.fail(`Invalid byte length ${length}.`);
    if (!Number.isInteger(maxLength) || maxLength < 0 || length > maxLength) {
      this.fail(`Byte length ${length} exceeds the safety limit.`);
    }
    if (length > Math.floor(this.remainingBits / 8)) {
      this.fail(`Read of ${length} bytes exceeds the available data.`);
    }
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) output[index] = this.readBits(8);
    return output;
  }
}
