import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { WorldMap } from "../../src/domain/map-model.ts";
import type { TileDefinition } from "../game-data/extract-catalog.ts";
import {
  finishRuntimeProbe,
  startRuntimeProbe,
} from "../runtime-capture/runtime-probe.ts";
import {
  buildRuntimeCaptureJob,
  writeRuntimeCaptureJob,
} from "../runtime-capture/capture-job.ts";
import { acceptRuntimeFrame } from "../runtime-capture/frame-validation.ts";
import { stitchRuntimeGrid } from "../runtime-capture/stitch-runtime-grid.ts";
import { applyRuntimePatch } from "../runtime-capture/runtime-patch.ts";
import type {
  FinishRuntimeProbeOptions,
  RuntimePatchOptions,
  RuntimeCaptureJob,
  RuntimeCaptureManifest,
  RuntimeProbeOptions,
} from "../runtime-capture/runtime-types.ts";
import type {
  DefaultSurfaceCaptureTarget,
  VerifiedSurfaceMaster,
} from "./default-surface-types.ts";
import {
  buildDefaultSurfaceCaptureInventory,
  selectCapabilityTarget,
} from "./default-surface-job.ts";
import { buildGrowLabCaptureJob } from "./grow-lab-job.ts";
import { verifyOfficialCapture } from "./verify-capture.ts";
import { verifySurfaceCapture } from "./verify-surface-capture.ts";

const execFileAsync = promisify(execFile);
const SURFACE_OUTPUT_ERROR =
  "Output must be a relative JSON path below public/data/generated.";

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

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readOptions(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1] !== undefined) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

export function parseRuntimeProbeStartOptions(
  args: readonly string[],
): RuntimeProbeOptions {
  const gameRoot = readOption(args, "--game-root");
  const userDataRoot = readOption(args, "--user-data-root");
  const protectedRoots = readOptions(args, "--protected-root");
  const sessionPath = readOption(args, "--session");
  if (!gameRoot) throw new Error("Missing required option: --game-root <path>");
  if (!userDataRoot) {
    throw new Error("Missing required option: --user-data-root <path>");
  }
  if (protectedRoots.length === 0) {
    throw new Error("Missing required option: --protected-root <path>");
  }
  if (!sessionPath) throw new Error("Missing required option: --session <path>");
  return { gameRoot, userDataRoot, protectedRoots, sessionPath };
}

function parseRuntimeProbeFinishOptions(
  args: readonly string[],
): FinishRuntimeProbeOptions {
  const sessionPath = readOption(args, "--session");
  const receiptPath = readOption(args, "--receipt");
  if (!sessionPath) throw new Error("Missing required option: --session <path>");
  if (!receiptPath) throw new Error("Missing required option: --receipt <path>");
  return { sessionPath, receiptPath };
}

export function parseRuntimePatchOptions(args: readonly string[]): RuntimePatchOptions {
  const gameRoot = readOption(args, "--game-root");
  const isolationReceiptPath = readOption(args, "--isolation-receipt");
  const backupRoot = readOption(args, "--backup-root");
  const receiptPath = readOption(args, "--receipt");
  if (!gameRoot) throw new Error("Missing required option: --game-root <path>");
  if (!isolationReceiptPath) {
    throw new Error("Missing required option: --isolation-receipt <path>");
  }
  if (!backupRoot) throw new Error("Missing required option: --backup-root <path>");
  if (!receiptPath) throw new Error("Missing required option: --receipt <path>");
  return { gameRoot, isolationReceiptPath, backupRoot, receiptPath };
}

export interface RuntimeFrameAcceptCliOptions {
  jobPath: string;
  pointId: string;
  firstFrame: string;
  secondFrame: string;
  evidencePath: string;
  outputRoot: string;
}

export interface RuntimeStitchCliOptions {
  jobPath: string;
  manifestPath: string;
  outputRoot: string;
}

export function parseRuntimeStitchOptions(args: readonly string[]): RuntimeStitchCliOptions {
  const jobPath = readOption(args, "--job");
  const manifestPath = readOption(args, "--manifest");
  const outputRoot = readOption(args, "--output-root");
  if (!jobPath) throw new Error("Missing required option: --job <path>");
  if (!manifestPath) throw new Error("Missing required option: --manifest <path>");
  if (!outputRoot) throw new Error("Missing required option: --output-root <path>");
  return { jobPath, manifestPath, outputRoot };
}

