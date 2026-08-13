import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

export interface OfficialTileAtlasEntry {
  uuid: string;
  page: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spanWidth: number;
  spanHeight: number;
  renderMode: "terrain" | "isometric-thumbnail";
  projection?: "verified-orthographic" | "isometric-preview";
  icon?: {
    page: string;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OfficialTileAtlasManifest {
  schemaVersion: 1;
  gameVersion: string;
  contentHash: string;
  spriteSize: number;
  pages: Record<string, { width: number; height: number; sha256: string }>;
  entries: Record<string, OfficialTileAtlasEntry>;
}

interface CatalogDocument {
  gameVersion: string;
  tiles: Array<{
    uuid: string;
    relativePath: string;
    width: number;
    height: number;
    sourceCategory: string;
  }>;
}

type PreviewClassification = Pick<
  CatalogDocument["tiles"][number],
  "relativePath" | "sourceCategory" | "width" | "height"
>;

export function selectOfficialPreviewMode(
  tile: PreviewClassification
): OfficialTileAtlasEntry["renderMode"] {
  const isNaturalTerrainPoi = /\/poi\/(?:campingspot|chemicallake|farmbotgraveyard|haybalelabyrinth|oillake|random_|ruin_(?:forest|lake|meadow))/i
    .test(tile.relativePath);
  const isStructurePreview = (
    tile.sourceCategory === "poi"
    || tile.sourceCategory === "quest"
  )
    && !isNaturalTerrainPoi;
  return (
    isStructurePreview
    || !tile.relativePath.startsWith("Survival/Terrain/Tiles/")
  )
    ? "isometric-thumbnail"
    : "terrain";
}

export function isOfficialDeepWaterTile(relativePath: string): boolean {
  return /\/lake\/Lake\(1111\)_\d+\.tile$/i.test(relativePath)
    || /\/poi\/(?:Random|Ruin)_Lake_\d+_\d+\.tile$/i.test(relativePath);
}

export function selectOfficialPreviewProjection(
  relativePath: string
): OfficialTileAtlasEntry["projection"] {
  return isOfficialDeepWaterTile(relativePath)
    ? "verified-orthographic"
    : undefined;
}

export interface BuildOfficialTileAtlasOptions {
  gameRoot: string;
  catalogPath: string;
  outputDirectory: string;
  spriteSize?: number;
  pageSize?: number;
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

/**
 * Scrap Mechanic ships a stable 220x150 isometric tile preview. This inverse
 * bilinear mapping samples the terrain diamond into a north-up square.
 */
export async function rectifyOfficialPreview(
  input: Buffer,
  size = 256
): Promise<Buffer> {
  const decoded = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== 220 || decoded.info.height !== 150) {
    throw new Error(
      `Official tile preview must be 220x150, got ${decoded.info.width}x${decoded.info.height}.`
    );
  }
  const source = decoded.data;
  const target = Buffer.allocUnsafe(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const sourceX = 109 + 106 * u - 105 * v;
      const sourceY = 37 + 56 * u + 56 * v;
      const x0 = Math.max(0, Math.min(219, Math.floor(sourceX)));
      const y0 = Math.max(0, Math.min(149, Math.floor(sourceY)));
      const x1 = Math.min(219, x0 + 1);
      const y1 = Math.min(149, y0 + 1);
      const fx = sourceX - x0;
      const fy = sourceY - y0;
      const destination = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top =
          source[(y0 * 220 + x0) * 4 + channel]! * (1 - fx)
          + source[(y0 * 220 + x1) * 4 + channel]! * fx;
        const bottom =
          source[(y1 * 220 + x0) * 4 + channel]! * (1 - fx)
          + source[(y1 * 220 + x1) * 4 + channel]! * fx;
        target[destination + channel] = Math.round(
          top * (1 - fy) + bottom * fy
        );
      }
    }
  }
  return sharp(target, {
    raw: { width: size, height: size, channels: 4 }
  }).rotate(90).png().toBuffer();
}

export async function prepareOfficialDeepWaterPreview(
  input: Buffer,
  size = 256
): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  if (metadata.width !== 220 || metadata.height !== 150) {
    throw new Error(
      `Official tile preview must be 220x150, got ${metadata.width}x${metadata.height}.`
    );
  }
  // Canonical median sampled from the water surfaces of the official 1.0
  // Lake(1111) previews. A single color prevents their editor-only underwater
  // geometry and per-preview lighting from creating false island seams.
  const water = { r: 18, g: 154, b: 198 };
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: {
        ...water,
        alpha: 1
      }
    }
  })
    .png()
    .toBuffer();
}

export async function prepareOfficialIcon(
  input: Buffer,
  size = 256
): Promise<Buffer> {
  const decoded = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== 220 || decoded.info.height !== 150) {
    throw new Error(
      `Official tile preview must be 220x150, got ${decoded.info.width}x${decoded.info.height}.`
    );
  }
  const pixels = Buffer.from(decoded.data);
  const background = [pixels[0]!, pixels[1]!, pixels[2]!];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const distance = Math.max(
      Math.abs(pixels[offset]! - background[0]!),
      Math.abs(pixels[offset + 1]! - background[1]!),
      Math.abs(pixels[offset + 2]! - background[2]!)
    );
    if (distance <= 12) pixels[offset + 3] = 0;
  }
  return sharp(pixels, {
    raw: { width: 220, height: 150, channels: 4 }
  }).resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  }).png().toBuffer();
}

