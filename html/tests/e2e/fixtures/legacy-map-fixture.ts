import type { Page } from "@playwright/test";
import {
  expect,
  SYNTHETIC_DECODED_SENTINEL,
  test as syntheticTest,
  type SyntheticSave,
  type SyntheticSaveManager,
  type SyntheticTerrainCell,
  type SyntheticTerrainGrid
} from "./synthetic-save";

export const ROTATION_UUIDS = [
  "e7c4f9d9-1e57-4a99-9492-75342d65f3c8",
  "410858cb-6aa8-418f-8bed-00c0dc920316",
  "e416821e-aabf-464e-ba61-b7314c651556",
  "2141d12a-ae86-4658-8d3f-405d5a301190"
] as const;

export const OFFICIAL_ROTATION_CELLS = [
  {
    uuid: ROTATION_UUIDS[0],
    legacyId: 10105,
    sourceUrl: "/legacy/img/tiles/10105.jpg",
    x: 0,
    y: 0,
    rotation: 0
  },
  {
    uuid: ROTATION_UUIDS[1],
    legacyId: 10106,
    sourceUrl: "/legacy/img/tiles/10106.jpg",
    x: 1,
    y: 0,
    rotation: 1
  },
  {
    uuid: ROTATION_UUIDS[2],
    legacyId: 10107,
    sourceUrl: "/legacy/img/tiles/10107.jpg",
    x: 0,
    y: 1,
    rotation: 2
  },
  {
    uuid: ROTATION_UUIDS[3],
    legacyId: 10108,
    sourceUrl: "/legacy/img/tiles/10108.jpg",
    x: 1,
    y: 1,
    rotation: 3
  }
] as const;

export const SECOND_LAYOUT_UUIDS = [
  "5174bec6-0c87-4a03-abfd-21e88c3d1e8a",
  "69c5db97-2452-4f95-9ec0-573721249137",
  "cdaaf827-67c2-4e24-b7a0-6daf2dbd9d30",
  "f3535095-b884-4596-a432-0aee1b5d742a"
] as const;

const FALLBACK_UUIDS = [
  "009e5e43-37f6-43b9-bb98-6489f6e8e58f",
  "013e980d-2425-4275-9c4b-c0eee0dba7f1"
] as const;
const MECHANIC_STATION_UUID = "2c36976b-e008-408c-a5b5-1baaaf01df04";

function cells(
  uuids: readonly string[],
  rotations: readonly (0 | 1 | 2 | 3)[] = [0, 0, 0, 0]
): SyntheticTerrainCell[] {
  return uuids.map((uuid, index) => ({
    uuid,
    xOffset: 101 + index * 101,
    yOffset: index,
    rotation: rotations[index] ?? 0,
    flags: SYNTHETIC_DECODED_SENTINEL + index
  }));
}

function grid(
  uuids: readonly string[],
  rotations?: readonly (0 | 1 | 2 | 3)[],
  bounds: Pick<SyntheticTerrainGrid, "minX" | "minY" | "width" | "height"> = {
    minX: 0,
    minY: 0,
    width: 2,
    height: 2
  }
): SyntheticTerrainGrid {
  return {
    ...bounds,
    cells: cells(uuids, rotations)
  };
}

export class LegacyMapSaveManager {
  constructor(private readonly saves: SyntheticSaveManager) {}

  createRotations(name: string): Promise<SyntheticSave> {
    return this.saves.create({
      name,
      seed: 141421,
      grid: grid(ROTATION_UUIDS, [0, 1, 2, 3])
    });
  }

  createDistantRotations(name: string): Promise<SyntheticSave> {
    return this.saves.create({
      name,
      seed: 173205,
      grid: grid(
        ROTATION_UUIDS,
        [0, 1, 2, 3],
        { minX: 100, minY: 100, width: 2, height: 2 }
      )
    });
  }

