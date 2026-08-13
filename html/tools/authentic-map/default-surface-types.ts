export interface DefaultSurfaceCaptureTarget {
  uuid: string;
  sourceTileRelativePath: string;
  widthCells: number;
  heightCells: number;
  outputPixels: { width: number; height: number };
  usedRotations: readonly (0 | 1 | 2 | 3)[];
  occurrences: number;
  sourcePreviewSha256: string;
}

export interface DefaultSurfaceCaptureInventory {
  schemaVersion: 1;
  gameVersion: "1.0.0";
  saveSha256: string;
  saveSeed: number;
  pixelsPerCell: 256;
  targets: readonly DefaultSurfaceCaptureTarget[];
  contentHash: string;
}

export interface SurfaceCaptureReceipt {
  editor: "TileEditor";
  editorVersion: "1.0.1.869";
  sourceTileUuid: string;
  sourceTileRelativePath: string;
  camera: {
    projection: "orthographic";
    direction: "north-up";
    viewDirection: "vertical-down";
    pixelsPerCell: 256;
    width: number;
    height: number;
  };
  image: {
    file: "scene.png";
    fullScene: true;
  };
}

export interface VerifiedSurfaceMaster {
  target: DefaultSurfaceCaptureTarget;
  receipt: SurfaceCaptureReceipt;
  absolutePath: string;
  sha256: string;
  width: number;
  height: number;
}
