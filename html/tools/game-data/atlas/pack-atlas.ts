import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { canonicalAtlasKey, type AtlasManifest, type AtlasPage, type AtlasSourceCell } from "./atlas-manifest.ts";
import { LEGACY_ROTATION_DEGREES } from "../../../src/map/legacy-rotation.ts";

const PAGE_SIZE = 4096;
const LOW_SCALE = 2;
const hashFile = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

/** Stable packer: only canonical keys and relative, reproducible input names enter the manifest. */
export async function buildAtlas(cells: AtlasSourceCell[], outputDir: string, gameVersion = "1.0.0"): Promise<AtlasManifest> {
  const canonical = cells.map((cell) => ({ ...cell, key: canonicalAtlasKey(cell.key) }));
  const ordered = [...canonical].sort((a, b) => a.key.localeCompare(b.key));
  const seen = new Set<string>();
  for (const cell of ordered) { if (seen.has(cell.key)) throw new Error(`Duplicate atlas key: ${cell.key}`); seen.add(cell.key); }
  await mkdir(outputDir, { recursive: true });
  const entries: AtlasManifest["entries"] = {}; const pages: Record<string, AtlasPage> = {}; let page = 0; let x = 0; let y = 0; let rowHeight = 0; let composites: OverlayOptions[] = [];
  const flush = async () => {
    if (!composites.length) return;
    const native = `terrain-${page}.webp`, low = `terrain-${page}-low.webp`;
    const source = sharp({ create: { width: PAGE_SIZE, height: PAGE_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites);
    await source.clone().webp({ lossless: true }).toFile(join(outputDir, native));
    await source.resize(PAGE_SIZE / LOW_SCALE, PAGE_SIZE / LOW_SCALE).webp({ lossless: true }).toFile(join(outputDir, low));
    for (const path of [native, low]) { const file = join(outputDir, path); const size = await stat(file); const meta = await sharp(file).metadata(); pages[path] = { path, bytes: size.size, sha256: await hashFile(file), width: meta.width!, height: meta.height! }; }
    composites = [];
  };
  for (const cell of ordered) {
    if (!Number.isInteger(cell.logicalSize) || cell.logicalSize < 1 || cell.logicalSize > PAGE_SIZE) throw new Error(`Invalid logical size for ${cell.key}`);
    if (x + cell.logicalSize > PAGE_SIZE) { x = 0; y += rowHeight; rowHeight = 0; }
    if (y + cell.logicalSize > PAGE_SIZE) { await flush(); page++; x = 0; y = 0; rowHeight = 0; }
    const rotation = Number(cell.key.split(":")[3]);
    const image = await sharp(cell.imagePath).resize(cell.logicalSize, cell.logicalSize, { fit: "fill" }).rotate(LEGACY_ROTATION_DEGREES[rotation as 0 | 1 | 2 | 3]).webp({ lossless: true }).toBuffer();
    entries[cell.key] = { page: `terrain-${page}.webp`, lowPage: `terrain-${page}-low.webp`, x, y, width: cell.logicalSize, height: cell.logicalSize, lowX: x / LOW_SCALE, lowY: y / LOW_SCALE, lowWidth: cell.logicalSize / LOW_SCALE, lowHeight: cell.logicalSize / LOW_SCALE, logicalSize: cell.logicalSize, sourceHash: cell.sourceHash };
    composites.push({ input: image, left: x, top: y }); x += cell.logicalSize; rowHeight = Math.max(rowHeight, cell.logicalSize);
  }
  await flush();
  const generatedFrom = [...new Set(ordered.map((cell) => basename(cell.imagePath)))].sort();
  const unsigned = { schemaVersion: 1 as const, gameVersion, generatedFrom, pageSize: PAGE_SIZE, entries, pages };
  const manifest: AtlasManifest = { ...unsigned, contentHash: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex") };
  await writeFile(join(outputDir, "terrain-cell-atlas.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function renderInputName(uuid: string, xOffset: number, yOffset: number): string { return `${uuid}__${xOffset}__${yOffset}.png`; }
