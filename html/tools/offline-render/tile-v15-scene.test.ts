import { describe, expect, it } from "vitest";

import { parseTileScene } from "./tile-v15-scene";

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

function makeTile(sectionOffset: number, record: Uint8Array, countOffset: number): Uint8Array {
  const headerBytes = 60;
  const cellHeaderBytes = 388;
  const compressed = encodeLiteralBlock(record);
  const dataOffset = headerBytes + cellHeaderBytes;
  const tile = new Uint8Array(dataOffset + compressed.length);
  const view = new DataView(tile.buffer);
  tile.set(new TextEncoder().encode("TILE"), 0);
  view.setUint32(4, 15, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, headerBytes, true);
  view.setUint32(44, cellHeaderBytes, true);
  view.setUint32(headerBytes + countOffset, 1, true);
  view.setUint32(headerBytes + sectionOffset, dataOffset, true);
  view.setUint32(headerBytes + sectionOffset + 4, compressed.length, true);
  view.setUint32(headerBytes + sectionOffset + 8, record.length, true);
  tile.set(compressed, dataOffset);
  return tile;
}

function makeHarvestableTile(record: Uint8Array, listIndex = 0): Uint8Array {
  const headerBytes = 60;
  const cellHeaderBytes = 388;
  const compressed = encodeLiteralBlock(record);
  const dataOffset = headerBytes + cellHeaderBytes;
  const tile = new Uint8Array(dataOffset + compressed.length);
  const view = new DataView(tile.buffer);
  tile.set(new TextEncoder().encode("TILE"), 0);
  view.setUint32(4, 15, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, headerBytes, true);
  view.setUint32(44, cellHeaderBytes, true);
  view.setUint32(headerBytes + 0xe4 + listIndex * 4, 1, true);
  view.setUint32(headerBytes + 0xf4 + listIndex * 4, dataOffset, true);
  view.setUint32(headerBytes + 0x104 + listIndex * 4, compressed.length, true);
  view.setUint32(headerBytes + 0x114 + listIndex * 4, record.length, true);
  tile.set(compressed, dataOffset);
  return tile;
}

function makeAssetTile(record: Uint8Array): Uint8Array {
  const headerBytes = 60;
  const cellHeaderBytes = 388;
  const compressed = encodeLiteralBlock(record);
  const dataOffset = headerBytes + cellHeaderBytes;
  const tile = new Uint8Array(dataOffset + compressed.length);
  const view = new DataView(tile.buffer);
  tile.set(new TextEncoder().encode("TILE"), 0);
  view.setUint32(4, 15, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, headerBytes, true);
  view.setUint32(44, cellHeaderBytes, true);
  view.setUint32(headerBytes + 0x54, 1, true);
  view.setUint32(headerBytes + 0x64, dataOffset, true);
  view.setUint32(headerBytes + 0x74, compressed.length, true);
  view.setUint32(headerBytes + 0x84, record.length, true);
  tile.set(compressed, dataOffset);
  return tile;
}

describe("parseTileScene", () => {
  it("includes asset instances in the scene", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const record = new Uint8Array(58);
    const view = new DataView(record.buffer);
    view.setFloat32(24, 1, true);
    view.setFloat32(28, 1, true);
    view.setFloat32(32, 1, true);
    view.setFloat32(36, 1, true);
    record.set(uuidBytes(uuid), 40);
    record[56] = 0;
    record[57] = 0;

    expect(parseTileScene(makeAssetTile(record)).assets).toEqual([
      expect.objectContaining({ uuid, position: [0, 0, 0], flags: 0 })
    ]);
  });

  it("parses a version 15 harvestable instance", () => {
    const uuid = "df1a36a3-6be0-4681-845e-d89d6c80d1a6";
    const record = new Uint8Array(65);
    const view = new DataView(record.buffer);
    view.setFloat32(0, 12, true);
    view.setFloat32(4, 34, true);
    view.setFloat32(8, 5, true);
    view.setFloat32(24, 1, true);
    view.setFloat32(28, 2, true);
    view.setFloat32(32, 3, true);
    view.setFloat32(36, 4, true);
    record.set(uuidBytes(uuid), 40);
    record.set([0x11, 0x22, 0x33, 0xff], 56);
    record[60] = 0x2a;
    view.setUint32(61, 0x12345678, true);
    const tile = makeHarvestableTile(record, 2);

    expect(parseTileScene(tile).harvestables).toEqual([
      {
        cellX: 0,
        cellY: 0,
        listIndex: 2,
        position: [12, 34, 5],
        rotation: [0, 0, 0, 1],
        size: [2, 3, 4],
        uuid,
        color: "112233ff",
        flags: 0x2a,
        extra: 0x12345678
      }
    ]);
  });

  it("parses a version 15 prefab reference", () => {
    const path = "$SURVIVAL_DATA/Prefabs/poi/example.prefab";
    const flag = "GAME";
    const pathBytes = new TextEncoder().encode(path);
    const flagBytes = new TextEncoder().encode(flag);
    const record = new Uint8Array(40 + 4 + pathBytes.length + 1 + 1 + flagBytes.length + 4);
    const view = new DataView(record.buffer);
    view.setFloat32(0, -7, true);
    view.setFloat32(4, 8, true);
    view.setFloat32(8, 9, true);
    view.setFloat32(24, 1, true);
    view.setFloat32(28, 1.5, true);
    view.setFloat32(32, 2.5, true);
    view.setFloat32(36, 3.5, true);
    let offset = 40;
    view.setUint32(offset, pathBytes.length, true);
    offset += 4;
    record.set(pathBytes, offset);
    offset += pathBytes.length;
    record[offset++] = 1;
    record[offset++] = flagBytes.length;
    record.set(flagBytes, offset);
    const tile = makeTile(0xc8, record, 0xc4);

    expect(parseTileScene(tile).prefabs).toEqual([
      {
        cellX: 0,
        cellY: 0,
        position: [-7, 8, 9],
        rotation: [0, 0, 0, 1],
        size: [1.5, 2.5, 3.5],
        path,
        flag
      }
    ]);
  });
});
