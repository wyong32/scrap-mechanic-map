import { expect, it, vi } from "vitest";
import * as L from "leaflet";
import type { TerrainCell } from "../domain/map-model";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({ clearRect() {}, fillRect() {}, fillText() {}, drawImage() {} }) });

it("forms atlas keys from UUID, offsets, and rotation", async () => {
  const { AtlasLayer } = await import("./atlas-layer");
  const cell: TerrainCell = { x: 0, y: 0, uuid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", xOffset: 2, yOffset: -1, rotation: 3, flags: 0, terrainType: "test" };
  const layer = new AtlasLayer();
  expect(layer).toBeDefined();
  // Cell lookup remains private so it cannot be confused with a legacy numeric ID.
  expect(`${cell.uuid.toLowerCase()}:${cell.xOffset}:${cell.yOffset}:${cell.rotation}`).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:2:-1:3");
});

it("uses low geometry below zoom 2 and prevents invisible or production hatches", async () => {
  const { chooseAtlasSource, shouldDrawMissing, isCurrentAtlasGeneration } = await import("./atlas-layer");
  const entry = { page: "native.webp", lowPage: "low.webp", x: 20, y: 40, width: 256, height: 256, lowX: 10, lowY: 20, lowWidth: 128, lowHeight: 128, logicalSize: 256, sourceHash: "x" };
  expect(chooseAtlasSource(entry, 1)).toEqual({ page: "low.webp", x: 10, y: 20, width: 128, height: 128 });
  expect(chooseAtlasSource(entry, 2)).toEqual({ page: "native.webp", x: 20, y: 40, width: 256, height: 256 });
  expect(chooseAtlasSource(entry, 0, true)).toEqual({ page: "native.webp", x: 20, y: 40, width: 256, height: 256 });
  expect(shouldDrawMissing(true, false)).toBe(false);
  expect(shouldDrawMissing(false, true)).toBe(false);
  expect(shouldDrawMissing(true, true)).toBe(true);
  expect(isCurrentAtlasGeneration(1, 2)).toBe(false);
  expect(isCurrentAtlasGeneration(2, 2)).toBe(true);
});

it("silently abandons a deferred old fetch after terrain is disabled", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); let reject!: (error: Error) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((_resolve, fail) => { reject = fail; })));
  const layer = new AtlasLayer("/atlas/test.json", true) as unknown as { _map: { getContainer(): HTMLElement }; setCells(cells: TerrainCell[]): Promise<void>; setVisible(visible: boolean): void };
  const container = document.createElement("div"); const errors = vi.fn(); container.addEventListener("atlas-error", errors); layer._map = { getContainer: () => container };
  const pending = layer.setCells([{ x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" }]);
  layer.setVisible(false); reject(new Error("old decode")); await expect(pending).resolves.toBeUndefined(); expect(errors).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

it("guards old operations, emits one current error, skips disabled fetches, and readies on re-enable", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); const deferred: Array<{ reject(error: Error): void; resolve(value: Response): void }> = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve, reject) => deferred.push({ resolve, reject }))));
  const layer = new AtlasLayer("/atlas/test.json", true) as unknown as { _map: unknown; setCells(cells: TerrainCell[]): Promise<void>; setVisible(visible: boolean): void };
  const container = document.createElement("div"); const errors = vi.fn(), ready = vi.fn(); container.addEventListener("atlas-error", errors); container.addEventListener("atlas-ready", ready);
  (layer as unknown as { _map: unknown })._map = { getContainer: () => container, getSize: () => ({ x: 10, y: 10 }), containerPointToLayerPoint: () => ({ x: 0, y: 0 }), latLngToContainerPoint: () => ({ x: 0, y: 0 }), getBounds: () => ({ contains: () => true }), getZoom: () => 0 };
  const cell: TerrainCell = { x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" };
  const old = layer.setCells([cell]); const newer = layer.setCells([cell]); deferred[0].reject(new Error("old")); await expect(old).resolves.toBeUndefined(); expect(errors).not.toHaveBeenCalled(); deferred[1].reject(new Error("current")); await expect(newer).rejects.toThrow("current"); expect(errors).toHaveBeenCalledTimes(1);
  layer.setVisible(false); const before = (fetch as ReturnType<typeof vi.fn>).mock.calls.length; await layer.setCells([cell]); expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(before);
  layer.setVisible(true); deferred[2].resolve({ ok: true, json: async () => ({ schemaVersion: 1, gameVersion: "1.0.0", pageSize: 4096, contentHash: "x", pages: {}, entries: {} }) } as Response); await Promise.resolve(); await Promise.resolve(); vi.unstubAllGlobals();
});

