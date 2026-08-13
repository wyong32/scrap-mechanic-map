import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { TreeFingerprint } from "./runtime-types.ts";
import { diffFingerprints, fingerprintTree } from "./tree-fingerprint.ts";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("fingerprintTree", () => {
  it("hashes nested files in stable relative-path order with exact byte totals", async () => {
    // Break caught: traversal order, content hashing, or aggregate accounting changes.
    const root = await makeRoot("sm-tree-fingerprint-");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "value.txt"), "def");
    await writeFile(join(root, "a.txt"), "abc");

    const fingerprint = await fingerprintTree(root);

    expect(fingerprint).toMatchObject({
      schemaVersion: 1,
      fileCount: 2,
      totalBytes: 6,
      sha256: "dd317585c03ec9dec88874ec2b759ae0b2722f02345e8c3c98dd4db8359afb41",
    });
    expect(fingerprint.files).toEqual([
      {
        relativePath: "a.txt",
        bytes: 3,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      },
      {
        relativePath: "nested/value.txt",
        bytes: 3,
        sha256: "cb8379ac2098aa165029e3938a51da0bcecfc008fd6795f401178647f96c5b34",
      },
    ]);
  });

  it("does not include modification times in aggregate identity", async () => {
    // Break caught: metadata-only changes alter the protected-root fingerprint.
    const root = await makeRoot("sm-tree-mtime-");
    const file = join(root, "value.txt");
    await writeFile(file, "abc");
    const before = await fingerprintTree(root);

    await utimes(file, new Date("2020-01-01T00:00:00.000Z"), new Date());

    expect(await fingerprintTree(root)).toEqual(before);
  });

  it("fails closed on a nested directory reparse point", async () => {
    // Break caught: files reachable only through a junction are silently omitted.
    const root = await makeRoot("sm-tree-junction-root-");
    const target = await makeRoot("sm-tree-junction-target-");
    await writeFile(join(target, "private.txt"), "secret");
    await symlink(target, join(root, "junction"), "junction");

    await expect(fingerprintTree(root)).rejects.toThrow(
      "Tree contains an unsupported symbolic link or reparse point.",
    );
  });

  it("does not leak an absolute root when filesystem traversal fails", async () => {
    // Break caught: raw readdir failures expose a private absolute root.
    const root = await makeRoot("sm-tree-missing-root-");
    await rm(root, { recursive: true, force: true });

    let failure: unknown;
    try {
      await fingerprintTree(root);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Tree could not be fingerprinted.");
    expect((failure as Error).message).not.toContain(root);
  });
});

describe("diffFingerprints", () => {
  it("reports sorted added, removed, and content-changed relative paths", async () => {
    // Break caught: a protected-root mutation is omitted or reported non-canonically.
    const root = await makeRoot("sm-tree-diff-");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "gone.txt"), "old");
    await writeFile(join(root, "nested", "value.txt"), "abc");
    const before = await fingerprintTree(root);

    await rm(join(root, "gone.txt"));
    await writeFile(join(root, "nested", "value.txt"), "xyz");
    await writeFile(join(root, "added.txt"), "new");
    const after = await fingerprintTree(root);

    expect(diffFingerprints(before, after)).toEqual({
      added: ["added.txt"],
      removed: ["gone.txt"],
      changed: ["nested/value.txt"],
    });
  });

  it("normalizes case-only path differences for Windows comparison", () => {
    // Break caught: Windows case spelling is misreported as remove-plus-add.
    const before: TreeFingerprint = {
      schemaVersion: 1,
      fileCount: 1,
      totalBytes: 3,
      sha256: "a".repeat(64),
      files: [{
        relativePath: "Nested/Value.txt",
        bytes: 3,
        sha256: "b".repeat(64),
      }],
    };
    const after: TreeFingerprint = {
      ...before,
      files: [{
        relativePath: "nested/value.TXT",
        bytes: 3,
        sha256: "b".repeat(64),
      }],
    };

    expect(diffFingerprints(before, after)).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it("preserves and compares two real Windows files whose names differ only by case", async () => {
    // Break caught: normalized map keys collapse a real case-sensitive directory fixture.
    const root = await makeRoot("sm-tree-case-sensitive-");
    await execFileAsync(
      "fsutil.exe",
      ["file", "setCaseSensitiveInfo", root, "enable"],
      { windowsHide: true },
    );
    await writeFile(join(root, "Value.txt"), "upper");
    await writeFile(join(root, "value.txt"), "lower");
    const before = await fingerprintTree(root);
    expect(before.files.map((file) => file.relativePath)).toEqual([
      "Value.txt",
      "value.txt",
    ]);

    await writeFile(join(root, "value.txt"), "after");
    const difference = diffFingerprints(before, await fingerprintTree(root));

    expect(difference).toEqual({
      added: [],
      removed: [],
      changed: ["value.txt"],
    });
  });
});
