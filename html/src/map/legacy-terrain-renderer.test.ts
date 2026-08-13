import { expect, it, vi } from "vitest";
import { overviewColor } from "../save/worker-overview";
import type {
  PreloadedLegacyAsset,
  ResolvedTerrainVisual
} from "../legacy/legacy-visual-types";
import {
  createLegacyTerrainFrame,
  drawLegacyTerrainFrame,
  poiIconScreenSize,
  type LegacyTerrainFrame,
  type LegacyViewport
} from "./legacy-terrain-renderer";

function asset(key: string): PreloadedLegacyAsset {
  return {
    record: {
      key: `poi:${key}`,
      url: `/legacy/img/${key}.png`,
      sha256: key.padEnd(64, "0").slice(0, 64),
      width: 64,
      height: 64,
      source: "the1killer/sm_overview"
    },
    image: { complete: true, dataset: { key } } as unknown as HTMLImageElement
  };
}

function visual(
  x: number,
  y: number,
  rotation: 0 | 1 | 2 | 3,
  source: ResolvedTerrainVisual["source"] = "legacy-tile",
  span = 1
): ResolvedTerrainVisual {
  const resolvedAsset = source === "one-dot-zero-fallback"
    ? undefined
    : asset(`${source}-${span}-${x}-${y}`);
  return {
    origin: { x, y },
    span: { width: span, height: span },
    rotation,
    source,
    ...(resolvedAsset ? { asset: resolvedAsset } : {}),
    terrainType: source === "one-dot-zero-fallback" ? "desert" : "meadow",
    coveredCells: Array.from({ length: span * span }, (_, index) =>
      `${x + index % span},${y + Math.floor(index / span)}`)
  };
}

function frame(visuals: readonly ResolvedTerrainVisual[]): LegacyTerrainFrame {
  return {
    visuals,
    coverage: {
      totalCells: visuals.reduce(
        (total, item) => total + item.coveredCells.length,
        0
      ),
      legacyTileCells: visuals
        .filter((item) => item.source === "legacy-tile")
        .reduce((total, item) => total + item.coveredCells.length, 0),
      legacyPoiCells: visuals
        .filter((item) => item.source === "legacy-poi")
        .reduce((total, item) => total + item.coveredCells.length, 0),
      oneDotZeroTileCells: visuals
        .filter((item) =>
          item.source === "one-dot-zero-tile"
          || item.source === "one-dot-zero-thumbnail"
        )
        .reduce((total, item) => total + item.coveredCells.length, 0),
      fallbackCells: visuals
        .filter((item) => item.source === "one-dot-zero-fallback")
        .reduce((total, item) => total + item.coveredCells.length, 0)
    }
  };
}

function recordingContext() {
  const operations: Array<readonly [string, ...unknown[]]> = [];
  const context = {
    fillStyle: "",
    save: () => operations.push(["save"]),
    restore: () => operations.push(["restore"]),
    translate: (...args: unknown[]) => operations.push(["translate", ...args]),
    rotate: (...args: unknown[]) => operations.push(["rotate", ...args]),
    drawImage: (...args: unknown[]) => operations.push(["drawImage", ...args]),
    fillRect: (...args: unknown[]) =>
      operations.push(["fillRect", context.fillStyle, ...args])
  } as unknown as CanvasRenderingContext2D;
  return { context, operations };
}

const viewport: LegacyViewport = {
  width: 128,
  height: 128,
  origin: { x: 0, y: 64 },
  cellSize: 64
};

it("sizes POI icons from the smaller footprint dimension within compact bounds", () => {
  expect(poiIconScreenSize(8, 8)).toBe(24);
  expect(poiIconScreenSize(128, 128)).toBe(48);
  expect(poiIconScreenSize(512, 512)).toBe(64);
});

it("draws rotated terrain before a centered upright POI icon", async () => {
  const terrain = asset("official-terrain");
  const icon = asset("official-icon");
  icon.sourceRect = { x: 4, y: 8, width: 16, height: 20 };
  const official = visual(1, 2, 2, "one-dot-zero-tile", 4);
  official.asset = terrain;
  official.overlayAsset = icon;
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 256, height: 256 } as HTMLCanvasElement,
    frame([official]),
    { width: 256, height: 256, origin: { x: 0, y: 192 }, cellSize: 32 },
    new AbortController().signal
  );

  expect(operations).toEqual([
    ["save"],
    ["translate", 96, 192],
    ["rotate", Math.PI],
    ["drawImage", terrain.image, -64, -64, 128, 128],
    ["restore"],
    ["drawImage", icon.image, 4, 8, 16, 20, 72, 168, 48, 48]
  ]);
});

