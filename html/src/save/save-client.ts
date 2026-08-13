import {
  createCancelledSaveError,
  deserializeSaveError,
  SaveParseError
} from "./save-errors";
import type {
  DecodedSave,
  SaveStage,
  WorkerInboundMessage,
  WorkerOutboundMessage
} from "./save-protocol";
import {
  detectBrowserCapabilities,
  readAndValidateSaveFile,
  validateSaveFileMetadata,
  validateSaveFileEnvironment,
  type BrowserCapabilities
} from "./validate-save-file";
import type { TileCatalog } from "../terrain/normalize-terrain";

export type SaveWorkerFactory = () => Worker;

interface PendingParse {
  requestId: number;
  dispatched: boolean;
  onProgress: (stage: SaveStage) => void;
  resolve: (save: DecodedSave) => void;
  reject: (reason: unknown) => void;
}

export class SaveClient {
  private worker?: Worker;
  private pending?: PendingParse;
  private nextRequestId = 1;
  private disposed = false;

  constructor(
    private readonly createWorker: SaveWorkerFactory = () =>
      new Worker(new URL("./save-worker.ts", import.meta.url), { type: "module" }),
    private readonly capabilities: BrowserCapabilities = detectBrowserCapabilities()
  ) {}

  parseSave(
    file: File,
    onProgress: (stage: SaveStage) => void,
    catalog: TileCatalog = { gameVersion: "1.0.0", tiles: {} }
  ): Promise<DecodedSave> {
    this.cancelPending();
    if (this.disposed) {
      return Promise.reject(new SaveParseError("UNSUPPORTED_BROWSER", {
        message: "The local save reader has been closed."
      }));
    }
    try {
      validateSaveFileEnvironment(this.capabilities);
      validateSaveFileMetadata(file, this.capabilities);
    } catch (error) {
      return Promise.reject(toSaveError(error));
    }

    const requestId = this.nextRequestId++;
    return new Promise<DecodedSave>((resolve, reject) => {
      this.pending = { requestId, dispatched: false, onProgress, resolve, reject };
      try {
        this.ensureWorker();
      } catch (error) {
        if (this.pending?.requestId === requestId) {
          this.pending = undefined;
        }
        reject(toSaveError(error));
        return;
      }
      void this.beginParse(file, requestId, catalog);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelPending();
    this.resetWorker();
  }

  cancel(): void {
    this.cancelPending();
    this.resetWorker();
  }

  private async beginParse(
    file: File,
    requestId: number,
    catalog: TileCatalog
  ): Promise<void> {
    try {
      const bytes = await readAndValidateSaveFile(file, this.capabilities);
      if (this.disposed || this.pending?.requestId !== requestId) {
        return;
      }
      const worker = this.ensureWorker();
      const bytesBuffer = bytes.buffer as ArrayBuffer;
      const message: WorkerInboundMessage = {
        type: "parse",
        requestId,
        fileName: file.name,
        bytes: bytesBuffer,
        catalog
      };
      const active = this.pending;
      if (!active || active.requestId !== requestId) {
        return;
      }
      active.dispatched = true;
      worker.postMessage(message, [bytesBuffer]);
    } catch (error) {
      if (this.pending?.requestId === requestId) {
        const active = this.pending;
        this.pending = undefined;
        this.resetWorker();
        active.reject(error);
      }
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      this.handleWorkerMessage(worker, event.data);
    };
    worker.onerror = () => {
      this.handleWorkerFailure(worker);
    };
    worker.onmessageerror = () => {
      this.handleWorkerFailure(worker);
    };
    this.worker = worker;
    return worker;
  }

  private handleWorkerMessage(worker: Worker, message: WorkerOutboundMessage): void {
    if (worker !== this.worker) {
      return;
    }
    const active = this.pending;
    if (!active || active.requestId !== message.requestId || this.disposed) {
      return;
    }
    if (message.type === "progress") {
      active.onProgress(message.stage);
      return;
    }
    this.pending = undefined;
    this.resetWorker();
    if (message.type === "success") {
      active.resolve(message.save);
      return;
    }
    active.reject(deserializeSaveError(message.error));
  }

  private cancelPending(): void {
    const active = this.pending;
    if (!active) {
      return;
    }
    this.pending = undefined;
    if (active.dispatched) {
      this.resetWorker();
    }
    active.reject(createCancelledSaveError());
  }

  private handleWorkerFailure(worker: Worker): void {
    if (worker !== this.worker) {
      return;
    }
    const active = this.pending;
    this.pending = undefined;
    this.resetWorker();
    active?.reject(
      new SaveParseError("NOT_SURVIVAL_SAVE", {
        message: "The local save reader stopped unexpectedly."
      })
    );
  }

  private resetWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    if (!worker) {
      return;
    }
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}

function toSaveError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new SaveParseError("NOT_SURVIVAL_SAVE", {
    message: "Unable to read the selected save."
  });
}