  createMixed(name: string): Promise<SyntheticSave> {
    return this.saves.create({
      name,
      seed: 223607,
      grid: grid([
        ROTATION_UUIDS[0],
        ROTATION_UUIDS[1],
        FALLBACK_UUIDS[0],
        FALLBACK_UUIDS[1]
      ])
    });
  }

  createMechanicStation(
    name: string,
    rotation: 0 | 1 | 2 | 3 = 0
  ): Promise<SyntheticSave> {
    return this.saves.create({
      name,
      seed: 244949,
      grid: grid(
        [
          MECHANIC_STATION_UUID,
          MECHANIC_STATION_UUID,
          ROTATION_UUIDS[0],
          MECHANIC_STATION_UUID,
          MECHANIC_STATION_UUID,
          ROTATION_UUIDS[1]
        ],
        [rotation, rotation, 0, rotation, rotation, 0],
        { minX: -37, minY: -41, width: 3, height: 2 }
      )
    });
  }

  createPrivacyLayout(
    name: string,
    layout: 0 | 1,
    seed: number
  ): Promise<SyntheticSave> {
    return this.saves.create({
      name,
      seed,
      grid: grid(layout === 0 ? ROTATION_UUIDS : SECOND_LAYOUT_UUIDS)
    });
  }
}

export interface LegacyRenderRecord {
  sequence?: number;
  targetCanvasId?: number;
  sourceCanvasId?: number;
  targetIsTerrain?: boolean;
  operation: "drawImage" | "fillRect";
  sourceKind?: "image" | "canvas" | "bitmap" | "other";
  sourceUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  centerX?: number;
  centerY?: number;
  fillStyle?: string;
  transform?: { a: number; b: number; c: number; d: number };
}

