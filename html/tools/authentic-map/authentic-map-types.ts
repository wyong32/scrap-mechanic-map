export const AUTHENTIC_LAYER_IDS = [
  "terrain",
  "surfaces",
  "structures",
  "props",
  "vegetation",
  "shadows",
  "effects",
] as const;

export type AuthenticLayerId = (typeof AUTHENTIC_LAYER_IDS)[number];

export interface AuthenticCaptureJob {
  regionId: "grow-lab-1";
  worldId: "growlab_01";
  gameVersion: "1.0.0";
  sourceTile: {
    uuid: string;
    relativePath: string;
    widthCells: 10;
    heightCells: 10;
  };
  worldBounds: { minX: -8; minY: -8; maxX: 7; maxY: 7 };
  sourceOriginCells: { x: 3; y: 3 };
  pixelsPerCell: 128;
  outputPixels: { width: 2048; height: 2048 };
  layers: readonly AuthenticLayerId[];
}

export interface OfficialCaptureReceipt {
  editor: "TileEditor";
  editorVersion: "1.0.1.869";
  sourceTileUuid: "d3d4d976-d2a6-4d21-95bd-fada26b6b371";
  sourceTileRelativePath: string;
  camera: {
    projection: "orthographic";
    direction: "north-up";
    pixelsPerCell: 128;
    width: 1280;
    height: 1280;
  };
  layers: Record<
    AuthenticLayerId,
    {
      file: string;
      officialInstanceCount: number;
      transparentAllowed: boolean;
    }
  >;
}

export interface VerifiedCaptureSet {
  job: AuthenticCaptureJob;
  receipt: OfficialCaptureReceipt;
  files: ReadonlyMap<
    AuthenticLayerId,
    {
      absolutePath: string;
      sha256: string;
      width: 1280;
      height: 1280;
    }
  >;
}
