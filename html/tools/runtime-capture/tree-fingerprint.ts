import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { TreeFingerprint } from "./runtime-types.ts";

interface FingerprintDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function digestFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const contents = chunk as Buffer;
    bytes += contents.byteLength;
    hash.update(contents);
  }
  return { bytes, sha256: hash.digest("hex") };
}

function toRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function comparisonKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function comparePaths(left: string, right: string): number {
  const leftKey = comparisonKey(left);
  const rightKey = comparisonKey(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

async function collectFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error("Tree contains an unsupported symbolic link or reparse point.");
    }
  }
  return files.sort((left, right) =>
    comparePaths(toRelativePath(root, left), toRelativePath(root, right))
  );
}

async function fingerprintTreeUnsafe(root: string): Promise<TreeFingerprint> {
  const paths = await collectFiles(root, root);
  const files: Array<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }> = new Array(paths.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const path = paths[index];
      const identity = await digestFile(path);
      files[index] = {
        relativePath: toRelativePath(root, path),
        ...identity,
      };
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, paths.length) }, () => worker()),
  );
  return {
    schemaVersion: 1,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: digest(JSON.stringify(files)),
    files,
  };
}

export async function fingerprintTree(root: string): Promise<TreeFingerprint> {
  try {
    return await fingerprintTreeUnsafe(root);
  } catch (error) {
    if (
      error instanceof Error
      && error.message === "Tree contains an unsupported symbolic link or reparse point."
    ) throw error;
    throw new Error("Tree could not be fingerprinted.");
  }
}

export function diffFingerprints(
  before: TreeFingerprint,
  after: TreeFingerprint,
): FingerprintDiff {
  type FileRecord = TreeFingerprint["files"][number];
  function groups(files: TreeFingerprint["files"]): Map<string, FileRecord[]> {
    const result = new Map<string, FileRecord[]>();
    for (const file of files) {
      const key = comparisonKey(file.relativePath);
      result.set(key, [...result.get(key) ?? [], file]);
    }
    return result;
  }
  const beforeGroups = groups(before.files);
  const afterGroups = groups(after.files);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const key of new Set([...beforeGroups.keys(), ...afterGroups.keys()])) {
    const beforeFiles = [...beforeGroups.get(key) ?? []];
    const afterFiles = [...afterGroups.get(key) ?? []];
    const pairs: Array<[FileRecord, FileRecord]> = [];
    for (let index = afterFiles.length - 1; index >= 0; index -= 1) {
      const beforeIndex = beforeFiles.findIndex((file) =>
        file.relativePath === afterFiles[index].relativePath
      );
      if (beforeIndex < 0) continue;
      pairs.push([beforeFiles.splice(beforeIndex, 1)[0], afterFiles.splice(index, 1)[0]]);
    }
    beforeFiles.sort((left, right) => comparePaths(left.relativePath, right.relativePath));
    afterFiles.sort((left, right) => comparePaths(left.relativePath, right.relativePath));
    while (beforeFiles.length > 0 && afterFiles.length > 0) {
      pairs.push([beforeFiles.shift()!, afterFiles.shift()!]);
    }
    removed.push(...beforeFiles.map((file) => file.relativePath));
    added.push(...afterFiles.map((file) => file.relativePath));
    changed.push(...pairs
      .filter(([left, right]) => left.bytes !== right.bytes || left.sha256 !== right.sha256)
      .map(([, right]) => right.relativePath));
  }
  added.sort(comparePaths);
  removed.sort(comparePaths);
  changed.sort(comparePaths);

  return { added, removed, changed };
}
