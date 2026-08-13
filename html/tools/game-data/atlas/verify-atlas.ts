import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import type { WorldMap } from "../../../src/domain/map-model.ts";
import {
  atlasKeyForCell,
  canonicalAtlasKey,
  verifyAtlasCoverage,
  type AtlasManifest,
  type CoverageReport
} from "./atlas-manifest.ts";
import { renderInputName } from "./pack-atlas.ts";
import type { LegacyAssetRecord } from "../legacy/legacy-assets.ts";
import type { LegacyBridgeEntry } from "../legacy/legacy-bridge.ts";
import { legacyPoiRules } from "../legacy/original-poi-rules.ts";
import { selectLegacyBridgeByUuid } from "../../../src/legacy/legacy-alias-selector.ts";
import { resolveTerrainVisuals } from "../../../src/legacy/hybrid-terrain-resolver.ts";
import type { LegacyAssetBundle } from "../../../src/legacy/legacy-visual-types.ts";
import {
  parseVerifiedGeneratedBundle,
  type BuildInfoBundle,
  type GeneratedEnvelope
} from "../../../src/data/reference-repository.ts";
import { validateRelativeGeneratedPath } from "../verify-generated.ts";

export interface AggregateCoverageReport {
  legacyAssetIds: number;
  officialLegacyMappings: number;
  legacyCoveredUuids: number;
  oneDotZeroRenderedUuids: number;
  fallbackUuids: number;
}

export interface CoverageReportInput {
  worlds: readonly WorldMap[];
  legacyBridge: readonly LegacyBridgeEntry[];
  legacyAssets: readonly LegacyAssetRecord[];
  atlasManifest?: VerifiedAtlasManifest;
}

declare const verifiedAtlasManifest: unique symbol;
export type VerifiedAtlasManifest = AtlasManifest & {
  readonly [verifiedAtlasManifest]: true;
};

