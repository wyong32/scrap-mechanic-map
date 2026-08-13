import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import sharp from "sharp";
import type {
  AcceptedRuntimeFrame,
  RuntimeCaptureJob,
  RuntimeCaptureManifest,
  RuntimeCapturePoint,
  RuntimeFrameEvidence,
} from "./runtime-types.ts";

const REVIEWED_EXECUTABLE_SHA256 =
  "fcb71ab85fb0e70033c370fec373e65293ac97c51544b49eedca83355096d7c3";
const PATH_ERROR = "Runtime frame path must remain inside the declared capture root.";

export interface RuntimeFrameValidationInputs {
  captureRoot: string;
  firstFrame: string;
  secondFrame: string;
  evidencePath: string;
  outputFile: string;
  attempt: number;
}

export interface RuntimeFrameAcceptInputs
  extends Omit<RuntimeFrameValidationInputs, "outputFile"> {}

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(comparablePath(root), comparablePath(candidate));
  return difference === "" || (
    difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
  );
}

async function resolveThroughNearestExistingAncestor(path: string): Promise<string> {
  const unresolved: string[] = [];
  let candidate = resolve(path);
  while (true) {
    try {
      return resolve(await realpath(candidate), ...unresolved);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
      const parent = dirname(candidate);
      if (code !== "ENOENT" || parent === candidate) throw error;
      unresolved.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

async function safeCapturePaths(
  captureRoot: string,
  paths: readonly string[],
): Promise<{ root: string; paths: readonly string[] }> {
  try {
    const root = await realpath(resolve(captureRoot));
    const canonicalPaths = await Promise.all(
      paths.map((path) => resolveThroughNearestExistingAncestor(path)),
    );
    if (canonicalPaths.some((path) => !isWithin(root, path) || path === root)) {
      throw new Error(PATH_ERROR);
    }
    return { root, paths: canonicalPaths };
  } catch (error) {
    if (error instanceof Error && error.message === PATH_ERROR) throw error;
    throw new Error(PATH_ERROR, { cause: error });
  }
}

function isEvidence(value: unknown): value is RuntimeFrameEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  return evidence.schemaVersion === 1
    && typeof evidence.pointId === "string"
    && /^r\d+-c\d+$/.test(evidence.pointId)
    && Number.isSafeInteger(evidence.pid)
    && (evidence.pid as number) > 0
    && typeof evidence.executableSha256 === "string"
    && /^[a-f0-9]{64}$/.test(evidence.executableSha256)
    && typeof evidence.firstFrame === "string"
    && isAbsolute(evidence.firstFrame)
    && typeof evidence.secondFrame === "string"
    && isAbsolute(evidence.secondFrame)
    && typeof evidence.cameraLog === "string"
    && isAbsolute(evidence.cameraLog)
    && typeof evidence.cameraLogSha256 === "string"
    && /^[a-f0-9]{64}$/.test(evidence.cameraLogSha256)
    && evidence.cursorOutsideCrop === true
    && evidence.hudReviewedHidden === true
    && typeof evidence.capturedAt === "string"
    && Number.isFinite(Date.parse(evidence.capturedAt));
}

function exactCameraToken(point: RuntimeCapturePoint, job: RuntimeCaptureJob): string {
  return `SM_OVERVIEW_CAPTURE_READY x=${point.x.toFixed(3)} y=${point.y.toFixed(3)} z=${point.z.toFixed(3)} fov=${job.camera.fov} direction=${job.camera.direction.join(",")} gui=hidden`;
}

async function loadAndValidateEvidence(
  job: RuntimeCaptureJob,
  point: RuntimeCapturePoint,
  evidencePath: string,
  firstFrame: string,
  secondFrame: string,
  captureRoot: string,
): Promise<RuntimeFrameEvidence> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch {
    throw new Error("Runtime frame evidence is invalid.");
  }
  if (!isEvidence(value) || value.pointId !== point.id) {
    throw new Error("Runtime frame evidence is invalid.");
  }
  if (value.executableSha256 !== REVIEWED_EXECUTABLE_SHA256) {
    throw new Error("Runtime frame executable is not the reviewed official runtime.");
  }

  const safe = await safeCapturePaths(captureRoot, [
    firstFrame,
    secondFrame,
    evidencePath,
    value.firstFrame,
    value.secondFrame,
    value.cameraLog,
  ]);
  if (
    comparablePath(safe.paths[0]) !== comparablePath(safe.paths[3])
    || comparablePath(safe.paths[1]) !== comparablePath(safe.paths[4])
  ) {
    throw new Error("Runtime frame evidence does not name the supplied frame pair.");
  }

  const log = await readFile(safe.paths[5], "utf8");
  if (digest(log) !== value.cameraLogSha256) {
    throw new Error("Runtime frame camera-log hash does not match its evidence.");
  }
  const token = exactCameraToken(point, job);
  const lineMatches = log.split(/\r?\n/).some((line) =>
    line.includes(`[Main:${value.pid}]`)
    && line.endsWith(token)
  );
  if (!lineMatches) {
    const hasToken = log.split(/\r?\n/).some((line) => line.endsWith(token));
    throw new Error(hasToken
      ? "Runtime frame camera-log PID does not match the evidence PID."
      : "Runtime frame camera proof is missing or does not match the capture point.");
  }
  return value;
}

async function readCrop(
  path: string,
  job: RuntimeCaptureJob,
): Promise<Buffer> {
  const image = sharp(path, { failOn: "error" });
  const metadata = await image.metadata();
  if (
    metadata.format !== "png"
    || metadata.width !== job.camera.window.width
    || metadata.height !== job.camera.window.height
  ) {
    throw new Error("Runtime source frames must be PNG images at exactly 1920x1080.");
  }
  const { data, info } = await image
    .extract(job.camera.crop)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== job.camera.crop.width
    || info.height !== job.camera.crop.height
    || info.channels !== 3
  ) {
    throw new Error("Runtime gameplay crop is not canonical RGB.");
  }
  return data;
}

