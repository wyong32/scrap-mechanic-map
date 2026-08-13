import { expect, it, vi } from "vitest";
import type { NormalizedTerrainTransfer } from "./save-protocol";

it("renders a low-resolution overview on an OffscreenCanvas and owns the bitmap", async () => {
  const fills: Array<{
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  const testContext = {
    fillStyle: "",
    fillRect(x: number, y: number, width: number, height: number) {
      fills.push({ color: testContext.fillStyle, x, y, width, height });
    }
  };
  const context = testContext as unknown as OffscreenCanvasRenderingContext2D;
  const canvases: Array<{ width: number; height: number }> = [];
  const createCanvas = (width: number, height: number) => {
    canvases.push({ width, height });
    return {
      width,
      height,
      getContext: () => context,
      transferToImageBitmap: () => bitmap
    } as unknown as OffscreenCanvas;
  };
  const terrain: NormalizedTerrainTransfer = {
    gameVersion: "1.0.0",
    bounds: { minX: -1, minY: 3, maxX: 0, maxY: 4 },
    uuids: [
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee4"
    ],
    terrainTypes: ["meadow", "desert", "forest", "burned"],
    poiTypes: [null, null, null, null],
    uuidIndexes: new Uint16Array([0, 1, 2, 3]),
    xOffsets: new Int32Array(4),
    yOffsets: new Int32Array(4),
    rotations: new Uint8Array(4),
    flags: new Int32Array(4)
  };
  const { renderWorkerOverview } = await import("./worker-overview");

  const result = renderWorkerOverview(terrain, createCanvas);

  expect(canvases).toEqual([{ width: 2, height: 2 }]);
  expect(fills).toHaveLength(4);
  expect(new Set(fills.map(({ color }) => color)).size).toBe(4);
  expect(fills.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 1, y: 0, width: 1, height: 1 },
    { x: 0, y: 1, width: 1, height: 1 },
    { x: 1, y: 1, width: 1, height: 1 }
  ]);
  expect(result).toEqual({ bitmap, width: 2, height: 2 });
  expect(bitmap.close).not.toHaveBeenCalled();
});