export function parseRuntimeFrameAcceptOptions(
  args: readonly string[],
): RuntimeFrameAcceptCliOptions {
  const jobPath = readOption(args, "--job");
  const pointId = readOption(args, "--point");
  const firstFrame = readOption(args, "--first");
  const secondFrame = readOption(args, "--second");
  const evidencePath = readOption(args, "--evidence");
  const outputRoot = readOption(args, "--output-root");
  if (!jobPath) throw new Error("Missing required option: --job <path>");
  if (!pointId) throw new Error("Missing required option: --point <id>");
  if (!firstFrame) throw new Error("Missing required option: --first <path>");
  if (!secondFrame) throw new Error("Missing required option: --second <path>");
  if (!evidencePath) throw new Error("Missing required option: --evidence <path>");
  if (!outputRoot) throw new Error("Missing required option: --output-root <path>");
  return { jobPath, pointId, firstFrame, secondFrame, evidencePath, outputRoot };
}

function parseRuntimeFrameAttempt(
  pointId: string,
  firstFrame: string,
  secondFrame: string,
  evidencePath: string,
): number {
  const escapedPoint = pointId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = basename(firstFrame).match(new RegExp(`^${escapedPoint}-a(\\d+)\\.png$`));
  const second = basename(secondFrame).match(new RegExp(`^${escapedPoint}-b(\\d+)\\.png$`));
  const evidence = basename(evidencePath).match(
    new RegExp(`^${escapedPoint}-a(\\d+)\\.json$`),
  );
  if (!first || !second || !evidence || first[1] !== second[1] || first[1] !== evidence[1]) {
    throw new Error("Runtime frame filenames must identify the same point and attempt.");
  }
  const attempt = Number(first[1]);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 3) {
    throw new Error("Runtime frame attempt must be 1, 2, or 3.");
  }
  return attempt;
}

function parseCanonicalRuntimeCaptureJob(text: string): RuntimeCaptureJob {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Runtime capture job is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime capture job is invalid.");
  }
  const sourceSaveSha256 = (value as Record<string, unknown>).sourceSaveSha256;
  if (typeof sourceSaveSha256 !== "string") {
    throw new Error("Runtime capture job is invalid.");
  }
  let expected: RuntimeCaptureJob;
  try {
    expected = buildRuntimeCaptureJob(sourceSaveSha256);
  } catch {
    throw new Error("Runtime capture job is invalid.");
  }
  if (JSON.stringify(canonicalize(value)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error("Runtime capture job is invalid.");
  }
  return expected;
}

async function acceptRuntimeFrameFromCli(args: readonly string[]): Promise<void> {
  const options = parseRuntimeFrameAcceptOptions(args);
  const [root, jobPath, approvedRuntimeRoot] = await Promise.all([
    realpath(resolve(options.outputRoot)),
    resolveThroughNearestExistingAncestor(options.jobPath),
    process.platform === "win32"
      ? realpath(resolve("F:\\Scrap Mechanical"))
      : Promise.resolve(resolve("/")),
  ]).catch((error) => {
    throw new Error("Runtime frame paths are unavailable.", { cause: error });
  });
  const repositoryRoot = await realpath(resolve("."));
  if (process.platform === "win32" && (
    !isWithin(approvedRuntimeRoot, root)
    || comparablePath(approvedRuntimeRoot) === comparablePath(root)
  )) {
    throw new Error("Runtime frame output root must be below F:\\Scrap Mechanical.");
  }
  if (!isWithin(root, jobPath) || isWithin(repositoryRoot, root)) {
    throw new Error("Runtime frame paths must remain inside an external capture root.");
  }
  const job = parseCanonicalRuntimeCaptureJob(await readFile(jobPath, "utf8"));
  const point = job.points.find((candidate) => candidate.id === options.pointId);
  if (!point) throw new Error("Runtime capture point is not present in the job.");
  const attempt = parseRuntimeFrameAttempt(
    point.id,
    options.firstFrame,
    options.secondFrame,
    options.evidencePath,
  );
  const manifest = await acceptRuntimeFrame(job, point, {
    captureRoot: root,
    firstFrame: options.firstFrame,
    secondFrame: options.secondFrame,
    evidencePath: options.evidencePath,
    attempt,
  });
  const accepted = manifest.frames.find((frame) => frame.pointId === point.id);
  console.log(JSON.stringify(accepted));
}

