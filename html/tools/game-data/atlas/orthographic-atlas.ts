import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type {
  OfficialTileAtlasEntry,
  OfficialTileAtlasManifest
} from "./official-tile-atlas.ts";

export interface BuildOrthographicAtlasOverlayOptions {
  manifestPath: string;
  inputDirectory: string;
  outputDirectory: string;
  pixelsPerCell?: number;
  pageSize?: number;
}

interface OrthographicManifestEntry extends OfficialTileAtlasEntry {
  projection?: "verified-orthographic" | "isometric-preview";
}

interface OrthographicManifest extends Omit<OfficialTileAtlasManifest, "entries"> {
  entries: Record<string, OrthographicManifestEntry>;
}

interface PreparedRender {
  uuid: string;
  path: string;
  width: number;
  height: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

async function loadInputs(
  manifest: OrthographicManifest,
  inputDirectory: string,
  pixelsPerCell: number,
  pageSize: number
): Promise<PreparedRender[]> {
  const names = (await readdir(inputDirectory))
    .filter((name) => /^[0-9a-f-]{36}\.png$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  const renders: PreparedRender[] = [];
  for (const name of names) {
    const uuid = basename(name, ".png").toLowerCase();
    const entry = manifest.entries[uuid];
    if (!entry) throw new Error(`Orthographic render UUID is absent from the official atlas: ${uuid}`);
    const expectedWidth = entry.spanWidth * pixelsPerCell;
    const expectedHeight = entry.spanHeight * pixelsPerCell;
    if (expectedWidth > pageSize || expectedHeight > pageSize) {
      throw new Error(`${uuid} requires ${expectedWidth}x${expectedHeight}, larger than the ${pageSize}px atlas page.`);
    }
    const path = join(inputDirectory, name);
    const metadata = await sharp(path).metadata();
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      throw new Error(
        `Orthographic render ${uuid} must be ${expectedWidth}x${expectedHeight}, got ${metadata.width ?? 0}x${metadata.height ?? 0}.`
      );
    }
    renders.push({ uuid, path, width: expectedWidth, height: expectedHeight });
  }
  return renders;
}

export async function buildOrthographicAtlasOverlay(
  options: BuildOrthographicAtlasOverlayOptions
): Promise<{ entries: number; pages: number }> {
  const pixelsPerCell = options.pixelsPerCell ?? 256;
  const pageSize = options.pageSize ?? 4096;
  assertPositiveInteger(pixelsPerCell, "Pixels per cell");
  assertPositiveInteger(pageSize, "Atlas page size");
  await mkdir(options.outputDirectory, { recursive: true });
  const manifest = JSON.parse(await readFile(options.manifestPath, "utf8")) as OrthographicManifest;
  if (manifest.schemaVersion !== 1 || !manifest.entries || !manifest.pages) {
    throw new Error("Official tile atlas manifest is malformed.");
  }
  const renders = await loadInputs(
    manifest,
    options.inputDirectory,
    pixelsPerCell,
    pageSize
  );

  for (const page of Object.keys(manifest.pages)) {
    if (page.startsWith("orthographic-") && page.endsWith(".webp")) {
      delete manifest.pages[page];
    }
  }
  for (const name of await readdir(options.outputDirectory)) {
    if (/^orthographic-\d+\.webp$/.test(name)) {
      await rm(join(options.outputDirectory, name));
    }
  }

  let pageIndex = 0;
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let composites: OverlayOptions[] = [];
  const flush = async (): Promise<void> => {
    if (composites.length === 0) return;
    const pageName = `orthographic-${pageIndex}.webp`;
    const pagePath = join(options.outputDirectory, pageName);
    await sharp({
      create: {
        width: pageSize,
        height: pageSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite(composites)
      .webp({ quality: 90, smartSubsample: true })
      .toFile(pagePath);
    const bytes = await readFile(pagePath);
    const details = await stat(pagePath);
    manifest.pages[pageName] = {
      width: pageSize,
      height: pageSize,
      sha256: digest(bytes)
    };
    if (details.size === 0) throw new Error(`Orthographic atlas page is empty: ${pageName}`);
    composites = [];
  };

  for (const render of renders) {
    if (x + render.width > pageSize) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    if (y + render.height > pageSize) {
      await flush();
      pageIndex += 1;
      x = 0;
      y = 0;
      rowHeight = 0;
    }
    const page = `orthographic-${pageIndex}.webp`;
    const previous = manifest.entries[render.uuid]!;
    manifest.entries[render.uuid] = {
      ...previous,
      page,
      x,
      y,
      width: render.width,
      height: render.height,
      renderMode: "terrain",
      projection: "verified-orthographic"
    };
    composites.push({ input: render.path, left: x, top: y });
    x += render.width;
    rowHeight = Math.max(rowHeight, render.height);
  }
  await flush();

  manifest.contentHash = "";
  manifest.contentHash = digest(JSON.stringify(canonicalize({
    ...manifest,
    contentHash: undefined
  })));
  await writeFile(
    options.manifestPath,
    `${JSON.stringify(canonicalize(manifest), null, 2)}\n`
  );
  return { entries: renders.length, pages: renders.length === 0 ? 0 : pageIndex + 1 };
}
