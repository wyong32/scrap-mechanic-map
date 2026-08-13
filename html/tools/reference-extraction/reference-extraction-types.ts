import type { CellBounds, WorldMap } from "../../src/domain/map-model.ts";
import type { TileCatalog } from "../../src/terrain/normalize-terrain.ts";

export interface ReferenceSourceMetadata {
  sha256: string;
  width: number;
  height: number;
  bounds: CellBounds;
}

export interface UuidIntersectionReport {
  shared: readonly string[];
  referenceOnly: readonly string[];
  targetOnly: readonly string[];
}

export interface ReferenceExtractionInputs {
  source: ReferenceSourceMetadata;
  /** Complete 144 x 112 checked-in image calibration world. */
  referenceWorld: WorldMap;
  /** Production-decoded 128 x 96 playable inset of the default save. */
  defaultWorld: WorldMap;
  targetWorld: WorldMap;
  /** Observational provenance only: player-save inputs are deliberately variable. */
  targetSaveSha256: string;
  catalog: TileCatalog & { legacyBridge: readonly unknown[] };
  uuidIntersection: UuidIntersectionReport;
}

export interface ReferenceExtractionInputOptions {
  sourceImagePath: string;
  referenceWorldPath: string;
  defaultSavePath: string;
  targetSavePath: string;
  buildInfoPath: string;
  catalogPath: string;
  /** Immutable checked-in inputs; target saves are intentionally not bound here. */
  expectedInputHashes?: ReferenceExtractionInputHashes;
}

export interface ReferenceExtractionInputHashes {
  sourceImageSha256: string;
  referenceWorldSha256: string;
  buildInfoSha256: string;
  catalogSha256: string;
  defaultSaveSha256: string;
}

export type ReferenceSurfaceBounds = CellBounds;
