export const MAP_LAYER_IDS = [
  "terrain",
  "labels",
  "player-markers",
  "roads",
  "poi",
  "quest",
  "resource",
  "danger",
  "grid",
  "progress"
] as const;

export type MapLayerId = (typeof MAP_LAYER_IDS)[number];

export interface MapLayerDefinition {
  id: MapLayerId;
  available: boolean;
  defaultVisible: boolean;
  categoryIds: readonly string[];
}

export const MAP_LAYER_DEFINITIONS: readonly MapLayerDefinition[] = [
  { id: "terrain", available: true, defaultVisible: true, categoryIds: [] },
  { id: "labels", available: true, defaultVisible: false, categoryIds: [] },
  {
    id: "player-markers",
    available: true,
    defaultVisible: true,
    categoryIds: []
  },
  { id: "roads", available: false, defaultVisible: false, categoryIds: [] },
  {
    id: "poi",
    available: true,
    defaultVisible: false,
    categoryIds: ["poi", "guide"]
  },
  {
    id: "quest",
    available: true,
    defaultVisible: false,
    categoryIds: ["quest"]
  },
  {
    id: "resource",
    available: true,
    defaultVisible: false,
    categoryIds: ["resource"]
  },
  {
    id: "danger",
    available: true,
    defaultVisible: false,
    categoryIds: ["danger", "boss"]
  },
  { id: "grid", available: true, defaultVisible: false, categoryIds: [] },
  { id: "progress", available: false, defaultVisible: false, categoryIds: [] }
];

export const DEFAULT_MAP_LAYER_IDS: readonly MapLayerId[] =
  MAP_LAYER_DEFINITIONS.filter(
    (layer) => layer.available && layer.defaultVisible
  ).map((layer) => layer.id);

const mapLayerIdSet = new Set<string>(MAP_LAYER_IDS);

export function isMapLayerId(value: string): value is MapLayerId {
  return mapLayerIdSet.has(value);
}

export function normalizeMapLayerIds(values: readonly string[]): MapLayerId[] {
  return [...new Set(values.filter(isMapLayerId))];
}

export function resolveVisibleMapLayerIds(
  values: readonly string[]
): ReadonlySet<MapLayerId> {
  const normalized = normalizeMapLayerIds(values);
  const hasAvailableLayer = normalized.some((id) =>
    MAP_LAYER_DEFINITIONS.some(
      (definition) => definition.id === id && definition.available
    )
  );

  return new Set(
    hasAvailableLayer
      ? normalized
      : [...normalized, ...DEFAULT_MAP_LAYER_IDS]
  );
}

export function getMapLayerDefinition(
  layerId: string
): MapLayerDefinition | undefined {
  return MAP_LAYER_DEFINITIONS.find((definition) => definition.id === layerId);
}