it.each([
  [
    "404",
    () => new Response("missing", { status: 404 })
  ],
  [
    "SPA HTML fallback",
    () => new Response("<!doctype html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  ]
] as const)(
  "treats a missing optional manifest returned as $0 as a ready fallback capability",
  async (_label, response) => {
  const visibleDraws = vi.fn();
  const fallbackFills = vi.fn();
  const contexts = [
    {
      clearRect() {},
      fillRect() {},
      fillText() {},
      drawImage: visibleDraws
    },
    {
      clearRect() {},
      fillRect: fallbackFills,
      fillText() {},
      drawImage() {}
    }
  ] as unknown as CanvasRenderingContext2D[];
  let contextIndex = 0;
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    development: false,
    contextFactory: () =>
      contexts[Math.min(contextIndex++, contexts.length - 1)]!
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    canvas: HTMLCanvasElement;
    setCells(cells: TerrainCell[]): Promise<void>;
  };
  const container = document.createElement("div");
  const errors = vi.fn();
  const ready = vi.fn();
  container.addEventListener("atlas-error", errors);
  container.addEventListener("atlas-ready", ready);
  layer._map = {
    getContainer: () => container,
    getSize: () => ({ x: 128, y: 128 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
    latLngToContainerPoint: () => ({ x: 16, y: 24 }),
    getBounds: () => ({
      contains: () => true,
      intersects: () => true
    }),
    getZoom: () => 0
  };
  layer.attached = true;

  await expect(layer.setCells([{
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  }])).resolves.toBeUndefined();

  expect(fallbackFills).toHaveBeenCalledOnce();
  expect(visibleDraws).toHaveBeenCalledOnce();
  expect(errors).not.toHaveBeenCalled();
  expect(ready).toHaveBeenCalledOnce();
  expect(layer.canvas.hidden).toBe(false);
  vi.unstubAllGlobals();
  }
);

it("clears a stale atlas error when a prepared local fallback frame commits", async () => {
  const context = {
    clearRect() {},
    fillRect() {},
    fillText() {},
    drawImage() {}
  } as unknown as CanvasRenderingContext2D;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "offline-overview",
    contextFactory: () => context
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    prepareOverview(cells: TerrainCell[]): Promise<void>;
    commitOverview(): void;
  };
  const container = document.createElement("div");
  container.dataset.atlasStatus = "error";
  container.dataset.atlasMessage = "old optional atlas failure";
  const ready = vi.fn();
  container.addEventListener("atlas-ready", ready);
  layer._map = {
    getContainer: () => container,
    getSize: () => ({ x: 64, y: 64 })
  };
  layer.attached = true;

  await layer.prepareOverview([{
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  }]);
  layer.commitOverview();

  expect(ready).toHaveBeenCalledOnce();
  expect(container.dataset.atlasStatus).toBeUndefined();
  expect(container.dataset.atlasMessage).toBeUndefined();
});

it("reports only current deferred image decode failures", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); let reject!: (error: Error) => void;
  const image = { complete: true, src: "", decode: () => new Promise<void>((_resolve, fail) => { reject = fail; }) } as unknown as HTMLImageElement;
  const layer = new AtlasLayer("/atlas/test.json", true, () => image) as unknown as { _map: unknown; manifest: unknown; cells: TerrainCell[]; generation: number; runDraw(): void; setVisible(visible: boolean): void; pages: Map<string, HTMLImageElement> };
  const container = document.createElement("div"); const errors = vi.fn(); container.addEventListener("atlas-error", errors);
  layer._map = { getContainer: () => container, getSize: () => ({ x: 10, y: 10 }), containerPointToLayerPoint: () => ({ x: 0, y: 0 }), latLngToContainerPoint: () => ({ x: 0, y: 0 }), getBounds: () => ({ contains: () => true }), getZoom: () => 2 };
  const cell: TerrainCell = { x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" }; layer.cells = [cell]; layer.manifest = { schemaVersion: 1, gameVersion: "1.0.0", pageSize: 4096, contentHash: "x", pages: { "page.webp": {} }, entries: { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:0:0:0": { page: "page.webp", lowPage: "page.webp", x: 0, y: 0, width: 1, height: 1, lowX: 0, lowY: 0, lowWidth: 1, lowHeight: 1, logicalSize: 1, sourceHash: "x" } } };
  layer.runDraw(); layer.generation++; reject(new Error("stale decode")); await Promise.resolve(); await Promise.resolve(); expect(errors).not.toHaveBeenCalled();
  layer.runDraw(); reject(new Error("current decode")); await new Promise((resolve) => setTimeout(resolve, 0)); expect(errors).toHaveBeenCalledTimes(1); layer.pages.set("old", image); layer.setVisible(false); expect(layer.pages.size).toBe(0);
});

it("does not cache stale successful image decodes after disable", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); let resolve!: () => void; const image = { complete: true, src: "", decode: () => new Promise<void>((done) => { resolve = done; }) } as unknown as HTMLImageElement;
  const layer = new AtlasLayer("/atlas/test.json", true, () => image) as unknown as { _map: unknown; manifest: unknown; cells: TerrainCell[]; runDraw(): void; setVisible(value: boolean): void; pages: Map<string, HTMLImageElement> };
  const container = document.createElement("div"); layer._map = { getContainer: () => container, getSize: () => ({ x: 10, y: 10 }), containerPointToLayerPoint: () => ({ x: 0, y: 0 }), latLngToContainerPoint: () => ({ x: 0, y: 0 }), getBounds: () => ({ contains: () => true }), getZoom: () => 2 };
  layer.cells = [{ x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" }]; layer.manifest = { schemaVersion: 1, gameVersion: "1.0.0", pageSize: 1, contentHash: "x", pages: { "page.webp": {} }, entries: { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:0:0:0": { page: "page.webp", lowPage: "page.webp", x: 0, y: 0, width: 1, height: 1, lowX: 0, lowY: 0, lowWidth: 1, lowHeight: 1, logicalSize: 1, sourceHash: "x" } } };
  layer.runDraw(); layer.setVisible(false); resolve(); await new Promise((done) => setTimeout(done, 0)); expect(layer.pages.size).toBe(0); expect(image.src).toBe("");
});

it("keeps the newer same-page image when an older decode completes late", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); const resolves: Array<() => void> = []; const images = [0, 1].map(() => ({ complete: true, src: "", decode: () => new Promise<void>((done) => resolves.push(done)) } as unknown as HTMLImageElement)); let index = 0;
  const layer = new AtlasLayer("/atlas/test.json", true, () => images[index++]) as unknown as { _map: unknown; manifest: unknown; cells: TerrainCell[]; generation: number; runDraw(): void; pages: Map<string, HTMLImageElement> };
  layer._map = { getContainer: () => document.createElement("div"), getSize: () => ({ x: 10, y: 10 }), containerPointToLayerPoint: () => ({ x: 0, y: 0 }), latLngToContainerPoint: () => ({ x: 0, y: 0 }), getBounds: () => ({ contains: () => true }), getZoom: () => 2 }; layer.cells = [{ x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" }]; layer.manifest = { schemaVersion: 1, gameVersion: "1.0.0", pageSize: 1, contentHash: "x", pages: { "page.webp": {} }, entries: { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:0:0:0": { page: "page.webp", lowPage: "page.webp", x: 0, y: 0, width: 1, height: 1, lowX: 0, lowY: 0, lowWidth: 1, lowHeight: 1, logicalSize: 1, sourceHash: "x" } } };
  layer.runDraw(); layer.generation++; layer.runDraw(); resolves[1](); await new Promise((done) => setTimeout(done, 0)); resolves[0](); await new Promise((done) => setTimeout(done, 0)); expect(layer.pages.get("page.webp")).toBe(images[1]); expect(images[0].src).toBe("");
});

