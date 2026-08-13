import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import type { TerrainCell } from "../../src/domain/map-model.ts";
import type { ReferenceExtractionInputs } from "./reference-extraction-types.ts";
import {
  createReferenceTransform,
  type PixelEdges,
  type ReferenceOrientation,
} from "./reference-transform.ts";

const OUTPUT_ERROR = "Candidate crops require a canonical local output root without symlinks or junctions.";

export interface CandidateExtractionInput {
  inputs: ReferenceExtractionInputs;
  /** Local-only source path supplied at the filesystem boundary; never published. */
  sourceImagePath: string;
  orientation: ReferenceOrientation;
  /** Exact pre-approved local generation root; callers own its ignore policy. */
  trustedLocalRoot: string;
  /** Explicit supported cell span; real-data tuning belongs to the caller. */
  maximumFootprintSpan: number;
}

export interface ExtractionCandidate {
  uuid: string;
  rotation: 0 | 1 | 2 | 3;
  offset: { x: number; y: number };
  footprint: { width: number; height: number };
  world: { x: number; y: number };
  pixelEdges: PixelEdges;
  sha256: string;
  width: number;
  height: number;
  channels: 3;
  /** Canonical RGB pixels retained locally for deterministic selection. */
  pixels: Uint8Array;
  localFilename: string;
}

export interface DecodedCandidateSource {
  pixels: Uint8Array;
  width: number;
  height: number;
  channels: 4;
}

export interface CandidateExtractorDependencies {
  decodeSource?: (bytes: Uint8Array) => Promise<DecodedCandidateSource>;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(comparable(root), comparable(candidate));
  return difference !== ""
    && difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference);
}

async function resolveNearestExisting(path: string): Promise<string> {
  const tail: string[] = [];
  let candidate = resolve(path);
  while (true) {
    try {
      return resolve(await realpath(candidate), ...tail);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
      const parent = dirname(candidate);
      if (code !== "ENOENT" || parent === candidate) throw error;
      tail.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  const requested = resolve(path);
  const canonical = await realpath(requested);
  const stats = await lstat(requested);
  if (comparable(requested) !== comparable(canonical) || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(OUTPUT_ERROR);
  }
  return canonical;
}

async function canonicalOutputRoot(trustedLocalRoot: string, outputRoot: string): Promise<string> {
  try {
    const trusted = await canonicalDirectory(trustedLocalRoot);
    const output = await canonicalDirectory(outputRoot);
    if (!isWithin(trusted, output)) {
      throw new Error("Candidate output must remain strictly below the trusted local root.");
    }
    return output;
  } catch (error) {
    if (error instanceof Error && (error.message === OUTPUT_ERROR || error.message.includes("trusted local root"))) throw error;
    throw new Error(OUTPUT_ERROR, { cause: error });
  }
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function relativeFilename(
  cell: TerrainCell,
  footprint: ExtractionCandidate["footprint"],
  orientation: ReferenceOrientation,
): string {
  return `${cell.uuid}/r${cell.rotation}-ox${signed(cell.xOffset)}-oy${signed(cell.yOffset)}`
    + `-span${footprint.width}x${footprint.height}-x${signed(cell.x)}-y${signed(cell.y)}-${orientation}.png`;
}

async function safeOutputPath(root: string, localFilename: string): Promise<string> {
  const requested = resolve(root, localFilename);
  const canonical = await resolveNearestExisting(requested);
  if (!isWithin(root, canonical) || comparable(requested) !== comparable(canonical)) {
    throw new Error(OUTPUT_ERROR);
  }
  return requested;
}

function compareCells(left: TerrainCell, right: TerrainCell): number {
  return left.y - right.y || left.x - right.x || left.uuid.localeCompare(right.uuid)
    || left.rotation - right.rotation;
}

function footprintKey(cell: Pick<TerrainCell, "uuid" | "rotation">): string {
  return `${cell.uuid}:${cell.rotation}`;
}

function footprintByGroup(
  cells: readonly TerrainCell[],
  maximumSpan: number,
): Map<string, ExtractionCandidate["footprint"]> {
  if (!Number.isSafeInteger(maximumSpan) || maximumSpan <= 0) {
    throw new Error("Maximum candidate footprint span is invalid.");
  }
  const footprints = new Map<string, ExtractionCandidate["footprint"]>();
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell.xOffset) || !Number.isSafeInteger(cell.yOffset)
      || cell.xOffset < 0 || cell.yOffset < 0
      || cell.xOffset >= maximumSpan || cell.yOffset >= maximumSpan) {
      throw new Error("Candidate cell offset exceeds the supported footprint span.");
    }
    const key = footprintKey(cell);
    const current = footprints.get(key) ?? { width: 1, height: 1 };
    current.width = Math.max(current.width, cell.xOffset + 1);
    current.height = Math.max(current.height, cell.yOffset + 1);
    footprints.set(key, current);
  }
  return footprints;
}