function assertCatalog(document: CatalogDocument): void {
  if (
    !document
    || typeof document.gameVersion !== "string"
    || !Array.isArray(document.tiles)
  ) {
    throw new Error("Tile catalog is malformed.");
  }
}

export async function buildOfficialTileAtlas(
  options: BuildOfficialTileAtlasOptions
): Promise<{ entries: number; pages: number; missing: number }> {
  const spriteSize = options.spriteSize ?? 256;
  const pageSize = options.pageSize ?? 4096;
  if (
    !Number.isSafeInteger(spriteSize)
    || !Number.isSafeInteger(pageSize)
    || spriteSize <= 0
    || pageSize < spriteSize
    || pageSize % spriteSize !== 0
  ) {
    throw new Error("Official atlas dimensions must be positive and divisible.");
  }
  const catalog = JSON.parse(
    await readFile(options.catalogPath, "utf8")
  ) as CatalogDocument;
  assertCatalog(catalog);
  const canonicalTiles = [...catalog.tiles].sort(
    (left, right) =>
      left.uuid.toLowerCase().localeCompare(right.uuid.toLowerCase())
      || left.relativePath.localeCompare(right.relativePath)
  );
  const selected = new Map<string, typeof canonicalTiles[number]>();
  let missing = 0;
  for (const tile of canonicalTiles) {
    const uuid = tile.uuid.toLowerCase();
    const previewPath = resolve(
      options.gameRoot,
      dirname(tile.relativePath),
      `${uuid}.png`
    );
    try {
      await readFile(previewPath);
    } catch {
      missing += 1;
      continue;
    }
    if (!selected.has(uuid)) selected.set(uuid, tile);
  }

  await mkdir(options.outputDirectory, { recursive: true });
  const perRow = pageSize / spriteSize;
  const perPage = perRow * perRow;
  const pages: OfficialTileAtlasManifest["pages"] = {};
  const entries: OfficialTileAtlasManifest["entries"] = {};
  const tiles = [...selected].sort(([left], [right]) => left.localeCompare(right));
  for (let pageIndex = 0; pageIndex * perPage < tiles.length; pageIndex += 1) {
    const pageTiles = tiles.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    const composites: Array<{ input: Buffer; left: number; top: number }> = [];
    const iconComposites: Array<{
      input: Buffer;
      left: number;
      top: number;
    }> = [];
    for (let index = 0; index < pageTiles.length; index += 1) {
      const [uuid, tile] = pageTiles[index]!;
      const previewPath = resolve(
        options.gameRoot,
        dirname(tile.relativePath),
        `${uuid}.png`
      );
      const renderMode = selectOfficialPreviewMode(tile);
      const source = await readFile(previewPath);
      const input = isOfficialDeepWaterTile(tile.relativePath)
        ? await prepareOfficialDeepWaterPreview(source, spriteSize)
        : await rectifyOfficialPreview(source, spriteSize);
      const x = index % perRow * spriteSize;
      const y = Math.floor(index / perRow) * spriteSize;
      composites.push({ input, left: x, top: y });
      const icon = renderMode === "isometric-thumbnail"
        ? {
            page: `official-icons-${pageIndex}.webp`,
            x,
            y,
            width: spriteSize,
            height: spriteSize
          }
        : undefined;
      if (icon) {
        iconComposites.push({
          input: await prepareOfficialIcon(source, spriteSize),
          left: x,
          top: y
        });
      }
      entries[uuid] = {
        uuid,
        page: `official-${pageIndex}.webp`,
        x,
        y,
        width: spriteSize,
        height: spriteSize,
        spanWidth: tile.width,
        spanHeight: tile.height,
        renderMode,
        ...(selectOfficialPreviewProjection(tile.relativePath)
          ? { projection: "verified-orthographic" as const }
          : {}),
        ...(icon ? { icon } : {})
      };
    }
    const pageName = `official-${pageIndex}.webp`;
    const page = await sharp({
      create: {
        width: pageSize,
        height: pageSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite(composites)
      .webp({ quality: 88, smartSubsample: true })
      .toBuffer();
    await writeFile(join(options.outputDirectory, pageName), page);
    pages[pageName] = {
      width: pageSize,
      height: pageSize,
      sha256: digest(page)
    };
    if (iconComposites.length > 0) {
      const iconPageName = `official-icons-${pageIndex}.webp`;
      const iconPage = await sharp({
        create: {
          width: pageSize,
          height: pageSize,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
        .composite(iconComposites)
        .webp({ quality: 88, smartSubsample: true })
        .toBuffer();
      await writeFile(join(options.outputDirectory, iconPageName), iconPage);
      pages[iconPageName] = {
        width: pageSize,
        height: pageSize,
        sha256: digest(iconPage)
      };
    }
  }
  const manifest: OfficialTileAtlasManifest = {
    schemaVersion: 1,
    gameVersion: catalog.gameVersion,
    contentHash: "",
    spriteSize,
    pages,
    entries
  };
  manifest.contentHash = digest(
    JSON.stringify(canonicalize({ ...manifest, contentHash: undefined }))
  );
  await writeFile(
    join(options.outputDirectory, "official-tile-atlas.json"),
    `${JSON.stringify(canonicalize(manifest), null, 2)}\n`
  );
  return {
    entries: Object.keys(entries).length,
    pages: Object.keys(pages).length,
    missing
  };
}
