import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export interface ReleaseBudget {
  maxTrackedBytes: number;
  maxOutputBytes: number;
  maxOutputFiles: number;
  maxSingleFileBytes: number;
  maxInitialAssetBytes: number;
  maxCompressedCodeBytes: number;
  initialPublicAssets: readonly string[];
}

export interface ReleaseAuditResult {
  trackedBytes: number;
  outputBytes: number;
  outputFiles: number;
  largestFiles: readonly { path: string; bytes: number }[];
  initialAssetBytes: number;
  violations: readonly string[];
}

export interface ReleaseAuditReport {
  result: ReleaseAuditResult;
  compressedCodeBytes: number;
}

interface OutputFile {
  absolutePath: string;
  path: string;
  bytes: number;
}

const runFile = promisify(execFile);
const forbiddenTrackedSegments = [
  "runtime-captures/",
  "tileeditor-working-copy",
  "offline-render-work/",
  "runtime-user-data/",
  "/dist/",
  "/node_modules/"
] as const;

function canonicalPath(path: string): string {
  return path.split(sep).join("/");
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isForbiddenTrackedPath(path: string): boolean {
  const lowerPath = canonicalPath(path).toLowerCase();
  const paddedPath = `/${lowerPath}`;
  return lowerPath.endsWith(".pdn")
    || lowerPath.startsWith("local-assets/")
    || lowerPath.includes("/local-assets/")
    || lowerPath === "public/data/default-save.db"
    || lowerPath.endsWith("/public/data/default-save.db")
    || forbiddenTrackedSegments.some((segment) => paddedPath.includes(segment));
}

function isForbiddenDefaultOutputPath(path: string): boolean {
  const lowerPath = canonicalPath(path).toLowerCase();
  return lowerPath === "data/default-save.db"
    || lowerPath === "data/generated/default-surface-orthographic-inventory.json"
    || lowerPath === "data/generated/tile-catalog.json"
    || lowerPath.startsWith("atlas/official/")
    || lowerPath.startsWith("legacy/img/");
}

async function deployedSourcePaths(repositoryRoot: string): Promise<string[]> {
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const path = canonicalPath(relative(repositoryRoot, absolutePath));
      const segments = path.toLowerCase().split("/");
      if (segments.some((segment) =>
        segment === ".git"
        || segment === ".vercel"
        || segment === "dist"
        || segment === "dist-save-import"
        || segment === "node_modules"
        || segment === "test-results"
        || segment === "playwright-report"
      )) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        paths.push(path);
      } else {
        throw new Error(`Unsupported deployed source entry: ${path}`);
      }
    }
  }

  await visit(repositoryRoot);
  return paths.sort(comparePaths);
}

async function trackedPaths(repositoryRoot: string): Promise<string[]> {
  const gitMetadata = await lstat(resolve(repositoryRoot, ".git"))
    .catch(() => undefined);
  if (!gitMetadata) {
    return deployedSourcePaths(repositoryRoot);
  }
  const { stdout } = await runFile("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(canonicalPath)
    .sort(comparePaths);
}

async function workingTreeBytes(repositoryRoot: string, path: string): Promise<number> {
  const absolutePath = resolve(repositoryRoot, ...path.split("/"));
  const stats = await lstat(absolutePath).catch(() => {
    throw new Error(`Cannot read tracked path: ${path}`);
  });
  if (!stats.isFile()) {
    throw new Error(`Tracked path is not a regular file: ${path}`);
  }
  try {
    return (await readFile(absolutePath)).byteLength;
  } catch {
    throw new Error(`Cannot read tracked path: ${path}`);
  }
}

async function collectOutputFiles(outputRoot: string): Promise<OutputFile[]> {
  const files: OutputFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const stats = await lstat(absolutePath);
        files.push({
          absolutePath,
          path: canonicalPath(relative(outputRoot, absolutePath)),
          bytes: stats.size
        });
      } else {
        throw new Error(
          `Unsupported output entry: ${canonicalPath(relative(outputRoot, absolutePath))}`
        );
      }
    }
  }

  await visit(outputRoot);
  return files;
}

