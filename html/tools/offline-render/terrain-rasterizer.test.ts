import { describe, expect, it } from "vitest";

import type { TerrainTileData } from "./tile-v15-reader";
import { renderTerrainPixels, type MaterialTexture } from "./terrain-rasterizer";

function solidTexture(red: number, green: number, blue: number): MaterialTexture {
  return { width: 1, height: 1, rgb: Uint8Array.from([red, green, blue]) };
}

describe("renderTerrainPixels", () => {
  it("renders the stored material layer and applies the official vertex-color tint", () => {
    const terrain: TerrainTileData = {
      version: 15,
      widthInCells: 1,
      heightInCells: 1,
      cellHeaderBytes: 388,
      vertexHeights: new Float32Array(33 * 33),
      vertexColors: new Uint32Array(33 * 33).fill(0xff808080),
      groundMaterials: new BigUint64Array(65 * 65).fill(0xffn)
    };
    const materials = [
      solidTexture(200, 100, 50),
      ...Array.from({ length: 7 }, () => solidTexture(0, 0, 0)),
      solidTexture(0, 255, 0)
    ];

    expect([...renderTerrainPixels(terrain, materials, 2)]).toEqual([
      100, 50, 25, 255,
      100, 50, 25, 255,
      100, 50, 25, 255,
      100, 50, 25, 255
    ]);
  });

  it("bilinearly blends neighboring terrain material weights", () => {
    const groundMaterials = new BigUint64Array(65 * 65);
    groundMaterials[10 + 10 * 65] = 0xffn;
    groundMaterials[10 + 11 * 65] = 0xffn;
    const terrain: TerrainTileData = {
      version: 15,
      widthInCells: 1,
      heightInCells: 1,
      cellHeaderBytes: 388,
      vertexHeights: new Float32Array(33 * 33),
      vertexColors: new Uint32Array(33 * 33).fill(0xffffffff),
      groundMaterials
    };
    const materials = [
      solidTexture(255, 0, 0),
      ...Array.from({ length: 7 }, () => solidTexture(0, 0, 0)),
      solidTexture(0, 0, 255)
    ];

    expect([...renderTerrainPixels(terrain, materials, 3).slice(0, 4)]).toEqual([85, 0, 170, 255]);
  });
});