it("omits only the upright POI icon when POI icons are disabled", async () => {
  const terrain = asset("official-terrain");
  const icon = asset("official-icon");
  const official = visual(0, 0, 2, "one-dot-zero-tile", 2);
  official.asset = terrain;
  official.overlayAsset = icon;
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 128, height: 128 } as HTMLCanvasElement,
    frame([official]),
    { width: 128, height: 128, origin: { x: 0, y: 64 }, cellSize: 32 },
    new AbortController().signal,
    { showPoiIcons: false }
  );

  expect(operations).toEqual([
    ["save"],
    ["translate", 32, 96],
    ["rotate", Math.PI],
    ["drawImage", terrain.image, -32, -32, 64, 64],
    ["restore"]
  ]);
});

it("paints fallback terrain beneath an optional bounded POI icon", async () => {
  const icon = asset("isometric-preview-icon");
  const fallback = visual(0, 0, 0, "one-dot-zero-fallback", 2);
  fallback.overlayAsset = icon;
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 128, height: 128 } as HTMLCanvasElement,
    frame([fallback]),
    { width: 128, height: 128, origin: { x: 0, y: 64 }, cellSize: 32 },
    new AbortController().signal
  );

  expect(operations).toEqual([
    ["fillRect", overviewColor("desert"), 0, 64, 64, 64],
    ["drawImage", icon.image, 20, 84, 24, 24]
  ]);
});

it("draws a rotated rectangular terrain AABB that intersects the viewport", async () => {
  const terrain = visual(1, 0, 1, "one-dot-zero-tile");
  terrain.span = { width: 1, height: 3 };
  terrain.coveredCells = ["1,0", "1,1", "1,2"];
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 10, height: 16 } as HTMLCanvasElement,
    frame([terrain]),
    { width: 10, height: 16, origin: { x: 0, y: 0 }, cellSize: 10 },
    new AbortController().signal
  );

  expect(
    operations.filter(([operation]) => operation === "drawImage")
  ).toHaveLength(1);
  expect(
    operations.find(([operation]) => operation === "rotate")?.[1]
  ).toBe(Math.PI * 1.5);
});

it("draws a minimum-size centered POI icon that intersects the viewport", async () => {
  const terrain = asset("edge-terrain");
  const icon = asset("edge-icon");
  const official = visual(1, 0, 0, "one-dot-zero-tile");
  official.asset = terrain;
  official.overlayAsset = icon;
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 10, height: 10 } as HTMLCanvasElement,
    frame([official]),
    { width: 10, height: 10, origin: { x: 2, y: 2 }, cellSize: 8 },
    new AbortController().signal
  );

  expect(
    operations
      .filter(([operation]) => operation === "drawImage")
      .map(([, image]) => image)
  ).toEqual([terrain.image, icon.image]);
  expect(
    operations.find(
      ([operation, image]) =>
        operation === "drawImage" && image === icon.image
    )?.slice(2)
  ).toEqual([2, -6, 24, 24]);
});

it("draws four original cells into distinct destinations with the legacy rotations", async () => {
  const { context, operations } = recordingContext();
  const visuals = [
    visual(0, 0, 0),
    visual(1, 0, 1),
    visual(0, 1, 2),
    visual(1, 1, 3)
  ];

  await drawLegacyTerrainFrame(
    context,
    { width: 128, height: 128 } as HTMLCanvasElement,
    frame(visuals),
    viewport,
    new AbortController().signal
  );

  const draws = operations.filter(([operation]) => operation === "drawImage");
  expect(draws.map(([, image]) => image)).toEqual(
    visuals.map((item) => item.asset!.image)
  );
  expect(
    operations
      .filter(([operation]) => operation === "translate")
      .map(([, x, y]) => [x, y])
  ).toEqual([[32, 96], [96, 96], [32, 32], [96, 32]]);
  expect(
    operations
      .filter(([operation]) => operation === "rotate")
      .map(([, radians]) => radians)
  ).toEqual([0, Math.PI * 1.5, Math.PI, Math.PI / 2]);
  expect(operations.some(([operation]) => operation === "fillRect")).toBe(false);
  expect(draws.every((draw) => draw[4] === 64 && draw[5] === 64)).toBe(true);
});

it("draws increasing game Y upward so north road edges meet y+1 neighbours", async () => {
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 128, height: 320 } as HTMLCanvasElement,
    frame([
      visual(0, 1, 0),
      visual(0, -1, 0)
    ]),
    {
      width: 128,
      height: 320,
      origin: { x: 0, y: 128 },
      cellSize: 64
    },
    new AbortController().signal
  );

  expect(
    operations
      .filter(([operation]) => operation === "translate")
      .map(([, x, y]) => [x, y])
  ).toEqual([
    [32, 96],
    [32, 224]
  ]);
});

