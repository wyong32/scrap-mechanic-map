import * as L from "leaflet";
import type { TerrainCell } from "../domain/map-model";
import { SaveParseError } from "../save/save-errors";
import type { SaveOverviewArtifact } from "../save/save-protocol";
import { overviewColor } from "../save/worker-overview";
import { cellToMapPoint, TERRAIN_CELL_SIZE } from "./coordinate-system";
import {
  drawLegacyTerrainFrame,
  type LegacyTerrainFrame,
  type LegacyViewport
} from "./legacy-terrain-renderer";

export interface BrowserAtlasEntry {
  page: string;
  lowPage: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lowX: number;
  lowY: number;
  lowWidth: number;
  lowHeight: number;
  logicalSize: number;
  sourceHash: string;
}

export interface BrowserAtlasManifest {
  schemaVersion: 1;
  gameVersion: string;
  pageSize: number;
  contentHash: string;
  pages: Record<string, unknown>;
  entries: Record<string, BrowserAtlasEntry>;
}

export type AtlasNetworkPolicy =
  | "atlas"
  | "offline-overview"
  | "legacy-preloaded";

export interface AtlasLayerOptions {
  manifestUrl?: string;
  development?: boolean;
  imageFactory?: () => HTMLImageElement;
  canvasFactory?: () => HTMLCanvasElement;
  contextFactory?: (
    canvas: HTMLCanvasElement
  ) => CanvasRenderingContext2D | null;
  yieldTask?: () => Promise<void>;
  networkPolicy?: AtlasNetworkPolicy;
}

interface OverviewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface DrawResult {
  missingEntries: number;
}

const DEFAULT_MANIFEST_URL = "/atlas/terrain-cell-atlas.json";
const FALLBACK_ROWS_PER_YIELD = 8;
const FALLBACK_CELLS_PER_YIELD = 4_096;

function key(cell: TerrainCell): string {
  return `${cell.uuid.toLowerCase()}:${cell.xOffset}:${cell.yOffset}:${cell.rotation}`;
}

function defaultCanvasFactory(): HTMLCanvasElement {
  return document.createElement("canvas");
}