async function createAuditReport(input: {
  repositoryRoot: string;
  outputRoot: string;
  budget: ReleaseBudget;
}): Promise<ReleaseAuditReport> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const outputRoot = resolve(input.outputRoot);
  const tracked = await trackedPaths(repositoryRoot);
  const trackedSet = new Set(tracked);
  const violations: string[] = [];
  let trackedBytes = 0;

  for (const path of tracked) {
    trackedBytes += await workingTreeBytes(repositoryRoot, path);
    if (isForbiddenTrackedPath(path)) {
      violations.push(`Forbidden tracked path: ${path}`);
    }
  }

  if (trackedBytes > input.budget.maxTrackedBytes) {
    violations.push(
      `Tracked size exceeds ${input.budget.maxTrackedBytes} bytes: ${trackedBytes} bytes`
    );
  }

  const output = await collectOutputFiles(outputRoot);
  const outputBytes = output.reduce((total, file) => total + file.bytes, 0);
  const outputFiles = output.length;

  if (outputBytes > input.budget.maxOutputBytes) {
    violations.push(
      `Output size exceeds ${input.budget.maxOutputBytes} bytes: ${outputBytes} bytes`
    );
  }
  if (outputFiles > input.budget.maxOutputFiles) {
    violations.push(
      `Output file count exceeds ${input.budget.maxOutputFiles}: ${outputFiles}`
    );
  }
  for (const file of output) {
    if (isForbiddenDefaultOutputPath(file.path)) {
      violations.push(
        `Personal-map asset is forbidden in default output: ${file.path}`
      );
    }
    if (file.bytes > input.budget.maxSingleFileBytes) {
      violations.push(
        `Output file exceeds ${input.budget.maxSingleFileBytes} bytes: ${file.path} (${file.bytes} bytes)`
      );
    }
  }

  const publicRoot = resolve(dirname(outputRoot), "public");
  const publicRootStats = await lstat(publicRoot).catch(() => undefined);
  const publicFiles = publicRootStats
    ? await collectOutputFiles(publicRoot)
    : [];
  for (const file of publicFiles) {
    const publicSourcePath = canonicalPath(relative(
      repositoryRoot,
      file.absolutePath
    ));
    if (!trackedSet.has(publicSourcePath)) {
      violations.push(
        `Public release file is not Git-tracked: ${publicSourcePath}`
      );
    }
  }

  const outputByPath = new Map(output.map((file) => [file.path, file]));
  let initialAssetBytes = 0;
  for (const configuredPath of input.budget.initialPublicAssets) {
    const path = canonicalPath(configuredPath);
    const publicSourcePath = canonicalPath(relative(
      repositoryRoot,
      resolve(dirname(outputRoot), "public", ...path.split("/"))
    ));
    if (!trackedSet.has(publicSourcePath)) {
      violations.push(
        `Initial public asset is not Git-tracked: ${publicSourcePath}`
      );
    }
    const file = outputByPath.get(path);
    if (file) {
      initialAssetBytes += file.bytes;
    } else {
      violations.push(`Initial public asset is missing: ${path}`);
    }
  }
  if (initialAssetBytes > input.budget.maxInitialAssetBytes) {
    violations.push(
      `Initial public assets exceed ${input.budget.maxInitialAssetBytes} bytes: ${initialAssetBytes} bytes`
    );
  }

  let compressedCodeBytes = 0;
  for (const file of output) {
    if (/\.(?:css|js)$/i.test(file.path)) {
      compressedCodeBytes += gzipSync(await readFile(file.absolutePath)).byteLength;
    }
  }
  if (compressedCodeBytes > input.budget.maxCompressedCodeBytes) {
    violations.push(
      `Compressed application code exceeds ${input.budget.maxCompressedCodeBytes} bytes: ${compressedCodeBytes} bytes`
    );
  }

  const largestFiles = output
    .map(({ path, bytes }) => ({ path, bytes }))
    .sort((left, right) => right.bytes - left.bytes || comparePaths(left.path, right.path))
    .slice(0, 20);

  return {
    result: {
      trackedBytes,
      outputBytes,
      outputFiles,
      largestFiles,
      initialAssetBytes,
      violations
    },
    compressedCodeBytes
  };
}

export async function auditRelease(input: {
  repositoryRoot: string;
  outputRoot: string;
  budget: ReleaseBudget;
}): Promise<ReleaseAuditResult> {
  return (await createAuditReport(input)).result;
}

export function formatReleaseAuditJson(report: ReleaseAuditReport): string {
  const { result, compressedCodeBytes } = report;
  return JSON.stringify({
    trackedBytes: result.trackedBytes,
    outputBytes: result.outputBytes,
    outputFiles: result.outputFiles,
    initialAssetBytes: result.initialAssetBytes,
    compressedCodeBytes,
    largestFiles: result.largestFiles,
    violations: result.violations
  }, null, 2);
}

export function formatReleaseAuditText(report: ReleaseAuditReport): string {
  const { result, compressedCodeBytes } = report;
  const largestFiles = result.largestFiles.length > 0
    ? result.largestFiles.map((file) => `- ${file.path}: ${file.bytes} bytes`).join("\n")
    : "- none";
  const violations = result.violations.length > 0
    ? result.violations.map((violation) => `- ${violation}`).join("\n")
    : "none";
  return [
    "Release audit",
    `Tracked bytes: ${result.trackedBytes}`,
    `Output bytes: ${result.outputBytes}`,
    `Output files: ${result.outputFiles}`,
    `Initial asset bytes: ${result.initialAssetBytes}`,
    `Compressed code bytes: ${compressedCodeBytes}`,
    "Largest output files:",
    largestFiles,
    `Violations: ${violations}`
  ].join("\n");
}

export async function runReleaseAuditCli(input: {
  repositoryRoot: string;
  outputRoot: string;
  budget: ReleaseBudget;
  format: "json" | "text";
  write: (text: string) => void;
}): Promise<0 | 1> {
  const report = await createAuditReport(input);
  input.write(input.format === "json"
    ? formatReleaseAuditJson(report)
    : formatReleaseAuditText(report));
  return report.result.violations.length > 0 ? 1 : 0;
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

async function runCli(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const htmlRoot = resolve(dirname(scriptPath), "../..");
  const budget = JSON.parse(
    await readFile(resolve(htmlRoot, "release-budget.json"), "utf8")
  ) as ReleaseBudget;
  process.exitCode = await runReleaseAuditCli({
    repositoryRoot: resolve(htmlRoot, ".."),
    outputRoot: resolve(htmlRoot, "dist"),
    budget,
    format: process.argv.includes("--json") ? "json" : "text",
    write: (text) => console.log(text)
  });
}

const invokedScript = process.argv[1];
if (invokedScript && samePath(invokedScript, fileURLToPath(import.meta.url))) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
