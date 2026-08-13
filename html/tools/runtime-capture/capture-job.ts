import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RuntimeCaptureJob,
  RuntimeCapturePoint,
} from "./runtime-types.ts";

const OUTPUT_ERROR =
  "Runtime job output must be outside the repository and game roots.";
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function digest(value: string | Buffer): string {
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

async function isInsideGameRoot(output: string): Promise<boolean> {
  let ancestor = dirname(output);
  while (true) {
    try {
      await access(join(ancestor, "Release", "ScrapMechanic.exe"));
      return true;
    } catch {
      const parent = dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
  }
}

async function safeRuntimeJobOutput(output: string): Promise<string> {
  if (!output.toLowerCase().endsWith(".json")) throw new Error(OUTPUT_ERROR);
  try {
    const [repositoryRoot, canonicalOutput] = await Promise.all([
      realpath(REPOSITORY_ROOT),
      resolveThroughNearestExistingAncestor(output),
    ]);
    if (
      isWithin(repositoryRoot, canonicalOutput)
      || await isInsideGameRoot(canonicalOutput)
    ) {
      throw new Error(OUTPUT_ERROR);
    }
    return canonicalOutput;
  } catch (error) {
    if (error instanceof Error && error.message === OUTPUT_ERROR) throw error;
    throw new Error(OUTPUT_ERROR, { cause: error });
  }
}

export function buildRuntimeCaptureJob(sourceSaveSha256: string): RuntimeCaptureJob {
  if (!/^[a-f0-9]{64}$/.test(sourceSaveSha256)) {
    throw new Error(
      "Source save SHA-256 must be 64 lowercase hexadecimal characters.",
    );
  }

  const centerX = -39 * 64 + 32;
  const centerY = 19 * 64 + 32;
  const points: RuntimeCapturePoint[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      points.push({
        id: `r${row}-c${column}`,
        row,
        column,
        x: centerX - 700 + column * 350,
        y: centerY + 700 - row * 350,
        z: 250,
      });
    }
  }

  const unsigned = {
    schemaVersion: 1,
    gameVersion: "1.0.0",
    executableVersion: "1.0.1.869",
    sourceSaveSha256,
    centerCell: { x: -39, y: 19, cellSize: 64 },
    spacing: 350,
    camera: {
      direction: [0, 0, -1],
      northUp: true,
      fov: 90,
      window: { width: 1920, height: 1080 },
      crop: { left: 585, top: 165, width: 750, height: 750 },
    },
    validation: {
      stabilityThreshold: 0.015,
      retryLimit: 3,
      darkLuminance: 8,
      maxDarkRatio: 0.85,
    },
    stitch: {
      nominalStride: 525,
      nominalOverlap: 225,
      searchRadius: 48,
    },
    points,
  } as const;
  const canonicalUnsigned = canonicalize(unsigned) as typeof unsigned;
  return canonicalize({
    ...canonicalUnsigned,
    contentHash: digest(JSON.stringify(canonicalUnsigned)),
  }) as unknown as RuntimeCaptureJob;
}

export function serializeRuntimeCaptureJob(job: RuntimeCaptureJob): string {
  return `${JSON.stringify(canonicalize(job), null, 2)}\n`;
}

export async function writeRuntimeCaptureJob(
  savePath: string,
  outputPath: string,
): Promise<RuntimeCaptureJob> {
  const output = await safeRuntimeJobOutput(outputPath);
  let source: Buffer;
  try {
    source = await readFile(savePath);
  } catch {
    throw new Error("Source save is unavailable.");
  }
  const job = buildRuntimeCaptureJob(digest(source));
  await mkdir(dirname(output), { recursive: true });
  const temporary = join(
    dirname(output),
    `.${basename(output)}.${process.pid}.tmp`,
  );
  try {
    await writeFile(temporary, serializeRuntimeCaptureJob(job), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, output);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return job;
}
