import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { renderTerrainPixels, type MaterialTexture } from "./terrain-rasterizer";
import { parseTerrainTile } from "./tile-v15-reader";

const materialNames = [
  "gnd_0",
  "gnd_1",
  "gnd_2",
  "gnd_3",
  "gnd_4",
  "gnd_5",
  "gnd_6",
  "gnd_7",
  "gnd_grass"
] as const;

const [tilePath, materialDirectory, outputPath, pixelsPerCellText = "256"] = process.argv.slice(2);
if (!tilePath || !materialDirectory || !outputPath) {
  throw new Error("Usage: render-tile-cli <tile> <material-png-directory> <output.png> [pixels-per-cell]");
}

const pixelsPerCell = Number(pixelsPerCellText);
const tile = parseTerrainTile(await readFile(tilePath));
const materials: MaterialTexture[] = [];
for (const name of materialNames) {
  const { data, info } = await sharp(path.join(materialDirectory, `${name}.png`))
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  materials.push({ width: info.width, height: info.height, rgb: data });
}

const width = tile.widthInCells * pixelsPerCell;
const height = tile.heightInCells * pixelsPerCell;
const pixels = renderTerrainPixels(tile, materials, pixelsPerCell);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(JSON.stringify({
  outputPath,
  version: tile.version,
  width,
  height,
  cellHeaderBytes: tile.cellHeaderBytes
}));
