import { serializeSaveError } from "./save-errors";
import type { WorkerInboundMessage, WorkerOutboundMessage } from "./save-protocol";
import { readSaveRecords } from "./sqlite-reader";
import { decodeSurfaceCandidates } from "./script-data-decoder";
import {
  normalizeTerrainTransfer,
  terrainTransferables
} from "../terrain/normalize-terrain";
import { renderWorkerOverview } from "./worker-overview";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerInboundMessage>) => void): void;
  postMessage(message: WorkerOutboundMessage, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;

if ("importScripts" in globalThis) {
  workerScope.addEventListener("message", (event) => {
    void parseSaveRequest(event.data);
  });
}

interface SaveWorkerDependencies {
  read(bytes: Uint8Array): ReturnType<typeof readSaveRecords>;
  decode(candidates: Uint8Array[]): ReturnType<typeof decodeSurfaceCandidates>;
  normalize: typeof normalizeTerrainTransfer;
  renderOverview?: typeof renderWorkerOverview;
}

const defaultDependencies: SaveWorkerDependencies = {
  read: readSaveRecords,
  decode: decodeSurfaceCandidates,
  normalize: normalizeTerrainTransfer,
  renderOverview: renderWorkerOverview
};

export async function parseSaveRequest(
  message: WorkerInboundMessage,
  scope: WorkerScope = workerScope,
  dependencies: SaveWorkerDependencies = defaultDependencies
): Promise<void> {
  const { requestId } = message;
  try {
    scope.postMessage({ type: "progress", requestId, stage: "reading" });
    scope.postMessage({ type: "progress", requestId, stage: "sqlite" });
    const records = await dependencies.read(new Uint8Array(message.bytes));
    scope.postMessage({ type: "progress", requestId, stage: "decompressing" });
    scope.postMessage({ type: "progress", requestId, stage: "decoding" });
    const decodedTerrain = dependencies.decode(records.surfaceCandidates);
    scope.postMessage({ type: "progress", requestId, stage: "normalizing" });
    const metadata = {
      fileName: message.fileName,
      saveVersion: 28 as const,
      seed: records.seed
    };
    const terrain = dependencies.normalize(
      decodedTerrain,
      metadata,
      message.catalog
    );
    scope.postMessage({ type: "progress", requestId, stage: "rendering" });
    const overview = dependencies.renderOverview?.(terrain);
    const success: WorkerOutboundMessage = {
      type: "success",
      requestId,
      save: {
        metadata,
        terrain,
        ...(overview ? { overview } : {}),
        connections: [],
        progressRecords: []
      }
    };
    const transfer: Transferable[] = terrainTransferables(terrain);
    if (overview) {
      transfer.push(overview.bitmap);
    }
    scope.postMessage(success, transfer);
  } catch (error) {
    scope.postMessage({
      type: "error",
      requestId,
      error: serializeSaveError(error)
    });
  }
}