function normalizedMeanAbsoluteDifference(first: Buffer, second: Buffer): number {
  if (first.length !== second.length) {
    throw new Error("Runtime gameplay crops have incompatible RGB data.");
  }
  let sum = 0;
  for (let index = 0; index < first.length; index += 1) {
    sum += Math.abs(first[index] - second[index]);
  }
  return sum / (first.length * 255);
}

function darkRatio(rgb: Buffer, luminanceLimit: number): number {
  let darkPixels = 0;
  for (let index = 0; index < rgb.length; index += 3) {
    const luminance = 0.2126 * rgb[index]
      + 0.7152 * rgb[index + 1]
      + 0.0722 * rgb[index + 2];
    if (luminance <= luminanceLimit) darkPixels += 1;
  }
  return darkPixels / (rgb.length / 3);
}

function acceptedRelativePath(point: RuntimeCapturePoint): string {
  return `accepted/${point.id}.png`;
}

async function writeDeterministicCrop(
  rgb: Buffer,
  job: RuntimeCaptureJob,
  outputFile: string,
): Promise<string> {
  await mkdir(dirname(outputFile), { recursive: true });
  const temporary = join(
    dirname(outputFile),
    `.${basename(outputFile)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await sharp(rgb, {
      raw: {
        width: job.camera.crop.width,
        height: job.camera.crop.height,
        channels: 3,
      },
    }).png({
      compressionLevel: 9,
      adaptiveFiltering: false,
      palette: false,
      force: true,
    }).toFile(temporary);
    await rename(temporary, outputFile);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return digest(await readFile(outputFile));
}

function validateAttempt(attempt: number): asserts attempt is 1 | 2 | 3 {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 3) {
    throw new Error("Runtime frame attempt must be 1, 2, or 3.");
  }
}

function requireExactJobPoint(
  job: RuntimeCaptureJob,
  point: RuntimeCapturePoint,
): void {
  const expected = job.points.find((candidate) => candidate.id === point.id);
  if (
    !expected
    || expected.row !== point.row
    || expected.column !== point.column
    || expected.x !== point.x
    || expected.y !== point.y
    || expected.z !== point.z
  ) {
    throw new Error("Runtime capture point does not match the canonical job.");
  }
}

export async function validateRuntimeFramePair(
  job: RuntimeCaptureJob,
  point: RuntimeCapturePoint,
  inputs: RuntimeFrameValidationInputs,
): Promise<AcceptedRuntimeFrame> {
  requireExactJobPoint(job, point);
  validateAttempt(inputs.attempt);
  const safe = await safeCapturePaths(inputs.captureRoot, [
    inputs.firstFrame,
    inputs.secondFrame,
    inputs.evidencePath,
    inputs.outputFile,
  ]);
  await loadAndValidateEvidence(
    job,
    point,
    safe.paths[2],
    safe.paths[0],
    safe.paths[1],
    safe.root,
  );
  const [first, second] = await Promise.all([
    readCrop(safe.paths[0], job),
    readCrop(safe.paths[1], job),
  ]);
  const difference = normalizedMeanAbsoluteDifference(first, second);
  if (difference > job.validation.stabilityThreshold) {
    throw new Error("Runtime frame pair is unstable.");
  }
  const firstDarkRatio = darkRatio(first, job.validation.darkLuminance);
  const secondDarkRatio = darkRatio(second, job.validation.darkLuminance);
  if (
    firstDarkRatio > job.validation.maxDarkRatio
    || secondDarkRatio > job.validation.maxDarkRatio
  ) {
    throw new Error("Runtime gameplay crop is too dark.");
  }
  const sha256 = await writeDeterministicCrop(second, job, safe.paths[3]);
  return {
    pointId: point.id,
    file: acceptedRelativePath(point),
    sha256,
    width: 750,
    height: 750,
    normalizedMeanAbsoluteDifference: difference,
    darkRatio: secondDarkRatio,
    attempt: inputs.attempt,
  };
}

function isAcceptedFrame(value: unknown): value is AcceptedRuntimeFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  return typeof frame.pointId === "string"
    && /^r\d+-c\d+$/.test(frame.pointId)
    && typeof frame.file === "string"
    && frame.file === `accepted/${frame.pointId}.png`
    && typeof frame.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(frame.sha256)
    && frame.width === 750
    && frame.height === 750
    && typeof frame.normalizedMeanAbsoluteDifference === "number"
    && Number.isFinite(frame.normalizedMeanAbsoluteDifference)
    && typeof frame.darkRatio === "number"
    && Number.isFinite(frame.darkRatio)
    && (frame.attempt === 1 || frame.attempt === 2 || frame.attempt === 3);
}

async function readManifest(
  path: string,
  job: RuntimeCaptureJob,
  captureRoot: string,
): Promise<RuntimeCaptureManifest> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (code === "ENOENT") {
      return { schemaVersion: 1, jobContentHash: job.contentHash, frames: [] };
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Runtime capture manifest is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime capture manifest is invalid.");
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1
    || manifest.jobContentHash !== job.contentHash
    || !Array.isArray(manifest.frames)
    || !manifest.frames.every(isAcceptedFrame)
    || new Set(manifest.frames.map((frame) => frame.pointId)).size !== manifest.frames.length
  ) {
    throw new Error("Runtime capture manifest is invalid.");
  }
  const typed = manifest as unknown as RuntimeCaptureManifest;
  const jobPointIds = new Set(job.points.map((point) => point.id));
  if (typed.frames.some((frame) => !jobPointIds.has(frame.pointId))) {
    throw new Error("Runtime capture manifest is invalid.");
  }
  for (const frame of typed.frames) {
    const expectedPath = join(captureRoot, ...frame.file.split("/"));
    let canonicalPath: string;
    try {
      canonicalPath = (await safeCapturePaths(captureRoot, [expectedPath])).paths[0];
      const bytes = await readFile(canonicalPath);
      const metadata = await sharp(bytes, { failOn: "error" }).metadata();
      if (
        digest(bytes) !== frame.sha256
        || metadata.format !== "png"
        || metadata.width !== 750
        || metadata.height !== 750
      ) {
        throw new Error("Runtime capture manifest is invalid.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Runtime capture manifest is invalid.") {
        throw error;
      }
      throw new Error("Runtime capture manifest is invalid.", { cause: error });
    }
  }
  return typed;
}

async function writeManifestAtomically(
  path: string,
  manifest: RuntimeCaptureManifest,
): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export interface RuntimeFrameAcceptanceDependencies {
  writeManifest?: (
    path: string,
    manifest: RuntimeCaptureManifest,
  ) => Promise<void>;
}

export async function acceptRuntimeFrame(
  job: RuntimeCaptureJob,
  point: RuntimeCapturePoint,
  inputs: RuntimeFrameAcceptInputs,
  dependencies: RuntimeFrameAcceptanceDependencies = {},
): Promise<RuntimeCaptureManifest> {
  requireExactJobPoint(job, point);
  validateAttempt(inputs.attempt);
  const root = await realpath(resolve(inputs.captureRoot)).catch((error) => {
    throw new Error(PATH_ERROR, { cause: error });
  });
  const manifestPath = join(root, "capture-manifest.json");
  const lockPath = join(root, ".capture-manifest.lock");
  await writeFile(lockPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx" })
    .catch((error) => {
      throw new Error("Runtime capture manifest is locked.", { cause: error });
    });
  const staging = join(root, `.runtime-frame-${point.id}-${process.pid}-${Date.now()}.png`);
  try {
    await safeCapturePaths(root, [manifestPath, lockPath, staging]);
    const manifest = await readManifest(manifestPath, job, root);
    const accepted = await validateRuntimeFramePair(job, point, {
      ...inputs,
      captureRoot: root,
      outputFile: staging,
    });
    const previous = manifest.frames.find((frame) => frame.pointId === point.id);
    if (previous && previous.sha256 !== accepted.sha256) {
      throw new Error("Runtime capture point is already accepted with a different image.");
    }
    const finalPath = join(root, ...accepted.file.split("/"));
    await safeCapturePaths(root, [finalPath]);
    let placedNewFinal = false;
    if (!previous) {
      await mkdir(dirname(finalPath), { recursive: true });
      await rename(staging, finalPath);
      placedNewFinal = true;
    }
    const order = new Map(job.points.map((entry, index) => [entry.id, index]));
    const frames = [
      ...manifest.frames.filter((frame) => frame.pointId !== point.id),
      accepted,
    ].sort((left, right) =>
      (order.get(left.pointId) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.pointId) ?? Number.MAX_SAFE_INTEGER)
    );
    const next: RuntimeCaptureManifest = {
      schemaVersion: 1,
      jobContentHash: job.contentHash,
      frames,
    };
    try {
      await (dependencies.writeManifest ?? writeManifestAtomically)(manifestPath, next);
    } catch (error) {
      if (placedNewFinal) await unlink(finalPath).catch(() => undefined);
      throw error;
    }
    return next;
  } finally {
    await Promise.all([
      unlink(staging).catch(() => undefined),
      unlink(lockPath).catch(() => undefined),
    ]);
  }
}
