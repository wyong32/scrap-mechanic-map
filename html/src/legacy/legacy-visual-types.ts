import type { TerrainCell } from "../domain/map-model";
import type { LegacyBridgeEntry } from "../terrain/tile-catalog";
import type { LegacyAssetRecord } from "../../tools/game-data/legacy/legacy-assets.ts";
import type { LegacyPoiRule } from "../../tools/game-data/legacy/original-poi-rules.ts";
import type { LegacyMultiCellPoiRule } from "../../tools/game-data/legacy/original-poi-rules.ts";

export type {
  LegacyAssetRecord,
  LegacyBridgeEntry,
  LegacyMultiCellPoiRule,
  LegacyPoiRule,
  TerrainCell
};

export interface PreloadedLegacyAsset {
  record: LegacyAssetRecord;
  image: HTMLImageElement;
  sourceRect?: { x: number; y: number; width: number; height: number };
}

export interface OfficialTileAtlasEntry {
  uuid: string;
  page: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spanWidth: number;
  spanHeight: number;
  renderMode?: "terrain" | "isometric-thumbnail";
  projection?: "verified-orthographic" | "isometric-preview";
  icon?: {
    page: string;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PreloadedOfficialTile {
  entry: OfficialTileAtlasEntry;
  image: HTMLImageElement;
  iconImage?: HTMLImageElement;
}

export interface LegacyAssetBundle {
  assets: ReadonlyMap<string, PreloadedLegacyAsset>;
  bridgeByUuid: ReadonlyMap<string, LegacyBridgeEntry>;
  poiByUuid?: ReadonlyMap<string, string>;
  poiRules: readonly LegacyPoiRule[];
  officialByUuid?: ReadonlyMap<string, PreloadedOfficialTile>;
}

export interface LegacyAssetProvider {
  loadForCells(
    cells: readonly TerrainCell[],
    policy?: "legacy-fallback" | "official-1.0-only"
  ): Promise<LegacyAssetBundle>;
  destroy(): void;
}

export interface ResolvedTerrainVisual {
  origin: { x: number; y: number };
  span: { width: number; height: number };
  rotation: 0 | 1 | 2 | 3;
  source:
    | "legacy-tile"
    | "legacy-poi"
    | "one-dot-zero-tile"
    | "one-dot-zero-thumbnail"
    | "one-dot-zero-fallback";
  asset?: PreloadedLegacyAsset;
  overlayAsset?: PreloadedLegacyAsset;
  terrainType: string;
  coveredCells: readonly string[];
}