it("re-enables through a fresh successful atlas load and emits ready once", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); const image = { complete: true, src: "", decode: async () => undefined } as unknown as HTMLImageElement;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 1, gameVersion: "1.0.0", pageSize: 1, contentHash: "x", pages: { "page.webp": {} }, entries: { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:0:0:0": { page: "page.webp", lowPage: "page.webp", x: 0, y: 0, width: 1, height: 1, lowX: 0, lowY: 0, lowWidth: 1, lowHeight: 1, logicalSize: 1, sourceHash: "x" } } }) })));
  const layer = new AtlasLayer("/atlas/test.json", true, () => image) as unknown as { _map: unknown; cells: TerrainCell[]; setVisible(value: boolean): Promise<void>; pages: Map<string, HTMLImageElement> }; const container = document.createElement("div"); const ready = vi.fn(), errors = vi.fn(); container.addEventListener("atlas-ready", ready); container.addEventListener("atlas-error", errors);
  layer._map = { getContainer: () => container, getSize: () => ({ x: 10, y: 10 }), containerPointToLayerPoint: () => ({ x: 0, y: 0 }), latLngToContainerPoint: () => ({ x: 0, y: 0 }), getBounds: () => ({ contains: () => true }), getZoom: () => 2 }; layer.cells = [{ x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" }]; await layer.setVisible(false); await layer.setVisible(true); expect(ready).toHaveBeenCalledTimes(1); expect(errors).not.toHaveBeenCalled(); expect(layer.pages.get("page.webp")).toBe(image); vi.unstubAllGlobals();
});

it("renders only the newest same-generation viewport after deferred decodes", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); const draws = vi.fn(); Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({ clearRect() {}, fillRect() {}, fillText() {}, drawImage: draws }) });
  const resolves: Array<() => void> = []; const images = [0, 1].map(() => ({ complete: true, src: "", decode: () => new Promise<void>((done) => resolves.push(done)) } as unknown as HTMLImageElement)); let index = 0, viewportX = 1;
  const layer = new AtlasLayer("/atlas/test.json", true, () => images[index++]) as unknown as { _map: unknown; manifest: unknown; cells: TerrainCell[]; context: CanvasRenderingContext2D; runDraw(): void };
  layer.context = { clearRect() {}, fillRect() {}, fillText() {}, drawImage: draws } as unknown as CanvasRenderingContext2D;
  layer._map = { getContainer: () => document.createElement("div"), getSize: () => ({ x: 100, y: 100 }), containerPointToLayerPoint: () => ({ x: 0, y: 0 }), latLngToContainerPoint: () => ({ x: viewportX, y: 2 }), getBounds: () => ({ contains: () => true }), getZoom: () => 2 };
  layer.cells = [{ x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" }]; layer.manifest = { schemaVersion: 1, gameVersion: "1.0.0", pageSize: 1, contentHash: "x", pages: { "page.webp": {} }, entries: { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:0:0:0": { page: "page.webp", lowPage: "page.webp", x: 0, y: 0, width: 1, height: 1, lowX: 0, lowY: 0, lowWidth: 1, lowHeight: 1, logicalSize: 1, sourceHash: "x" } } };
  layer.runDraw(); viewportX = 9; layer.runDraw(); expect(resolves).toHaveLength(2); resolves[1](); await new Promise((done) => setTimeout(done, 0));
  const nativeDraws = () => draws.mock.calls.filter(([source]) => images.includes(source));
  expect(nativeDraws()).toHaveLength(1); expect(nativeDraws()[0]![0]).toBe(images[1]); expect(nativeDraws()[0]![5]).toBe(9);
  resolves[0](); await new Promise((done) => setTimeout(done, 0)); expect(nativeDraws()).toHaveLength(1); expect(images[0].src).toBe("");
});

it("cancels a deferred decode when removed without emitting or drawing", async () => {
  const { AtlasLayer } = await import("./atlas-layer"); const draws = vi.fn(); Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({ clearRect() {}, fillRect() {}, fillText() {}, drawImage: draws }) });
  let resolve!: () => void; const image = { complete: true, src: "", decode: () => new Promise<void>((done) => { resolve = done; }) } as unknown as HTMLImageElement;
  const layer = new AtlasLayer("/atlas/test.json", true, () => image) as unknown as { _map: unknown; manifest: unknown; cells: TerrainCell[]; context: CanvasRenderingContext2D; attached: boolean; runDraw(): void; onRemove(map: unknown): unknown; pages: Map<string, HTMLImageElement> };
  layer.context = { clearRect() {}, fillRect() {}, fillText() {}, drawImage: draws } as unknown as CanvasRenderingContext2D;
  const container = document.createElement("div"), error = vi.fn(), ready = vi.fn(); container.addEventListener("atlas-error", error); container.addEventListener("atlas-ready", ready); const map = { getContainer: () => container, getSize: () => ({ x: 10, y: 10 }), containerPointToLayerPoint: () => ({ x: 0, y: 0 }), latLngToContainerPoint: () => ({ x: 0, y: 0 }), getBounds: () => ({ contains: () => true }), getZoom: () => 2, off() {} };
  layer._map = map; layer.attached = true; layer.cells = [{ x: 0, y: 0, uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "x" }]; layer.manifest = { schemaVersion: 1, gameVersion: "1.0.0", pageSize: 1, contentHash: "x", pages: { "page.webp": {} }, entries: { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:0:0:0": { page: "page.webp", lowPage: "page.webp", x: 0, y: 0, width: 1, height: 1, lowX: 0, lowY: 0, lowWidth: 1, lowHeight: 1, logicalSize: 1, sourceHash: "x" } } };
  layer.runDraw(); layer.onRemove(map); resolve(); await new Promise((done) => setTimeout(done, 0));
  expect(image.src).toBe(""); expect(layer.pages.size).toBe(0); expect(draws).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
});

it("rejects a production layer when Canvas cannot create a 2D context", async () => {
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(null);
  const { AtlasLayer } = await import("./atlas-layer");

  expect(() => new AtlasLayer()).toThrowError(
    expect.objectContaining({ code: "UNSUPPORTED_BROWSER" })
  );
  getContext.mockRestore();
});