it.each(
  ([2, 4, 8] as const).flatMap((span) =>
    ([1, 2, 3] as const).map((rotation) => ({ span, rotation })))
)(
  "keeps a rotated $span x $span POI centered over its covered cells",
  async ({ span, rotation }) => {
    const { context, operations } = recordingContext();
    const poi = visual(1, 10, rotation, "legacy-poi", span);

    await drawLegacyTerrainFrame(
      context,
      { width: 1024, height: 1024 } as HTMLCanvasElement,
      frame([poi]),
      { width: 1024, height: 1024, origin: { x: 0, y: 512 }, cellSize: 32 },
      new AbortController().signal
    );

    const draws = operations.filter(([operation]) => operation === "drawImage");
    expect(draws).toHaveLength(1);
    expect(
      operations.find(([operation]) => operation === "translate")?.slice(1)
    ).toEqual([
      32 + span * 16,
      512 - (10 + span - 1) * 32 + span * 16
    ]);
    expect(
      operations.find(([operation]) => operation === "rotate")?.[1]
    ).toBe([0, Math.PI * 1.5, Math.PI, Math.PI / 2][rotation]);
    expect(draws[0]!.slice(2)).toEqual([
      -span * 16,
      -span * 16,
      span * 32,
      span * 32
    ]);
  }
);

it("fills an uncovered 1.0 cell with its overview color instead of claiming an exact image", async () => {
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 64, height: 64 } as HTMLCanvasElement,
    frame([visual(0, 0, 0, "one-dot-zero-fallback")]),
    { width: 64, height: 64, origin: { x: 0, y: 0 }, cellSize: 64 },
    new AbortController().signal
  );

  expect(operations).toEqual([
    ["fillRect", overviewColor("desert"), 0, 0, 64, 64]
  ]);
});

it("renders an uncovered official lake cell with the sampled game-water color", async () => {
  const lake = visual(0, 0, 0, "one-dot-zero-fallback");
  lake.terrainType = "8";
  const { context, operations } = recordingContext();

  await drawLegacyTerrainFrame(
    context,
    { width: 64, height: 64 } as HTMLCanvasElement,
    frame([lake]),
    { width: 64, height: 64, origin: { x: 0, y: 0 }, cellSize: 64 },
    new AbortController().signal
  );

  expect(operations).toEqual([
    ["fillRect", "#49a3c7", 0, 0, 64, 64]
  ]);
});

it("draws an official atlas sub-rectangle with the nine-argument canvas overload", async () => {
  const { context, operations } = recordingContext();
  const official = visual(0, 0, 0, "one-dot-zero-tile");
  official.asset!.sourceRect = { x: 128, y: 64, width: 64, height: 64 };

  await drawLegacyTerrainFrame(
    context,
    { width: 64, height: 64 } as HTMLCanvasElement,
    frame([official]),
    { width: 64, height: 64, origin: { x: 0, y: 0 }, cellSize: 64 },
    new AbortController().signal
  );

  expect(operations.find(([operation]) => operation === "drawImage")?.slice(2))
    .toEqual([128, 64, 64, 64, -32, -32, 64, 64]);
});

it("does not paint a rectangular fallback beneath a transparent isometric thumbnail", async () => {
  const { context, operations } = recordingContext();
  const thumbnail = visual(0, 0, 0, "one-dot-zero-thumbnail", 2);
  thumbnail.terrainType = "forest";

  await drawLegacyTerrainFrame(
    context,
    { width: 128, height: 128 } as HTMLCanvasElement,
    frame([thumbnail]),
    { width: 128, height: 128, origin: { x: 0, y: 64 }, cellSize: 64 },
    new AbortController().signal
  );

  expect(operations.some(([operation]) => operation === "fillRect")).toBe(false);
  expect(operations.some(([operation]) => operation === "drawImage")).toBe(true);
});

it("yields a real task by the ordinary-cell budget and observes cancellation", async () => {
  vi.useFakeTimers();
  const { context } = recordingContext();
  const controller = new AbortController();
  const pending = drawLegacyTerrainFrame(
    context,
    { width: 5000, height: 1 } as HTMLCanvasElement,
    frame(
      Array.from({ length: 5_000 }, (_, x) =>
        visual(x, 0, 0, "one-dot-zero-fallback"))
    ),
    { width: 5000, height: 1, origin: { x: 0, y: 0 }, cellSize: 1 },
    controller.signal
  );
  const rejection = expect(pending).rejects.toMatchObject({
    name: "AbortError"
  });

  controller.abort();
  await vi.runAllTimersAsync();
  await rejection;
  vi.useRealTimers();
});

it("counts an exact-source visual without an asset as fallback coverage", () => {
  const missingAsset: ResolvedTerrainVisual = {
    origin: { x: 0, y: 0 },
    span: { width: 1, height: 1 },
    rotation: 0,
    source: "legacy-tile",
    terrainType: "meadow",
    coveredCells: ["0,0"]
  };

  expect(createLegacyTerrainFrame([missingAsset]).coverage).toEqual({
    totalCells: 1,
    legacyTileCells: 0,
    legacyPoiCells: 0,
    oneDotZeroTileCells: 0,
    fallbackCells: 1
  });
});
