import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";
import type { LegacyPoiRule } from "./original-poi-rules.ts";
import { compareCanonicalStrings } from "../../../src/shared/canonical-order.ts";

export interface LegacyAssetRecord {
  key: `tile:${number}` | `poi:${string}`;
  url: string;
  width: number;
  height: number;
  sha256: string;
  source: "the1killer/sm_overview";
}

export interface LegacyAssetsPayload {
  schemaVersion: number;
  gameVersion: string;
  generatedFrom: string[];
  assets: LegacyAssetRecord[];
  contentHash: string;
}

export interface LegacyAssetManifestOptions {
  assetDirectory: string;
  poiRules: LegacyPoiRule[];
  gameVersion?: string;
}

const TILE_COUNT = 297;
const SOURCE = "the1killer/sm_overview" as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  return value;
}

export function computeLegacyAssetContentHash(payload: Record<string, unknown>): string {
  const { contentHash: _contentHash, ...withoutHash } = payload;
  return createHash("sha256").update(JSON.stringify(canonicalize(withoutHash))).digest("hex");
}

function withHash(payload: Omit<LegacyAssetsPayload, "contentHash">): LegacyAssetsPayload {
  const result = { ...payload, contentHash: "" } as LegacyAssetsPayload;
  result.contentHash = computeLegacyAssetContentHash(result as unknown as Record<string, unknown>);
  return canonicalize(result) as LegacyAssetsPayload;
}

function assertLocalUrl(url: string): void {
  if (!url.startsWith("/legacy/img/") || /[A-Za-z]:|\\|\.\./.test(url)) throw new Error(`unsafe legacy asset URL '${url}'`);
}

function compareRecords(left: LegacyAssetRecord, right: LegacyAssetRecord): number {
  const [leftKind, leftName] = left.key.split(":", 2);
  const [rightKind, rightName] = right.key.split(":", 2);
  if (leftKind !== rightKind) return leftKind === "tile" ? -1 : 1;
  return leftKind === "tile"
    ? Number(leftName) - Number(rightName)
    : compareCanonicalStrings(leftName!, rightName!);
}

async function recordForFile(assetDirectory: string, file: string, key: LegacyAssetRecord["key"]): Promise<LegacyAssetRecord> {
  const filePath = join(assetDirectory, file);
  const bytes = await readFile(filePath);
  if (bytes.length === 0) throw new Error(`legacy asset '${file}' is zero-sized`);
  let metadata: Metadata;
  try { metadata = await sharp(bytes, { failOn: "error" }).metadata(); }
  catch { throw new Error(`legacy asset '${file}' is unreadable`); }
  if (!metadata.width || !metadata.height) throw new Error(`legacy asset '${file}' has no dimensions`);
  const url = `/legacy/img/${file.replace(/\\/g, "/")}`;
  assertLocalUrl(url);
  return { key, url, width: metadata.width, height: metadata.height, sha256: createHash("sha256").update(bytes).digest("hex"), source: SOURCE };
}

function assertUnique(records: LegacyAssetRecord[]): void {
  const keys = new Set<string>();
  for (const record of records) {
    if (keys.has(record.key)) throw new Error(`duplicate legacy asset key '${record.key}'`);
    keys.add(record.key);
  }
}

function assertRulesReferenceAssets(poiRules: LegacyPoiRule[], records: LegacyAssetRecord[]): void {
  const keys = new Set(records.map((record) => record.key));
  for (const rule of poiRules) {
    if (!keys.has(rule.imageKey)) {
      const label = rule.kind === "multi-cell-poi"
        ? rule.poiType
        : `${rule.coordinate.x},${rule.coordinate.y}`;
      throw new Error(
        `POI rule '${label}' references absent image '${rule.imageKey}'`
      );
    }
  }
}

export async function buildLegacyAssetManifest(options: LegacyAssetManifestOptions): Promise<LegacyAssetsPayload> {
  const tileDirectory = join(options.assetDirectory, "tiles");
  const tileFiles = (await readdir(tileDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jpg"));
  const ids = new Set<number>();
  const tiles = tileFiles.map((entry) => {
    const filename = entry.name.replace(/\.jpg$/i, "");
    if (!/^\d+$/.test(filename)) throw new Error(`legacy tile '${entry.name}' has a non-numeric ID`);
    const id = Number(filename);
    if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error(`duplicate legacy tile ID '${id}'`);
    ids.add(id);
    return { entry, id };
  });
  const records: LegacyAssetRecord[] = [];
  for (const { entry, id } of tiles) {
    records.push(await recordForFile(options.assetDirectory, join("tiles", entry.name), `tile:${id}`));
  }
  if (records.length !== TILE_COUNT) throw new Error(`expected ${TILE_COUNT} numeric JPG legacy tiles, found ${records.length}`);

  for (const entry of await readdir(options.assetDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:jpg|png)$/i.test(entry.name)) continue;
    records.push(await recordForFile(options.assetDirectory, entry.name, `poi:${entry.name}`));
  }
  assertUnique(records);
  assertRulesReferenceAssets(options.poiRules, records);
  return withHash({ schemaVersion: 1, gameVersion: options.gameVersion ?? "1.0.0", generatedFrom: ["html/local-assets/legacy/img"], assets: records.sort(compareRecords) });
}

function parsePayload(text: string): LegacyAssetsPayload {
  if (text.includes("\r")) throw new Error("legacy asset manifest must not use CRLF line endings");
  let payload: LegacyAssetsPayload;
  try { payload = JSON.parse(text) as LegacyAssetsPayload; }
  catch { throw new Error("legacy asset manifest is invalid JSON"); }
  if (payload.contentHash !== computeLegacyAssetContentHash(payload as unknown as Record<string, unknown>)) throw new Error("legacy asset manifest content hash mismatch");
  return payload;
}

export async function verifyLegacyAssetManifest(options: LegacyAssetManifestOptions & { manifestFile: string }): Promise<void> {
  const payload = parsePayload(await readFile(options.manifestFile, "utf8"));
  assertUnique(payload.assets);
  assertRulesReferenceAssets(options.poiRules, payload.assets);
  for (const record of payload.assets) assertLocalUrl(record.url);
  const expected = await buildLegacyAssetManifest(options);
  if (JSON.stringify(payload.assets) !== JSON.stringify(expected.assets)) throw new Error("legacy asset manifest differs from current image hashes or dimensions");
}
