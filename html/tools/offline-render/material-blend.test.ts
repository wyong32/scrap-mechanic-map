import { describe, expect, it } from "vitest";

import { blendMaterialPixel, decodeGroundWeights } from "./material-blend";

describe("ground material blending", () => {
  it("decodes eight little-endian blend bytes and leaves zero-filled ground on the base layer", () => {
    expect(decodeGroundWeights(0n)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 255]);
    expect(decodeGroundWeights(0x000000000100ff00n)).toEqual([0, 255, 0, 1, 0, 0, 0, 0, 0]);
  });

  it("blends the official diffuse layers using their stored weights", () => {
    const materials = [
      [255, 0, 0],
      [0, 0, 255],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 255, 0]
    ] as const;

    expect(blendMaterialPixel(0n, materials)).toEqual([0, 255, 0]);
    expect(blendMaterialPixel(0x0000000000007f80n, materials)).toEqual([128, 0, 127]);
  });
});
