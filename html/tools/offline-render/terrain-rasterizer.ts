import type { TerrainTileData } from "./tile-v15-reader";

export interface MaterialTexture {
  width: number;
  height: number;
  rgb: Uint8Array;
}

function bilinearSample(
  width: number,
  height: number,
  x: number,
  y: number,
  valueAt: (index: number) => number
): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = valueAt(x0 + y0 * width) * (1 - tx) + valueAt(x1 + y0 * width) * tx;
  const bottom = valueAt(x0 + y1 * width) * (1 - tx) + valueAt(x1 + y1 * width) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function renderTerrainPixels(
  terrain: TerrainTileData,
  materials: readonly MaterialTexture[],
  pixelsPerCell: number
): Uint8Array {
  if (materials.length !== 9) {
    throw new Error(`Expected nine material textures, received ${materials.length}.`);
  }
  if (!Number.isInteger(pixelsPerCell) || pixelsPerCell < 1) {
    throw new Error("Pixels per cell must be a positive integer.");
  }
  for (const material of materials) {
    if (material.width < 1 || material.height < 1 || material.rgb.length !== material.width * material.height * 3) {
      throw new Error("Material texture dimensions do not match its RGB payload.");
    }
  }

  const outputWidth = terrain.widthInCells * pixelsPerCell;
  const outputHeight = terrain.heightInCells * pixelsPerCell;
  const groundWidth = terrain.widthInCells * 64 + 1;
  const groundHeight = terrain.heightInCells * 64 + 1;
  const vertexWidth = terrain.widthInCells * 32 + 1;
  const vertexHeight = terrain.heightInCells * 32 + 1;
  const output = new Uint8Array(outputWidth * outputHeight * 4);

  for (let y = 0; y < outputHeight; y += 1) {
    const groundY = (y + 0.5) * (groundHeight - 1) / outputHeight;
    const vertexY = (y + 0.5) * (vertexHeight - 1) / outputHeight;
    for (let x = 0; x < outputWidth; x += 1) {
      const groundX = (x + 0.5) * (groundWidth - 1) / outputWidth;
      const vertexX = (x + 0.5) * (vertexWidth - 1) / outputWidth;
      const tintRed = bilinearSample(vertexWidth, vertexHeight, vertexX, vertexY,
        (index) => (terrain.vertexColors[index] >>> 16) & 0xff);
      const tintGreen = bilinearSample(vertexWidth, vertexHeight, vertexX, vertexY,
        (index) => (terrain.vertexColors[index] >>> 8) & 0xff);
      const tintBlue = bilinearSample(vertexWidth, vertexHeight, vertexX, vertexY,
        (index) => terrain.vertexColors[index] & 0xff);

      let paintedTotal = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let materialIndex = 0; materialIndex < 8; materialIndex += 1) {
        const weight = bilinearSample(groundWidth, groundHeight, groundX, groundY,
          (index) => Number((terrain.groundMaterials[index] >> BigInt(materialIndex * 8)) & 0xffn));
        if (weight === 0) continue;
        paintedTotal += weight;
        const material = materials[materialIndex];
        const textureX = x % material.width;
        const textureY = y % material.height;
        const textureOffset = (textureX + textureY * material.width) * 3;
        red += material.rgb[textureOffset] * weight;
        green += material.rgb[textureOffset + 1] * weight;
        blue += material.rgb[textureOffset + 2] * weight;
      }
      const baseWeight = Math.max(0, 255 - paintedTotal);
      if (baseWeight > 0) {
        const material = materials[8];
        const textureX = x % material.width;
        const textureY = y % material.height;
        const textureOffset = (textureX + textureY * material.width) * 3;
        red += material.rgb[textureOffset] * baseWeight;
        green += material.rgb[textureOffset + 1] * baseWeight;
        blue += material.rgb[textureOffset + 2] * baseWeight;
      }
      const divisor = Math.max(255, paintedTotal);

      const outputOffset = (x + y * outputWidth) * 4;
      output[outputOffset] = Math.round(red / divisor * tintRed / 255);
      output[outputOffset + 1] = Math.round(green / divisor * tintGreen / 255);
      output[outputOffset + 2] = Math.round(blue / divisor * tintBlue / 255);
      output[outputOffset + 3] = 255;
    }
  }

  return output;
}
