import { describe, expect, it } from "vitest";

import { parseTileAssets } from "./tile-v15-assets";

function encodeLiteralBlock(payload: Uint8Array): Uint8Array {
  const bytes = [0xf0];
  let remaining = payload.length - 15;
  while (remaining >= 255) {
    bytes.push(255);
    remaining -= 255;
  }
  bytes.push(remaining, ...payload);
  return Uint8Array.from(bytes);
}

function uuidBytes(uuid: string): Uint8Array {
  return Uint8Array.from(uuid.replaceAll("-", "").match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

function assetRecord(x: number, uuid: string, materialName?: string, flag = ""): Uint8Array {
  const name = materialName ? new TextEncoder().encode(materialName) : new Uint8Array();
  const flagBytes = new TextEncoder().encode(flag);
  const record = new Uint8Array(40 + 16 + 1 + (materialName ? 1 + name.length + 4 : 0) + 1 + (flag ? 1 + flagBytes.length : 0));
  const view = new DataView(record.buffer);
  view.setFloat32(0, x, true);
  view.setFloat32(4, 2, true);
  view.setFloat32(8, 3, true);
  view.setFloat32(12, 0, true);
  view.setFloat32(16, 0, true);
  view.setFloat32(20, 0, true);
  view.setFloat32(24, 1, true);
  view.setFloat32(28, 1, true);
  view.setFloat32(32, 1, true);
  view.setFloat32(36, 1, true);
  record.set(uuidBytes(uuid), 40);
  let offset = 56;
  record[offset++] = materialName ? 1 : 0;
  if (materialName) {
    record[offset++] = name.length;
    record.set(name, offset);
    offset += name.length;
    record.set(Uint8Array.from([0x7f, 0x4b, 0x0f, 0xff]), offset);
    offset += 4;
  }
  record[offset++] = flag ? 1 : 0;
  if (flag) {
    record[offset++] = flagBytes.length;
    record.set(flagBytes, offset);
  }
  return record;
}

describe("parseTileAssets", () => {
  it("uses the version 15 trailing asset byte when advancing to the next record", () => {
    const firstUuid = "df1a36a3-6be0-4681-845e-d89d6c80d1a6";
    const secondUuid = "11111111-2222-3333-4444-555555555555";
    const first = assetRecord(10, firstUuid, "leaves");
    const second = assetRecord(20, secondUuid);
    const payload = Uint8Array.from([...first, ...second]);
    const compressed = encodeLiteralBlock(payload);
    const headerBytes = 60;
    const cellHeaderBytes = 388;
    const dataOffset = headerBytes + cellHeaderBytes;
    const tile = new Uint8Array(dataOffset + compressed.length);
    const view = new DataView(tile.buffer);
    tile.set(new TextEncoder().encode("TILE"), 0);
    view.setUint32(4, 15, true);
    view.setUint32(32, 1, true);
    view.setUint32(36, 1, true);
    view.setUint32(40, headerBytes, true);
    view.setUint32(44, cellHeaderBytes, true);
    view.setUint32(headerBytes + 0x54, 2, true);
    view.setUint32(headerBytes + 0x64, dataOffset, true);
    view.setUint32(headerBytes + 0x74, compressed.length, true);
    view.setUint32(headerBytes + 0x84, payload.length, true);
    tile.set(compressed, dataOffset);

    expect(parseTileAssets(tile)).toEqual([
      expect.objectContaining({
        cellX: 0,
        cellY: 0,
        listIndex: 0,
        position: [10, 2, 3],
        uuid: firstUuid,
        materialColors: { leaves: "7f4b0fff" },
        flags: 0,
        flag: ""
      }),
      expect.objectContaining({
        position: [20, 2, 3],
        uuid: secondUuid,
        materialColors: {},
        flags: 0,
        flag: ""
      })
    ]);
  });

  it("consumes the optional version 15 asset flag before the next record", () => {
    const firstUuid = "df1a36a3-6be0-4681-845e-d89d6c80d1a6";
    const secondUuid = "11111111-2222-3333-4444-555555555555";
    const payload = Uint8Array.from([
      ...assetRecord(10, firstUuid, undefined, "ts:show:raised"),
      ...assetRecord(20, secondUuid)
    ]);
    const compressed = encodeLiteralBlock(payload);
    const headerBytes = 60;
    const cellHeaderBytes = 388;
    const dataOffset = headerBytes + cellHeaderBytes;
    const tile = new Uint8Array(dataOffset + compressed.length);
    const view = new DataView(tile.buffer);
    tile.set(new TextEncoder().encode("TILE"), 0);
    view.setUint32(4, 15, true);
    view.setUint32(32, 1, true);
    view.setUint32(36, 1, true);
    view.setUint32(40, headerBytes, true);
    view.setUint32(44, cellHeaderBytes, true);
    view.setUint32(headerBytes + 0x54, 2, true);
    view.setUint32(headerBytes + 0x64, dataOffset, true);
    view.setUint32(headerBytes + 0x74, compressed.length, true);
    view.setUint32(headerBytes + 0x84, payload.length, true);
    tile.set(compressed, dataOffset);

    expect(parseTileAssets(tile)).toEqual([
      expect.objectContaining({ uuid: firstUuid, flag: "ts:show:raised" }),
      expect.objectContaining({ uuid: secondUuid, flag: "" })
    ]);
  });
});