export async function decodeCandidateSource(bytes: Uint8Array): Promise<DecodedCandidateSource> {
  const { data, info } = await sharp(bytes, { failOn: "error" })
    .ensureAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width <= 0 || info.height <= 0
    || data.length !== info.width * info.height * 4) {
    throw new Error("Candidate source could not be decoded to tightly packed RGBA pixels.");
  }
  return {
    pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    channels: 4,
  };
}

function cropDecodedSource(
  source: DecodedCandidateSource,
  edges: PixelEdges,
): Uint8Array {
  if (source.channels !== 4 || source.width <= 0 || source.height <= 0
    || source.pixels.length !== source.width * source.height * 4
    || edges.left < 0 || edges.top < 0 || edges.right > source.width || edges.bottom > source.height
    || edges.right <= edges.left || edges.bottom <= edges.top) {
    throw new Error("Candidate source pixels or crop edges are invalid.");
  }
  const width = edges.right - edges.left;
  const height = edges.bottom - edges.top;
  const pixels = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((edges.top + row) * source.width + edges.left) * 4;
    const targetOffset = row * width * 3;
    for (let column = 0; column < width; column += 1) {
      const rgba = sourceOffset + column * 4;
      const rgb = targetOffset + column * 3;
      pixels[rgb] = source.pixels[rgba]!;
      pixels[rgb + 1] = source.pixels[rgba + 1]!;
      pixels[rgb + 2] = source.pixels[rgba + 2]!;
    }
  }
  return pixels;
}

export async function extractCandidates(
  input: CandidateExtractionInput,
  outputRoot: string,
  dependencies: CandidateExtractorDependencies = {},
): Promise<ExtractionCandidate[]> {
  const root = await canonicalOutputRoot(input.trustedLocalRoot, outputRoot);
  const sourceBytes = await readFile(input.sourceImagePath);
  if (createHash("sha256").update(sourceBytes).digest("hex") !== input.inputs.source.sha256) {
    throw new Error("Candidate source image failed its validated hash check.");
  }
  const metadata = await sharp(sourceBytes, { failOn: "error" }).metadata();
  if (metadata.width !== input.inputs.source.width || metadata.height !== input.inputs.source.height) {
    throw new Error("Candidate source image dimensions do not match validated input metadata.");
  }
  const decoded = await (dependencies.decodeSource ?? decodeCandidateSource)(sourceBytes);
  if (decoded.width !== input.inputs.source.width || decoded.height !== input.inputs.source.height
    || decoded.channels !== 4 || decoded.pixels.length !== decoded.width * decoded.height * 4) {
    throw new Error("Candidate source decoded dimensions or channels do not match validated input metadata.");
  }
  const transform = createReferenceTransform({
    imageWidth: input.inputs.source.width,
    imageHeight: input.inputs.source.height,
    bounds: input.inputs.source.bounds,
    orientation: input.orientation,
  });
  const footprints = footprintByGroup(input.inputs.referenceWorld.cells, input.maximumFootprintSpan);
  const candidates: ExtractionCandidate[] = [];
  for (const cell of [...input.inputs.defaultWorld.cells].sort(compareCells)) {
    const footprint = footprints.get(footprintKey(cell));
    if (!footprint || cell.xOffset >= footprint.width || cell.yOffset >= footprint.height) {
      throw new Error("Candidate cell has an invalid observed footprint offset.");
    }
    const pixelEdges = transform.cellPixelEdges(cell.x, cell.y);
    const width = pixelEdges.right - pixelEdges.left;
    const height = pixelEdges.bottom - pixelEdges.top;
    const localFilename = relativeFilename(cell, footprint, input.orientation);
    const outputPath = await safeOutputPath(root, localFilename);
    await mkdir(dirname(outputPath), { recursive: true });
    const pixels = cropDecodedSource(decoded, pixelEdges);
    const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer();
    await writeFile(outputPath, bytes);
    candidates.push({
      uuid: cell.uuid,
      rotation: cell.rotation,
      offset: { x: cell.xOffset, y: cell.yOffset },
      footprint: { ...footprint },
      world: { x: cell.x, y: cell.y },
      pixelEdges,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width,
      height,
      channels: 3,
      pixels,
      localFilename,
    });
  }
  return candidates;
}
