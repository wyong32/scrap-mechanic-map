import {
  parseVerifiedGeneratedBundle,
  type BuildInfoBundle,
  type GeneratedEnvelope
} from "../data/reference-repository";
import { parseTileCatalogDocuments } from "../terrain/tile-catalog";
import { legacyPoiRules } from "../../tools/game-data/legacy/original-poi-rules.ts";
import type {
  LegacyAssetBundle,
  LegacyAssetProvider,
  LegacyAssetRecord,
  LegacyBridgeEntry,
  LegacyPoiRule,
  PreloadedLegacyAsset,
  PreloadedOfficialTile,
  OfficialTileAtlasEntry,
  TerrainCell
} from "./legacy-visual-types";
import { selectLegacyBridgeByUuid } from "./legacy-alias-selector";
import { compareCanonicalStrings } from "../shared/canonical-order";
import { planTerrainAssets, type TerrainAssetPlan } from "./terrain-asset-plan";

export type { LegacyAssetProvider } from "./legacy-visual-types";

interface LegacyAssetsDocument extends GeneratedEnvelope {
  generatedFrom: string[];
  assets: LegacyAssetRecord[];
}

interface OfficialTileAtlasDocument {
  schemaVersion: 1;
  gameVersion: string;
  contentHash: string;
  spriteSize: number;
  pages: Record<string, {
    width: number;
    height: number;
    sha256: string;
  }>;
  entries: Record<string, OfficialTileAtlasEntry>;
}

interface LegacyAssetMetadata {
  legacyRecords: readonly LegacyAssetRecord[];
  legacyByKey: ReadonlyMap<string, LegacyAssetRecord>;
  bridgeByUuid: ReadonlyMap<string, LegacyBridgeEntry>;
  poiByUuid: ReadonlyMap<string, string>;
  poiRules: readonly LegacyPoiRule[];
  officialManifest?: OfficialTileAtlasDocument;
  officialEntries: ReadonlyMap<string, OfficialTileAtlasEntry>;
}

interface ImageDescriptor {
  url: string;
  sha256: string;
  width: number;
  height: number;
  missingMessage: string;
  hashMessage: string;
  decodeMessage?: string;
  dimensionsMessage: string;
}

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#values = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  keys(): MapIterator<K> {
    return this.#values.keys();
  }

  values(): MapIterator<V> {
    return this.#values.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown
  ): void {
    this.#values.forEach((value, key) =>
      callbackfn.call(thisArg, value, key, this)
    );
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return "ImmutableMap";
  }
}

function assertPublicAssetRecord(
  record: LegacyAssetRecord,
  previousKey: string | undefined,
  keys: Set<string>
): void {
  if (
    !record ||
    typeof record !== "object" ||
    !/^(?:tile:\d+|poi:[^/\\]+)$/.test(record.key) ||
    !record.url.startsWith("/legacy/img/") ||
    record.url.includes("\\") ||
    record.url.includes("..") ||
    /[A-Za-z]:/.test(record.url) ||
    !Number.isSafeInteger(record.width) ||
    record.width <= 0 ||
    !Number.isSafeInteger(record.height) ||
    record.height <= 0 ||
    !/^[0-9a-f]{64}$/.test(record.sha256) ||
    record.source !== "the1killer/sm_overview" ||
    keys.has(record.key) ||
    (previousKey !== undefined && compareAssetKeys(previousKey, record.key) > 0)
  ) {
    throw new Error("Generated legacy asset manifest is malformed or non-canonical.");
  }
}

