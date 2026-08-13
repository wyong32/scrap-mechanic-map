import type { TerrainCell, WorldMap } from "../../../src/domain/map-model.ts";

export type AtlasKey = `${string}:${number}:${number}:${0 | 1 | 2 | 3}`;

export interface AtlasSourceCell { key: AtlasKey; imagePath: string; logicalSize: number; sourceHash: string; }
export interface AtlasManifestEntry { page: string; lowPage: string; x: number; y: number; width: number; height: number; lowX: number; lowY: number; lowWidth: number; lowHeight: number; logicalSize: number; sourceHash: string; }
export interface AtlasPage { path: string; bytes: number; sha256: string; width: number; height: number; }
export interface AtlasManifest { schemaVersion: 1; gameVersion: string; generatedFrom: string[]; contentHash: string; entries: Record<AtlasKey, AtlasManifestEntry>; pages: Record<string, AtlasPage>; pageSize: number; }
export interface CoverageReport { occurrences: number; distinctKeys: number; covered: number; missing: Array<{ regionId: string; uuid: string; xOffset: number; yOffset: number; rotation: 0 | 1 | 2 | 3 }>; }

export function normalizeUuid(uuid: string): string {
  const normalized = uuid.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) throw new Error(`Invalid tile UUID: ${uuid}`);
  return normalized;
}
export function atlasKey(uuid: string, xOffset: number, yOffset: number, rotation: 0 | 1 | 2 | 3): AtlasKey {
  if (!Number.isInteger(xOffset) || !Number.isInteger(yOffset)) throw new Error("Atlas offsets must be integers");
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw new Error("Atlas rotation must be 0, 1, 2, or 3");
  return `${normalizeUuid(uuid)}:${xOffset}:${yOffset}:${rotation}`;
}
export function canonicalAtlasKey(value: string): AtlasKey {
  const parts = value.split(":");
  if (parts.length !== 4 || !parts.every((part) => part.length > 0)) throw new Error(`Invalid atlas key: ${value}`);
  return atlasKey(parts[0], Number(parts[1]), Number(parts[2]), Number(parts[3]) as 0 | 1 | 2 | 3);
}
export function atlasKeyForCell(cell: Pick<TerrainCell, "uuid" | "xOffset" | "yOffset" | "rotation">): AtlasKey { return atlasKey(cell.uuid, cell.xOffset, cell.yOffset, cell.rotation); }

/** The report intentionally preserves world order for actionable, reproducible intake lists. */
export function verifyAtlasCoverage(worlds: WorldMap[], manifest: AtlasManifest): CoverageReport {
  const missing: CoverageReport["missing"] = []; let covered = 0; const keys = new Set<string>(); let occurrences = 0;
  for (const world of worlds) for (const cell of world.cells) {
    const key = atlasKeyForCell(cell); keys.add(key); occurrences++;
    if (manifest.entries[key]) covered++; else missing.push({ regionId: world.id, uuid: normalizeUuid(cell.uuid), xOffset: cell.xOffset, yOffset: cell.yOffset, rotation: cell.rotation });
  }
  return { occurrences, distinctKeys: keys.size, covered, missing };
}
