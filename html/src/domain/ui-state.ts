import {
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  type MapUiState
} from "./map-model";
import { normalizeMapLayerIds } from "./map-layers";
import {
  PLAYER_MARKER_TYPES,
  type PlayerMarkerType
} from "../player-markers/player-marker";

const DEFAULT_PLAYER_MARKER_TYPE_IDS = [...PLAYER_MARKER_TYPES].sort();
const LOCATION_TYPE_ID_PATTERN = /^(fixed|generated):[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULT_UI_STATE: MapUiState = {
  regionId: "surface",
  zoom: 0,
  center: { x: 0, y: 0 },
  query: "",
  categoryIds: [],
  locationTypeIds: [],
  playerMarkerTypeIds: DEFAULT_PLAYER_MARKER_TYPE_IDS,
  layerIds: [],
};

const MAX_STRING_LENGTH = 100;

function readString(value: string | null): string | undefined {
  if (value === null || value.length > MAX_STRING_LENGTH) {
    return undefined;
  }

  return value;
}

function readIdList(value: string | null): string[] {
  if (value === null || value.length === 0) {
    return [];
  }

  return value.split(",").filter((id) => id.length > 0 && id.length <= MAX_STRING_LENGTH);
}

function normalizePlayerMarkerTypeIds(values: readonly string[]): PlayerMarkerType[] {
  const allowed = new Set<string>(PLAYER_MARKER_TYPES);
  return [...new Set(values.filter((value) => allowed.has(value)))]
    .sort() as PlayerMarkerType[];
}

function normalizeLocationTypeIds(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => LOCATION_TYPE_ID_PATTERN.test(value)))]
    .sort();
}

function readFiniteNumber(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readZoom(value: string | null): number | undefined {
  const zoom = readFiniteNumber(value);
  if (zoom === undefined || !Number.isInteger(zoom)) return undefined;
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, zoom));
}

function setString(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value.length <= MAX_STRING_LENGTH) {
    params.set(key, value);
  }
}

function setIdList(params: URLSearchParams, key: string, values: string[]): void {
  const validValues = values.filter((value) => value.length > 0 && value.length <= MAX_STRING_LENGTH);
  if (validValues.length > 0) {
    params.set(key, validValues.join(","));
  }
}

export function parseUiState(search: string): MapUiState {
  const params = new URLSearchParams(search);
  const regionId = readString(params.get("region"));
  const query = readString(params.get("q"));
  const selectedLocationId = readString(params.get("selected"));

  return {
    regionId: regionId && regionId.length > 0 ? regionId : DEFAULT_UI_STATE.regionId,
    zoom: readZoom(params.get("z")) ?? DEFAULT_UI_STATE.zoom,
    center: {
      x: readFiniteNumber(params.get("x")) ?? DEFAULT_UI_STATE.center.x,
      y: readFiniteNumber(params.get("y")) ?? DEFAULT_UI_STATE.center.y,
    },
    query: query ?? DEFAULT_UI_STATE.query,
    categoryIds: readIdList(params.get("cat")),
    locationTypeIds: normalizeLocationTypeIds(readIdList(params.get("locationTypes"))),
    playerMarkerTypeIds: params.has("markers")
      ? normalizePlayerMarkerTypeIds(readIdList(params.get("markers")))
      : [...DEFAULT_UI_STATE.playerMarkerTypeIds],
    layerIds: normalizeMapLayerIds(readIdList(params.get("layers"))),
    ...(selectedLocationId && selectedLocationId.length > 0 ? { selectedLocationId } : {}),
  };
}

export function serializeUiState(state: MapUiState): string {
  const params = new URLSearchParams();
  setString(params, "region", state.regionId);

  if (
    Number.isInteger(state.zoom)
    && state.zoom >= MIN_MAP_ZOOM
    && state.zoom <= MAX_MAP_ZOOM
  ) {
    params.set("z", String(state.zoom));
  }
  if (Number.isFinite(state.center.x)) {
    params.set("x", String(state.center.x));
  }
  if (Number.isFinite(state.center.y)) {
    params.set("y", String(state.center.y));
  }

  setString(params, "q", state.query);
  setIdList(params, "cat", state.categoryIds);
  setIdList(
    params,
    "locationTypes",
    normalizeLocationTypeIds(state.locationTypeIds),
  );
  const playerMarkerTypeIds = normalizePlayerMarkerTypeIds(
    state.playerMarkerTypeIds
  );
  if (
    playerMarkerTypeIds.length !== DEFAULT_PLAYER_MARKER_TYPE_IDS.length
    || playerMarkerTypeIds.some(
      (typeId, index) => typeId !== DEFAULT_PLAYER_MARKER_TYPE_IDS[index]
    )
  ) {
    params.set("markers", playerMarkerTypeIds.join(","));
  }
  setIdList(params, "layers", normalizeMapLayerIds(state.layerIds));
  setString(params, "selected", state.selectedLocationId);

  const encoded = params.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}
