import lz4 from "lz4js";

const TILE_HEADER_BYTES = 60;
const LEGACY_CELL_HEADER_BYTES = 0x124;
const HEIGHT_SAMPLES_PER_CELL = 33;
const GROUND_SAMPLES_PER_CELL = 65;
const HEIGHT_BYTES_PER_CELL = HEIGHT_SAMPLES_PER_CELL * HEIGHT_SAMPLES_PER_CELL * 8;
const GROUND_BYTES_PER_CELL = GROUND_SAMPLES_PER_CELL * GROUND_SAMPLES_PER_CELL * 8;
const TERRAIN_MIP_BYTES = HEIGHT_BYTES_PER_CELL + GROUND_BYTES_PER_CELL;

export interface TerrainTileData {
  version: number;
  widthInCells: number;
  heightInCells: number;
  cellHeaderBytes: number;
  vertexHeights: Float32Array;
  vertexColors: Uint32Array;
  groundMaterials: BigUint64Array;
}

export function parseTerrainTile(_bytes: Uint8Array): TerrainTileData {
  if (_bytes.length < TILE_HEADER_BYTES) {
    throw new Error("Tile header is truncated.");
  }

  const view = new DataView(_bytes.buffer, _bytes.byteOffset, _bytes.byteLength);
  const magic = new TextDecoder("ascii").decode(_bytes.subarray(0, 4));
  if (magic !== "TILE") {
    throw new Error("Tile magic must be TILE.");
  }

  const version = view.getUint32(4, true);
  const widthInCells = view.getUint32(32, true);
  const heightInCells = view.getUint32(36, true);
  const cellHeadersOffset = view.getUint32(40, true);
  const cellHeaderBytes = view.getUint32(44, true);
  const tileType = view.getUint32(56, true) >>> 24;
  const cellCount = widthInCells * heightInCells;

  if (version !== 15) {
    throw new Error(`Expected Tile version 15, received ${version}.`);
  }
  if (tileType !== 0) {
    throw new Error(`Tile type ${tileType} is not terrain.`);
  }
  if (cellCount === 0 || !Number.isSafeInteger(cellCount)) {
    throw new Error("Tile dimensions are invalid.");
  }
  if (cellHeaderBytes < LEGACY_CELL_HEADER_BYTES) {
    throw new Error("Tile cell header is too small for terrain MIP fields.");
  }
  if (cellHeadersOffset + cellCount * cellHeaderBytes > _bytes.length) {
    throw new Error("Tile cell headers are truncated.");
  }

  const vertexWidth = widthInCells * 32 + 1;
  const vertexHeight = heightInCells * 32 + 1;
  const groundWidth = widthInCells * 64 + 1;
  const groundHeight = heightInCells * 64 + 1;
  const vertexHeights = new Float32Array(vertexWidth * vertexHeight);
  const vertexColors = new Uint32Array(vertexWidth * vertexHeight);
  const groundMaterials = new BigUint64Array(groundWidth * groundHeight);

  for (let cellY = 0; cellY < heightInCells; cellY += 1) {
    for (let cellX = 0; cellX < widthInCells; cellX += 1) {
      const cellIndex = cellX + cellY * widthInCells;
      const headerOffset = cellHeadersOffset + cellIndex * cellHeaderBytes;
      const mipOffset = view.getUint32(headerOffset, true);
      const compressedBytes = view.getUint32(headerOffset + 0x18, true);
      const mipBytes = view.getUint32(headerOffset + 0x30, true);

      if (mipBytes !== TERRAIN_MIP_BYTES) {
        throw new Error(`Cell ${cellIndex} terrain MIP has unexpected size ${mipBytes}.`);
      }
      if (mipOffset + compressedBytes > _bytes.length) {
        throw new Error(`Cell ${cellIndex} terrain MIP is truncated.`);
      }

      const output = new Uint8Array(mipBytes);
      const written = lz4.decompressBlock(
        _bytes.subarray(mipOffset, mipOffset + compressedBytes),
        output,
        0,
        compressedBytes,
        0
      );
      if (written !== mipBytes) {
        throw new Error(`Cell ${cellIndex} terrain MIP decompressed to ${written} bytes.`);
      }

      const mipView = new DataView(output.buffer, output.byteOffset, output.byteLength);
      for (let localY = 0; localY < HEIGHT_SAMPLES_PER_CELL; localY += 1) {
        for (let localX = 0; localX < HEIGHT_SAMPLES_PER_CELL; localX += 1) {
          const localIndex = localX + localY * HEIGHT_SAMPLES_PER_CELL;
          const sourceOffset = localIndex * 8;
          const targetX = cellX * 32 + localX;
          const targetY = cellY * 32 + localY;
          const targetIndex = targetX + targetY * vertexWidth;
          vertexHeights[targetIndex] = mipView.getFloat32(sourceOffset, true);
          vertexColors[targetIndex] = mipView.getUint32(sourceOffset + 4, true);
        }
      }

      for (let localY = 0; localY < GROUND_SAMPLES_PER_CELL; localY += 1) {
        for (let localX = 0; localX < GROUND_SAMPLES_PER_CELL; localX += 1) {
          const localIndex = localX + localY * GROUND_SAMPLES_PER_CELL;
          const sourceOffset = HEIGHT_BYTES_PER_CELL + localIndex * 8;
          const targetX = cellX * 64 + localX;
          const targetY = cellY * 64 + localY;
          groundMaterials[targetX + targetY * groundWidth] = mipView.getBigUint64(sourceOffset, true);
        }
      }
    }
  }

  return {
    version,
    widthInCells,
    heightInCells,
    cellHeaderBytes,
    vertexHeights,
    vertexColors,
    groundMaterials
  };
}