async function stitchRuntimeGridFromCli(args: readonly string[]): Promise<void> {
  const options = parseRuntimeStitchOptions(args);
  const root = await realpath(resolve(options.outputRoot)).catch((error) => {
    throw new Error("Runtime stitch paths are unavailable.", { cause: error });
  });
  const [jobPath, manifestPath, repositoryRoot, approvedRuntimeRoot] = await Promise.all([
    realpath(resolve(options.jobPath)),
    realpath(resolve(options.manifestPath)),
    realpath(resolve(".")),
    process.platform === "win32"
      ? realpath(resolve("F:\\Scrap Mechanical"))
      : Promise.resolve(resolve("/")),
  ]).catch((error) => {
    throw new Error("Runtime stitch paths are unavailable.", { cause: error });
  });
  if (process.platform === "win32" && (
    !isWithin(approvedRuntimeRoot, root)
    || comparablePath(approvedRuntimeRoot) === comparablePath(root)
  )) {
    throw new Error("Runtime stitch output root must be below F:\\Scrap Mechanical.");
  }
  if (
    isWithin(repositoryRoot, root)
    || !isWithin(root, jobPath)
    || !isWithin(root, manifestPath)
    || comparablePath(jobPath) !== comparablePath(resolve(options.jobPath))
    || comparablePath(manifestPath) !== comparablePath(resolve(options.manifestPath))
  ) {
    throw new Error("Runtime stitch paths must remain inside an external capture root.");
  }
  const job = parseCanonicalRuntimeCaptureJob(await readFile(jobPath, "utf8"));
  let manifest: RuntimeCaptureManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RuntimeCaptureManifest;
  } catch {
    throw new Error("Runtime capture manifest is invalid.");
  }
  console.log(JSON.stringify(await stitchRuntimeGrid(job, manifest, root), null, 2));
}

async function writeRuntimeJob(args: readonly string[]): Promise<void> {
  const savePath = readOption(args, "--save");
  const outputPath = readOption(args, "--output");
  if (!savePath) throw new Error("Missing required option: --save <path>");
  if (!outputPath) throw new Error("Missing required option: --output <path>");
  const job = await writeRuntimeCaptureJob(savePath, outputPath);
  console.log(JSON.stringify({
    points: job.points.length,
    rows: 5,
    columns: 5,
    crop: job.camera.crop,
    contentHash: job.contentHash,
  }));
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

async function resolveSurfaceOutput(
  output: string,
  gameRoot: string,
): Promise<{ filePath: string; publicPath: string }> {
  const parts = output.split(/[\\/]+/);
  if (
    isAbsolute(output)
    || /^[A-Za-z]:/.test(output)
    || parts.includes("..")
    || !output.toLowerCase().endsWith(".json")
  ) {
    throw new Error(SURFACE_OUTPUT_ERROR);
  }
  const projectRoot = resolve(".");
  const generatedRoot = resolve(projectRoot, "public", "data", "generated");
  const filePath = resolve(projectRoot, output);
  if (!isWithin(generatedRoot, filePath) || filePath === generatedRoot) {
    throw new Error(SURFACE_OUTPUT_ERROR);
  }
  try {
    const [canonicalProject, canonicalGenerated, canonicalOutput, canonicalGameRoot] =
      await Promise.all([
        realpath(projectRoot),
        realpath(generatedRoot),
        resolveThroughNearestExistingAncestor(filePath),
        resolveThroughNearestExistingAncestor(resolve(gameRoot)),
      ]);
    if (
      !isWithin(canonicalProject, canonicalGenerated)
      || !isWithin(canonicalGenerated, canonicalOutput)
      || isWithin(canonicalGameRoot, canonicalOutput)
    ) {
      throw new Error(SURFACE_OUTPUT_ERROR);
    }
  } catch (error) {
    if (error instanceof Error && error.message === SURFACE_OUTPUT_ERROR) throw error;
    throw new Error(SURFACE_OUTPUT_ERROR, { cause: error });
  }
  return {
    filePath,
    publicPath: relative(projectRoot, filePath).split(sep).join("/"),
  };
}

async function readEditorVersion(editorPath: string): Promise<string> {
  try {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-Item -LiteralPath $env:SM_AUTHENTIC_EDITOR).VersionInfo.FileVersion",
      ],
      {
        windowsHide: true,
        env: { ...process.env, SM_AUTHENTIC_EDITOR: editorPath },
      },
    );
    const version = result.stdout.trim();
    if (!version) {
      throw new Error("TileEditor version metadata is unavailable.");
    }
    return version;
  } catch {
    throw new Error("The reviewed Scrap Mechanic TileEditor executable is unavailable.");
  }
}

