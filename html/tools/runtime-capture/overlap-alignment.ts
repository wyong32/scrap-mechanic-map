import sharp from "sharp";
import type {
  NeighborAlignment,
  RuntimeStitchContract,
} from "./runtime-types.ts";

const FRAME_SIZE = 750;
const SCORE_STEP = 4;
const MAX_ERROR = 0.08;

interface RgbImage {
  data: Buffer;
  width: number;
  height: number;
  luminanceIntegral: Float64Array;
}

async function readCanonicalFrame(path: string): Promise<RgbImage> {
  const image = sharp(path, { failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || metadata.width !== FRAME_SIZE || metadata.height !== FRAME_SIZE) {
    throw new Error("Runtime stitch inputs must be PNG images at exactly 750x750.");
  }
  const { data, info } = await image.removeAlpha().toColourspace("srgb").raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width !== FRAME_SIZE || info.height !== FRAME_SIZE) {
    throw new Error("Runtime stitch input is not canonical RGB.");
  }
  const stride = info.width + 1;
  const luminanceIntegral = new Float64Array((info.width + 1) * (info.height + 1));
  for (let y = 0; y < info.height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 3;
      rowSum += 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      luminanceIntegral[(y + 1) * stride + x + 1] = luminanceIntegral[y * stride + x + 1] + rowSum;
    }
  }
  return { data, width: info.width, height: info.height, luminanceIntegral };
}

function quarterPixel(image: RgbImage, x: number, y: number, width: number, height: number): number {
  const stride = image.width + 1;
  const x2 = x + width;
  const y2 = y + height;
  const sum = image.luminanceIntegral[y2 * stride + x2]
    - image.luminanceIntegral[y * stride + x2]
    - image.luminanceIntegral[y2 * stride + x]
    + image.luminanceIntegral[y * stride + x];
  return sum / (width * height);
}

function scoreTranslation(
  left: RgbImage,
  right: RgbImage,
  x: number,
  y: number,
  upperBound = Number.POSITIVE_INFINITY,
): number {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(left.width, x + right.width);
  const endY = Math.min(left.height, y + right.height);
  if (endX <= startX || endY <= startY) return Number.POSITIVE_INFINITY;
  const columns = Math.ceil((endX - startX) / SCORE_STEP);
  const rows = Math.ceil((endY - startY) / SCORE_STEP);
  const count = columns * rows;
  const cutoff = upperBound * count * 255;
  let sum = 0;
  for (let py = startY; py < endY; py += SCORE_STEP) {
    for (let px = startX; px < endX; px += SCORE_STEP) {
      const blockWidth = Math.min(SCORE_STEP, endX - px);
      const blockHeight = Math.min(SCORE_STEP, endY - py);
      sum += Math.abs(
        quarterPixel(left, px, py, blockWidth, blockHeight)
        - quarterPixel(right, px - x, py - y, blockWidth, blockHeight),
      );
      if (sum > cutoff) return Number.POSITIVE_INFINITY;
    }
  }
  const normalized = sum / (count * 255);
  return normalized < 1e-12 ? 0 : normalized;
}

interface Candidate { x: number; y: number; error: number }

function adjustment(candidate: Candidate, contract: RuntimeStitchContract): [number, number] {
  return contract.axis === "horizontal"
    ? [candidate.x - contract.nominalStride, candidate.y]
    : [candidate.x, candidate.y - contract.nominalStride];
}

function compareCandidateTie(
  left: Candidate,
  right: Candidate,
  contract: RuntimeStitchContract,
): number {
  const [leftX, leftY] = adjustment(left, contract);
  const [rightX, rightY] = adjustment(right, contract);
  const leftMagnitude = Math.abs(leftX) + Math.abs(leftY);
  const rightMagnitude = Math.abs(rightX) + Math.abs(rightY);
  return leftMagnitude - rightMagnitude || leftX - rightX || leftY - rightY;
}

function ranges(contract: RuntimeStitchContract): { x: [number, number]; y: [number, number] } {
  const { nominalStride, searchRadius, axis } = contract;
  return axis === "horizontal"
    ? { x: [nominalStride - searchRadius, nominalStride + searchRadius], y: [-searchRadius, searchRadius] }
    : { x: [-searchRadius, searchRadius], y: [nominalStride - searchRadius, nominalStride + searchRadius] };
}

function validContract(contract: RuntimeStitchContract): boolean {
  return (contract.axis === "horizontal" || contract.axis === "vertical")
    && Number.isSafeInteger(contract.nominalStride)
    && Number.isSafeInteger(contract.nominalOverlap)
    && Number.isSafeInteger(contract.searchRadius)
    && contract.nominalStride === FRAME_SIZE - contract.nominalOverlap
    && contract.nominalOverlap > 0
    && contract.searchRadius >= 0
    && contract.nominalStride - contract.searchRadius > 0;
}

export async function estimateNeighborTranslation(
  leftPath: string,
  rightPath: string,
  contract: RuntimeStitchContract,
): Promise<NeighborAlignment> {
  if (!validContract(contract)) throw new Error("Runtime stitch contract is invalid.");
  const [left, right] = await Promise.all([
    readCanonicalFrame(leftPath),
    readCanonicalFrame(rightPath),
  ]);
  const search = ranges(contract);
  const candidates: Candidate[] = [];
  for (let x = search.x[0]; x <= search.x[1]; x += 1) {
    for (let y = search.y[0]; y <= search.y[1]; y += 1) {
      candidates.push({ x, y, error: Number.POSITIVE_INFINITY });
    }
  }
  candidates.sort((a, b) => compareCandidateTie(a, b, contract));
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    candidate.error = scoreTranslation(
      left,
      right,
      candidate.x,
      candidate.y,
      best?.error,
    );
    if (!best || candidate.error < best.error) {
      best = candidate;
    }
  }
  if (!best || best.error > MAX_ERROR) {
    throw new Error("Runtime neighbor alignment error exceeds 0.08.");
  }
  return {
    axis: contract.axis,
    x: best.x,
    y: best.y,
    error: best.error,
  };
}
