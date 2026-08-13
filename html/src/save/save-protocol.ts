import type { WorldConnection } from "../domain/map-model";
import type { TileCatalog } from "../terrain/normalize-terrain";

export type SaveStage =
  | "reading"
  | "sqlite"
  | "decompressing"
  | "decoding"
  | "normalizing"
  | "rendering";

export type SaveErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "NOT_SQLITE"
  | "NOT_SURVIVAL_SAVE"
  | "UNSUPPORTED_SAVE_VERSION"
  | "MISSING_SURFACE_DATA"
  | "DECOMPRESSION_FAILED"
  | "DECODE_FAILED"
  | "UNKNOWN_TILE_UUID"
  | "UNSUPPORTED_BROWSER";

export type LuaValue =
  | null
  | boolean
  | number
  | string
  | { kind: "array"; values: LuaValue[]; negativeValues: Record<number, LuaValue> }
  | { kind: "table"; entries: Array<[LuaValue, LuaValue]> }
  | { kind: "uuid"; value: string }
  | { kind: "vec3"; x: number; y: number; z: number };

export interface SupportedProgressRecord {
  locationId: string;
  state: "locked" | "available" | "visited" | "completed";
  source: "script-data" | "generic-data" | "portal";
}

export interface SaveMetadata {
  fileName: string;
  saveVersion: 28;
  seed: number;
}

export interface NormalizedTerrainTransfer {
  gameVersion: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  uuids: string[];
  terrainTypes: string[];
  poiTypes: Array<string | null>;
  uuidIndexes: Uint16Array;
  xOffsets: Int32Array;
  yOffsets: Int32Array;
  rotations: Uint8Array;
  flags: Int32Array;
}

export interface SaveOverviewArtifact {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface DecodedSave {
  metadata: SaveMetadata;
  terrain: NormalizedTerrainTransfer;
  overview?: SaveOverviewArtifact;
  connections: WorldConnection[];
  progressRecords: SupportedProgressRecord[];
}

export interface SerializedSaveError {
  code: SaveErrorCode;
  message: string;
  stage?: string;
  offset?: number;
}

export interface WorkerInboundMessage {
  type: "parse";
  requestId: number;
  fileName: string;
  bytes: ArrayBuffer;
  catalog: TileCatalog;
}

export type WorkerOutboundMessage =
  | { type: "progress"; requestId: number; stage: SaveStage }
  | { type: "success"; requestId: number; save: DecodedSave }
  | { type: "error"; requestId: number; error: SerializedSaveError };
