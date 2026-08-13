import lz4 from "lz4js";

export interface TileAssetInstance {
  cellX: number;
  cellY: number;
  listIndex: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  size: [number, number, number];
  uuid: string;
  materialColors: Record<string, string>;
  flags: number;
  flag: string;
}

function uuidAt(bytes: Uint8Array, offset: number): string {
  const hex = Array.from(bytes.subarray(offset, offset + 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireBytes(offset: number, length: number, available: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > available) {
    throw new Error(`${label} is truncated.`);
  }
}

export function parseTileAssets(bytes: Uint8Array): TileAssetInstance[] {
  requireBytes(0, 60, bytes.length, "Tile header");
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 4)) !== "TILE") {
    throw new Error("Tile magic must be TILE.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 15) {
    throw new Error(`Expected Tile version 15, received ${version}.`);
  }
  const width = view.getUint32(32, true);
  const height = view.getUint32(36, true);
  const headersOffset = view.getUint32(40, true);
  const headerBytes = view.getUint32(44, true);
  const cellCount = width * height;
  if (cellCount === 0 || headerBytes < 0x124) {
    throw new Error("Tile cell headers are invalid.");
  }
  requireBytes(headersOffset, cellCount * headerBytes, bytes.length, "Tile cell headers");

  const assets: TileAssetInstance[] = [];
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const cellHeader = headersOffset + cellIndex * headerBytes;
    for (let listIndex = 0; listIndex < 4; listIndex += 1) {
      const count = view.getUint32(cellHeader + 0x54 + listIndex * 4, true);
      if (count === 0) continue;
      const compressedOffset = view.getUint32(cellHeader + 0x64 + listIndex * 4, true);
      const compressedBytes = view.getUint32(cellHeader + 0x74 + listIndex * 4, true);
      const outputBytes = view.getUint32(cellHeader + 0x84 + listIndex * 4, true);
      requireBytes(compressedOffset, compressedBytes, bytes.length, `Cell ${cellIndex} asset list ${listIndex}`);

      const output = new Uint8Array(outputBytes);
      const written = lz4.decompressBlock(
        bytes.subarray(compressedOffset, compressedOffset + compressedBytes),
        output,
        0,
        compressedBytes,
        0
      );
      if (written !== outputBytes) {
        throw new Error(`Cell ${cellIndex} asset list ${listIndex} decompressed to ${written} bytes.`);
      }
      const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);
      let offset = 0;
      for (let assetIndex = 0; assetIndex < count; assetIndex += 1) {
        requireBytes(offset, 57, output.length, `Cell ${cellIndex} asset ${assetIndex}`);
        const position: [number, number, number] = [
          outputView.getFloat32(offset, true),
          outputView.getFloat32(offset + 4, true),
          outputView.getFloat32(offset + 8, true)
        ];
        const rotation: [number, number, number, number] = [
          outputView.getFloat32(offset + 12, true),
          outputView.getFloat32(offset + 16, true),
          outputView.getFloat32(offset + 20, true),
          outputView.getFloat32(offset + 24, true)
        ];
        const size: [number, number, number] = [
          outputView.getFloat32(offset + 28, true),
          outputView.getFloat32(offset + 32, true),
          outputView.getFloat32(offset + 36, true)
        ];
        const uuid = uuidAt(output, offset + 40);
        offset += 56;
        const materialCount = output[offset++];
        const materialColors: Record<string, string> = {};
        for (let materialIndex = 0; materialIndex < materialCount; materialIndex += 1) {
          requireBytes(offset, 1, output.length, `Cell ${cellIndex} asset ${assetIndex} material`);
          const nameBytes = output[offset++];
          requireBytes(offset, nameBytes + 4, output.length, `Cell ${cellIndex} asset ${assetIndex} material`);
          const name = new TextDecoder().decode(output.subarray(offset, offset + nameBytes));
          offset += nameBytes;
          materialColors[name] = Array.from(output.subarray(offset, offset + 4), (byte) =>
            byte.toString(16).padStart(2, "0")
          ).join("");
          offset += 4;
        }
        requireBytes(offset, 1, output.length, `Cell ${cellIndex} asset ${assetIndex} flags`);
        const flags = output[offset++];
        let flag = "";
        if (flags === 1) {
          requireBytes(offset, 1, output.length, `Cell ${cellIndex} asset ${assetIndex} flag length`);
          const flagBytes = output[offset++];
          requireBytes(offset, flagBytes, output.length, `Cell ${cellIndex} asset ${assetIndex} flag`);
          flag = new TextDecoder().decode(output.subarray(offset, offset + flagBytes));
          offset += flagBytes;
        }
        assets.push({
          cellX: cellIndex % width,
          cellY: Math.floor(cellIndex / width),
          listIndex,
          position,
          rotation,
          size,
          uuid,
          materialColors,
          flags,
          flag
        });
      }
      if (offset !== output.length) {
        throw new Error(`Cell ${cellIndex} asset list ${listIndex} has ${output.length - offset} unread bytes.`);
      }
    }
  }
  return assets;
}
