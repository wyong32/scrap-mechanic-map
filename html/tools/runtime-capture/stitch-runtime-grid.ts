import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import { buildRuntimeCaptureJob } from "./capture-job.ts";
import { estimateNeighborTranslation } from "./overlap-alignment.ts";
import type {
  AcceptedRuntimeFrame,
  RuntimeCaptureJob,
  RuntimeCaptureManifest,
  RuntimeFramePlacement,
  RuntimeNeighborAlignment,
  RuntimeStitchReceipt,
} from "./runtime-types.ts";

const FRAME_SIZE = 750;
const OUTPUT_FILE = "stitched/default-surface-5x5.png" as const;
const RECEIPT_FILE = "reports/stitch-receipt.json";

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function canonicalText(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(comparable(root), comparable(candidate));
  return difference === "" || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

async function resolveThroughNearestExistingAncestor(path: string): Promise<string> {
  const tail: string[] = [];
  let candidate = resolve(path);
  while (true) {
    try {
      return resolve(await realpath(candidate), ...tail);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      const parent = dirname(candidate);
      if (code !== "ENOENT" || parent === candidate) throw error;
      tail.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function assertCanonicalJob(job: RuntimeCaptureJob): void {
  let expected: RuntimeCaptureJob;
  try {
    expected = buildRuntimeCaptureJob(job.sourceSaveSha256);
  } catch {
    throw new Error("Runtime stitch requires the canonical job.");
  }
  if (JSON.stringify(canonicalize(job)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error("Runtime stitch requires the canonical job.");
  }
}

function assertCanonicalManifest(job: RuntimeCaptureJob, manifest: RuntimeCaptureManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.jobContentHash !== job.contentHash || manifest.frames.length !== 25) {
    throw new Error("Runtime stitch manifest must contain exactly 25 accepted points.");
  }
  const expected = new Set(job.points.map((point) => point.id));
  const actual = new Set(manifest.frames.map((frame) => frame.pointId));
  if (actual.size !== 25 || [...expected].some((id) => !actual.has(id))) {
    throw new Error("Runtime stitch manifest must contain exactly 25 accepted points.");
  }
  for (const frame of manifest.frames) {
    if (
      frame.file !== `accepted/${frame.pointId}.png`
      || !/^[a-f0-9]{64}$/.test(frame.sha256)
      || frame.width !== FRAME_SIZE
      || frame.height !== FRAME_SIZE
      || !Number.isFinite(frame.normalizedMeanAbsoluteDifference)
      || !Number.isFinite(frame.darkRatio)
      || ![1, 2, 3].includes(frame.attempt)
    ) throw new Error("Runtime stitch manifest contains a non-canonical frame record.");
  }
}

interface LoadedFrame { record: AcceptedRuntimeFrame; path: string; rgb: Buffer }

async function loadFrames(
  root: string,
  job: RuntimeCaptureJob,
  manifest: RuntimeCaptureManifest,
): Promise<Map<string, LoadedFrame>> {
  const byId = new Map(manifest.frames.map((frame) => [frame.pointId, frame]));
  const loaded = new Map<string, LoadedFrame>();
  for (const point of job.points) {
    const record = byId.get(point.id)!;
    const path = resolve(root, ...record.file.split("/"));
    const canonical = await realpath(path).catch((error) => {
      throw new Error("Runtime stitch frame path is unavailable.", { cause: error });
    });
    if (!isWithin(root, canonical) || comparable(path) !== comparable(canonical)) {
      throw new Error("Runtime stitch frame does not use its canonical path inside the capture root.");
    }
    const bytes = await readFile(canonical);
    if (digest(bytes) !== record.sha256) throw new Error("Runtime stitch frame hash does not match the manifest.");
    const image = sharp(bytes, { failOn: "error" });
    const metadata = await image.metadata();
    if (metadata.format !== "png" || metadata.width !== FRAME_SIZE || metadata.height !== FRAME_SIZE) {
      throw new Error("Runtime stitch inputs must be PNG images at exactly 750x750.");
    }
    const { data, info } = await image.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error("Runtime stitch input is not canonical RGB.");
    loaded.set(point.id, { record, path: canonical, rgb: data });
  }
  return loaded;
}

async function alignGrid(
  job: RuntimeCaptureJob,
  frames: Map<string, LoadedFrame>,
): Promise<RuntimeNeighborAlignment[]> {
  const records: RuntimeNeighborAlignment[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const fromPointId = `r${row}-c${column}` as const;
      const toPointId = `r${row}-c${column + 1}` as const;
      const result = await estimateNeighborTranslation(frames.get(fromPointId)!.path, frames.get(toPointId)!.path, {
        ...job.stitch,
        axis: "horizontal",
      });
      records.push({ fromPointId, toPointId, ...result });
    }
  }
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const fromPointId = `r${row}-c${column}` as const;
      const toPointId = `r${row + 1}-c${column}` as const;
      const result = await estimateNeighborTranslation(frames.get(fromPointId)!.path, frames.get(toPointId)!.path, {
        ...job.stitch,
        axis: "vertical",
      });
      records.push({ fromPointId, toPointId, ...result });
    }
  }
  return records;
}

function solveLinear(matrix: number[][], vector: number[]): number[] {
  for (let pivot = 0; pivot < vector.length; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < vector.length; row += 1) {
      if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[best][pivot])) best = row;
    }
    [matrix[pivot], matrix[best]] = [matrix[best], matrix[pivot]];
    [vector[pivot], vector[best]] = [vector[best], vector[pivot]];
    const divisor = matrix[pivot][pivot];
    if (Math.abs(divisor) < 1e-12) throw new Error("Runtime stitch translations cannot be solved.");
    for (let column = pivot; column < vector.length; column += 1) matrix[pivot][column] /= divisor;
    vector[pivot] /= divisor;
    for (let row = 0; row < vector.length; row += 1) {
      if (row === pivot) continue;
      const factor = matrix[row][pivot];
      for (let column = pivot; column < vector.length; column += 1) matrix[row][column] -= factor * matrix[pivot][column];
      vector[row] -= factor * vector[pivot];
    }
  }
  return vector;
}

