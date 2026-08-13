import { describe, expect, it } from "vitest";

import { parseTerrainTile } from "./tile-v15-reader";

const TILE_HEADER_BYTES = 60;
const V15_CELL_HEADER_BYTES = 388;
const MIP_BYTES = (33 * 33 * 8) + (65 * 65 * 8);

function encodeLiteralBlock(payload: Uint8Array): Uint8Array {
  const lengthBytes: number[] = [];
  let remaining = payload.length - 15;
  while (remaining >= 255) {
    lengthBytes.push(255);
    remaining -= 255;
  }
  lengthBytes.push(remaining);

  return Uint8Array.from([0xf0, ...lengthBytes, ...payload]);
}

function buildVersion15Tile(): Uint8Array {
  const mip = new Uint8Array(MIP_BYTES);
  const mipView = new DataView(mip.buffer);
  mipView.setFloat32(0, 12.5, true);
  mipView.setUint32(4, 0x11223344, true);
  mipView.setBigUint64(33 * 33 * 8, 0x0102030405060708n, true);

  const compressed = encodeLiteralBlock(mip);
  const mipOffset = TILE_HEADER_BYTES + V15_CELL_HEADER_BYTES;
  const tile = new Uint8Array(mipOffset + compressed.length);
  const view = new DataView(tile.buffer);
  tile.set(new TextEncoder().encode("TILE"), 0);
  view.setUint32(4, 15, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, TILE_HEADER_BYTES, true);
  view.setUint32(44, V15_CELL_HEADER_BYTES, true);
  view.setUint32(56, 0, true);

  view.setUint32(TILE_HEADER_BYTES, mipOffset, true);
  view.setUint32(TILE_HEADER_BYTES + 0x18, compressed.length, true);
  view.setUint32(TILE_HEADER_BYTES + 0x30, mip.length, true);
  tile.set(compressed, mipOffset);
  return tile;
}

describe("parseTerrainTile", () => {
  it("reads the retained terrain MIP fields from a version 15 cell header", () => {
    const terrain = parseTerrainTile(buildVersion15Tile());

    expect(terrain).toMatchObject({
      version: 15,
      widthInCells: 1,
      heightInCells: 1,
      cellHeaderBytes: V15_CELL_HEADER_BYTES
    });
    expect(terrain.vertexHeights).toHaveLength(33 * 33);
    expect(terrain.vertexColors).toHaveLength(33 * 33);
    expect(terrain.groundMaterials).toHaveLength(65 * 65);
    expect(terrain.vertexHeights[0]).toBe(12.5);
    expect(terrain.vertexColors[0]).toBe(0x11223344);
    expect(terrain.groundMaterials[0]).toBe(0x0102030405060708n);
  });
});
