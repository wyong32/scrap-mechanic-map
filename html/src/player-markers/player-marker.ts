export const PLAYER_MARKER_TYPES = ["resource", "danger", "base", "vehicle", "note"] as const;

export type PlayerMarkerType = (typeof PLAYER_MARKER_TYPES)[number];

export interface PlayerMarkerPosition {
  x: number;
  y: number;
}

export interface PlayerMarkerDraft {
  mapScopeId: string;
  regionId: string;
  position: PlayerMarkerPosition;
  name: string;
  type: PlayerMarkerType;
  notes: string;
}

export interface PlayerMarker extends PlayerMarkerDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}