function solveAxis(alignments: readonly RuntimeNeighborAlignment[], key: "x" | "y"): number[] {
  const size = 24;
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const vector = Array<number>(size).fill(0);
  const index = (id: string) => Number(id[1]) * 5 + Number(id[4]);
  for (const edge of alignments) {
    const from = index(edge.fromPointId);
    const to = index(edge.toPointId);
    const delta = edge[key];
    if (from > 0) { matrix[from - 1][from - 1] += 1; vector[from - 1] -= delta; }
    if (to > 0) { matrix[to - 1][to - 1] += 1; vector[to - 1] += delta; }
    if (from > 0 && to > 0) {
      matrix[from - 1][to - 1] -= 1;
      matrix[to - 1][from - 1] -= 1;
    }
  }
  return [0, ...solveLinear(matrix, vector).map(Math.round)];
}

function solveOrigins(alignments: readonly RuntimeNeighborAlignment[]): Map<string, { x: number; y: number }> {
  const xs = solveAxis(alignments, "x");
  const ys = solveAxis(alignments, "y");
  const origins = new Map<string, { x: number; y: number }>();
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const index = row * 5 + column;
      origins.set(`r${row}-c${column}`, { x: xs[index], y: ys[index] });
    }
  }
  return origins;
}

function compose(
  job: RuntimeCaptureJob,
  frames: Map<string, LoadedFrame>,
  origins: Map<string, { x: number; y: number }>,
): { pixels: Buffer; width: number; height: number; placements: RuntimeFramePlacement[] } {
  const points = job.points;
  const left = Math.max(...points.filter((point) => point.column === 0).map((point) => origins.get(point.id)!.x));
  const top = Math.max(...points.filter((point) => point.row === 0).map((point) => origins.get(point.id)!.y));
  const right = Math.min(...points.filter((point) => point.column === 4).map((point) => origins.get(point.id)!.x + FRAME_SIZE));
  const bottom = Math.min(...points.filter((point) => point.row === 4).map((point) => origins.get(point.id)!.y + FRAME_SIZE));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) throw new Error("Runtime stitch translations do not form a complete grid.");
  const pixels = Buffer.alloc(width * height * 3);
  const placements: RuntimeFramePlacement[] = points.map((point) => {
    const origin = origins.get(point.id)!;
    return {
      pointId: point.id,
      sourceSha256: frames.get(point.id)!.record.sha256,
      origin: { x: origin.x - left, y: origin.y - top },
      crop: {
        left: Math.max(0, left - origin.x),
        top: Math.max(0, top - origin.y),
        width: Math.min(origin.x + FRAME_SIZE, right) - Math.max(origin.x, left),
        height: Math.min(origin.y + FRAME_SIZE, bottom) - Math.max(origin.y, top),
      },
    };
  });
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      let selected: typeof points[number] | undefined;
      let distance = Number.POSITIVE_INFINITY;
      for (const point of points) {
        const origin = origins.get(point.id)!;
        if (x < origin.x || x >= origin.x + FRAME_SIZE || y < origin.y || y >= origin.y + FRAME_SIZE) continue;
        const dx = x - (origin.x + FRAME_SIZE / 2);
        const dy = y - (origin.y + FRAME_SIZE / 2);
        const candidate = dx * dx + dy * dy;
        if (candidate < distance) { selected = point; distance = candidate; }
      }
      if (!selected) throw new Error("Runtime stitch translations leave an uncovered output pixel.");
      const origin = origins.get(selected.id)!;
      const sourceOffset = ((y - origin.y) * FRAME_SIZE + (x - origin.x)) * 3;
      const outputOffset = ((y - top) * width + (x - left)) * 3;
      frames.get(selected.id)!.rgb.copy(pixels, outputOffset, sourceOffset, sourceOffset + 3);
    }
  }
  return { pixels, width, height, placements };
}

