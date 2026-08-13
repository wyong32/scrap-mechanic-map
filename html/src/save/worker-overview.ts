import type {
  NormalizedTerrainTransfer,
  SaveOverviewArtifact
} from "./save-protocol";

const MAX_OVERVIEW_DIMENSION = 512;

export type OffscreenCanvasFactory = (
  width: number,
  height: number
) => OffscreenCanvas;

function defaultCanvasFactory(
  width: number,
  height: number
): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}

export function overviewColor(terrainType: string): string {
  if (terrainType === "8") return "#49a3c7";
  let hash = 0;
  for (let index = 0; index < terrainType.length; index += 1) {
    hash = (hash * 31 + terrainType.charCodeAt(index)) >>> 0;
  }
  return `hsl(${hash % 360} 28% 42%)`;
}

export function renderWorkerOverview(
  terrain: NormalizedTerrainTransfer,
  createCanvas: OffscreenCanvasFactory | undefined =
    typeof OffscreenCanvas === "undefined" ? undefined : defaultCanvasFactory
): SaveOverviewArtifact | undefined {
  if (!createCanvas) {
    return undefined;
  }
  const cellWidth = terrain.bounds.maxX - terrain.bounds.minX + 1;
  const cellHeight = terrain.bounds.maxY - terrain.bounds.minY + 1;
  const width = Math.max(1, Math.min(MAX_OVERVIEW_DIMENSION, cellWidth));
  const height = Math.max(1, Math.min(MAX_OVERVIEW_DIMENSION, cellHeight));

  try {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.transferToImageBitmap !== "function") {
      return undefined;
    }
    let activeColor = "";
    for (let index = 0; index < terrain.uuidIndexes.length; index += 1) {
      const uuidIndex = terrain.uuidIndexes[index]!;
      const color = overviewColor(terrain.terrainTypes[uuidIndex] ?? "unknown");
      if (color !== activeColor) {
        context.fillStyle = color;
        activeColor = color;
      }
      const column = index % cellWidth;
      const row = Math.floor(index / cellWidth);
      const left = Math.floor(column * width / cellWidth);
      const top = Math.floor(row * height / cellHeight);
      const right = Math.ceil((column + 1) * width / cellWidth);
      const bottom = Math.ceil((row + 1) * height / cellHeight);
      context.fillRect(
        left,
        top,
        Math.max(1, right - left),
        Math.max(1, bottom - top)
      );
    }
    return {
      bitmap: canvas.transferToImageBitmap(),
      width,
      height
    };
  } catch {
    return undefined;
  }
}
