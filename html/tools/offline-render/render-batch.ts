import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isOfficialDeepWaterTile } from "../game-data/atlas/official-tile-atlas.ts";
import { renderTerrainPixels, type MaterialTexture } from "./terrain-rasterizer.ts";
import { parseTerrainTile } from "./tile-v15-reader.ts";

export interface TerrainRenderCandidate {
  uuid: string;
  relativePath: string;
  width: number;
  height: number;
  version: number;
}

export interface RenderTerrainBatchOptions {
  gameRoot: string;
  materialDirectory: string;
  outputDirectory: string;
  rows: readonly TerrainRenderCandidate[];
  pixelsPerCell?: number;
  onProgress?: (completed: number, total: number, row: TerrainRenderCandidate) => void;
}

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

export function selectTerrainRenderCandidates(
  rows: readonly TerrainRenderCandidate[]
): TerrainRenderCandidate[] {
  const selected: TerrainRenderCandidate[] = [];
  for (const row of rows) {
    if (!row.relativePath.startsWith("Survival/Terrain/Tiles/")) continue;
    if (row.version !== 15) {
      throw new Error(`${row.relativePath} uses unsupported Tile version ${row.version}.`);
    }
    if (isOfficialDeepWaterTile(row.relativePath)) continue;
    selected.push(row);
  }
  return selected.sort((left, right) => left.uuid.localeCompare(right.uuid));
}

async function loadMaterials(directory: string): Promise<MaterialTexture[]> {
  return Promise.all(materialNames.map(async (name) => {
    const { data, info } = await sharp(path.join(directory, `${name}.png`))
      .resize(64, 64, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, rgb: data };
  }));
}

async function hasExpectedOutput(
  outputPath: string,
  width: number,
  height: number
): Promise<boolean> {
  try {
    if ((await stat(outputPath)).size === 0) return false;
    const metadata = await sharp(outputPath).metadata();
    return metadata.width === width && metadata.height === height;
  } catch {
    return false;
  }
}

export async function renderTerrainBatch(
  options: RenderTerrainBatchOptions
): Promise<{ rendered: number; reused: number; total: number }> {
  const pixelsPerCell = options.pixelsPerCell ?? 256;
  if (!Number.isSafeInteger(pixelsPerCell) || pixelsPerCell < 1) {
    throw new Error("Pixels per cell must be a positive integer.");
  }
  const rows = selectTerrainRenderCandidates(options.rows);
  const materials = await loadMaterials(options.materialDirectory);
  await mkdir(options.outputDirectory, { recursive: true });
  let rendered = 0;
  let reused = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const width = row.width * pixelsPerCell;
    const height = row.height * pixelsPerCell;
    const outputPath = path.join(options.outputDirectory, `${row.uuid}.png`);
    if (await hasExpectedOutput(outputPath, width, height)) {
      reused += 1;
      options.onProgress?.(index + 1, rows.length, row);
      continue;
    }
    const tilePath = path.resolve(options.gameRoot, row.relativePath);
    const terrain = parseTerrainTile(await readFile(tilePath));
    if (terrain.widthInCells !== row.width || terrain.heightInCells !== row.height) {
      throw new Error(`${row.relativePath} dimensions do not match the catalog.`);
    }
    const pixels = renderTerrainPixels(terrain, materials, pixelsPerCell);
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
    rendered += 1;
    options.onProgress?.(index + 1, rows.length, row);
  }
  return { rendered, reused, total: rows.length };
}
