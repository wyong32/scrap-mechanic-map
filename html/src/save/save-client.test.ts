import { describe, expect, it } from "vitest";
import { SaveClient } from "./save-client";
import {
  deserializeSaveError,
  SaveParseError,
  serializeSaveError
} from "./save-errors";
import type { WorkerInboundMessage, WorkerOutboundMessage } from "./save-protocol";

const browser = { worker: true, webAssembly: true, canvas: true };

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerOutboundMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly sent: WorkerInboundMessage[] = [];
  readonly transferLists: Transferable[][] = [];
  terminated = false;

  postMessage(message: WorkerInboundMessage, transfer: Transferable[] = []): void {
    this.sent.push(message);
    this.transferLists.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: WorkerOutboundMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerOutboundMessage>);
  }
}

function sqliteSave(name: string): File {
  const bytes = new TextEncoder().encode("SQLite format 3\0test");
  return {
    size: bytes.byteLength,
    name,
    slice(start: number, end?: number) {
      const copy = bytes.slice(start, end);
      return { arrayBuffer: async () => copy.buffer } as Blob;
    }
  } as unknown as File;
}

function sqliteSaveWithFullBuffer(name: string): { file: File; fullBuffer: ArrayBuffer } {
  const bytes = new TextEncoder().encode("SQLite format 3\0full-span");
  const fullBuffer = bytes.buffer as ArrayBuffer;
  const file = {
    size: bytes.byteLength,
    name,
    slice(start: number, end?: number) {
      if (start === 0 && end === bytes.byteLength) {
        return { arrayBuffer: async () => fullBuffer } as Blob;
      }
      const copy = bytes.slice(start, end);
      return { arrayBuffer: async () => copy.buffer } as Blob;
    }
  } as unknown as File;
  return { file, fullBuffer };
}

function emptySave(name = "empty.db"): File {
  return { size: 0, name } as File;
}

function decoded(fileName: string) {
  return {
    metadata: { fileName, saveVersion: 28 as const, seed: 1 },
    terrain: {
      gameVersion: "1.0.0",
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      uuids: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"],
      terrainTypes: ["meadow"],
      poiTypes: [null],
      uuidIndexes: new Uint16Array([0]),
      xOffsets: new Int32Array([0]),
      yOffsets: new Int32Array([0]),
      rotations: new Uint8Array([0]),
      flags: new Int32Array([0])
    },
    connections: [],
    progressRecords: []
  };
}

