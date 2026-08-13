import type { PlayerMarkerType } from "../player-markers/player-marker";

export type Precision = "exact" | "save-exact" | "area-reference" | "unknown";
export type Progress = "locked" | "available" | "visited" | "completed" | "unknown";

export const MIN_MAP_ZOOM = -3;
export const MAX_MAP_ZOOM = 0;

export interface CellBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TerrainCell {
  x: number;
  y: number;
  uuid: string;
  rotation: 0 | 1 | 2 | 3;
  xOffset: number;
  yOffset: number;
  flags: number;
  terrainType: string;
  poiType?: string;
}

export interface MapLocation {
  id: string;
  regionId: string;
  name: string;
  category: string;
  precision: Precision;
  position?: { x: number; y: number; z?: number };
  bounds?: CellBounds;
  questIds: string[];
  resourceIds: string[];
  enemyIds: string[];
  progress?: Progress;
  relatedRegionIds: string[];
}

export interface WorldMap {
  id: string;
  source: "reference" | "save" | "fixed-region";
  gameVersion: string;
  saveVersion?: number;
  seed?: number;
  bounds: CellBounds;
  cells: TerrainCell[];
  locations: MapLocation[];
  connections: WorldConnection[];
}

export interface WorldConnection {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  fromPosition?: { x: number; y: number; z?: number };
  toPosition?: { x: number; y: number; z?: number };
}

export interface RegionDefinition {
  id: string;
  name: string;
  group: "surface" | "story" | "grow-lab" | "underground" | "boss";
  source: "reference" | "fixed-region" | "generated";
  bounds: CellBounds;
}

export interface MapUiState {
  regionId: string;
  zoom: number;
  center: { x: number; y: number };
  query: string;
  categoryIds: string[];
  locationTypeIds: string[];
  playerMarkerTypeIds: PlayerMarkerType[];
  layerIds: string[];
  selectedLocationId?: string;
}

export interface MapRepository {
  loadRegions(): Promise<RegionDefinition[]>;
  loadLocations(): Promise<MapLocation[]>;
  loadWorld(regionId: string): Promise<WorldMap>;
}
