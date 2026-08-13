import { execFile } from "node:child_process";
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditRelease,
  formatReleaseAuditJson,
  formatReleaseAuditText,
  runReleaseAuditCli,
  type ReleaseAuditReport,
  type ReleaseBudget
} from "./release-audit";

const runFile = promisify(execFile);
const fixtureRoots: string[] = [];
const MiB = 1024 * 1024;

const productionBudget: ReleaseBudget = {
  maxTrackedBytes: 150 * MiB,
  maxOutputBytes: 200 * MiB,
  maxOutputFiles: 1000,
  maxSingleFileBytes: 25 * MiB,
  maxInitialAssetBytes: 25 * MiB,
  maxCompressedCodeBytes: 1 * MiB,
  initialPublicAssets: ["assets/reference.webp"]
};

async function createFixture(): Promise<{
  repositoryRoot: string;
  outputRoot: string;
}> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "release-audit-"));
  fixtureRoots.push(repositoryRoot);
  const outputRoot = join(repositoryRoot, "dist");
  await mkdir(outputRoot, { recursive: true });
  await runFile("git", ["init", "--quiet"], { cwd: repositoryRoot });
  return { repositoryRoot, outputRoot };
}

async function writeSized(path: string, bytes: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "w");
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

async function track(repositoryRoot: string, path: string, contents = "x") {
  const absolute = join(repositoryRoot, ...path.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
  await runFile("git", ["add", "--", path], { cwd: repositoryRoot });
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("release audit", () => {
  it("detects forbidden Git-tracked paths without counting untracked captures", async () => {
    const fixture = await createFixture();
    await track(fixture.repositoryRoot, "runtime-captures/frame.bin", "bad");
    await writeFile(join(fixture.repositoryRoot, "untracked-capture.bin"), "ignored");

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.trackedBytes).toBe(3);
    expect(result.violations).toContain(
      "Forbidden tracked path: runtime-captures/frame.bin"
    );
  });

  it("audits the deployed source tree when Git metadata is unavailable", async () => {
    const fixture = await createFixture();
    await track(fixture.repositoryRoot, "src/index.ts", "export {};");
    await track(
      fixture.repositoryRoot,
      "local-assets/private.db",
      "private"
    );
    await rm(join(fixture.repositoryRoot, ".git"), {
      recursive: true,
      force: true
    });

    const result = await auditRelease({
      ...fixture,
      budget: { ...productionBudget, initialPublicAssets: [] }
    });

    expect(result.trackedBytes).toBe(17);
    expect(result.violations).toContain(
      "Forbidden tracked path: local-assets/private.db"
    );
  });

  it("measures current working-tree bytes for Git-tracked paths", async () => {
    const fixture = await createFixture();
    const trackedPath = join(fixture.repositoryRoot, "src", "index.ts");
    await track(fixture.repositoryRoot, "src/index.ts", "small");
    await writeSized(trackedPath, 101);

    const result = await auditRelease({
      ...fixture,
      budget: {
        ...productionBudget,
        maxTrackedBytes: 100,
        initialPublicAssets: []
      }
    });

    expect(result.trackedBytes).toBe(101);
    expect(result.violations).toContain(
      "Tracked size exceeds 100 bytes: 101 bytes"
    );
  });

  it("fails closed when a tracked path is absent from the working tree", async () => {
    const fixture = await createFixture();
    await track(fixture.repositoryRoot, "src/index.ts", "index-only");
    await rm(join(fixture.repositoryRoot, "src", "index.ts"));

    await expect(auditRelease({ ...fixture, budget: productionBudget }))
      .rejects.toThrow("Cannot read tracked path: src/index.ts");
  });

  it("fails closed when a tracked path is not a regular file", async () => {
    const fixture = await createFixture();
    const trackedPath = join(fixture.repositoryRoot, "src", "index.ts");
    await track(fixture.repositoryRoot, "src/index.ts", "index-only");
    await rm(trackedPath);
    await mkdir(trackedPath);

    await expect(auditRelease({ ...fixture, budget: productionBudget }))
      .rejects.toThrow("Tracked path is not a regular file: src/index.ts");
  });

  it("detects an output file above the single-file budget", async () => {
    const fixture = await createFixture();
    await writeSized(join(fixture.outputRoot, "assets", "huge.webp"), 25 * MiB + 1);

    const result = await auditRelease({
      ...fixture,
      budget: { ...productionBudget, maxOutputBytes: 300 * MiB }
    });

    expect(result.violations).toContain(
      "Output file exceeds 26214400 bytes: assets/huge.webp (26214401 bytes)"
    );
  });

  it("detects aggregate output above 200 MiB", async () => {
    const fixture = await createFixture();
    for (let index = 0; index < 9; index += 1) {
      await writeSized(
        join(fixture.outputRoot, "chunks", `${index}.bin`),
        24 * MiB
      );
    }

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.outputBytes).toBe(216 * MiB);
    expect(result.violations).toContain(
      `Output size exceeds ${200 * MiB} bytes: ${216 * MiB} bytes`
    );
  });

  it("rejects a Git-tracked save DB in the public source tree", async () => {
    const fixture = await createFixture();
    await track(fixture.repositoryRoot, "public/data/default-save.db", "private");

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.violations).toContain(
      "Forbidden tracked path: public/data/default-save.db"
    );
  });

  it.each([
    "local-assets/default-save.db",
    "html/local-assets/nested/private.db",
    "html/local-assets/README.txt"
  ])("rejects a forced Git-tracked local asset: %s", async (path) => {
    const fixture = await createFixture();
    await track(fixture.repositoryRoot, path, "private");

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.violations).toContain(`Forbidden tracked path: ${path}`);
  });

  it.each([
    "data/default-save.db",
    "data/generated/default-surface-orthographic-inventory.json",
    "data/generated/tile-catalog.json",
    "atlas/official/official-tile-atlas.json",
    "legacy/img/tiles/10105.jpg"
  ])("rejects personal-map public asset from default output: %s", async (path) => {
    const fixture = await createFixture();
    await writeSized(join(fixture.outputRoot, ...path.split("/")), 1);

    const result = await auditRelease({
      ...fixture,
      budget: { ...productionBudget, initialPublicAssets: [] }
    });

    expect(result.violations).toContain(
      `Personal-map asset is forbidden in default output: ${path}`
    );
  });

  it("detects an output file count above its budget", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.outputRoot, "a.txt"), "a");
    await writeFile(join(fixture.outputRoot, "b.txt"), "b");

    const result = await auditRelease({
      ...fixture,
      budget: {
        ...productionBudget,
        maxOutputFiles: 1,
        initialPublicAssets: []
      }
    });

    expect(result.violations).toContain("Output file count exceeds 1: 2");
  });

  it("reports a configured initial public asset that is missing", async () => {
    const fixture = await createFixture();

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.violations).toContain(
      "Initial public asset is missing: assets/reference.webp"
    );
  });

  it("reports a configured initial public asset that is not Git-tracked", async () => {
    const fixture = await createFixture();
    await mkdir(join(fixture.repositoryRoot, "public", "assets"), {
      recursive: true
    });
    await writeFile(
      join(fixture.repositoryRoot, "public", "assets", "reference.webp"),
      "image"
    );
    await mkdir(join(fixture.outputRoot, "assets"), { recursive: true });
    await writeFile(join(fixture.outputRoot, "assets", "reference.webp"), "image");

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.violations).toContain(
      "Initial public asset is not Git-tracked: public/assets/reference.webp"
    );
  });

  it("rejects any untracked public file that Vite would copy to output", async () => {
    const fixture = await createFixture();
    await track(
      fixture.repositoryRoot,
      "public/assets/reference.webp",
      "image"
    );
    await mkdir(join(fixture.repositoryRoot, "public", "legacy"), {
      recursive: true
    });
    await writeFile(
      join(fixture.repositoryRoot, "public", "legacy", "orphan.png"),
      "untracked"
    );
    await mkdir(join(fixture.outputRoot, "assets"), { recursive: true });
    await writeFile(join(fixture.outputRoot, "assets", "reference.webp"), "image");

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.violations).toContain(
      "Public release file is not Git-tracked: public/legacy/orphan.png"
    );
  });

  it("detects initial public assets above 25 MiB", async () => {
    const fixture = await createFixture();
    await writeSized(
      join(fixture.outputRoot, "assets", "reference.webp"),
      25 * MiB + 1
    );

    const result = await auditRelease({
      ...fixture,
      budget: { ...productionBudget, maxSingleFileBytes: 30 * MiB }
    });

    expect(result.initialAssetBytes).toBe(25 * MiB + 1);
    expect(result.violations).toContain(
      `Initial public assets exceed ${25 * MiB} bytes: ${25 * MiB + 1} bytes`
    );
  });

  it("detects compressed JavaScript and CSS above 1 MiB", async () => {
    const fixture = await createFixture();
    const bytes = Buffer.allocUnsafe(2 * MiB);
    let state = 0x12345678;
    for (let index = 0; index < bytes.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[index] = state >>> 24;
    }
    await mkdir(join(fixture.outputRoot, "assets"), { recursive: true });
    await writeFile(join(fixture.outputRoot, "assets", "app.js"), bytes);

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result.violations.some((violation) =>
      violation.startsWith(
        `Compressed application code exceeds ${1 * MiB} bytes:`
      )
    )).toBe(true);
  });

  it("passes a fixture within every configured budget", async () => {
    const fixture = await createFixture();
    await track(fixture.repositoryRoot, "src/app.ts", "export {};");
    await track(
      fixture.repositoryRoot,
      "public/assets/reference.webp",
      "image"
    );
    await mkdir(join(fixture.outputRoot, "assets"), { recursive: true });
    await writeFile(join(fixture.outputRoot, "assets", "app.js"), "export{};");
    await writeFile(join(fixture.outputRoot, "assets", "reference.webp"), "image");

    const result = await auditRelease({ ...fixture, budget: productionBudget });

    expect(result).toMatchObject({
      trackedBytes: 15,
      outputBytes: 14,
      outputFiles: 2,
      initialAssetBytes: 5,
      violations: []
    });
  });

  it("rejects symbolic links and junctions in release output", async () => {
    const fixture = await createFixture();
    const target = join(fixture.repositoryRoot, "linked-output-target");
    await mkdir(target);
    await symlink(
      target,
      join(fixture.outputRoot, "linked"),
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(auditRelease({ ...fixture, budget: productionBudget }))
      .rejects.toThrow("Unsupported output entry: linked");
  });

  it("reports only the 20 largest output files", async () => {
    const fixture = await createFixture();
    for (let index = 0; index < 21; index += 1) {
      await writeFile(
        join(fixture.outputRoot, `${index.toString().padStart(2, "0")}.txt`),
        "x"
      );
    }

    const result = await auditRelease({
      ...fixture,
      budget: { ...productionBudget, initialPublicAssets: [] }
    });

    expect(result.largestFiles).toHaveLength(20);
    expect(result.largestFiles[0]?.path).toBe("00.txt");
    expect(result.largestFiles[19]?.path).toBe("19.txt");
  });

  it("returns a nonzero CLI status when the audit finds a violation", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.outputRoot, "one.txt"), "x");
    const output: string[] = [];

    const exitCode = await runReleaseAuditCli({
      ...fixture,
      budget: {
        ...productionBudget,
        maxOutputFiles: 0,
        initialPublicAssets: []
      },
      format: "text",
      write: (text) => output.push(text)
    });

    expect(exitCode).toBe(1);
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("Output file count exceeds 0: 1");
  });

  it("sorts equal-sized files canonically and formats stable JSON and text", () => {
    const report: ReleaseAuditReport = {
      result: {
        trackedBytes: 3,
        outputBytes: 20,
        outputFiles: 3,
        largestFiles: [
          { path: "assets/a.js", bytes: 9 },
          { path: "assets/b.js", bytes: 9 },
          { path: "index.html", bytes: 2 }
        ],
        initialAssetBytes: 4,
        violations: []
      },
      compressedCodeBytes: 7
    };

    expect(formatReleaseAuditJson(report)).toBe(
      '{\n  "trackedBytes": 3,\n  "outputBytes": 20,\n  "outputFiles": 3,\n  "initialAssetBytes": 4,\n  "compressedCodeBytes": 7,\n  "largestFiles": [\n    {\n      "path": "assets/a.js",\n      "bytes": 9\n    },\n    {\n      "path": "assets/b.js",\n      "bytes": 9\n    },\n    {\n      "path": "index.html",\n      "bytes": 2\n    }\n  ],\n  "violations": []\n}'
    );
    expect(formatReleaseAuditText(report)).toBe(
      "Release audit\n"
      + "Tracked bytes: 3\n"
      + "Output bytes: 20\n"
      + "Output files: 3\n"
      + "Initial asset bytes: 4\n"
      + "Compressed code bytes: 7\n"
      + "Largest output files:\n"
      + "- assets/a.js: 9 bytes\n"
      + "- assets/b.js: 9 bytes\n"
      + "- index.html: 2 bytes\n"
      + "Violations: none"
    );
  });
});
