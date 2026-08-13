export interface TreeFingerprint {
  schemaVersion: 1;
  fileCount: number;
  totalBytes: number;
  sha256: string;
  files: readonly { relativePath: string; bytes: number; sha256: string }[];
}

export interface RuntimeProbeSession {
  schemaVersion: 1;
  pid: number;
  executableVersion: "1.0.1.869";
  executableSha256: string;
  startedAt: string;
  commandLine: string;
  userDataRoot: string;
  protectedBefore: Readonly<Record<string, TreeFingerprint>>;
}

export interface RuntimeIsolationReceipt {
  schemaVersion: 1;
  processExecutableSha256: string;
  commandLineSha256: string;
  userDataRoot: string;
  proofLogRelativePath: string;
  proofLogSha256: string;
  protectedRootsUnchanged: true;
}

export interface RuntimeProbeOptions {
  gameRoot: string;
  userDataRoot: string;
  protectedRoots: readonly string[];
  sessionPath: string;
}

export interface FinishRuntimeProbeOptions {
  sessionPath: string;
  receiptPath: string;
}

export interface RuntimePatchOptions {
  gameRoot: string;
  isolationReceiptPath: string;
  backupRoot: string;
  receiptPath: string;
}

export interface RuntimePatchReceipt {
  schemaVersion: 1;
  gameExecutableSha256: string;
  isolationReceiptSha256: string;
  survivalGame: {
    relativePath: "Survival/Scripts/game/SurvivalGame.lua";
    backupRelativePath: "Survival/Scripts/game/SurvivalGame.lua";
    originalSha256: string;
    backupSha256: string;
    patchedSha256: string;
  };
  companionScript: {
    relativePath: "Survival/Scripts/game/SmOverviewCapture.lua";
    sha256: string;
  };
}

export interface RuntimeCapturePoint {
  id: `r${number}-c${number}`;
  row: number;
  column: number;
  x: number;
  y: number;
  z: 250;
}

export interface RuntimeCaptureJob {
  schemaVersion: 1;
  gameVersion: "1.0.0";
  executableVersion: "1.0.1.869";
  sourceSaveSha256: string;
  centerCell: { x: -39; y: 19; cellSize: 64 };
  spacing: 350;
  camera: {
    direction: readonly [0, 0, -1];
    northUp: true;
    fov: 90;
    window: { width: 1920; height: 1080 };
    crop: { left: 585; top: 165; width: 750; height: 750 };
  };
  validation: {
    stabilityThreshold: 0.015;
    retryLimit: 3;
    darkLuminance: 8;
    maxDarkRatio: 0.85;
  };
  stitch: {
    nominalStride: 525;
    nominalOverlap: 225;
    searchRadius: 48;
  };
  points: readonly RuntimeCapturePoint[];
  contentHash: string;
}

export interface RuntimeFrameEvidence {
  schemaVersion: 1;
  pointId: RuntimeCapturePoint["id"];
  pid: number;
  executableSha256: string;
  firstFrame: string;
  secondFrame: string;
  cameraLog: string;
  cameraLogSha256: string;
  cursorOutsideCrop: true;
  hudReviewedHidden: true;
  capturedAt: string;
}

export interface AcceptedRuntimeFrame {
  pointId: RuntimeCapturePoint["id"];
  file: string;
  sha256: string;
  width: 750;
  height: 750;
  normalizedMeanAbsoluteDifference: number;
  darkRatio: number;
  attempt: 1 | 2 | 3;
}

export interface RuntimeCaptureManifest {
  schemaVersion: 1;
  jobContentHash: string;
  frames: readonly AcceptedRuntimeFrame[];
}

export interface RuntimeStitchContract {
  axis: "horizontal" | "vertical";
  nominalStride: number;
  nominalOverlap: number;
  searchRadius: number;
}

export interface NeighborAlignment {
  axis: "horizontal" | "vertical";
  x: number;
  y: number;
  error: number;
}

export interface RuntimeNeighborAlignment extends NeighborAlignment {
  fromPointId: RuntimeCapturePoint["id"];
  toPointId: RuntimeCapturePoint["id"];
}

export interface RuntimeFramePlacement {
  pointId: RuntimeCapturePoint["id"];
  sourceSha256: string;
  origin: { x: number; y: number };
  crop: { left: number; top: number; width: number; height: number };
}

export interface RuntimeStitchReceipt {
  schemaVersion: 1;
  jobContentHash: string;
  transforms: "translation-and-crop-only";
  output: {
    file: "stitched/default-surface-5x5.png";
    sha256: string;
    width: number;
    height: number;
  };
  placements: readonly RuntimeFramePlacement[];
  alignments: readonly RuntimeNeighborAlignment[];
  contentHash: string;
}