it("lets a queued browser task cancel fallback overview work between row blocks", async () => {
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer() as unknown as {
    _map: unknown;
    attached: boolean;
    prepareOverview(cells: TerrainCell[]): Promise<void>;
    setVisible(visible: boolean): Promise<void>;
  };
  layer._map = { getSize: () => ({ x: 64, y: 64 }) };
  layer.attached = true;
  const cells = Array.from({ length: 64 }, (_, y): TerrainCell => ({
    x: 0,
    y,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  }));

  const pending = layer.prepareOverview(cells);
  setTimeout(() => {
    void layer.setVisible(false);
  }, 0);

  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it("yields by cell budget so a single allowed wide row remains cancellable", async () => {
  const { AtlasLayer } = await import("./atlas-layer");
  let layer!: InstanceType<typeof AtlasLayer>;
  const fills = vi.fn();
  const yieldTask = vi.fn(async () => {
    expect(fills).not.toHaveBeenCalled();
    await layer.setVisible(false);
  });
  layer = new AtlasLayer({
    yieldTask,
    contextFactory: () => ({
      clearRect() {},
      fillRect: fills,
      fillText() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D)
  });
  const mounted = layer as unknown as {
    _map: unknown;
    attached: boolean;
    prepareOverview(cells: TerrainCell[]): Promise<void>;
  };
  mounted._map = { getSize: () => ({ x: 64, y: 1 }) };
  mounted.attached = true;
  const cells = Array.from({ length: 5_000 }, (_, x): TerrainCell => ({
    x,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  }));

  await expect(mounted.prepareOverview(cells)).rejects.toMatchObject({
    name: "AbortError"
  });
  expect(yieldTask).toHaveBeenCalled();
});

it("computes the advertised large overview bounds without argument spreading", async () => {
  const module = await import("./atlas-layer") as unknown as {
    computeOverviewBounds(cells: readonly TerrainCell[]): {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
  };
  const repeated: TerrainCell = {
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  };
  const cells = new Array<TerrainCell>(2_000_000).fill(repeated);
  cells[0] = { ...repeated, x: -1_000_000, y: 999_999 };
  cells[cells.length - 1] = { ...repeated, x: 1_000_000, y: -999_999 };

  expect(module.computeOverviewBounds(cells)).toEqual({
    minX: -1_000_000,
    minY: -999_999,
    maxX: 1_000_000,
    maxY: 999_999
  });
});

it("draws and closes a Worker overview bitmap during mounted preparation", async () => {
  const { AtlasLayer } = await import("./atlas-layer");
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  const draws = vi.fn();
  const layer = new AtlasLayer() as unknown as {
    _map: unknown;
    attached: boolean;
    context: CanvasRenderingContext2D;
    prepareOverview(
      cells: TerrainCell[],
      overview: { bitmap: ImageBitmap; width: number; height: number }
    ): Promise<void>;
  };
  layer._map = { getSize: () => ({ x: 80, y: 60 }) };
  layer.attached = true;
  layer.context = {
    clearRect() {},
    drawImage: draws
  } as unknown as CanvasRenderingContext2D;

  await layer.prepareOverview([], { bitmap, width: 2, height: 2 });

  expect(draws).toHaveBeenCalledWith(bitmap, 0, 0, 80, 60);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});

it("does not clear a committed overview when current native decode fails", async () => {
  const { AtlasLayer } = await import("./atlas-layer");
  const clears = vi.fn();
  const draws = vi.fn();
  const context = {
    clearRect: clears,
    fillRect() {},
    fillText() {},
    drawImage: draws
  } as unknown as CanvasRenderingContext2D;
  const image = {
    complete: true,
    src: "",
    decode: async () => {
      throw new Error("decode failed");
    }
  } as unknown as HTMLImageElement;
  const layer = new AtlasLayer("/atlas/test.json", false, () => image) as unknown as {
    _map: unknown;
    attached: boolean;
    context: CanvasRenderingContext2D;
    manifest: unknown;
    prepareOverview(cells: TerrainCell[]): Promise<void>;
    commitOverview(): void;
    refinePrepared(): void;
  };
  const container = document.createElement("div");
  const errors = vi.fn();
  container.addEventListener("atlas-error", errors);
  layer._map = {
    getContainer: () => container,
    getSize: () => ({ x: 40, y: 40 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
    getBounds: () => ({ contains: () => true }),
    getZoom: () => 2
  };
  layer.attached = true;
  layer.context = context;
  const cell: TerrainCell = {
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  };
  await layer.prepareOverview([cell]);
  layer.commitOverview();
  const clearsAtCommit = clears.mock.calls.length;
  layer.manifest = {
    schemaVersion: 1,
    gameVersion: "1.0.0",
    pageSize: 1,
    contentHash: "x",
    pages: { "native.webp": {} },
    entries: {
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1:0:0:0": {
        page: "native.webp",
        lowPage: "native.webp",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        lowX: 0,
        lowY: 0,
        lowWidth: 1,
        lowHeight: 1,
        logicalSize: 1,
        sourceHash: "x"
      }
    }
  };

  layer.refinePrepared();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(clears).toHaveBeenCalledTimes(clearsAtCommit);
  expect(draws).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledTimes(1);
});

it("commits an explicit production fallback and reports partial manifests as recoverable", async () => {
  const visibleDraws = vi.fn();
  const fallbackFills = vi.fn();
  const contexts = [
    {
      clearRect() {},
      fillRect() {},
      fillText() {},
      drawImage: visibleDraws
    },
    {
      clearRect() {},
      fillRect: fallbackFills,
      fillText() {},
      drawImage() {}
    }
  ] as unknown as CanvasRenderingContext2D[];
  let contextIndex = 0;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    development: false,
    contextFactory: () => contexts[Math.min(contextIndex++, contexts.length - 1)]!
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    manifest: unknown;
    setCells(cells: TerrainCell[], nativeDetail?: boolean): Promise<void>;
  };
  const container = document.createElement("div");
  const errors = vi.fn();
  const ready = vi.fn();
  container.addEventListener("atlas-error", errors);
  container.addEventListener("atlas-ready", ready);
  layer._map = {
    getContainer: () => container,
    getSize: () => ({ x: 20, y: 20 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
    getBounds: () => ({ contains: () => true }),
    getZoom: () => 2
  };
  layer.attached = true;
  layer.manifest = {
    schemaVersion: 1,
    gameVersion: "1.0.0",
    pageSize: 1,
    contentHash: "x",
    pages: {},
    entries: {}
  };

  await layer.setCells([{
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  }]);

  expect(fallbackFills).toHaveBeenCalledTimes(1);
  expect(visibleDraws).toHaveBeenCalledTimes(1);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
});

it("draws native atlas cells on a real CRS.Simple map using the shared 64-unit geometry", async () => {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 256 },
    clientHeight: { configurable: true, value: 256 }
  });
  document.body.append(element);
  const map = L.map(element, {
    crs: L.CRS.Simple,
    zoomControl: false,
    attributionControl: false
  });
  map.setView([3.5 * 64, 2.5 * 64], 0, { animate: false });
  const image = {
    complete: true,
    src: "",
    decode: async () => undefined
  } as unknown as HTMLImageElement;
  const draws: unknown[][] = [];
  const context = {
    clearRect() {},
    fillRect() {},
    fillText() {},
    drawImage(...args: unknown[]) {
      draws.push(args);
    }
  } as unknown as CanvasRenderingContext2D;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    imageFactory: () => image,
    contextFactory: () => context
  }) as unknown as {
    manifest: unknown;
    setCells(cells: TerrainCell[]): Promise<void>;
    addTo(target: L.Map): unknown;
  };
  layer.manifest = {
    schemaVersion: 1,
    gameVersion: "1.0.0",
    pageSize: 4096,
    contentHash: "fixture",
    pages: { "terrain-0.webp": {} },
    entries: {
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1:0:0:0": {
        page: "terrain-0.webp",
        lowPage: "terrain-0.webp",
        x: 0,
        y: 0,
        width: 64,
        height: 64,
        lowX: 0,
        lowY: 0,
        lowWidth: 64,
        lowHeight: 64,
        logicalSize: 64,
        sourceHash: "fixture"
      }
    }
  };
  layer.addTo(map);
  const expectedPoint = map.latLngToContainerPoint([3 * 64, 2 * 64]);

  await layer.setCells([{
    x: 2,
    y: 3,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "fixed"
  }]);

  const native = draws.find(([source]) => source === image);
  expect(native?.slice(5)).toEqual([
    expectedPoint.x,
    expectedPoint.y,
    64,
    64
  ]);
  map.remove();
});