function defaultContextFactory(
  canvas: HTMLCanvasElement
): CanvasRenderingContext2D | null {
  return canvas.getContext("2d");
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

function unsupportedCanvas(): SaveParseError {
  return new SaveParseError("UNSUPPORTED_BROWSER", {
    message: "This browser cannot create a Canvas 2D rendering context."
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function chooseAtlasSource(
  entry: BrowserAtlasEntry,
  zoom: number,
  forceNative = false
): { page: string; x: number; y: number; width: number; height: number } {
  return !forceNative && zoom < 2
    ? {
        page: entry.lowPage,
        x: entry.lowX,
        y: entry.lowY,
        width: entry.lowWidth,
        height: entry.lowHeight
      }
    : {
        page: entry.page,
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height
      };
}

export function shouldDrawMissing(
  development: boolean,
  visible: boolean
): boolean {
  return development && visible;
}

export function isCurrentAtlasGeneration(
  expected: number,
  current: number
): boolean {
  return expected === current;
}

export function computeOverviewBounds(
  cells: readonly TerrainCell[]
): OverviewBounds | undefined {
  if (cells.length === 0) {
    return undefined;
  }
  let minX = cells[0]!.x;
  let minY = cells[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (let index = 1; index < cells.length; index += 1) {
    const cell = cells[index]!;
    if (cell.x < minX) minX = cell.x;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Canvas terrain overlay that draws only cells inside the current Leaflet viewport. */
export class AtlasLayer extends L.Layer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly manifestUrl: string;
  private readonly development: boolean;
  private readonly imageFactory: () => HTMLImageElement;
  private readonly canvasFactory: () => HTMLCanvasElement;
  private readonly contextFactory: (
    canvas: HTMLCanvasElement
  ) => CanvasRenderingContext2D | null;
  private readonly yieldTask: () => Promise<void>;
  private readonly networkPolicy: AtlasNetworkPolicy;
  private cells: TerrainCell[] = [];
  private manifest?: BrowserAtlasManifest;
  private pages = new Map<string, HTMLImageElement>();
  private generation = 0;
  private drawOperation = 0;
  private attached = false;
  private visible = true;
  private poiIconsVisible = true;
  private nativeDetail = false;
  private overviewDirty = true;
  private atlasCapability: "unknown" | "available" | "absent" = "unknown";
  private preparedFrameHasError = false;
  private legacyFrame?: LegacyTerrainFrame;
  private legacyAbort?: AbortController;
  private readonly redraw = () => this.runDraw();

  constructor(
    optionsOrManifest: AtlasLayerOptions | string = {},
    legacyDevelopment = import.meta.env.DEV,
    legacyImageFactory: () => HTMLImageElement = () => new Image()
  ) {
    super();
    const options: AtlasLayerOptions =
      typeof optionsOrManifest === "string"
        ? {
            manifestUrl: optionsOrManifest,
            development: legacyDevelopment,
            imageFactory: legacyImageFactory
          }
        : optionsOrManifest;
    this.manifestUrl = options.manifestUrl ?? DEFAULT_MANIFEST_URL;
    this.development = options.development ?? import.meta.env.DEV;
    this.imageFactory = options.imageFactory ?? (() => new Image());
    this.canvasFactory = options.canvasFactory ?? defaultCanvasFactory;
    this.contextFactory = options.contextFactory ?? defaultContextFactory;
    this.yieldTask = options.yieldTask ?? yieldBrowserTask;
    this.networkPolicy = options.networkPolicy ?? "atlas";
    this.canvas = this.canvasFactory();
    const context = this.contextFactory(this.canvas);
    if (!context) {
      throw unsupportedCanvas();
    }
    this.context = context;
    this.canvas.className = "terrain-atlas-layer";
    this.canvas.setAttribute("aria-hidden", "true");
  }

  onAdd(map: L.Map): this {
    this.attached = true;
    map.getPanes().overlayPane.append(this.canvas);
    if (!this.canvas.dataset.terrainFrame) {
      this.canvas.dataset.terrainFrame = "committed";
    }
    map.on("moveend zoomend resize", this.redraw);
    this.runDraw();
    return this;
  }

  onRemove(map: L.Map): this {
    this.attached = false;
    this.legacyAbort?.abort();
    this.legacyAbort = undefined;
    this.generation += 1;
    this.drawOperation += 1;
    map.off("moveend zoomend resize", this.redraw);
    this.canvas.remove();
    this.release();
    return this;
  }

  async setCells(
    cells: TerrainCell[],
    nativeDetail = false
  ): Promise<void> {
    if (this.networkPolicy === "legacy-preloaded") {
      this.cells = cells;
      this.nativeDetail = nativeDetail;
      if (this.visible && this.legacyFrame) {
        await this.redrawLegacyFrame();
      }
      return;
    }
    if (this.networkPolicy === "offline-overview") {
      this.cells = cells;
      this.nativeDetail = nativeDetail;
      this.overviewDirty = true;
      if (!this.visible) {
        return;
      }
      await this.prepareOverview(cells);
      if (this.visible) {
        this.commitOverview();
      }
      return;
    }
    const generation = ++this.generation;
    this.drawOperation += 1;
    this.release();
    this.cells = cells;
    this.nativeDetail = nativeDetail;
    if (!this.visible) {
      return;
    }
    this.canvas.hidden = false;
    try {
      if (!this.manifest) {
        const response = await fetch(this.manifestUrl);
        const contentType =
          response.headers?.get("content-type")?.toLowerCase() ?? "";
        if (
          response.status === 404
          || (response.ok && contentType.includes("text/html"))
        ) {
          if (
            !isCurrentAtlasGeneration(generation, this.generation)
            || !this.visible
          ) {
            return;
          }
          this.atlasCapability = "absent";
          this.manifest = {
            schemaVersion: 1,
            gameVersion: "1.0",
            pageSize: TERRAIN_CELL_SIZE,
            contentHash: "optional-atlas-absent",
            pages: {},
            entries: {}
          };
        } else if (!response.ok) {
          throw new Error(`Unable to load terrain atlas: ${response.status}`);
        } else {
          const candidate = await response.json() as BrowserAtlasManifest;
          if (
            candidate.schemaVersion !== 1
            || !candidate.contentHash
            || !candidate.pages
            || !candidate.entries
          ) {
            throw new Error("Invalid terrain atlas manifest");
          }
          if (
            !isCurrentAtlasGeneration(generation, this.generation)
            || !this.visible
          ) {
            return;
          }
          this.atlasCapability = "available";
          this.manifest = candidate;
        }
      }
      const result = await this.draw(generation);
      if (
        result
        && isCurrentAtlasGeneration(generation, this.generation)
        && this.visible
      ) {
        this.finishDraw(result);
      }
    } catch (error) {
      if (
        !isCurrentAtlasGeneration(generation, this.generation)
        || !this.visible
      ) {
        return;
      }
      this.manifest = undefined;
      this.atlasCapability = "unknown";
      this.reportError(error);
      throw error;
    }
  }

  async setVisible(visible: boolean): Promise<void> {
    this.visible = visible;
    if (!visible) {
      this.legacyAbort?.abort();
      this.legacyAbort = undefined;
      this.generation += 1;
      this.drawOperation += 1;
      this.canvas.hidden = true;
      this.release();
      return;
    }
    if (this.networkPolicy === "legacy-preloaded") {
      this.canvas.hidden = false;
      if (this.legacyFrame) {
        await this.redrawLegacyFrame();
      }
      return;
    }
    if (this.networkPolicy === "offline-overview") {
      if (this.overviewDirty) {
        await this.prepareOverview(this.cells);
        if (this.visible) {
          this.commitOverview();
        }
        return;
      }
      this.canvas.hidden = false;
      return;
    }
    this.canvas.hidden = false;
    await this.setCells(this.cells, this.nativeDetail);
  }

  async setPoiIconsVisible(visible: boolean): Promise<void> {
    if (this.poiIconsVisible === visible) {
      return;
    }
    this.poiIconsVisible = visible;
    if (this.networkPolicy === "legacy-preloaded" && this.legacyFrame) {
      await this.redrawLegacyFrame();
    }
  }

  release(): void {
    for (const image of this.pages.values()) {
      image.src = "";
    }
    this.pages.clear();
  }

  async prepareOverview(
    cells: TerrainCell[],
    overview?: SaveOverviewArtifact
  ): Promise<void> {
    const generation = ++this.generation;
    this.preparedFrameHasError = false;
    this.overviewDirty = true;
    this.drawOperation += 1;
    this.release();
    this.cells = cells;
    this.canvas.hidden = true;
    this.canvas.dataset.terrainFrame = "preparing";
    const map = this._map;
    if (!map) {
      overview?.bitmap.close();
      throw new Error("Terrain layer must be mounted before preparation.");
    }
    const size = map.getSize();
    this.canvas.width = Math.max(1, size.x);
    this.canvas.height = Math.max(1, size.y);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (overview) {
      try {
        if (
          !Number.isSafeInteger(overview.width)
          || !Number.isSafeInteger(overview.height)
          || overview.width <= 0
          || overview.height <= 0
          || typeof overview.bitmap.close !== "function"
        ) {
          throw new SaveParseError("DECODE_FAILED", {
            stage: "rendering",
            message: "Worker overview artifact is invalid."
          });
        }
        this.context.drawImage(
          overview.bitmap,
          0,
          0,
          this.canvas.width,
          this.canvas.height
        );
      } finally {
        overview.bitmap.close();
      }
    } else {
      await this.drawFallbackOverview(cells, generation);
    }
    this.assertPreparationCurrent(generation);
    this.overviewDirty = false;
    this.canvas.dataset.terrainFrame = "prepared";
  }

  async prepareLegacyFrame(
    cells: TerrainCell[],
    overview: SaveOverviewArtifact | undefined,
    frame: LegacyTerrainFrame
  ): Promise<void> {
    if (this.networkPolicy !== "legacy-preloaded") {
      overview?.bitmap.close();
      throw new Error(
        "Legacy terrain frames require the legacy-preloaded network policy."
      );
    }
    this.legacyAbort?.abort();
    this.legacyAbort = undefined;
    this.legacyFrame = undefined;
    await this.prepareOverview(cells, overview);
    const generation = this.generation;
    this.legacyFrame = frame;
    const controller = new AbortController();
    this.legacyAbort = controller;
    try {
      await this.stageLegacyFrame(frame, generation, controller.signal, true);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.preparedFrameHasError = true;
      this.reportError(error);
    } finally {
      if (this.legacyAbort === controller) {
        this.legacyAbort = undefined;
      }
    }
    this.assertPreparationCurrent(generation);
    this.canvas.dataset.terrainFrame = "prepared";
  }

  commitOverview(): void {
    this.canvas.hidden = false;
    this.canvas.dataset.terrainFrame = "committed";
    if (!this.preparedFrameHasError) {
      this.signalReady();
    }
  }

  hidePrepared(): void {
    this.canvas.hidden = true;
    this.canvas.dataset.terrainFrame = "prepared";
  }

  async restagePrepared(): Promise<void> {
    if (this.networkPolicy === "legacy-preloaded" && this.legacyFrame) {
      await this.redrawLegacyFrame();
    }
  }

  async refreshCommitted(): Promise<void> {
    if (!this.attached || !this.visible) {
      return;
    }
    if (this.networkPolicy === "legacy-preloaded") {
      if (this.legacyFrame) {
        await this.redrawLegacyFrame();
      }
      return;
    }
    if (this.networkPolicy === "offline-overview") {
      await this.prepareOverview(this.cells);
      if (this.visible) {
        this.commitOverview();
      }
      return;
    }
    await this.setCells(this.cells, this.nativeDetail);
  }

  refinePrepared(): void {
    this.nativeDetail = true;
    if (
      this.networkPolicy === "offline-overview"
      || this.networkPolicy === "legacy-preloaded"
    ) {
      if (this.networkPolicy === "legacy-preloaded") {
        return;
      }
      return;
    }
    void this.setCells(this.cells, true).catch(() => undefined);
  }

  private async drawFallbackOverview(
    cells: readonly TerrainCell[],
    generation: number
  ): Promise<void> {
    const bounds = await this.computeFallbackBounds(cells, generation);
    if (!bounds) {
      return;
    }
    const scaleX = this.canvas.width / (bounds.maxX - bounds.minX + 1);
    const scaleY = this.canvas.height / (bounds.maxY - bounds.minY + 1);
    let currentY = cells[0]!.y;
    let rowsSinceYield = 0;
    let cellsSinceYield = 0;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]!;
      if (cell.y !== currentY) {
        currentY = cell.y;
        rowsSinceYield += 1;
      }
      cellsSinceYield += 1;
      if (
        rowsSinceYield >= FALLBACK_ROWS_PER_YIELD
        || cellsSinceYield >= FALLBACK_CELLS_PER_YIELD
      ) {
        await this.yieldTask();
        this.assertPreparationCurrent(generation);
        rowsSinceYield = 0;
        cellsSinceYield = 0;
      }
      this.context.fillStyle = overviewColor(cell.terrainType);
      this.context.fillRect(
        (cell.x - bounds.minX) * scaleX,
        (cell.y - bounds.minY) * scaleY,
        Math.max(1, scaleX),
        Math.max(1, scaleY)
      );
    }
  }

  private async computeFallbackBounds(
    cells: readonly TerrainCell[],
    generation: number
  ): Promise<OverviewBounds | undefined> {
    if (cells.length === 0) {
      return undefined;
    }
    let minX = cells[0]!.x;
    let minY = cells[0]!.y;
    let maxX = minX;
    let maxY = minY;
    for (let index = 1; index < cells.length; index += 1) {
      const cell = cells[index]!;
      if (cell.x < minX) minX = cell.x;
      if (cell.x > maxX) maxX = cell.x;
      if (cell.y < minY) minY = cell.y;
      if (cell.y > maxY) maxY = cell.y;
      if (index % FALLBACK_CELLS_PER_YIELD === 0) {
        await this.yieldTask();
        this.assertPreparationCurrent(generation);
      }
    }
    return { minX, minY, maxX, maxY };
  }

  private assertPreparationCurrent(generation: number): void {
    if (generation !== this.generation || !this.attached) {
      throw new DOMException("Terrain preparation was replaced.", "AbortError");
    }
  }

  private async image(
    page: string,
    expectedGeneration: number,
    expectedDraw: number
  ): Promise<HTMLImageElement | undefined> {
    const existing = this.pages.get(page);
    if (existing) {
      return existing;
    }
    const image = this.imageFactory();
    image.src = `/atlas/${page}`;
    if (image.decode) {
      await image.decode();
    }
    if (
      !isCurrentAtlasGeneration(expectedGeneration, this.generation)
      || expectedDraw !== this.drawOperation
      || !this.visible
    ) {
      image.src = "";
      return undefined;
    }
    if (!image.complete) {
      image.src = "";
      throw new Error(`Terrain atlas page ${page} did not finish loading.`);
    }
    const newer = this.pages.get(page);
    if (newer) {
      image.src = "";
      return newer;
    }
    this.pages.set(page, image);
    return image;
  }

  private runDraw(): void {
    if (this.networkPolicy === "legacy-preloaded") {
      if (this.visible && this.legacyFrame) {
        void this.redrawLegacyFrame().catch((error: unknown) => {
          if (!isAbortError(error) && this.visible && this.attached) {
            this.reportError(error);
          }
        });
      }
      return;
    }
    if (this.networkPolicy === "offline-overview") {
      return;
    }
    const operationGeneration = this.generation;
    const drawOperation = ++this.drawOperation;
    void this.draw(operationGeneration, drawOperation)
      .then((result) => {
        if (
          result
          && isCurrentAtlasGeneration(operationGeneration, this.generation)
          && drawOperation === this.drawOperation
          && this.visible
        ) {
          this.finishDraw(result);
        }
      })
      .catch((error: unknown) => {
        if (
          isCurrentAtlasGeneration(operationGeneration, this.generation)
          && drawOperation === this.drawOperation
          && this.visible
        ) {
          this.reportError(error);
        }
      });
  }

  private async draw(
    generation: number,
    drawOperation = ++this.drawOperation
  ): Promise<DrawResult | undefined> {
    const map = this._map;
    if (
      !map
      || !this.manifest
      || !this.visible
      || !isCurrentAtlasGeneration(generation, this.generation)
      || drawOperation !== this.drawOperation
    ) {
      return undefined;
    }
    const size = map.getSize();
    const stagingCanvas = this.canvasFactory();
    const stagingContext = this.contextFactory(stagingCanvas);
    if (!stagingContext) {
      throw unsupportedCanvas();
    }
    stagingCanvas.width = Math.max(1, size.x);
    stagingCanvas.height = Math.max(1, size.y);
    stagingContext.clearRect(
      0,
      0,
      stagingCanvas.width,
      stagingCanvas.height
    );
    const visible = map.getBounds();
    const zoom = map.getZoom();
    const activePages = new Set<string>();
    let missingEntries = 0;

    for (const cell of this.cells) {
      const mapPoint = cellToMapPoint(cell);
      const point = map.latLngToContainerPoint([mapPoint.y, mapPoint.x]);
      const scale = TERRAIN_CELL_SIZE * Math.pow(2, zoom);
      const cellBounds = L.latLngBounds(
        [mapPoint.y - TERRAIN_CELL_SIZE, mapPoint.x],
        [mapPoint.y, mapPoint.x + TERRAIN_CELL_SIZE]
      );
      const intersectsViewport =
        "intersects" in visible && typeof visible.intersects === "function"
          ? visible.intersects(cellBounds)
          : visible.contains([mapPoint.y, mapPoint.x]);
      if (
        point.x + scale < 0
        || point.y + scale < 0
        || point.x > size.x
        || point.y > size.y
        || !intersectsViewport
      ) {
        continue;
      }
      const entry = this.manifest.entries[key(cell)];
      if (!entry) {
        missingEntries += 1;
        this.drawMissingFallback(stagingContext, point, scale, cell);
        continue;
      }
      const source = chooseAtlasSource(entry, zoom, this.nativeDetail);
      const page = source.page;
      activePages.add(page);
      const image = await this.image(page, generation, drawOperation);
      if (
        !isCurrentAtlasGeneration(generation, this.generation)
        || drawOperation !== this.drawOperation
        || !this.visible
      ) {
        return undefined;
      }
      if (!image) {
        return undefined;
      }
      stagingContext.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        point.x,
        point.y,
        Math.max(1, scale),
        Math.max(1, scale)
      );
    }

    if (
      !isCurrentAtlasGeneration(generation, this.generation)
      || drawOperation !== this.drawOperation
      || !this.visible
    ) {
      return undefined;
    }
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    this.canvas.width = stagingCanvas.width;
    this.canvas.height = stagingCanvas.height;
    L.DomUtil.setPosition(this.canvas, topLeft);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.drawImage(stagingCanvas, 0, 0);
    for (const [page, image] of this.pages) {
      if (!activePages.has(page)) {
        image.src = "";
        this.pages.delete(page);
      }
    }
    return { missingEntries };
  }

  private legacyViewport(): LegacyViewport {
    const map = this._map;
    if (!map) {
      throw new Error("Terrain layer must be mounted before preparation.");
    }
    const size = map.getSize();
    const origin = map.latLngToContainerPoint([0, 0]);
    const cellCorner = map.latLngToContainerPoint([
      -TERRAIN_CELL_SIZE,
      TERRAIN_CELL_SIZE
    ]);
    return {
      width: Math.max(1, size.x),
      height: Math.max(1, size.y),
      origin: { x: origin.x, y: origin.y },
      cellSize: Math.max(
        1,
        Math.max(
          Math.abs(cellCorner.x - origin.x),
          Math.abs(cellCorner.y - origin.y)
        )
      )
    };
  }

  private async stageLegacyFrame(
    frame: LegacyTerrainFrame,
    generation: number,
    signal: AbortSignal,
    includeCommittedOverview: boolean
  ): Promise<void> {
    const viewport = this.legacyViewport();
    const stagingCanvas = this.canvasFactory();
    const stagingContext = this.contextFactory(stagingCanvas);
    if (!stagingContext) {
      throw unsupportedCanvas();
    }
    stagingCanvas.width = viewport.width;
    stagingCanvas.height = viewport.height;
    stagingContext.clearRect(
      0,
      0,
      stagingCanvas.width,
      stagingCanvas.height
    );
    if (includeCommittedOverview) {
      stagingContext.drawImage(this.canvas, 0, 0);
    }
    await drawLegacyTerrainFrame(
      stagingContext,
      stagingCanvas,
      frame,
      viewport,
      signal,
      { showPoiIcons: this.poiIconsVisible }
    );
    this.assertPreparationCurrent(generation);
    if (signal.aborted || !this.visible) {
      throw new DOMException("Legacy terrain rendering was replaced.", "AbortError");
    }
    const positionedMap = this._map as L.Map & {
      containerPointToLayerPoint?: (point: L.PointExpression) => L.Point;
    };
    const topLeft = positionedMap.containerPointToLayerPoint
      ? positionedMap.containerPointToLayerPoint([0, 0])
      : L.point(0, 0);
    if (
      this.canvas.width !== stagingCanvas.width ||
      this.canvas.height !== stagingCanvas.height
    ) {
      this.canvas.width = stagingCanvas.width;
      this.canvas.height = stagingCanvas.height;
    }
    L.DomUtil.setPosition(this.canvas, topLeft);
    const previousComposite = this.context.globalCompositeOperation;
    this.context.globalCompositeOperation = "copy";
    try {
      this.context.drawImage(stagingCanvas, 0, 0);
    } finally {
      this.context.globalCompositeOperation = previousComposite;
    }
  }

  private async redrawLegacyFrame(): Promise<void> {
    const frame = this.legacyFrame;
    if (!frame || !this.visible || !this.attached) {
      return;
    }
    this.legacyAbort?.abort();
    const controller = new AbortController();
    this.legacyAbort = controller;
    const generation = this.generation;
    try {
      await this.stageLegacyFrame(frame, generation, controller.signal, false);
      this.preparedFrameHasError = false;
      if (this.canvas.dataset.terrainFrame === "committed") {
        this.signalReady();
      }
    } finally {
      if (this.legacyAbort === controller) {
        this.legacyAbort = undefined;
      }
    }
  }

  private drawMissingFallback(
    context: CanvasRenderingContext2D,
    point: L.Point,
    scale: number,
    cell: TerrainCell
  ): void {
    context.fillStyle = overviewColor(cell.terrainType);
    context.fillRect(
      point.x,
      point.y,
      Math.max(1, scale),
      Math.max(1, scale)
    );
    if (shouldDrawMissing(this.development, true)) {
      context.fillStyle = "#1b1b1b";
      context.fillText("missing", point.x, point.y + Math.max(10, scale));
    }
  }

  private finishDraw(result: DrawResult): void {
    if (
      result.missingEntries > 0
      && this.atlasCapability !== "absent"
    ) {
      this.reportError(
        new Error(
          `${result.missingEntries} visible terrain atlas entr${result.missingEntries === 1 ? "y is" : "ies are"} unavailable; explicit overview fallbacks remain visible.`
        )
      );
      return;
    }
    this.signalReady();
  }

  private signalReady(): void {
    const element = this._map?.getContainer();
    if (element) {
      delete element.dataset.atlasStatus;
      delete element.dataset.atlasMessage;
      element.dispatchEvent(new CustomEvent("atlas-ready"));
    }
  }

  private reportError(error: unknown): void {
    const element = this._map?.getContainer();
    if (!element) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (
      element.dataset.atlasStatus === "error"
      && element.dataset.atlasMessage === message
    ) {
      return;
    }
    element.dataset.atlasStatus = "error";
    element.dataset.atlasMessage = message;
    element.dispatchEvent(
      new CustomEvent("atlas-error", { detail: message })
    );
  }
}