async function waitForMessages(worker: FakeWorker, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (worker.sent.length >= count) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected ${count} worker messages, received ${worker.sent.length}`);
}

describe("SaveClient", () => {
  it("transfers the validated full-span file buffer without cloning it", async () => {
    const worker = new FakeWorker();
    const client = new SaveClient(() => worker as unknown as Worker, browser);
    const { file, fullBuffer } = sqliteSaveWithFullBuffer("full-span.db");
    const pending = client.parseSave(file, () => undefined);
    await waitForMessages(worker, 1);

    expect(worker.sent[0]?.bytes).toBe(fullBuffer);
    expect(worker.transferLists[0]).toEqual([fullBuffer]);
    client.cancel();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("exposes immediate cancellation for a dispatched Worker", async () => {
    const worker = new FakeWorker();
    const client = new SaveClient(() => worker as unknown as Worker, browser);
    const pending = client.parseSave(sqliteSave("first.db"), () => undefined);
    await waitForMessages(worker, 1);
    client.cancel();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });
  it("serializes parser errors without losing their recovery details", () => {
    const serialized = serializeSaveError(
      new SaveParseError("DECODE_FAILED", {
        message: "Unsupported value tag",
        stage: "lua-value",
        offset: 42
      })
    );

    expect(serialized).toEqual({
      code: "DECODE_FAILED",
      message: "Unsupported value tag",
      stage: "lua-value",
      offset: 42
    });
    expect(deserializeSaveError(serialized)).toMatchObject({
      code: "DECODE_FAILED",
      stage: "lua-value",
      offset: 42
    });
  });

  it("terminates a dispatched replacement and ignores its stale success", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const client = new SaveClient(
      () => workers.shift() as unknown as Worker,
      browser
    );
    const first = client.parseSave(sqliteSave("first.db"), () => undefined);
    await waitForMessages(firstWorker, 1);
    const second = client.parseSave(sqliteSave("second.db"), () => undefined);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminated).toBe(true);
    expect(firstWorker.onmessage).toBeNull();
    await waitForMessages(secondWorker, 1);
    const [firstParse] = firstWorker.sent;
    const [secondParse] = secondWorker.sent;
    expect(firstParse?.type).toBe("parse");
    expect(secondParse?.type).toBe("parse");

    firstWorker.emit({ type: "success", requestId: firstParse!.requestId, save: decoded("first.db") });
    secondWorker.emit({ type: "success", requestId: secondParse!.requestId, save: decoded("second.db") });
    await expect(second).resolves.toMatchObject({ metadata: { fileName: "second.db" } });
  });

  it("cancels a dispatched request before rejecting an invalid replacement", async () => {
    const worker = new FakeWorker();
    const client = new SaveClient(() => worker as unknown as Worker, browser);
    const first = client.parseSave(sqliteSave("first.db"), () => undefined);
    await waitForMessages(worker, 1);

    const invalidReplacement = client.parseSave(emptySave(), () => undefined);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(invalidReplacement).rejects.toMatchObject({ code: "EMPTY_FILE" });
    expect(worker.terminated).toBe(true);
    const firstRequest = worker.sent[0]!;
    worker.emit({ type: "success", requestId: firstRequest.requestId, save: decoded("first.db") });
  });

  it("routes serialized worker errors to the active request", async () => {
    const worker = new FakeWorker();
    const client = new SaveClient(() => worker as unknown as Worker, browser);
    const pending = client.parseSave(sqliteSave("private.db"), () => undefined);
    await waitForMessages(worker, 1);
    const request = worker.sent[0]!;

    worker.emit({
      type: "error",
      requestId: request.requestId,
      error: { code: "NOT_SURVIVAL_SAVE", message: "Expected Game table" }
    });

    await expect(pending).rejects.toMatchObject({
      code: "NOT_SURVIVAL_SAVE"
    });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it("terminates and clears Worker handlers after terminal success", async () => {
    const worker = new FakeWorker();
    const client = new SaveClient(() => worker as unknown as Worker, browser);
    const pending = client.parseSave(sqliteSave("complete.db"), () => undefined);
    await waitForMessages(worker, 1);
    const request = worker.sent[0]!;

    worker.emit({
      type: "success",
      requestId: request.requestId,
      save: decoded("complete.db")
    });

    await expect(pending).resolves.toMatchObject({
      metadata: { fileName: "complete.db" }
    });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it("does not call progress callbacks for stale replies", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const progress: string[] = [];
    const workers = [firstWorker, secondWorker];
    const client = new SaveClient(() => workers.shift() as unknown as Worker, browser);
    const first = client.parseSave(sqliteSave("first.db"), (stage) => progress.push(stage));
    await waitForMessages(firstWorker, 1);
    const second = client.parseSave(sqliteSave("second.db"), (stage) => progress.push(stage));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await waitForMessages(secondWorker, 1);
    const [firstRequest] = firstWorker.sent;
    const [secondRequest] = secondWorker.sent;

    firstWorker.emit({ type: "progress", requestId: firstRequest!.requestId, stage: "sqlite" });
    secondWorker.emit({ type: "progress", requestId: secondRequest!.requestId, stage: "reading" });
    secondWorker.emit({ type: "success", requestId: secondRequest!.requestId, save: decoded("second.db") });

    await expect(second).resolves.toBeDefined();
    expect(progress).toEqual(["reading"]);
  });

  it("terminates, rejects and clears callbacks when disposed", async () => {
    const worker = new FakeWorker();
    const progress: string[] = [];
    const client = new SaveClient(() => worker as unknown as Worker, browser);
    const pending = client.parseSave(sqliteSave("private.db"), (stage) => progress.push(stage));
    await waitForMessages(worker, 1);
    const request = worker.sent[0]!;

    client.dispose();
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    worker.emit({ type: "progress", requestId: request.requestId, stage: "sqlite" });
    expect(progress).toEqual([]);
    await expect(client.parseSave(sqliteSave("another.db"), () => undefined)).rejects.toMatchObject(
      { code: "UNSUPPORTED_BROWSER" }
    );
  });

  it.each(["error", "messageerror"] as const)(
    "recreates the Worker after a fatal %s event",
    async (eventName) => {
      const failedWorker = new FakeWorker();
      const freshWorker = new FakeWorker();
      const workers = [failedWorker, freshWorker];
      const client = new SaveClient(() => workers.shift() as unknown as Worker, browser);
      const failedParse = client.parseSave(sqliteSave("first.db"), () => undefined);
      await waitForMessages(failedWorker, 1);

      if (eventName === "error") {
        failedWorker.onerror?.(new Event("error") as ErrorEvent);
      } else {
        failedWorker.onmessageerror?.(new MessageEvent("messageerror"));
      }

      await expect(failedParse).rejects.toMatchObject({ code: "NOT_SURVIVAL_SAVE" });
      expect(failedWorker.terminated).toBe(true);
      expect(failedWorker.onmessage).toBeNull();
      expect(failedWorker.onerror).toBeNull();
      expect(failedWorker.onmessageerror).toBeNull();

      const freshParse = client.parseSave(sqliteSave("second.db"), () => undefined);
      await waitForMessages(freshWorker, 1);
      const request = freshWorker.sent[0]!;
      freshWorker.emit({ type: "success", requestId: request.requestId, save: decoded("second.db") });
      await expect(freshParse).resolves.toMatchObject({ metadata: { fileName: "second.db" } });
    }
  );

  it("returns rejected Promises for every early failure", async () => {
    const unavailable = new SaveClient(() => new FakeWorker() as unknown as Worker, {
      worker: false,
      webAssembly: true,
      canvas: true
    });
    await expect(unavailable.parseSave(sqliteSave("blocked.db"), () => undefined)).rejects.toMatchObject(
      { code: "UNSUPPORTED_BROWSER" }
    );

    const client = new SaveClient(() => new FakeWorker() as unknown as Worker, browser);
    await expect(client.parseSave(emptySave(), () => undefined)).rejects.toMatchObject({
      code: "EMPTY_FILE"
    });
    client.dispose();
    await expect(client.parseSave(sqliteSave("closed.db"), () => undefined)).rejects.toMatchObject({
      code: "UNSUPPORTED_BROWSER"
    });
  });
});