async function loadCaptureJob() {
  const [worldText, catalogText] = await Promise.all([
    readFile("public/data/generated/worlds/growlab_01.json", "utf8"),
    readFile("public/data/generated/tile-catalog.json", "utf8"),
  ]);
  const world = JSON.parse(worldText) as { world: WorldMap };
  const catalog = JSON.parse(catalogText) as { tiles: TileDefinition[] };
  return buildGrowLabCaptureJob(world.world, catalog.tiles);
}

async function writeSurfaceInventory(args: readonly string[]): Promise<void> {
  const gameRoot = readOption(args, "--game-root");
  const savePath = readOption(args, "--save");
  const output = readOption(args, "--output");
  if (!gameRoot) throw new Error("Missing required option: --game-root <path>");
  if (!savePath) throw new Error("Missing required option: --save <path>");
  if (!output) throw new Error("Missing required option: --output <path>");
  const resolvedOutput = await resolveSurfaceOutput(output, gameRoot);

  const { inventory } = await buildDefaultSurfaceCaptureInventory({
    savePath,
    buildInfoPath: "public/data/generated/build-info.json",
    catalogPath: "public/data/generated/tile-catalog.json",
    officialManifestPath: "public/atlas/official/official-tile-atlas.json",
    gameRoot,
  });
  const largest = selectCapabilityTarget(inventory);
  await mkdir(dirname(resolvedOutput.filePath), { recursive: true });
  await writeFile(
    resolvedOutput.filePath,
    `${JSON.stringify(canonicalize(inventory), null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    targets: inventory.targets.length,
    totalCanonicalCells: inventory.targets.reduce(
      (sum, target) => sum + target.widthCells * target.heightCells,
      0,
    ),
    largestTargetDimensions: `${largest.widthCells}x${largest.heightCells}`,
    output: resolvedOutput.publicPath,
  }));
}

function isSurfaceTarget(value: unknown): value is DefaultSurfaceCaptureTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  const output = target.outputPixels;
  return (
    typeof target.uuid === "string"
    && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(target.uuid)
    && typeof target.sourceTileRelativePath === "string"
    && target.sourceTileRelativePath.startsWith("Survival/")
    && !target.sourceTileRelativePath.includes("\\")
    && !target.sourceTileRelativePath.split("/").includes("..")
    && Number.isSafeInteger(target.widthCells)
    && (target.widthCells as number) > 0
    && Number.isSafeInteger(target.heightCells)
    && (target.heightCells as number) > 0
    && typeof output === "object"
    && output !== null
    && !Array.isArray(output)
    && (output as Record<string, unknown>).width === (target.widthCells as number) * 256
    && (output as Record<string, unknown>).height === (target.heightCells as number) * 256
    && Number.isSafeInteger(target.occurrences)
    && (target.occurrences as number) > 0
    && Array.isArray(target.usedRotations)
    && target.usedRotations.every((rotation) =>
      Number.isSafeInteger(rotation) && (rotation as number) >= 0 && (rotation as number) <= 3
    )
    && typeof target.sourcePreviewSha256 === "string"
    && /^[a-f0-9]{64}$/.test(target.sourcePreviewSha256)
  );
}

async function readSurfaceInventory(
  path: string,
): Promise<{ targets: readonly DefaultSurfaceCaptureTarget[] }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error("Surface capture inventory is unavailable.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Surface capture inventory is invalid.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Surface capture inventory is invalid.");
  }
  const inventory = raw as Record<string, unknown>;
  if (
    inventory.schemaVersion !== 1
    || inventory.gameVersion !== "1.0.0"
    || inventory.pixelsPerCell !== 256
    || !Array.isArray(inventory.targets)
    || !inventory.targets.every(isSurfaceTarget)
    || new Set(inventory.targets.map(({ uuid }) => uuid)).size !== inventory.targets.length
  ) {
    throw new Error("Surface capture inventory is invalid.");
  }
  return { targets: inventory.targets as DefaultSurfaceCaptureTarget[] };
}

function surfacePreviewPath(
  gameRoot: string,
  target: DefaultSurfaceCaptureTarget,
): string {
  const root = resolve(gameRoot);
  const preview = resolve(
    root,
    dirname(target.sourceTileRelativePath),
    `${target.uuid}.png`,
  );
  if (!isWithin(root, preview)) {
    throw new Error("Surface capture inventory is invalid.");
  }
  return preview;
}

async function verifySurfaceCaptures(args: readonly string[]): Promise<void> {
  const gameRoot = readOption(args, "--game-root");
  const inventoryPath = readOption(args, "--inventory");
  const captureDirectory = readOption(args, "--capture-directory");
  if (!gameRoot) throw new Error("Missing required option: --game-root <path>");
  if (!inventoryPath) throw new Error("Missing required option: --inventory <path>");
  if (!captureDirectory) {
    throw new Error("Missing required option: --capture-directory <path>");
  }

  const editorVersion = await readEditorVersion(
    join(gameRoot, "Release", "TileEditor.exe"),
  );
  if (editorVersion !== "1.0.1.869") {
    throw new Error("The Scrap Mechanic TileEditor version is not the reviewed 1.0 build.");
  }

  const inventory = await readSurfaceInventory(inventoryPath);
  const verified: VerifiedSurfaceMaster[] = [];
  const failures: Array<{ uuid: string; reason: string }> = [];
  for (const target of [...inventory.targets].sort((left, right) =>
    left.uuid.localeCompare(right.uuid)
  )) {
    try {
      verified.push(await verifySurfaceCapture(
        target,
        join(captureDirectory, target.uuid),
        surfacePreviewPath(gameRoot, target),
      ));
    } catch (error) {
      failures.push({
        uuid: target.uuid,
        reason: error instanceof Error
          ? error.message
          : "Capture verification failed.",
      });
    }
  }

  const byHash = new Map<string, VerifiedSurfaceMaster[]>();
  for (const master of verified) {
    const matches = byHash.get(master.sha256) ?? [];
    matches.push(master);
    byHash.set(master.sha256, matches);
  }
  for (const matches of byHash.values()) {
    if (new Set(matches.map(({ target }) => target.uuid)).size <= 1) continue;
    for (const master of matches) {
      failures.push({
        uuid: master.target.uuid,
        reason: "Identical master hash is assigned to different UUIDs.",
      });
    }
  }
  if (failures.length > 0) {
    throw new Error(failures
      .sort((left, right) => left.uuid.localeCompare(right.uuid))
      .map(({ uuid, reason }) => `${uuid}: ${reason}`)
      .join("\n"));
  }

  console.log(JSON.stringify({
    targets: verified.length,
    masters: verified
      .sort((left, right) => left.target.uuid.localeCompare(right.target.uuid))
      .map((master) => ({
        uuid: master.target.uuid,
        sha256: master.sha256,
        width: master.width,
        height: master.height,
      })),
  }, null, 2));
}

export async function runAuthenticMapCli(
  args = process.argv.slice(2),
): Promise<void> {
  const command = args[0];
  if (command === "runtime-probe-start") {
    console.log(JSON.stringify(
      await startRuntimeProbe(parseRuntimeProbeStartOptions(args)),
      null,
      2,
    ));
    return;
  }
  if (command === "runtime-probe-finish") {
    console.log(JSON.stringify(
      await finishRuntimeProbe(parseRuntimeProbeFinishOptions(args)),
      null,
      2,
    ));
    return;
  }
  if (command === "runtime-job") {
    await writeRuntimeJob(args);
    return;
  }
  if (command === "runtime-patch") {
    console.log(JSON.stringify(
      await applyRuntimePatch(parseRuntimePatchOptions(args)),
      null,
      2,
    ));
    return;
  }
  if (command === "runtime-frame-accept") {
    await acceptRuntimeFrameFromCli(args);
    return;
  }
  if (command === "runtime-stitch") {
    await stitchRuntimeGridFromCli(args);
    return;
  }
  if (command === "surface-inventory") {
    await writeSurfaceInventory(args);
    return;
  }
  if (command === "surface-verify") {
    await verifySurfaceCaptures(args);
    return;
  }
  if (command !== "verify-capture") {
    throw new Error("Unsupported authentic-map command.");
  }

  const gameRoot = readOption(args, "--game-root");
  const captureDirectory = readOption(args, "--capture-directory");
  if (!gameRoot) throw new Error("Missing required option: --game-root <path>");
  if (!captureDirectory) {
    throw new Error("Missing required option: --capture-directory <path>");
  }

  const editorVersion = await readEditorVersion(
    join(gameRoot, "Release", "TileEditor.exe"),
  );
  if (editorVersion !== "1.0.1.869") {
    throw new Error("The Scrap Mechanic TileEditor version is not the reviewed 1.0 build.");
  }

  const capture = await verifyOfficialCapture(
    await loadCaptureJob(),
    captureDirectory,
  );
  console.log(JSON.stringify({
    editor: capture.receipt.editor,
    editorVersion: capture.receipt.editorVersion,
    layers: [...capture.files].map(([id, file]) => ({
      id,
      sha256: file.sha256,
      width: file.width,
      height: file.height,
    })),
  }, null, 2));
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runAuthenticMapCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