function compareAssetKeys(left: string, right: string): number {
  const [leftKind, leftName] = left.split(":", 2);
  const [rightKind, rightName] = right.split(":", 2);
  if (leftKind !== rightKind) return leftKind === "tile" ? -1 : 1;
  return leftKind === "tile"
    ? Number(leftName) - Number(rightName)
    : compareCanonicalStrings(leftName!, rightName!);
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Text(text: string): Promise<string> {
  return sha256(new TextEncoder().encode(text).buffer);
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

async function parseOfficialManifest(
  text: string,
  expectedGameVersion: string
): Promise<OfficialTileAtlasDocument> {
  const manifest = JSON.parse(text) as OfficialTileAtlasDocument;
  const { contentHash, ...payload } = manifest;
  if (
    manifest.schemaVersion !== 1
    || manifest.gameVersion !== expectedGameVersion
    || !/^[0-9a-f]{64}$/.test(contentHash)
    || await sha256Text(JSON.stringify(canonicalize(payload))) !== contentHash
  ) {
    throw new Error("Official tile atlas manifest failed its integrity check.");
  }
  if (
    !manifest.pages
    || typeof manifest.pages !== "object"
    || Array.isArray(manifest.pages)
    || !manifest.entries
    || typeof manifest.entries !== "object"
    || Array.isArray(manifest.entries)
  ) {
    throw new Error("Official tile atlas manifest is malformed.");
  }
  for (const [pageName, record] of Object.entries(manifest.pages)) {
    if (
      !/^(?:official-(?:icons-)?|orthographic-)(?:0|[1-9]\d*)\.webp$/.test(pageName)
      || !record
      || typeof record !== "object"
      || !Number.isSafeInteger(record.width)
      || !Number.isSafeInteger(record.height)
      || record.width <= 0
      || record.height <= 0
      || !/^[0-9a-f]{64}$/.test(record.sha256)
    ) {
      throw new Error("Official tile atlas manifest is malformed.");
    }
  }
  for (const [uuid, entry] of Object.entries(manifest.entries)) {
    const page = manifest.pages[entry.page];
    const iconPage = entry.icon
      ? manifest.pages[entry.icon.page]
      : undefined;
    if (
      uuid !== uuid.toLowerCase()
      || entry.uuid !== uuid
      || !page
      || !/^(?:official|orthographic)-(?:0|[1-9]\d*)\.webp$/.test(entry.page)
      || !Number.isSafeInteger(entry.x)
      || !Number.isSafeInteger(entry.y)
      || !Number.isSafeInteger(entry.width)
      || !Number.isSafeInteger(entry.height)
      || !Number.isSafeInteger(entry.spanWidth)
      || !Number.isSafeInteger(entry.spanHeight)
      || (entry.renderMode !== undefined
        && entry.renderMode !== "terrain"
        && entry.renderMode !== "isometric-thumbnail")
      || (entry.projection !== undefined
        && entry.projection !== "verified-orthographic"
        && entry.projection !== "isometric-preview")
      || entry.width <= 0
      || entry.height <= 0
      || entry.spanWidth <= 0
      || entry.spanHeight <= 0
      || entry.x < 0
      || entry.y < 0
      || entry.x + entry.width > page.width
      || entry.y + entry.height > page.height
      || (entry.icon !== undefined && (
        !iconPage
        || !/^official-icons-(?:0|[1-9]\d*)\.webp$/.test(entry.icon.page)
        || !Number.isSafeInteger(entry.icon.x)
        || !Number.isSafeInteger(entry.icon.y)
        || !Number.isSafeInteger(entry.icon.width)
        || !Number.isSafeInteger(entry.icon.height)
        || entry.icon.width <= 0
        || entry.icon.height <= 0
        || entry.icon.x < 0
        || entry.icon.y < 0
        || entry.icon.x + entry.icon.width > iconPage.width
        || entry.icon.y + entry.icon.height > iconPage.height
      ))
    ) {
      throw new Error("Official tile atlas manifest is malformed.");
    }
  }
  return manifest;
}

async function fetchText(url: string, label: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load legacy asset ${label}.`);
  return response.text();
}

export class LegacyAssetRepository implements LegacyAssetProvider {
  private generation = 0;
  private metadata?: Promise<LegacyAssetMetadata>;
  private readonly byteLoads = new Map<string, Promise<ArrayBuffer>>();
  private readonly imageLoads = new Map<string, Promise<HTMLImageElement>>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly objectUrls = new Map<string, string>();

  constructor(
    private readonly manifestUrl: string | undefined,
    private readonly catalogUrl: string,
    private readonly buildInfoUrl: string,
    private readonly officialManifestUrl?: string
  ) {}

  async loadForCells(
    cells: readonly TerrainCell[],
    policy: "legacy-fallback" | "official-1.0-only" = "legacy-fallback"
  ): Promise<LegacyAssetBundle> {
    const generation = this.generation;
    const metadata = await this.loadMetadata();
    this.assertCurrentGeneration(generation);
    const plan = planTerrainAssets({
      cells,
      legacyRecords: metadata.legacyRecords,
      bridgeByUuid: metadata.bridgeByUuid,
      poiByUuid: metadata.poiByUuid,
      poiRules: metadata.poiRules,
      officialEntries: metadata.officialEntries,
      allowLegacyFallback: policy === "legacy-fallback"
    });
    return this.loadPlan(metadata, plan);
  }

  destroy(): void {
    this.generation += 1;
    for (const image of this.images.values()) image.src = "";
    if (typeof URL.revokeObjectURL === "function") {
      for (const objectUrl of this.objectUrls.values()) {
        URL.revokeObjectURL(objectUrl);
      }
    }
    this.images.clear();
    this.objectUrls.clear();
    this.imageLoads.clear();
    this.byteLoads.clear();
    this.metadata = undefined;
  }

  private loadMetadata(): Promise<LegacyAssetMetadata> {
    if (this.metadata) return this.metadata;
    const pending = this.fetchMetadata().catch((error: unknown) => {
      if (this.metadata === pending) this.metadata = undefined;
      throw error;
    });
    this.metadata = pending;
    return pending;
  }

  private async fetchMetadata(): Promise<LegacyAssetMetadata> {
    const metadata = await Promise.allSettled([
      this.manifestUrl
        ? fetchText(this.manifestUrl, "manifest")
        : Promise.resolve(undefined),
      fetchText(this.catalogUrl, "catalog"),
      fetchText(this.buildInfoUrl, "build-info"),
      this.officialManifestUrl
        ? fetchText(this.officialManifestUrl, "official atlas manifest")
        : Promise.resolve(undefined)
    ]);
    const metadataFailure = metadata.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (metadataFailure) throw metadataFailure.reason;
    const [
      manifestText,
      catalogText,
      buildInfoText,
      officialManifestText
    ] = metadata.map(
      (result) => (result as PromiseFulfilledResult<string | undefined>).value
    );
    const buildInfo = await parseVerifiedGeneratedBundle<BuildInfoBundle>(
      buildInfoText!,
      "build-info.json"
    );
    const [manifest, catalog] = await Promise.all([
      manifestText
        ? parseVerifiedGeneratedBundle<LegacyAssetsDocument>(
            manifestText,
            "legacy-assets.json",
            buildInfo
          )
        : Promise.resolve(undefined),
      parseTileCatalogDocuments(buildInfoText!, catalogText!)
    ]);
    const officialManifest = officialManifestText
      ? await parseOfficialManifest(officialManifestText, buildInfo.gameVersion)
      : undefined;

    let previousKey: string | undefined;
    const keys = new Set<string>();
    const descriptorByUrl = new Map<string, LegacyAssetRecord>();
    const legacyRecords = (manifest?.assets ?? []).map((record) => {
      assertPublicAssetRecord(record, previousKey, keys);
      const existingDescriptor = descriptorByUrl.get(record.url);
      if (
        existingDescriptor
        && (
          existingDescriptor.sha256 !== record.sha256
          || existingDescriptor.width !== record.width
          || existingDescriptor.height !== record.height
        )
      ) {
        throw new Error(
          "Generated legacy asset manifest has a repeated URL with a conflicting integrity descriptor."
        );
      }
      keys.add(record.key);
      descriptorByUrl.set(record.url, record);
      previousKey = record.key;
      return Object.freeze({ ...record });
    });
    const legacyByKey = new Map(
      legacyRecords.map((record) => [record.key, record] as const)
    );
    const poiRules = Object.freeze(
      legacyPoiRules.map((rule) =>
        Object.freeze({
          ...rule,
          ...("legacyIds" in rule && rule.legacyIds
            ? {
                legacyIds: Object.freeze([
                  ...rule.legacyIds
                ]) as unknown as number[]
              }
            : {}),
          ...(rule.coordinate
            ? { coordinate: Object.freeze({ ...rule.coordinate }) }
            : {})
        })
      )
    ) as readonly LegacyPoiRule[];
    const bridgeByUuid = selectLegacyBridgeByUuid(
      catalog.legacyBridge,
      legacyByKey,
      poiRules
    );
    const poiByUuid = new Map(
      Object.entries(catalog.tiles).flatMap(([uuid, tile]) => tile.poiType
        ? [[uuid, tile.poiType] as const]
        : [])
    );
    const officialEntries = new Map(
      Object.entries(officialManifest?.entries ?? {}).map(([uuid, entry]) => [
        uuid,
        Object.freeze({
          ...entry,
          ...(entry.icon ? { icon: Object.freeze({ ...entry.icon }) } : {})
        })
      ] as const)
    );
    return Object.freeze({
      legacyRecords: Object.freeze(legacyRecords),
      legacyByKey: new ImmutableMap(legacyByKey),
      bridgeByUuid: new ImmutableMap(
        [...bridgeByUuid].map(([uuid, entry]) => [
          uuid,
          Object.freeze({ ...entry })
        ])
      ),
      poiByUuid: new ImmutableMap(poiByUuid),
      poiRules,
      ...(officialManifest ? { officialManifest } : {}),
      officialEntries: new ImmutableMap(officialEntries)
    });
  }

  private async loadPlan(
    metadata: LegacyAssetMetadata,
    plan: TerrainAssetPlan
  ): Promise<LegacyAssetBundle> {
    const generation = this.generation;
    const legacyAssetLoads = plan.legacyKeys.map(async (key) => {
      const record = metadata.legacyByKey.get(key)!;
      const image = await this.loadImage({
        url: record.url,
        sha256: record.sha256,
        width: record.width,
        height: record.height,
        missingMessage: `Legacy asset '${record.key}' is missing.`,
        hashMessage: `Legacy asset '${record.key}' failed its hash check.`,
        decodeMessage: `Legacy asset '${record.key}' could not be decoded.`,
        dimensionsMessage: `Legacy asset '${record.key}' has unexpected dimensions.`
      });
      return [
        record.key,
        Object.freeze({ record, image })
      ] as const;
    });
    const officialPageNames = [...plan.officialPages];
    const officialPageLoads = officialPageNames.map(async (pageName) => {
      const record = metadata.officialManifest!.pages[pageName]!;
      const image = await this.loadImage({
        url: `/atlas/official/${pageName}`,
        sha256: record.sha256,
        width: record.width,
        height: record.height,
        missingMessage: `Official atlas page '${pageName}' is missing.`,
        hashMessage: `Official atlas page '${pageName}' failed its hash check.`,
        dimensionsMessage: `Official atlas page '${pageName}' has unexpected dimensions.`
      });
      return [pageName, image] as const;
    });
    const [loaded, loadedPages] = await Promise.all([
      Promise.allSettled(legacyAssetLoads),
      Promise.allSettled(officialPageLoads)
    ]);
    this.assertCurrentGeneration(generation);
    const failure = loaded.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failure) {
      throw failure.reason;
    }
    const assetEntries = loaded.map(
      (result) => (result as PromiseFulfilledResult<
        readonly [string, PreloadedLegacyAsset]
      >).value
    );
    const officialPages = new Map<string, HTMLImageElement>();
    for (const result of loadedPages) {
      if (result.status === "fulfilled") {
        officialPages.set(...result.value);
      }
    }
    const pageFailure = loadedPages.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (pageFailure) {
      throw pageFailure.reason;
    }
    const officialEntries: Array<readonly [string, PreloadedOfficialTile]> =
      plan.officialUuids.map((uuid) => {
        const entry = metadata.officialEntries.get(uuid)!;
        const iconImage = entry.icon
          ? officialPages.get(entry.icon.page)
          : undefined;
        return [
          uuid,
          Object.freeze({
            entry,
            image: officialPages.get(entry.page)!,
            ...(iconImage ? { iconImage } : {})
          })
        ];
      });
    return Object.freeze({
      assets: new ImmutableMap(assetEntries),
      bridgeByUuid: metadata.bridgeByUuid,
      poiByUuid: metadata.poiByUuid,
      poiRules: metadata.poiRules,
      ...(officialEntries.length > 0
        ? { officialByUuid: new ImmutableMap(officialEntries) }
        : {})
    });
  }

  private loadImage(descriptor: ImageDescriptor): Promise<HTMLImageElement> {
    const existing = this.imageLoads.get(descriptor.url);
    if (existing) return existing;
    const generation = this.generation;
    const pending = this.fetchVerifiedImage(descriptor, generation).catch((error: unknown) => {
      if (this.imageLoads.get(descriptor.url) === pending) {
        this.imageLoads.delete(descriptor.url);
      }
      throw error;
    });
    this.imageLoads.set(descriptor.url, pending);
    return pending;
  }

  private loadBytes(
    descriptor: ImageDescriptor,
    generation: number
  ): Promise<ArrayBuffer> {
    const existing = this.byteLoads.get(descriptor.url);
    if (existing) return existing;
    const pending = this.fetchVerifiedBytes(descriptor, generation).catch((error: unknown) => {
      if (this.byteLoads.get(descriptor.url) === pending) {
        this.byteLoads.delete(descriptor.url);
      }
      throw error;
    });
    this.byteLoads.set(descriptor.url, pending);
    return pending;
  }

  private async fetchVerifiedBytes(
    descriptor: ImageDescriptor,
    generation: number
  ): Promise<ArrayBuffer> {
    const response = await fetch(descriptor.url);
    this.assertCurrentGeneration(generation);
    if (!response.ok) throw new Error(descriptor.missingMessage);
    const bytes = await response.arrayBuffer();
    this.assertCurrentGeneration(generation);
    const digest = await sha256(bytes);
    this.assertCurrentGeneration(generation);
    if (digest !== descriptor.sha256) {
      throw new Error(descriptor.hashMessage);
    }
    return bytes;
  }

  private async fetchVerifiedImage(
    descriptor: ImageDescriptor,
    generation: number
  ): Promise<HTMLImageElement> {
    const bytes = await this.loadBytes(descriptor, generation);
    this.assertCurrentGeneration(generation);
    const image = new Image();
    const objectUrl = typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(new Blob([bytes]))
      : descriptor.url;
    image.src = objectUrl;
    try {
      try {
        await image.decode();
      } catch (error) {
        throw descriptor.decodeMessage
          ? new Error(descriptor.decodeMessage, { cause: error })
          : error;
      }
      this.assertCurrentGeneration(generation);
      if (
        image.naturalWidth !== descriptor.width
        || image.naturalHeight !== descriptor.height
      ) {
        throw new Error(descriptor.dimensionsMessage);
      }
    } catch (error) {
      image.src = "";
      if (
        objectUrl !== descriptor.url
        && typeof URL.revokeObjectURL === "function"
      ) {
        URL.revokeObjectURL(objectUrl);
      }
      throw error;
    }
    this.images.set(descriptor.url, image);
    if (objectUrl !== descriptor.url) {
      this.objectUrls.set(descriptor.url, objectUrl);
    }
    return image;
  }

  private assertCurrentGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new Error("Legacy asset repository was destroyed during loading.");
    }
  }
}