it("preserves forced native detail through terrain hide and show", async () => {
  const nativeDraws = vi.fn();
  const image = {
    complete: true,
    src: "",
    decode: async () => undefined
  } as unknown as HTMLImageElement;
  const context = {
    clearRect() {},
    fillRect() {},
    fillText() {},
    drawImage: nativeDraws
  } as unknown as CanvasRenderingContext2D;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    imageFactory: () => image,
    contextFactory: () => context
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    manifest: unknown;
    setCells(cells: TerrainCell[], nativeDetail?: boolean): Promise<void>;
    setVisible(visible: boolean): Promise<void>;
  };
  const container = document.createElement("div");
  layer._map = {
    getContainer: () => container,
    getSize: () => ({ x: 20, y: 20 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
    getBounds: () => ({ contains: () => true }),
    getZoom: () => 1
  };
  layer.attached = true;
  const entry = {
    page: "native.webp",
    lowPage: "low.webp",
    x: 20,
    y: 40,
    width: 2,
    height: 2,
    lowX: 10,
    lowY: 20,
    lowWidth: 1,
    lowHeight: 1,
    logicalSize: 2,
    sourceHash: "x"
  };
  layer.manifest = {
    schemaVersion: 1,
    gameVersion: "1.0.0",
    pageSize: 64,
    contentHash: "x",
    pages: { "native.webp": {}, "low.webp": {} },
    entries: {
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1:0:0:0": entry
    }
  };
  const cell: TerrainCell = {
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  };

  await layer.setCells([cell], true);
  await layer.setVisible(false);
  nativeDraws.mockClear();
  await layer.setVisible(true);

  const imageDraws = nativeDraws.mock.calls.filter(([source]) => source === image);
  expect(imageDraws).toHaveLength(1);
  expect(imageDraws[0]![1]).toBe(entry.x);
  expect(image.src).toBe("/atlas/native.webp");
});

it("keeps an offline committed overview intact across terrain hide and show", async () => {
  const clears = vi.fn();
  const context = {
    clearRect: clears,
    fillRect() {},
    fillText() {},
    drawImage() {}
  } as unknown as CanvasRenderingContext2D;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "offline-overview",
    contextFactory: () => context
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    canvas: HTMLCanvasElement;
    prepareOverview(cells: TerrainCell[]): Promise<void>;
    commitOverview(): void;
    setVisible(visible: boolean): Promise<void>;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 20, y: 20 })
  };
  layer.attached = true;
  await layer.prepareOverview([{
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  }]);
  layer.commitOverview();
  const committedClears = clears.mock.calls.length;

  await layer.setVisible(false);
  expect(layer.canvas.hidden).toBe(true);
  await layer.setVisible(true);

  expect(layer.canvas.hidden).toBe(false);
  expect(layer.canvas.dataset.terrainFrame).toBe("committed");
  expect(clears).toHaveBeenCalledTimes(committedClears);
});

it("regenerates an offline overview before showing cells changed while hidden", async () => {
  const colors: string[] = [];
  const contextState = {
    fillStyle: "",
    clearRect() {},
    fillRect() {
      colors.push(contextState.fillStyle);
    },
    fillText() {},
    drawImage() {}
  };
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "offline-overview",
    contextFactory: () =>
      contextState as unknown as CanvasRenderingContext2D
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    canvas: HTMLCanvasElement;
    prepareOverview(cells: TerrainCell[]): Promise<void>;
    commitOverview(): void;
    setCells(cells: TerrainCell[]): Promise<void>;
    setVisible(visible: boolean): Promise<void>;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 20, y: 20 })
  };
  layer.attached = true;
  const cell = (terrainType: string): TerrainCell => ({
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType
  });
  await layer.prepareOverview([cell("meadow")]);
  layer.commitOverview();
  const personalColor = colors.at(-1);

  await layer.setVisible(false);
  await layer.setCells([cell("desert")]);
  expect(colors.at(-1)).toBe(personalColor);
  await layer.setVisible(true);

  expect(colors.at(-1)).not.toBe(personalColor);
  expect(layer.canvas.hidden).toBe(false);
  expect(layer.canvas.dataset.terrainFrame).toBe("committed");
});

