import lz4 from "lz4js";

import { parseTileAssets, type TileAssetInstance } from "./tile-v15-assets";

export interface TileHarvestableInstance {
  cellX: number;
  cellY: number;
  listIndex: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  size: [number, number, number];
  uuid: string;
  color: string;
  flags: number;
  extra: number;
}

export interface TileScene {
  assets: TileAssetInstance[];
  harvestables: TileHarvestableInstance[];
  prefabs: TilePrefabInstance[];
}

export interface TilePrefabInstance {
  cellX: number;
  cellY: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  size: [number, number, number];
  path: string;
  flag: string;
}

function requireBytes(offset: number, length: number, available: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > available) {
    throw new Error(`${label} is truncated.`);
  }
}

function uuidAt(bytes: Uint8Array, offset: number): string {
  const hex = Array.from(bytes.subarray(offset, offset + 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hexAt(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.subarray(offset, offset + length), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function vec3(view: DataView, offset: number): [number, number, number] {
  return [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
}

function quat(view: DataView, offset: number): [number, number, number, number] {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true)
  ];
}

function decompressSection(
  bytes: Uint8Array,
  view: DataView,
  cellHeader: number,
  sectionOffset: number,
  label: string
): Uint8Array {
  const compressedOffset = view.getUint32(cellHeader + sectionOffset, true);
  const compressedBytes = view.getUint32(cellHeader + sectionOffset + 4, true);
  const outputBytes = view.getUint32(cellHeader + sectionOffset + 8, true);
  requireBytes(compressedOffset, compressedBytes, bytes.length, label);
  const output = new Uint8Array(outputBytes);
  const written = lz4.decompressBlock(
    bytes.subarray(compressedOffset, compressedOffset + compressedBytes),
    output,
    0,
    compressedBytes,
    0
  );
  if (written !== outputBytes) throw new Error(`${label} decompressed to ${written} bytes.`);
  return output;
}

function decompressArraySection(
  bytes: Uint8Array,
  view: DataView,
  cellHeader: number,
  listIndex: number,
  label: string
): Uint8Array {
  const compressedOffset = view.getUint32(cellHeader + 0xf4 + listIndex * 4, true);
  const compressedBytes = view.getUint32(cellHeader + 0x104 + listIndex * 4, true);
  const outputBytes = view.getUint32(cellHeader + 0x114 + listIndex * 4, true);
  requireBytes(compressedOffset, compressedBytes, bytes.length, label);
  const output = new Uint8Array(outputBytes);
  const written = lz4.decompressBlock(
    bytes.subarray(compressedOffset, compressedOffset + compressedBytes),
    output,
    0,
    compressedBytes,
    0
  );
  if (written !== outputBytes) throw new Error(`${label} decompressed to ${written} bytes.`);
  return output;
}

export function parseTileScene(bytes: Uint8Array): TileScene {
  requireBytes(0, 60, bytes.length, "Tile header");
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 4)) !== "TILE") throw new Error("Tile magic must be TILE.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 15) throw new Error(`Expected Tile version 15, received ${version}.`);
  const width = view.getUint32(32, true);
  const height = view.getUint32(36, true);
  const headersOffset = view.getUint32(40, true);
  const headerBytes = view.getUint32(44, true);
  const cellCount = width * height;
  if (cellCount === 0 || headerBytes < 0x124) throw new Error("Tile cell headers are invalid.");
  requireBytes(headersOffset, cellCount * headerBytes, bytes.length, "Tile cell headers");

  const harvestables: TileHarvestableInstance[] = [];
  const prefabs: TilePrefabInstance[] = [];
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const cellHeader = headersOffset + cellIndex * headerBytes;
    for (let listIndex = 0; listIndex < 4; listIndex += 1) {
      const count = view.getUint32(cellHeader + 0xe4 + listIndex * 4, true);
      if (count === 0) continue;
      const output = decompressArraySection(bytes, view, cellHeader, listIndex, `Cell ${cellIndex} harvestable list ${listIndex}`);
      const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);
      const recordBytes = 0x41;
      requireBytes(0, count * recordBytes, output.length, `Cell ${cellIndex} harvestable list ${listIndex}`);
      for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
        const offset = itemIndex * recordBytes;
        harvestables.push({
          cellX: cellIndex % width,
          cellY: Math.floor(cellIndex / width),
          listIndex,
          position: vec3(outputView, offset),
          rotation: quat(outputView, offset + 0xc),
          size: vec3(outputView, offset + 0x1c),
          uuid: uuidAt(output, offset + 0x28),
          color: hexAt(output, offset + 0x38, 4),
          flags: output[offset + 0x3c],
          extra: outputView.getUint32(offset + 0x3d, true)
        });
      }
      if (count * recordBytes !== output.length) {
        throw new Error(`Cell ${cellIndex} harvestable list ${listIndex} has ${output.length - count * recordBytes} unread bytes.`);
      }
    }

    const prefabCount = view.getUint32(cellHeader + 0xc4, true);
    if (prefabCount > 0) {
      const output = decompressSection(bytes, view, cellHeader, 0xc8, `Cell ${cellIndex} prefab list`);
      const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);
      let offset = 0;
      for (let prefabIndex = 0; prefabIndex < prefabCount; prefabIndex += 1) {
        requireBytes(offset, 44, output.length, `Cell ${cellIndex} prefab ${prefabIndex}`);
        const position = vec3(outputView, offset);
        const rotation = quat(outputView, offset + 0xc);
        const size = vec3(outputView, offset + 0x1c);
        offset += 0x28;
        const pathBytes = outputView.getUint32(offset, true);
        offset += 4;
        requireBytes(offset, pathBytes + 1, output.length, `Cell ${cellIndex} prefab ${prefabIndex} path`);
        const path = new TextDecoder().decode(output.subarray(offset, offset + pathBytes));
        offset += pathBytes;
        const hasFlag = output[offset++] !== 0;
        let flag = "";
        if (hasFlag) {
          requireBytes(offset, 1, output.length, `Cell ${cellIndex} prefab ${prefabIndex} flag length`);
          const flagBytes = output[offset++];
          requireBytes(offset, flagBytes, output.length, `Cell ${cellIndex} prefab ${prefabIndex} flag`);
          flag = new TextDecoder().decode(output.subarray(offset, offset + flagBytes));
          offset += flagBytes;
        }
        requireBytes(offset, 4, output.length, `Cell ${cellIndex} prefab ${prefabIndex} trailer`);
        offset += 4;
        prefabs.push({
          cellX: cellIndex % width,
          cellY: Math.floor(cellIndex / width),
          position,
          rotation,
          size,
          path,
          flag
        });
      }
      if (offset !== output.length) throw new Error(`Cell ${cellIndex} prefab list has ${output.length - offset} unread bytes.`);
    }
  }
  return { assets: parseTileAssets(bytes), harvestables, prefabs };
}
