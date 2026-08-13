import type { ResolvedTerrainVisual } from "../legacy/legacy-visual-types";
import { overviewColor } from "../save/worker-overview";
import { LEGACY_ROTATION_DEGREES } from "./legacy-rotation";

export interface LegacyTerrainFrame {
  visuals: readonly ResolvedTerrainVisual[];
  coverage: {
    totalCells: number;
    legacyTileCells: number;
    legacyPoiCells: number;
    oneDotZeroTileCells?: number;
    fallbackCells: number;
  };
}

export interface LegacyViewport {
  width: number;
  height: number;
  origin: { x: number; y: number };
  cellSize: number;
}

export function poiIconScreenSize(
  footprintWidth: number,
  footprintHeight: number
): number {
  const size = Math.round(
    Math.min(footprintWidth, footprintHeight) * 0.375
  );
  return Math.max(24, Math.min(64, size));
}

export function createLegacyTerrainFrame(
  visuals: readonly ResolvedTerrainVisual[]
): LegacyTerrainFrame {
  let totalCells = 0;
  let legacyTileCells = 0;
  let legacyPoiCells = 0;
  let oneDotZeroTileCells = 0;
  let fallbackCells = 0;
  for (const visual of visuals) {
    const count = visual.coveredCells.length;
    totalCells += count;
    if (visual.source === "legacy-tile" && visual.asset) {
      legacyTileCells += count;
    } else if (visual.source === "legacy-poi" && visual.asset) {
      legacyPoiCells += count;
    } else if (
      (visual.source === "one-dot-zero-tile"
        || visual.source === "one-dot-zero-thumbnail")
      && visual.asset
    ) {
      oneDotZeroTileCells += count;
    } else {
      fallbackCells += count;
    }
  }
  return {
    visuals,
    coverage: {
      totalCells,
      legacyTileCells,
      legacyPoiCells,
      oneDotZeroTileCells,
      fallbackCells
    }
  };
}

const ORDINARY_CELLS_PER_YIELD = 4_096;
const ROWS_PER_YIELD = 8;

function abortIfRequested(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Legacy terrain rendering was aborted.", "AbortError");
  }
}

function yieldBrowserTask(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function intersectsViewport(
  left: number,
  top: number,
  width: number,
  height: number,
  viewport: LegacyViewport
): boolean {
  return (
    left < viewport.width &&
    top < viewport.height &&
    left + width > 0 &&
    top + height > 0
  );
}

export async function drawLegacyTerrainFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: LegacyTerrainFrame,
  viewport: LegacyViewport,
  signal: AbortSignal,
  options?: { showPoiIcons?: boolean }
): Promise<void> {
  abortIfRequested(signal);
  if (
    canvas.width !== viewport.width ||
    canvas.height !== viewport.height
  ) {
    canvas.width = viewport.width;
    canvas.height = viewport.height;
  }

  let ordinaryCells = 0;
  let rows = 0;
  let currentRow: number | undefined;
  for (const visual of frame.visuals) {
    const isOrdinary = visual.span.width === 1 && visual.span.height === 1;
    if (isOrdinary) {
      ordinaryCells += 1;
      if (visual.origin.y !== currentRow) {
        currentRow = visual.origin.y;
        rows += 1;
      }
      if (
        ordinaryCells >= ORDINARY_CELLS_PER_YIELD ||
        rows >= ROWS_PER_YIELD
      ) {
        await yieldBrowserTask();
        abortIfRequested(signal);
        ordinaryCells = 0;
        rows = 0;
      }
    }

    const left =
      viewport.origin.x
      + visual.origin.x * viewport.cellSize;
    const topGridY = visual.source === "legacy-poi"
      ? visual.origin.y + visual.span.height - 1
      : visual.origin.y;
    const top =
      viewport.origin.y
      - topGridY * viewport.cellSize;
    const width = visual.span.width * viewport.cellSize;
    const height = visual.span.height * viewport.cellSize;
    const swapsTerrainBounds = visual.rotation % 2 === 1;
    const terrainWidth = swapsTerrainBounds ? height : width;
    const terrainHeight = swapsTerrainBounds ? width : height;
    const terrainLeft = left + (width - terrainWidth) / 2;
    const terrainTop = top + (height - terrainHeight) / 2;
    const icon = options?.showPoiIcons === false
      ? undefined
      : visual.overlayAsset;
    const iconSize = icon ? poiIconScreenSize(width, height) : 0;
    const iconLeft = left + (width - iconSize) / 2;
    const iconTop = top + (height - iconSize) / 2;
    if (
      !intersectsViewport(
        terrainLeft,
        terrainTop,
        terrainWidth,
        terrainHeight,
        viewport
      )
      && (
        !icon
        || !intersectsViewport(
          iconLeft,
          iconTop,
          iconSize,
          iconSize,
          viewport
        )
      )
    ) {
      continue;
    }

    const terrainAsset = visual.asset;
    const usesFallbackTerrain =
      visual.source === "one-dot-zero-fallback" || !terrainAsset;
    if (usesFallbackTerrain) {
      context.fillStyle = overviewColor(visual.terrainType);
      context.fillRect(left, top, Math.max(1, width), Math.max(1, height));
    } else {
      context.save();
      try {
        context.translate(left + width / 2, top + height / 2);
        context.rotate(
          LEGACY_ROTATION_DEGREES[visual.rotation] * Math.PI / 180
        );
        if (terrainAsset.sourceRect) {
          const source = terrainAsset.sourceRect;
          context.drawImage(
            terrainAsset.image,
            source.x,
            source.y,
            source.width,
            source.height,
            -width / 2,
            -height / 2,
            Math.max(1, width),
            Math.max(1, height)
          );
        } else {
          context.drawImage(
            terrainAsset.image,
            -width / 2,
            -height / 2,
            Math.max(1, width),
            Math.max(1, height)
          );
        }
      } finally {
        context.restore();
      }
    }

    if (!icon) {
      continue;
    }
    if (icon.sourceRect) {
      const source = icon.sourceRect;
      context.drawImage(
        icon.image,
        source.x,
        source.y,
        source.width,
        source.height,
        iconLeft,
        iconTop,
        iconSize,
        iconSize
      );
    } else {
      context.drawImage(
        icon.image,
        iconLeft,
        iconTop,
        iconSize,
        iconSize
      );
    }
  }
  abortIfRequested(signal);
}