it("keeps personal refinement offline without treating capability absence as an error", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "offline-overview",
    contextFactory: () => ({
      clearRect() {},
      fillRect() {},
      fillText() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D)
  }) as unknown as {
    _map: unknown;
    refinePrepared(): void;
  };
  const container = document.createElement("div");
  const errors = vi.fn();
  container.addEventListener("atlas-error", errors);
  layer._map = { getContainer: () => container };

  layer.refinePrepared();

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
  expect(container.dataset.atlasStatus).toBeUndefined();
  fetchSpy.mockRestore();
});

it("stages a legacy-preloaded frame atomically without fetching or changing image src", async () => {
  const committedDraws: unknown[][] = [];
  const stagingDraws: unknown[][] = [];
  const committedClears = vi.fn();
  let contextIndex = 0;
  const contexts = [
    {
      clearRect: committedClears,
      fillRect() {},
      fillText() {},
      drawImage(...args: unknown[]) {
        committedDraws.push(args);
      },
      save() {},
      restore() {},
      translate() {},
      rotate() {}
    },
    {
      clearRect() {},
      fillRect() {},
      fillText() {},
      drawImage(...args: unknown[]) {
        stagingDraws.push(args);
      },
      save() {},
      restore() {},
      translate() {},
      rotate() {}
    }
  ] as unknown as CanvasRenderingContext2D[];
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const image = document.createElement("img");
  const originalSrc = "/legacy/img/preloaded.png";
  image.src = originalSrc;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    contextFactory: () => contexts[Math.min(contextIndex++, 1)]!
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    canvas: HTMLCanvasElement;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: { bitmap: ImageBitmap; width: number; height: number },
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    commitOverview(): void;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 64, y: 64 }),
    latLngToContainerPoint: ([lat, lng]: [number, number]) => ({
      x: lng,
      y: lat
    })
  };
  layer.attached = true;
  const close = vi.fn();
  const bitmap = { close } as unknown as ImageBitmap;
  const cell: TerrainCell = {
    x: 0, y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "meadow"
  };

  await layer.prepareLegacyFrame([cell], {
    bitmap,
    width: 1,
    height: 1
  }, {
    visuals: [{
      origin: { x: 0, y: 0 },
      span: { width: 1, height: 1 },
      rotation: 0,
      source: "legacy-tile",
      asset: {
        record: {
          key: "tile:1",
          url: originalSrc,
          sha256: "a".repeat(64),
          width: 64,
          height: 64,
          source: "the1killer/sm_overview"
        },
        image
      },
      terrainType: "meadow",
      coveredCells: ["0,0"]
    }],
    coverage: {
      totalCells: 1,
      legacyTileCells: 1,
      legacyPoiCells: 0,
      fallbackCells: 0
    }
  });
  layer.commitOverview();

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(image.src).toContain("/legacy/img/preloaded.png");
  expect(stagingDraws.some(([source]) => source === image)).toBe(true);
  expect(committedDraws.at(-1)?.[0]).toBeInstanceOf(HTMLCanvasElement);
  expect(committedClears).toHaveBeenCalledOnce();
  expect(layer.canvas.dataset.terrainFrame).toBe("committed");
  expect(close).toHaveBeenCalledOnce();
  fetchSpy.mockRestore();
});

it("keeps the worker overview when a preloaded legacy image cannot be drawn", async () => {
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  const image = document.createElement("img");
  let contextIndex = 0;
  const committedSources: unknown[] = [];
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    contextFactory: () => {
      const isCommitted = contextIndex++ === 0;
      return {
        clearRect() {},
        fillRect() {},
        fillText() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        drawImage(source: unknown) {
          if (isCommitted) {
            committedSources.push(source);
          } else if (source === image) {
            throw new Error("legacy draw failed");
          }
        }
      } as unknown as CanvasRenderingContext2D;
    }
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    canvas: HTMLCanvasElement;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: { bitmap: ImageBitmap; width: number; height: number },
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    commitOverview(): void;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 64, y: 64 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 })
  };
  layer.attached = true;
  const cell: TerrainCell = {
    x: 0, y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "meadow"
  };

  await layer.prepareLegacyFrame([cell], {
    bitmap,
    width: 1,
    height: 1
  }, {
    visuals: [{
      origin: { x: 0, y: 0 },
      span: { width: 1, height: 1 },
      rotation: 0,
      source: "legacy-tile",
      asset: {
        record: {
          key: "tile:1",
          url: "/legacy/img/tile.png",
          sha256: "a".repeat(64),
          width: 64,
          height: 64,
          source: "the1killer/sm_overview"
        },
        image
      },
      terrainType: "meadow",
      coveredCells: ["0,0"]
    }],
    coverage: {
      totalCells: 1,
      legacyTileCells: 1,
      legacyPoiCells: 0,
      fallbackCells: 0
    }
  });
  layer.commitOverview();

  expect(committedSources).toEqual([bitmap]);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(layer.canvas.dataset.terrainFrame).toBe("committed");
});