/** Aggregate-only report: UUID values remain internal and are never serialized. */
export function buildCoverageReport(input: CoverageReportInput): AggregateCoverageReport {
  const worldUuids = new Set(
    input.worlds.flatMap((world) =>
      world.cells.map((cell) => cell.uuid.toLowerCase())
    )
  );
  const legacyAssetIds = new Set(
    input.legacyAssets.flatMap((asset) => {
      const match = /^tile:(\d+)$/.exec(asset.key);
      return match ? [Number(match[1])] : [];
    })
  );
  const assetKeys = new Set(input.legacyAssets.map((asset) => asset.key));
  const selectedBridge = selectLegacyBridgeByUuid(
    input.legacyBridge,
    assetKeys,
    legacyPoiRules
  );
  const legacyBundle: LegacyAssetBundle = {
    assets: new Map(
      input.legacyAssets.map((record) => [
        record.key,
        {
          record,
          image: {} as HTMLImageElement
        }
      ])
    ),
    bridgeByUuid: selectedBridge,
    poiRules: legacyPoiRules
  };
  const legacyCoverageByUuid = new Map<string, boolean>();
  for (const world of input.worlds) {
    const legacyCells = new Set(
      resolveTerrainVisuals(world.cells, legacyBundle).flatMap((visual) =>
        visual.asset ? [...visual.coveredCells] : []
      )
    );
    for (const cell of world.cells) {
      const uuid = cell.uuid.toLowerCase();
      const resolved = legacyCells.has(`${cell.x},${cell.y}`);
      legacyCoverageByUuid.set(
        uuid,
        (legacyCoverageByUuid.get(uuid) ?? true) && resolved
      );
    }
  }
  const legacyCovered = new Set(
    [...legacyCoverageByUuid].flatMap(([uuid, fullyResolved]) =>
      fullyResolved ? [uuid] : []
    )
  );
  const keysByUuid = new Map<
    string,
    Set<ReturnType<typeof atlasKeyForCell>>
  >();
  for (const world of input.worlds) {
    for (const cell of world.cells) {
      const uuid = cell.uuid.toLowerCase();
      const keys =
        keysByUuid.get(uuid)
        ?? new Set<ReturnType<typeof atlasKeyForCell>>();
      keys.add(atlasKeyForCell(cell));
      keysByUuid.set(uuid, keys);
    }
  }
  const rendered = new Set(
    [...keysByUuid].flatMap(([uuid, keys]) =>
      !legacyCovered.has(uuid)
      && input.atlasManifest
      && [...keys].every((key) => input.atlasManifest?.entries[key])
        ? [uuid]
        : []
    )
  );

  return {
    legacyAssetIds: legacyAssetIds.size,
    officialLegacyMappings: input.legacyBridge.length,
    legacyCoveredUuids: legacyCovered.size,
    oneDotZeroRenderedUuids: rendered.size,
    fallbackUuids: [...worldUuids].filter(
      (uuid) => !legacyCovered.has(uuid) && !rendered.has(uuid)
    ).length
  };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface GeneratedWorldBundle extends GeneratedEnvelope {
  world: WorldMap;
}

export async function loadGeneratedWorlds(outputDirectory: string): Promise<WorldMap[]> {
  const buildText = await readFile(
    join(outputDirectory, "build-info.json"),
    "utf8"
  );
  const build = await parseVerifiedGeneratedBundle<BuildInfoBundle>(
    buildText,
    "build-info.json"
  );
  if (!Array.isArray(build.files)) {
    throw new Error("Generated build-info has an invalid file inventory.");
  }
  const names = new Set<string>();
  for (const file of build.files) {
    if (
      !file
      || typeof file.name !== "string"
      || typeof file.contentHash !== "string"
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 0
    ) {
      throw new Error("Generated build-info has an invalid file entry.");
    }
    validateRelativeGeneratedPath(file.name);
    if (names.has(file.name)) {
      throw new Error(`Generated build-info repeats path: ${file.name}`);
    }
    names.add(file.name);
  }
  const worldFiles = build.files.filter(
    (file) => /^worlds\/[^/]+\.json$/.test(file.name)
  );
  return Promise.all(
    worldFiles.map(async (file) => {
      const text = await readFile(join(outputDirectory, file.name), "utf8");
      const bundle =
        await parseVerifiedGeneratedBundle<GeneratedWorldBundle>(
          text,
          file.name,
          build
        );
      if (!bundle.world || typeof bundle.world !== "object") {
        throw new Error(`Generated ${file.name} has no world payload.`);
      }
      return bundle.world;
    })
  );
}
export async function loadAtlasManifest(atlasDirectory: string): Promise<AtlasManifest> { return JSON.parse(await readFile(join(atlasDirectory, "terrain-cell-atlas.json"), "utf8")) as AtlasManifest; }
export async function loadOptionalVerifiedAtlasManifest(
  atlasDirectory: string,
  gameVersion = "1.0.0"
): Promise<VerifiedAtlasManifest | undefined> {
  let manifest: AtlasManifest;
  try {
    manifest = await loadAtlasManifest(atlasDirectory);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
  return verifyAtlasFiles(atlasDirectory, manifest, gameVersion);
}
export function missingInputNames(report: CoverageReport): string[] { return [...new Set(report.missing.map((item) => renderInputName(item.uuid, item.xOffset, item.yOffset)))].sort(); }
function safePageName(name: string): void { if (!name || name !== basename(name) || name.includes("..") || name.includes(":") || name.includes("\\") || name.includes("/")) throw new Error(`Unsafe atlas page path: ${name}`); }
/** Validates integrity before considering any key covered: a fake key cannot satisfy this gate. */
export async function verifyAtlasFiles(directory: string, manifest: AtlasManifest, gameVersion = "1.0.0"): Promise<VerifiedAtlasManifest> {
  if (manifest.schemaVersion !== 1 || manifest.gameVersion !== gameVersion || !manifest.contentHash || !manifest.pages || !manifest.entries) throw new Error("Invalid terrain atlas manifest metadata");
  const { contentHash, ...unsigned } = manifest; if (digest(unsigned) !== contentHash) throw new Error("Terrain atlas manifest contentHash mismatch");
  if (
    !Number.isSafeInteger(manifest.pageSize)
    || manifest.pageSize < 2
    || manifest.pageSize % 2 !== 0
    || Object.keys(manifest.pages).length === 0
  ) {
    throw new Error("Invalid terrain atlas page contract");
  }
  const used = new Map<string, Array<{ x: number; y: number; width: number; height: number }>>();
  const pageRoles = new Map<string, "native" | "low">();
  for (const [key, entry] of Object.entries(manifest.entries)) {
    if (canonicalAtlasKey(key) !== key) throw new Error(`Non-canonical atlas key: ${key}`);
    if (
      !Number.isSafeInteger(entry.logicalSize)
      || entry.logicalSize < 2
      || entry.logicalSize > manifest.pageSize
      || entry.width !== entry.logicalSize
      || entry.height !== entry.logicalSize
      || entry.lowWidth * 2 !== entry.logicalSize
      || entry.lowHeight * 2 !== entry.logicalSize
      || entry.lowWidth !== entry.lowHeight
      || entry.lowX * 2 !== entry.x
      || entry.lowY * 2 !== entry.y
      || entry.page === entry.lowPage
    ) {
      throw new Error(`Invalid atlas logical/low geometry for ${key}`);
    }
    for (
      const [role, pageName, x, y, width, height] of [
        ["native", entry.page, entry.x, entry.y, entry.width, entry.height],
        [
          "low",
          entry.lowPage,
          entry.lowX,
          entry.lowY,
          entry.lowWidth,
          entry.lowHeight
        ]
      ] as const
    ) {
      safePageName(pageName); const page = manifest.pages[pageName]; if (!page) throw new Error(`Atlas entry ${key} references unlisted page ${pageName}`);
      const priorRole = pageRoles.get(pageName);
      if (priorRole && priorRole !== role) {
        throw new Error(`Atlas page ${pageName} mixes native and low geometry`);
      }
      pageRoles.set(pageName, role);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || x < 0 || y < 0 || x + width > page.width || y + height > page.height) throw new Error(`Invalid atlas rectangle for ${key}`);
      const prior = used.get(pageName) ?? []; if (prior.some((other) => x < other.x + other.width && x + width > other.x && y < other.y + other.height && y + height > other.y)) throw new Error(`Overlapping atlas rectangle on ${pageName}`); prior.push({ x, y, width, height }); used.set(pageName, prior);
    }
  }
  const paths = new Set<string>();
  for (const [pageKey, page] of Object.entries(manifest.pages)) {
    safePageName(pageKey);
    safePageName(page.path);
    if (pageKey !== page.path) throw new Error(`Atlas page key/path mismatch: ${pageKey}`);
    if (paths.has(page.path)) throw new Error(`Duplicate atlas page path: ${page.path}`);
    paths.add(page.path);
    const role = pageRoles.get(pageKey);
    if (!role) {
      throw new Error(`Atlas page is not referenced by an entry: ${pageKey}`);
    }
    const expectedSize =
      role === "native" ? manifest.pageSize : manifest.pageSize / 2;
    if (
      page.width !== expectedSize
      || page.height !== expectedSize
      || !Number.isSafeInteger(page.bytes)
      || page.bytes < 1
      || !/^[0-9a-f]{64}$/.test(page.sha256)
    ) {
      throw new Error(`Invalid atlas page geometry or metadata: ${page.path}`);
    }
    const file = join(directory, page.path);
    const bytes = await stat(file);
    const buffer = await readFile(file);
    const metadata = await sharp(buffer).metadata();
    if (
      bytes.size !== page.bytes
      || createHash("sha256").update(buffer).digest("hex") !== page.sha256
      || metadata.width !== page.width
      || metadata.height !== page.height
    ) {
      throw new Error(`Atlas page integrity mismatch: ${page.path}`);
    }
  }
  return manifest as VerifiedAtlasManifest;
}
export async function verifyGeneratedAtlas(outputDirectory: string, atlasDirectory: string, gameVersion = "1.0.0"): Promise<CoverageReport> { const manifest = await loadAtlasManifest(atlasDirectory); await verifyAtlasFiles(atlasDirectory, manifest, gameVersion); return verifyAtlasCoverage(await loadGeneratedWorlds(outputDirectory), manifest); }
