import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import sharp, { type Metadata, type Stats } from "sharp";
import { rectifyOfficialPreview } from "../game-data/atlas/official-tile-atlas.ts";
import type {
  DefaultSurfaceCaptureTarget,
  SurfaceCaptureReceipt,
  VerifiedSurfaceMaster,
} from "./default-surface-types.ts";

const RECEIPT_KEYS = [
  "camera",
  "editor",
  "editorVersion",
  "image",
  "sourceTileRelativePath",
  "sourceTileUuid",
] as const;
const CAMERA_KEYS = [
  "direction",
  "height",
  "pixelsPerCell",
  "projection",
  "viewDirection",
  "width",
] as const;
const IMAGE_KEYS = ["file", "fullScene"] as const;

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function failReceipt(): never {
  throw new Error("Capture does not contain a valid official TileEditor receipt.");
}

function failSource(): never {
  throw new Error("Capture source does not match the reviewed surface tile.");
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0
    && !isAbsolute(value)
    && !/^[A-Za-z]:/.test(value)
    && !value.split(/[\\/]+/).includes("..");
}

function parseReceipt(
  raw: unknown,
  target: DefaultSurfaceCaptureTarget,
): SurfaceCaptureReceipt {
  if (
    !isObject(raw)
    || !hasExactKeys(raw, RECEIPT_KEYS)
    || raw.editor !== "TileEditor"
    || raw.editorVersion !== "1.0.1.869"
  ) {
    failReceipt();
  }
  if (
    !isSafeRelativePath(target.sourceTileRelativePath)
    || raw.sourceTileUuid !== target.uuid
    || raw.sourceTileRelativePath !== target.sourceTileRelativePath
  ) {
    failSource();
  }

  const expectedWidth = target.widthCells * 256;
  const expectedHeight = target.heightCells * 256;
  const camera = raw.camera;
  const image = raw.image;
  if (
    !isObject(camera)
    || !hasExactKeys(camera, CAMERA_KEYS)
    || camera.projection !== "orthographic"
    || camera.direction !== "north-up"
    || camera.viewDirection !== "vertical-down"
    || camera.pixelsPerCell !== 256
    || camera.width !== expectedWidth
    || camera.height !== expectedHeight
    || !isObject(image)
    || !hasExactKeys(image, IMAGE_KEYS)
    || image.file !== "scene.png"
    || image.fullScene !== true
  ) {
    failReceipt();
  }
  return raw as unknown as SurfaceCaptureReceipt;
}

async function readReceipt(
  target: DefaultSurfaceCaptureTarget,
  targetDirectory: string,
): Promise<SurfaceCaptureReceipt> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(targetDirectory, "capture-receipt.json"));
  } catch {
    throw new Error(`Capture '${target.uuid}' receipt is missing.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    failReceipt();
  }
  return parseReceipt(raw, target);
}

async function sampleRgb(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .toColourspace("srgb")
    .removeAlpha()
    .resize(32, 32, { fit: "fill" })
    .raw()
    .toBuffer();
}

function rmse(left: Buffer, right: Buffer): number {
  if (left.length !== right.length || left.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    sum += difference * difference;
  }
  return Math.sqrt(sum / left.length);
}

async function opaqueRatio(bytes: Buffer, metadata: Metadata): Promise<number> {
  if (!metadata.hasAlpha) return 1;
  const alpha = await sharp(bytes)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
  let opaque = 0;
  for (const value of alpha) {
    if (value === 255) opaque += 1;
  }
  return opaque / alpha.length;
}

export async function verifySurfaceCapture(
  target: DefaultSurfaceCaptureTarget,
  targetDirectory: string,
  officialPreviewPath: string,
): Promise<VerifiedSurfaceMaster> {
  const receipt = await readReceipt(target, targetDirectory);
  let previewBytes: Buffer;
  try {
    previewBytes = await readFile(officialPreviewPath);
  } catch {
    throw new Error(`Capture '${target.uuid}' official source preview is unavailable.`);
  }
  const previewHash = digest(previewBytes);
  if (previewHash !== target.sourcePreviewSha256) {
    throw new Error(`Capture '${target.uuid}' official source preview does not match the inventory.`);
  }

  const absolutePath = resolve(targetDirectory, receipt.image.file);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    throw new Error(`Capture '${target.uuid}' scene image is missing.`);
  }
  const sha256 = digest(bytes);
  if (sha256 === previewHash) {
    throw new Error(`Capture '${target.uuid}' is an official preview derivative.`);
  }

  let metadata: Metadata;
  let stats: Stats;
  try {
    const image = sharp(bytes, { failOn: "error" });
    [metadata, stats] = await Promise.all([
      image.clone().metadata(),
      image.clone().toColourspace("srgb").ensureAlpha().stats(),
    ]);
  } catch {
    throw new Error(`Capture '${target.uuid}' scene image is not a valid PNG.`);
  }
  if (metadata.format !== "png") {
    throw new Error(`Capture '${target.uuid}' scene image is not a valid PNG.`);
  }
  const expectedWidth = target.widthCells * 256;
  const expectedHeight = target.heightCells * 256;
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    throw new Error(`Capture '${target.uuid}' has the wrong pixel dimensions.`);
  }
  const alpha = metadata.hasAlpha ? stats.channels.at(-1) : undefined;
  if (alpha?.max === 0) {
    throw new Error(`Capture '${target.uuid}' is fully transparent.`);
  }
  if (
    stats.channels.slice(0, 3).every((channel) => channel.max <= 16)
    && await opaqueRatio(bytes, metadata) >= 0.99
  ) {
    throw new Error(`Capture '${target.uuid}' is implausibly dark.`);
  }

  let rectified: Buffer;
  try {
    rectified = await rectifyOfficialPreview(previewBytes, 256);
  } catch {
    throw new Error(`Capture '${target.uuid}' official source preview is invalid.`);
  }
  const derivative = await sharp(rectified)
    .resize(expectedWidth, expectedHeight, { fit: "fill" })
    .png()
    .toBuffer();
  const [masterSample, derivativeSample] = await Promise.all([
    sampleRgb(bytes),
    sampleRgb(derivative),
  ]);
  if (rmse(masterSample, derivativeSample) <= 3) {
    throw new Error(`Capture '${target.uuid}' is an official preview derivative.`);
  }

  return {
    target,
    receipt,
    absolutePath,
    sha256,
    width: expectedWidth,
    height: expectedHeight,
  };
}