async function publishAtomically(root: string, png: Buffer, receiptText: string): Promise<void> {
  const imagePath = join(root, ...OUTPUT_FILE.split("/"));
  const receiptPath = join(root, ...RECEIPT_FILE.split("/"));
  await Promise.all([mkdir(dirname(imagePath), { recursive: true }), mkdir(dirname(receiptPath), { recursive: true })]);
  const imageTemp = join(dirname(imagePath), `.${basename(imagePath)}.${process.pid}.tmp`);
  const receiptTemp = join(dirname(receiptPath), `.${basename(receiptPath)}.${process.pid}.tmp`);
  let imagePlaced = false;
  try {
    await Promise.all([
      writeFile(imageTemp, png, { flag: "wx" }),
      writeFile(receiptTemp, receiptText, { encoding: "utf8", flag: "wx" }),
    ]);
    const existing = await Promise.all([
      readFile(imagePath).catch(() => undefined),
      readFile(receiptPath, "utf8").catch(() => undefined),
    ]);
    if (existing[0] || existing[1]) {
      if (!existing[0] || existing[1] === undefined || !existing[0].equals(png) || existing[1] !== receiptText) {
        throw new Error("Runtime stitch outputs already exist with different content.");
      }
      return;
    }
    await rename(imageTemp, imagePath); imagePlaced = true;
    await rename(receiptTemp, receiptPath);
  } catch (error) {
    if (imagePlaced) await unlink(imagePath).catch(() => undefined);
    throw error;
  } finally {
    await Promise.all([unlink(imageTemp).catch(() => undefined), unlink(receiptTemp).catch(() => undefined)]);
  }
}

export async function stitchRuntimeGrid(
  job: RuntimeCaptureJob,
  manifest: RuntimeCaptureManifest,
  outputRoot: string,
): Promise<RuntimeStitchReceipt> {
  assertCanonicalJob(job);
  assertCanonicalManifest(job, manifest);
  const root = await realpath(resolve(outputRoot)).catch((error) => {
    throw new Error("Runtime stitch capture root is unavailable.", { cause: error });
  });
  const [outputPath, receiptPath] = await Promise.all([
    resolveThroughNearestExistingAncestor(join(root, ...OUTPUT_FILE.split("/"))),
    resolveThroughNearestExistingAncestor(join(root, ...RECEIPT_FILE.split("/"))),
  ]);
  if (!isWithin(root, outputPath) || !isWithin(root, receiptPath)) {
    throw new Error("Runtime stitch output path escapes the capture root.");
  }
  const frames = await loadFrames(root, job, manifest);
  const alignments = await alignGrid(job, frames);
  if (alignments.length !== 40) throw new Error("Runtime stitch requires 40 neighbor alignments.");
  const origins = solveOrigins(alignments);
  const composition = compose(job, frames, origins);
  const png = await sharp(composition.pixels, {
    raw: { width: composition.width, height: composition.height, channels: 3 },
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true }).toBuffer();
  const unsigned = {
    schemaVersion: 1 as const,
    jobContentHash: job.contentHash,
    transforms: "translation-and-crop-only" as const,
    output: { file: OUTPUT_FILE, sha256: digest(png), width: composition.width, height: composition.height },
    placements: composition.placements,
    alignments,
  };
  const receipt: RuntimeStitchReceipt = { ...unsigned, contentHash: digest(canonicalText(unsigned)) };
  await publishAtomically(root, png, canonicalText(receipt));
  return receipt;
}