it("clears a transient legacy staging error after a successful commit restage", async () => {
  const image = document.createElement("img");
  let contextIndex = 0;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    contextFactory: () => {
      const index = contextIndex++;
      return {
        clearRect() {},
        fillRect() {},
        fillText() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        drawImage(source: unknown) {
          if (index === 1 && source === image) {
            throw new Error("transient legacy draw failure");
          }
        }
      } as unknown as CanvasRenderingContext2D;
    }
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    canvas: HTMLCanvasElement;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: undefined,
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    restagePrepared(): Promise<void>;
    commitOverview(): void;
  };
  const container = document.createElement("div");
  const errors = vi.fn();
  const ready = vi.fn();
  container.addEventListener("atlas-error", errors);
  container.addEventListener("atlas-ready", ready);
  layer._map = {
    getContainer: () => container,
    getSize: () => ({ x: 64, y: 64 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 })
  };
  layer.attached = true;
  const cell: TerrainCell = {
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  };
  const frame = {
    visuals: [{
      origin: { x: 0, y: 0 },
      span: { width: 1, height: 1 },
      rotation: 0 as const,
      source: "legacy-tile" as const,
      asset: {
        record: {
          key: "tile:1" as const,
          url: "/legacy/img/tile.png",
          sha256: "a".repeat(64),
          width: 64,
          height: 64,
          source: "the1killer/sm_overview" as const
        },
        image
      },
      terrainType: "meadow",
      coveredCells: ["0,0"]
    }],
    coverage: {
      totalCells: 1,
      legacyTileCells: 1,
      legacyPoiCells: 0,
      fallbackCells: 0
    }
  };

  await layer.prepareLegacyFrame([cell], undefined, frame);
  expect(errors).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  expect(container.dataset.atlasStatus).toBe("error");

  await layer.restagePrepared();
  layer.commitOverview();

  expect(errors).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  expect(container.dataset.atlasStatus).toBeUndefined();
  expect(container.dataset.atlasMessage).toBeUndefined();
  expect(layer.canvas.dataset.terrainFrame).toBe("committed");
});

it("clears a candidate error after the committed legacy frame refreshes", async () => {
  const image = document.createElement("img");
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    contextFactory: () => ({
      clearRect() {},
      fillRect() {},
      fillText() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D)
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    canvas: HTMLCanvasElement;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: undefined,
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    refreshCommitted(): Promise<void>;
    commitOverview(): void;
  };
  const container = document.createElement("div");
  const ready = vi.fn();
  container.addEventListener("atlas-ready", ready);
  layer._map = {
    getContainer: () => container,
    getSize: () => ({ x: 64, y: 64 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 })
  };
  layer.attached = true;
  const cell: TerrainCell = {
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  };
  await layer.prepareLegacyFrame([cell], undefined, {
    visuals: [{
      origin: { x: 0, y: 0 },
      span: { width: 1, height: 1 },
      rotation: 0,
      source: "legacy-tile",
      asset: {
        record: {
          key: "tile:1",
          url: "/legacy/img/tile.png",
          sha256: "a".repeat(64),
          width: 64,
          height: 64,
          source: "the1killer/sm_overview"
        },
        image
      },
      terrainType: "meadow",
      coveredCells: ["0,0"]
    }],
    coverage: {
      totalCells: 1,
      legacyTileCells: 1,
      legacyPoiCells: 0,
      fallbackCells: 0
    }
  });
  layer.commitOverview();
  ready.mockClear();
  container.dataset.atlasStatus = "error";
  container.dataset.atlasMessage = "candidate failed";

  await layer.refreshCommitted();

  expect(ready).toHaveBeenCalledOnce();
  expect(container.dataset.atlasStatus).toBeUndefined();
  expect(container.dataset.atlasMessage).toBeUndefined();
  expect(layer.canvas.dataset.terrainFrame).toBe("committed");
  expect(layer.canvas.hidden).toBe(false);
});

it("redraws the same preloaded frame after terrain is hidden and shown", async () => {
  let srcWrites = 0;
  const image = {
    complete: true,
    get src() {
      return "/legacy/img/preloaded.png";
    },
    set src(_value: string) {
      srcWrites += 1;
    }
  } as unknown as HTMLImageElement;
  const imageDraws = vi.fn();
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    contextFactory: () => ({
      clearRect() {},
      fillRect() {},
      fillText() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      drawImage(source: unknown) {
        if (source === image) imageDraws();
      }
    } as unknown as CanvasRenderingContext2D)
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: undefined,
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    commitOverview(): void;
    setVisible(visible: boolean): Promise<void>;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 64, y: 64 }),
    latLngToContainerPoint: ([lat, lng]: [number, number]) => ({
      x: lng,
      y: lat
    }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 })
  };
  layer.attached = true;
  const cell: TerrainCell = {
    x: 0, y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "meadow"
  };
  const frame = {
    visuals: [{
      origin: { x: 0, y: 0 },
      span: { width: 1, height: 1 },
      rotation: 0 as const,
      source: "legacy-tile" as const,
      asset: {
        record: {
          key: "tile:1" as const,
          url: "/legacy/img/preloaded.png",
          width: 64,
          height: 64,
          sha256: "a".repeat(64),
          source: "the1killer/sm_overview" as const
        },
        image
      },
      terrainType: "meadow",
      coveredCells: ["0,0"]
    }],
    coverage: {
      totalCells: 1,
      legacyTileCells: 1,
      legacyPoiCells: 0,
      fallbackCells: 0
    }
  };
  await layer.prepareLegacyFrame([cell], undefined, frame);
  layer.commitOverview();
  const firstDraws = imageDraws.mock.calls.length;

  await layer.setVisible(false);
  await layer.setVisible(true);

  expect(imageDraws.mock.calls.length).toBeGreaterThan(firstDraws);
  expect(srcWrites).toBe(0);
});

it("restages a legacy frame when POI icon visibility changes", async () => {
  const terrainImage = document.createElement("img");
  const iconImage = document.createElement("img");
  const stagingDraws: unknown[][] = [];
  let contextIndex = 0;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    contextFactory: () => {
      const index = contextIndex++;
      const draws: unknown[] = [];
      if (index > 0) {
        stagingDraws.push(draws);
      }
      return {
        clearRect() {},
        fillRect() {},
        fillText() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        drawImage(source: unknown) {
          draws.push(source);
        }
      } as unknown as CanvasRenderingContext2D;
    }
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: undefined,
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    commitOverview(): void;
    setPoiIconsVisible(visible: boolean): Promise<void>;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 256, y: 256 }),
    latLngToContainerPoint: ([lat, lng]: [number, number]) => ({
      x: lng,
      y: lat
    }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 })
  };
  layer.attached = true;
  const cell: TerrainCell = {
    x: 0,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  };
  const frame = {
    visuals: [{
      origin: { x: 0, y: 0 },
      span: { width: 2, height: 2 },
      rotation: 2 as const,
      source: "one-dot-zero-tile" as const,
      asset: {
        record: {
          key: "tile:1" as const,
          url: "/official/terrain.png",
          sha256: "a".repeat(64),
          width: 128,
          height: 128,
          source: "the1killer/sm_overview" as const
        },
        image: terrainImage
      },
      overlayAsset: {
        record: {
          key: "poi:official" as const,
          url: "/official/icon.png",
          sha256: "b".repeat(64),
          width: 64,
          height: 64,
          source: "the1killer/sm_overview" as const
        },
        image: iconImage
      },
      terrainType: "meadow",
      coveredCells: ["0,0", "1,0", "0,1", "1,1"]
    }],
    coverage: {
      totalCells: 4,
      legacyTileCells: 0,
      legacyPoiCells: 0,
      oneDotZeroTileCells: 4,
      fallbackCells: 0
    }
  };

  await layer.prepareLegacyFrame([cell], undefined, frame);
  layer.commitOverview();
  expect(
    stagingDraws[0]!.filter(
      (source) => source === terrainImage || source === iconImage
    )
  ).toEqual([terrainImage, iconImage]);

  await layer.setPoiIconsVisible(false);
  expect(stagingDraws[1]).toEqual([terrainImage]);

  await layer.setPoiIconsVisible(true);
  expect(stagingDraws[2]).toEqual([terrainImage, iconImage]);
});