export async function installLegacyRenderCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type CapturedRecord = {
      sequence?: number;
      targetCanvasId?: number;
      sourceCanvasId?: number;
      targetIsTerrain?: boolean;
      operation: "drawImage" | "fillRect";
      sourceKind?: "image" | "canvas" | "bitmap" | "other";
      sourceUrl?: string;
      sourceWidth?: number;
      sourceHeight?: number;
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      centerX?: number;
      centerY?: number;
      fillStyle?: string;
      transform?: { a: number; b: number; c: number; d: number };
    };
    const records: CapturedRecord[] = [];
    const statusHistory: string[] = [];
    const canvasIds = new WeakMap<HTMLCanvasElement, number>();
    const bufferSourceUrls = new WeakMap<ArrayBuffer, string>();
    const blobSourceUrls = new WeakMap<Blob, string>();
    const objectUrlSources = new Map<string, string>();
    const renderedImages = new Map<string, HTMLImageElement>();
    let nextCanvasId = 1;
    Object.defineProperty(window, "__legacyRenderRecords", { value: records });
    Object.defineProperty(window, "__legacyStatusHistory", {
      value: statusHistory
    });
    Object.defineProperty(window, "__legacyRenderImages", {
      value: renderedImages
    });
    const clean = (value: number) => {
      const rounded = Math.round(value * 1_000_000) / 1_000_000;
      return Object.is(rounded, -0) ? 0 : rounded;
    };
    const canvasId = (canvas: HTMLCanvasElement) => {
      let id = canvasIds.get(canvas);
      if (id === undefined) {
        id = nextCanvasId;
        nextCanvasId += 1;
        canvasIds.set(canvas, id);
      }
      return id;
    };
    const responseArrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const bytes = await responseArrayBuffer.call(this);
      try {
        const pathname = new URL(this.url).pathname;
        if (pathname.startsWith("/legacy/")) {
          bufferSourceUrls.set(bytes, pathname);
        }
      } catch {
        // Non-URL response labels are irrelevant to legacy source identity.
      }
      return bytes;
    };
    const NativeBlob = Blob;
    const TrackedBlob = class extends NativeBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        for (const part of parts ?? []) {
          if (part instanceof ArrayBuffer) {
            const sourceUrl = bufferSourceUrls.get(part);
            if (sourceUrl) {
              blobSourceUrls.set(this, sourceUrl);
              break;
            }
          }
        }
      }
    };
    Object.defineProperty(window, "Blob", {
      configurable: true,
      writable: true,
      value: TrackedBlob
    });
    const createObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = createObjectUrl(object);
      if (object instanceof NativeBlob) {
        const sourceUrl = blobSourceUrls.get(object);
        if (sourceUrl) objectUrlSources.set(url, sourceUrl);
      }
      return url;
    };
    const contextPrototype = CanvasRenderingContext2D.prototype;
    const drawImage = contextPrototype.drawImage;
    contextPrototype.drawImage = function (...args: Parameters<typeof drawImage>) {
      const source = args[0];
      const transform = this.getTransform();
      const destination =
        args.length === 5
          ? {
              left: Number(args[1]),
              top: Number(args[2]),
              width: Number(args[3]),
              height: Number(args[4])
            }
          : args.length === 9
            ? {
                left: Number(args[5]),
                top: Number(args[6]),
                width: Number(args[7]),
                height: Number(args[8])
              }
            : {};
      const sourceKind =
        source instanceof HTMLImageElement
          ? "image"
          : source instanceof HTMLCanvasElement
            ? "canvas"
            : typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap
              ? "bitmap"
              : "other";
      const sourceUrl = source instanceof HTMLImageElement
        ? objectUrlSources.get(source.currentSrc || source.src)
          ?? new URL(
            source.currentSrc || source.src,
            location.href
          ).pathname
        : undefined;
      if (source instanceof HTMLImageElement && sourceUrl) {
        renderedImages.set(sourceUrl, source);
      }
      records.push({
        sequence: records.length,
        targetCanvasId: canvasId(this.canvas),
        ...(source instanceof HTMLCanvasElement
          ? { sourceCanvasId: canvasId(source) }
          : {}),
        targetIsTerrain: this.canvas.matches(
          "canvas[data-terrain-frame]"
        ),
        operation: "drawImage",
        sourceKind,
        ...(source instanceof HTMLImageElement
          ? {
              sourceUrl,
              sourceWidth: source.naturalWidth,
              sourceHeight: source.naturalHeight
            }
          : {}),
        ...destination,
        centerX: clean(transform.e),
        centerY: clean(transform.f),
        transform: {
          a: clean(transform.a),
          b: clean(transform.b),
          c: clean(transform.c),
          d: clean(transform.d)
        }
      });
      return drawImage.apply(this, args);
    };
    const fillRect = contextPrototype.fillRect;
    contextPrototype.fillRect = function (
      left: number,
      top: number,
      width: number,
      height: number
    ) {
      records.push({
        sequence: records.length,
        targetCanvasId: canvasId(this.canvas),
        targetIsTerrain: this.canvas.matches(
          "canvas[data-terrain-frame]"
        ),
        operation: "fillRect",
        left: clean(left),
        top: clean(top),
        width: clean(width),
        height: clean(height),
        fillStyle: String(this.fillStyle)
      });
      return fillRect.call(this, left, top, width, height);
    };
    const collectStatus = () => {
      const value = document
        .querySelector<HTMLElement>("[data-status]")
        ?.textContent?.trim();
      if (value && statusHistory.at(-1) !== value) statusHistory.push(value);
    };
    new MutationObserver(collectStatus).observe(document, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
}

export async function clearLegacyRenderCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as Window & {
        __legacyRenderRecords: LegacyRenderRecord[];
        __legacyStatusHistory: string[];
      }
    ).__legacyRenderRecords.length = 0;
    (
      window as Window & {
        __legacyRenderRecords: LegacyRenderRecord[];
        __legacyStatusHistory: string[];
      }
    ).__legacyStatusHistory.length = 0;
  });
}

export const test = syntheticTest.extend<{
  legacyMapSaves: LegacyMapSaveManager;
}>({
  legacyMapSaves: async ({ syntheticSaves }, use) => {
    await use(new LegacyMapSaveManager(syntheticSaves));
  }
});

export { expect };
