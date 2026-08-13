import { expect, it, vi } from "vitest";
import type {
  LuaValue,
  NormalizedTerrainTransfer,
  WorkerInboundMessage,
  WorkerOutboundMessage
} from "./save-protocol";
import { parseSaveRequest } from "./save-worker";

it("returns only normalized typed terrain and transfers every numeric buffer", async () => {
  const rawLua: LuaValue = {
    kind: "table",
    entries: [["seed", 42]]
  };
  const terrain: NormalizedTerrainTransfer = {
    gameVersion: "1.0.0",
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    uuids: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"],
    terrainTypes: ["meadow"],
    poiTypes: [null],
    uuidIndexes: new Uint16Array([0]),
    xOffsets: new Int32Array([1]),
    yOffsets: new Int32Array([2]),
    rotations: new Uint8Array([3]),
    flags: new Int32Array([4])
  };
  const posts: Array<{ message: WorkerOutboundMessage; transfer?: Transferable[] }> = [];
  const scope = {
    addEventListener() {},
    postMessage(message: WorkerOutboundMessage, transfer?: Transferable[]) {
      posts.push({ message, transfer });
    }
  };
  const request: WorkerInboundMessage = {
    type: "parse",
    requestId: 7,
    fileName: "private.db",
    bytes: new ArrayBuffer(1),
    catalog: {
      gameVersion: "1.0.0",
      tiles: {
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1": { terrainType: "meadow" }
      }
    }
  };
  const normalize = vi.fn(() => terrain);

  await parseSaveRequest(request, scope, {
    read: async () => ({
      saveVersion: 28,
      seed: 42,
      surfaceCandidates: [new Uint8Array([1])]
    }),
    decode: () => rawLua,
    normalize
  });

  const success = posts.find(({ message }) => message.type === "success")!;
  expect(normalize).toHaveBeenCalledWith(
    rawLua,
    { fileName: "private.db", saveVersion: 28, seed: 42 },
    request.catalog
  );
  expect(
    success.message.type === "success" ? success.message.save.terrain : null
  ).not.toHaveProperty("kind");
  expect(success.message).toMatchObject({
    type: "success",
    save: { terrain: { uuids: terrain.uuids } }
  });
  expect(success.transfer).toEqual([
    terrain.uuidIndexes.buffer,
    terrain.xOffsets.buffer,
    terrain.yOffsets.buffer,
    terrain.rotations.buffer,
    terrain.flags.buffer
  ]);
});

it("includes a Worker-owned overview ImageBitmap in the terminal transfer", async () => {
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  const terrain: NormalizedTerrainTransfer = {
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
  };
  const posts: Array<{ message: WorkerOutboundMessage; transfer?: Transferable[] }> = [];
  const scope = {
    addEventListener() {},
    postMessage(message: WorkerOutboundMessage, transfer?: Transferable[]) {
      posts.push({ message, transfer });
    }
  };
  const request: WorkerInboundMessage = {
    type: "parse",
    requestId: 8,
    fileName: "private.db",
    bytes: new ArrayBuffer(1),
    catalog: {
      gameVersion: "1.0.0",
      tiles: {
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1": { terrainType: "meadow" }
      }
    }
  };

  await parseSaveRequest(request, scope, {
    read: async () => ({
      saveVersion: 28,
      seed: 42,
      surfaceCandidates: [new Uint8Array([1])]
    }),
    decode: () => ({ kind: "table", entries: [] }),
    normalize: () => terrain,
    renderOverview: () => ({ bitmap, width: 1, height: 1 })
  });

  const success = posts.find(({ message }) => message.type === "success")!;
  expect(success.message).toMatchObject({
    type: "success",
    save: { overview: { bitmap, width: 1, height: 1 } }
  });
  expect(success.transfer).toEqual([
    terrain.uuidIndexes.buffer,
    terrain.xOffsets.buffer,
    terrain.yOffsets.buffer,
    terrain.rotations.buffer,
    terrain.flags.buffer,
    bitmap
  ]);
});