it("does not redraw a stale legacy frame during a newer preparation", async () => {
  let releaseOverview!: () => void;
  let signalOverviewYield!: () => void;
  const overviewYielded = new Promise<void>((resolve) => {
    signalOverviewYield = resolve;
  });
  const holdOverview = new Promise<void>((resolve) => {
    releaseOverview = resolve;
  });
  const oldImage = document.createElement("img");
  const newImage = document.createElement("img");
  const oldDraws = vi.fn();
  const newDraws = vi.fn();
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    yieldTask: () => {
      signalOverviewYield();
      return holdOverview;
    },
    contextFactory: () => ({
      clearRect() {},
      fillRect() {},
      fillText() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      drawImage(source: unknown) {
        if (source === oldImage) oldDraws();
        if (source === newImage) newDraws();
      }
    } as unknown as CanvasRenderingContext2D)
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: {
        bitmap: ImageBitmap;
        width: number;
        height: number;
      } | undefined,
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    commitOverview(): void;
    setPoiIconsVisible(visible: boolean): Promise<void>;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 64, y: 64 }),
    latLngToContainerPoint: ([lat, lng]: [number, number]) => ({
      x: lng,
      y: lat
    }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 })
  };
  layer.attached = true;
  const cells = Array.from({ length: 9 }, (_, y): TerrainCell => ({
    x: 0,
    y,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0,
    flags: 0,
    terrainType: "meadow"
  }));
  const legacyFrame = (
    image: HTMLImageElement,
    key: `tile:${number}`
  ): import("./legacy-terrain-renderer").LegacyTerrainFrame => ({
    visuals: [{
      origin: { x: 0, y: 0 },
      span: { width: 1, height: 1 },
      rotation: 0,
      source: "legacy-tile",
      asset: {
        record: {
          key,
          url: `/legacy/img/${key}.png`,
          sha256: "a".repeat(64),
          width: 64,
          height: 64,
          source: "the1killer/sm_overview"
        },
        image
      },
      terrainType: "meadow",
      coveredCells: ["0,0"]
    }],
    coverage: {
      totalCells: 1,
      legacyTileCells: 1,
      legacyPoiCells: 0,
      fallbackCells: 0
    }
  });

  await layer.prepareLegacyFrame(
    [cells[0]!],
    {
      bitmap: { close() {} } as unknown as ImageBitmap,
      width: 1,
      height: 1
    },
    legacyFrame(oldImage, "tile:1")
  );
  layer.commitOverview();
  oldDraws.mockClear();

  const pendingPreparation = layer.prepareLegacyFrame(
    cells,
    undefined,
    legacyFrame(newImage, "tile:2")
  );
  await overviewYielded;
  await layer.setPoiIconsVisible(false);

  expect(oldDraws).not.toHaveBeenCalled();

  releaseOverview();
  await pendingPreparation;
  expect(newDraws).toHaveBeenCalledOnce();
});

it("aborts a hidden legacy staging generation before it can swap", async () => {
  vi.useFakeTimers();
  const committedCopies = vi.fn();
  let contextIndex = 0;
  const { AtlasLayer } = await import("./atlas-layer");
  const layer = new AtlasLayer({
    networkPolicy: "legacy-preloaded",
    contextFactory: () => {
      const committed = contextIndex++ === 0;
      return {
        clearRect() {},
        fillRect() {},
        fillText() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        drawImage() {
          if (committed) committedCopies();
        }
      } as unknown as CanvasRenderingContext2D;
    }
  }) as unknown as {
    _map: unknown;
    attached: boolean;
    prepareLegacyFrame(
      cells: TerrainCell[],
      overview: undefined,
      frame: import("./legacy-terrain-renderer").LegacyTerrainFrame
    ): Promise<void>;
    setVisible(visible: boolean): Promise<void>;
  };
  layer._map = {
    getContainer: () => document.createElement("div"),
    getSize: () => ({ x: 5000, y: 1 }),
    latLngToContainerPoint: ([lat, lng]: [number, number]) => ({
      x: lng,
      y: lat
    }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 })
  };
  layer.attached = true;
  const cell: TerrainCell = {
    x: 0, y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "meadow"
  };
  const pending = layer.prepareLegacyFrame([cell], undefined, {
    visuals: Array.from({ length: 5_000 }, (_, x) => ({
      origin: { x, y: 0 },
      span: { width: 1, height: 1 },
      rotation: 0 as const,
      source: "one-dot-zero-fallback" as const,
      terrainType: "meadow",
      coveredCells: [`${x},0`]
    })),
    coverage: {
      totalCells: 5_000,
      legacyTileCells: 0,
      legacyPoiCells: 0,
      fallbackCells: 5_000
    }
  });
  const rejection = expect(pending).rejects.toMatchObject({
    name: "AbortError"
  });
  await Promise.resolve();
  await Promise.resolve();
  await layer.setVisible(false);
  await vi.runAllTimersAsync();
  await rejection;

  expect(committedCopies).not.toHaveBeenCalled();
  vi.useRealTimers();
});
