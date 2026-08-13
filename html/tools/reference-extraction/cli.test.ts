import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CANDIDATE_THRESHOLDS,
  DEFAULT_REFERENCE_QUALITY_THRESHOLDS,
  parseReferenceExtractionArgs,
  renderTargetPreview,
  resolveReferenceExtractionCurrentRun,
  runReferenceExtractionCli as runReferenceExtractionCliProduction,
  type ReferenceExtractionCliDependencies,
  type ReferenceExtractionPipeline,
  type ReferenceExtractionRun,
} from "./cli.ts";
import { CALIBRATED_REFERENCE_INPUT_HASHES } from "./reference-inputs.ts";
import type { ReferenceExtractionInputs } from "./reference-extraction-types.ts";
import type { CandidateDecision } from "./candidate-selector.ts";
import type { ExtractionCandidate } from "./candidate-extractor.ts";
import type { ReconstructionResult } from "./reconstruct-reference.ts";
import type { ReferenceQualityReport } from "./quality-report.ts";

const cleanupRoots: string[] = [];

async function runReferenceExtractionCli(
  args: string[],
  dependencies: ReferenceExtractionCliDependencies,
): Promise<void> {
  return runReferenceExtractionCliProduction(args, { expectedSharedUuids: 1, ...dependencies });
}

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function fixture(): Promise<{ projectRoot: string; localRoot: string; target: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "reference-cli-"));
  cleanupRoots.push(projectRoot);
  const localRoot = join(projectRoot, "local-assets", "reference-extraction");
  await mkdir(localRoot, { recursive: true });
  await writeFile(join(projectRoot, "local-assets", "default-save.db"), "fixture-default-save");
  return { projectRoot, localRoot, target: join(projectRoot, "target.db") };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function markerColor(marker: string): [number, number, number, number] {
  const bytes = createHash("sha256").update(marker).digest();
  return [bytes[0]!, bytes[1]!, bytes[2]!, 255];
}

async function fixtureImage(marker: string, format: "webp" | "png"): Promise<Buffer> {
  const image = sharp({ create: { width: 2, height: 2, channels: 4, background: markerColor(marker) } });
  return format === "webp" ? image.webp({ lossless: true }).toBuffer() : image.png().toBuffer();
}

async function imageColor(path: string): Promise<number[]> {
  const bytes = await sharp(path).ensureAlpha().raw().toBuffer();
  return [...bytes.subarray(0, 4)];
}

async function completedRun(
  options: ReferenceExtractionRun,
  marker: string,
  status: "passed" | "failed" = "passed",
): Promise<void> {
  const candidateLocalFilename = "fixture/r0-ox+0-oy+0-span1x1-x-64-y-48-x-right-y-up.png";
  await mkdir(join(options.stagingDirectory, "candidates", "fixture"), { recursive: true });
  const candidateBytes = await fixtureImage(`candidate-${marker}`, "png");
  await writeFile(
    join(options.stagingDirectory, "candidates", ...candidateLocalFilename.split("/")),
    candidateBytes,
  );
  const artifacts = {
    reconstruction: {
      path: "default-reconstruction.webp",
      bytes: await fixtureImage(`reconstruction-${marker}`, "webp"),
    },
    difference: {
      path: "default-difference.png",
      bytes: await fixtureImage(`difference-${marker}`, "png"),
    },
    targetPreview: {
      path: "target-preview.png",
      bytes: await fixtureImage(`preview-${marker}`, "png"),
    },
  };
  for (const artifact of Object.values(artifacts)) {
    await writeFile(join(options.stagingDirectory, artifact.path), artifact.bytes);
  }
  const shared = ["fixture", ...Array.from(
    { length: options.expectedSharedUuids - 1 }, (_value, index) => `uuid-${index}`,
  )]
    .sort((left, right) => left.localeCompare(right));
  const extraCells = shared.filter((uuid) => uuid !== "fixture").map((uuid, index) => ({
    x: -63 + index % 127,
    y: -48 + Math.floor(index / 127),
    uuid,
    rotation: 0,
    xOffset: 0,
    yOffset: 0,
    flags: 0,
    terrainType: "fixture",
  }));
  const fixtureCoverageCell = {
    x: -64, y: -48, uuid: "fixture", rotation: 0, groupId: "fixture/r0/ox0/oy0",
  };
  const allCoverageCells = [fixtureCoverageCell, ...extraCells.map((cell) => ({
    x: cell.x,
    y: cell.y,
    uuid: cell.uuid,
    rotation: cell.rotation,
    groupId: `${cell.uuid}/r0/ox0/oy0`,
  }))].sort((left, right) => left.y - right.y || left.x - right.x);
  const completeCoverage = Object.fromEntries(["fullReference", "playableReference", "targetEligible"].map((domain) => [
    domain,
    Object.fromEntries(["type", "rotation", "cell"].map((metric) => [
      metric,
      { covered: 1, total: metric === "cell" ? allCoverageCells.length : shared.length,
        ratio: metric === "cell" ? 1 / allCoverageCells.length : 1 / shared.length },
    ])),
  ]));
  const qualityReasons = [
    ...(status === "failed" ? ["mean-image-difference-exceeded"] : []),
    ...(shared.length > 1 ? [
      "full-reference-type-coverage-below-minimum",
      "full-reference-rotation-coverage-below-minimum",
      "full-reference-cell-coverage-below-minimum",
      "playable-reference-cell-coverage-below-minimum",
      "target-eligible-cell-coverage-below-minimum",
    ] : []),
  ];
  const referenceWorldText = JSON.stringify({
    id: "fixture-reference", source: "reference", gameVersion: "fixture",
    bounds: { minX: -64, minY: -48, maxX: 63, maxY: -45 },
    cells: [{ x: -64, y: -48, uuid: "fixture", rotation: 0, xOffset: 0, yOffset: 0,
      flags: 0, terrainType: "fixture" }, ...extraCells], locations: [], connections: [],
  });
  const targetWorldText = JSON.stringify({
    id: "fixture-target", source: "save", gameVersion: "fixture",
    bounds: { minX: -64, minY: -48, maxX: 63, maxY: -45 },
    cells: [{ x: -64, y: -48, uuid: "fixture", rotation: 0, xOffset: 0, yOffset: 0,
      flags: 0, terrainType: "fixture" }, ...extraCells], locations: [], connections: [],
  });
  const qualityReportText = `${JSON.stringify({
    status: qualityReasons.length === 0 ? "passed" : "failed",
    reasons: qualityReasons,
    sourceHashes: {
      sourceImageSha256: options.sourceHash,
      referenceWorldSha256: digest(referenceWorldText),
      targetWorldSha256: digest(targetWorldText),
      targetSaveSha256: "c".repeat(64),
    },
    thresholds: DEFAULT_REFERENCE_QUALITY_THRESHOLDS,
    imageDifference: status === "passed"
      ? { mean: 0, maximum: 0, samples: 1 }
      : { mean: 1, maximum: 1, samples: 1 },
    seam: { mean: 0, maximum: 0, samples: 1 },
    seamEvidence: {
      state: "measured",
      expectedSamples: 1,
      placedToPlaced: 1,
      placedToMissing: 0,
      missingToMissing: 0,
    },
    coverage: completeCoverage,
    coverageEvidence: {
      fullReference: allCoverageCells,
      playableReference: allCoverageCells,
      targetEligible: allCoverageCells,
    },
    groups: [{
      id: "fixture/r0/ox0/oy0",
      uuid: "fixture",
      rotation: 0,
      offset: { x: 0, y: 0 },
      footprint: { width: 1, height: 1 },
      selectorStatus: "accepted",
      selectorReasons: [],
      selected: {
        sha256: digestBytes(candidateBytes),
        localFilename: candidateLocalFilename,
        sourceWorld: { x: -64, y: -48 },
        sourceRotation: 0,
        synthesized: false,
      },
      rejectedCandidates: [],
      status: "accepted",
      reasons: [],
      placedReferenceCells: [{ x: -64, y: -48 }],
      imageDifference: { mean: 0, maximum: 0, samples: 1 },
      seam: { mean: 0, maximum: 0, samples: 1 },
      seamEvidence: { expectedSamples: 1 },
    }],
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [
      name,
      { path: artifact.path, sha256: digestBytes(artifact.bytes) },
    ])),
  }, null, 2)}\n`;
  await writeFile(join(options.stagingDirectory, "quality-report.json"), qualityReportText);
  await Promise.all([
    writeFile(join(options.stagingDirectory, "reference-world.json"), referenceWorldText),
    writeFile(join(options.stagingDirectory, "target-world.json"), targetWorldText),
  ]);
  const summary = {
    schemaVersion: 2,
    rootManifestSha256: "0".repeat(64),
    rootManifestBytes: 0,
    status: qualityReasons.length === 0 ? "passed" : "failed",
    reasons: qualityReasons,
    checkedInputHashes: CALIBRATED_REFERENCE_INPUT_HASHES,
    provenance: {
      sourceImage: {
        sha256: options.sourceHash,
        width: 256,
        height: 8,
        bounds: { minX: -64, minY: -48, maxX: 63, maxY: -45 },
      },
      referenceWorld: {
        fileSha256: CALIBRATED_REFERENCE_INPUT_HASHES.referenceWorldSha256,
        canonicalSha256: digest(referenceWorldText),
      },
      buildInfo: { sha256: CALIBRATED_REFERENCE_INPUT_HASHES.buildInfoSha256 },
      catalog: { sha256: CALIBRATED_REFERENCE_INPUT_HASHES.catalogSha256 },
      defaultSave: { sha256: CALIBRATED_REFERENCE_INPUT_HASHES.defaultSaveSha256 },
      targetSave: { sha256: "c".repeat(64) },
      targetWorld: { canonicalSha256: digest(targetWorldText) },
    },
    orientation: "x-right-y-up",
    inventory: {
      expectedShared: options.expectedSharedUuids,
      sharedCount: shared.length,
      shared,
      referenceOnlyCount: 0,
      referenceOnly: [],
      targetOnlyCount: 0,
      targetOnly: [],
    },
    candidates: 1,
    candidateGroups: 1,
    selectorAcceptedGroups: 1,
    selectorRejectedGroups: 0,
    qualityAcceptedGroups: 1,
    qualityRejectedGroups: 0,
    qualityAcceptedCells: 1,
    qualityRejectedCells: allCoverageCells.length - 1,
    thresholds: {
      candidate: DEFAULT_CANDIDATE_THRESHOLDS,
      quality: DEFAULT_REFERENCE_QUALITY_THRESHOLDS,
    },
    coverage: completeCoverage,
    artifacts: {
      candidates: {
        path: "candidates",
        files: 1,
        bytes: candidateBytes.byteLength,
        sha256: digest(JSON.stringify([{
          path: candidateLocalFilename,
          bytes: candidateBytes.byteLength,
          sha256: digestBytes(candidateBytes),
          width: 2,
          height: 2,
          provenance: {
            uuid: "fixture", rotation: 0, offset: { x: 0, y: 0 },
            footprint: { width: 1, height: 1 }, sourceWorld: { x: -64, y: -48 },
            orientation: "x-right-y-up",
          },
        }])),
        records: [{
          path: candidateLocalFilename,
          bytes: candidateBytes.byteLength,
          sha256: digestBytes(candidateBytes),
          width: 2,
          height: 2,
          provenance: {
            uuid: "fixture", rotation: 0, offset: { x: 0, y: 0 },
            footprint: { width: 1, height: 1 }, sourceWorld: { x: -64, y: -48 },
            orientation: "x-right-y-up",
          },
        }],
      },
      referenceWorld: {
        path: "reference-world.json", bytes: Buffer.byteLength(referenceWorldText), sha256: digest(referenceWorldText),
      },
      targetWorld: {
        path: "target-world.json", bytes: Buffer.byteLength(targetWorldText), sha256: digest(targetWorldText),
      },
      ...Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [
        name,
        { path: artifact.path, bytes: artifact.bytes.byteLength, sha256: digestBytes(artifact.bytes) },
      ])),
      qualityReport: {
        path: "quality-report.json",
        bytes: Buffer.byteLength(qualityReportText),
        sha256: digest(qualityReportText),
      },
    },
  };
  for (;;) {
    const bytes = Buffer.byteLength(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.rootManifestBytes === bytes) break;
    summary.rootManifestBytes = bytes;
  }
  summary.rootManifestSha256 = digest(`${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(options.stagingDirectory, "run-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

async function currentRunDirectory(finalDirectory: string): Promise<string> {
  const pointer = JSON.parse(await readFile(join(finalDirectory, "current.json"), "utf8")) as {
    runDirectory: string;
  };
  return join(finalDirectory, ...pointer.runDirectory.split("/"));
}

async function resealSummary(stagingDirectory: string): Promise<Record<string, any>> {
  const path = join(stagingDirectory, "run-summary.json");
  const summary = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
  summary.rootManifestSha256 = "0".repeat(64);
  for (;;) {
    const bytes = Buffer.byteLength(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.rootManifestBytes === bytes) break;
    summary.rootManifestBytes = bytes;
  }
  summary.rootManifestSha256 = digest(`${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

describe("parseReferenceExtractionArgs", () => {
  it("requires exactly one target save argument", () => {
    // Break caught: an implicit/default target could evaluate or overwrite the wrong save.
    expect(() => parseReferenceExtractionArgs([])).toThrow("--target <save.db>");
    expect(() => parseReferenceExtractionArgs(["--target"])).toThrow("--target <save.db>");
    expect(() => parseReferenceExtractionArgs(["--target", "first.db", "--target", "second.db"]))
      .toThrow("exactly once");
    expect(() => parseReferenceExtractionArgs(["--target", "save.db", "--publish"]))
      .toThrow("Unsupported");
    expect(parseReferenceExtractionArgs(["--target", "save.db"]))
      .toEqual({ targetSavePath: "save.db" });
    expect(parseReferenceExtractionArgs([
      "--target", "save.db", "--default-save", "source.db",
    ])).toEqual({ targetSavePath: "save.db", defaultSavePath: "source.db" });
    expect(() => parseReferenceExtractionArgs([
      "--target", "save.db", "--default-save", "first.db", "--default-save", "second.db",
    ])).toThrow("--default-save option must be supplied at most once");
  });
});

describe("reviewed thresholds", () => {
  it("keeps candidate and quality gates explicit at the CLI boundary", () => {
    // Break caught: a permissive implicit default silently weakens the real-data quality gate.
    expect(DEFAULT_CANDIDATE_THRESHOLDS).toEqual({
      normalizedWidth: 64,
      normalizedHeight: 64,
      interiorInset: 8,
      edgeStripWidth: 8,
      maximumInteriorDistance: 0.06,
      maximumEdgeDistance: 0.08,
      minimumClusterSize: 2,
      maximumGroupSize: 256,
    });
    expect(DEFAULT_REFERENCE_QUALITY_THRESHOLDS).toEqual({
      maximumMeanImageDifference: 0.18,
      maximumPixelImageDifference: 1,
      maximumMeanSeamError: 0.18,
      maximumSeamError: 1,
      maximumGroupMeanImageDifference: 0.12,
      maximumGroupPixelImageDifference: 0.8,
      maximumGroupMeanSeamError: 0.12,
      maximumGroupSeamError: 0.8,
      minimumFullReferenceTypeCoverage: 0.65,
      minimumFullReferenceRotationCoverage: 0.7,
      minimumFullReferenceCellCoverage: 0.8,
      minimumPlayableCellCoverage: 0.8,
      minimumTargetEligibleCellCoverage: 0.8,
    });
  });
});

describe("renderTargetPreview", () => {
  it("puts positive world Y at the top for the reviewed x-right-y-up orientation", async () => {
    // Break caught: the target preview is vertically mirrored relative to the calibrated source.
    const decision = (uuid: string, color: readonly [number, number, number]) => ({
      status: "accepted",
      selected: { uuid, rotation: 0, offset: { x: 0, y: 0 } },
      image: {
        width: 1,
        height: 1,
        channels: 3,
        rotation: 0,
        synthesized: false,
        pixels: Uint8Array.from(color),
      },
    }) as unknown as CandidateDecision;
    const inputs = {
      targetWorld: {
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 1 },
        cells: [
          { x: 0, y: 0, uuid: "south", rotation: 0, xOffset: 0, yOffset: 0 },
          { x: 0, y: 1, uuid: "north", rotation: 0, xOffset: 0, yOffset: 0 },
        ],
      },
    } as unknown as ReferenceExtractionInputs;

    const preview = await renderTargetPreview(inputs, [
      decision("south", [255, 0, 0]),
      decision("north", [0, 0, 255]),
    ]);
    const { data, info } = await sharp(preview).raw().toBuffer({ resolveWithObject: true });

    expect({ width: info.width, height: info.height, channels: info.channels })
      .toEqual({ width: 32, height: 64, channels: 4 });
    expect([...data.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...data.subarray(32 * 32 * 4, 32 * 32 * 4 + 4)]).toEqual([255, 0, 0, 255]);
  });
});

describe("runReferenceExtractionCli", () => {
  it("wires the ignored local default save into the production pipeline", async () => {
    const value = await fixture();
    const defaultSavePath = join(value.projectRoot, "local-assets", "default-save.db");
    await writeFile(defaultSavePath, "local-save");
    let observedPath = "";

    await expect(runReferenceExtractionCliProduction(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash: "0".repeat(64),
      expectedSharedUuids: 1,
      pipeline: {
        loadInputs: async (options: Parameters<ReferenceExtractionPipeline["loadInputs"]>[0]) => {
          observedPath = options.defaultSavePath;
          throw new Error("stop-after-default-save-path");
        },
      } as unknown as ReferenceExtractionPipeline,
    })).rejects.toThrow("stop-after-default-save-path");

    expect(observedPath).toBe(defaultSavePath);
  });

  it("prioritizes an explicit default-save CLI input", async () => {
    const value = await fixture();
    const explicitSavePath = join(value.projectRoot, "explicit-source.db");
    await writeFile(explicitSavePath, "explicit-save");
    let observedPath = "";

    await expect(runReferenceExtractionCliProduction([
      "--target", value.target, "--default-save", explicitSavePath,
    ], {
      projectRoot: value.projectRoot,
      sourceHash: "0".repeat(64),
      expectedSharedUuids: 1,
      pipeline: {
        loadInputs: async (options: Parameters<ReferenceExtractionPipeline["loadInputs"]>[0]) => {
          observedPath = options.defaultSavePath;
          throw new Error("stop-after-explicit-save-path");
        },
      } as unknown as ReferenceExtractionPipeline,
    })).rejects.toThrow("stop-after-explicit-save-path");

    expect(observedPath).toBe(explicitSavePath);
  });

  it("fails closed with recovery guidance when the local default save is absent", async () => {
    const value = await fixture();
    await rm(join(value.projectRoot, "local-assets", "default-save.db"));

    await expect(runReferenceExtractionCliProduction(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash: "0".repeat(64),
      expectedSharedUuids: 1,
      pipeline: {
        loadInputs: async () => {
          throw new Error("pipeline must not receive a missing default save");
        },
      } as unknown as ReferenceExtractionPipeline,
    })).rejects.toThrow(
      "Reference extraction default save is missing at local-assets/default-save.db; provide --default-save <save.db>.",
    );
  });

  it("creates only the fixed extraction directory when it is not present yet", async () => {
    // Break caught: a fresh checkout cannot run because the ignored output directory does not exist.
    const value = await fixture();
    await rm(value.localRoot, { recursive: true });

    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash: "0".repeat(64),
      execute: async (options) => completedRun(options, "fresh-root"),
    });

    const runDirectory = await currentRunDirectory(join(value.localRoot, "0".repeat(64)));
    expect(await imageColor(join(runDirectory, "target-preview.png")))
      .toEqual(markerColor("preview-fresh-root"));
  });

  it("rejects an output root outside the project's fixed local extraction directory", async () => {
    // Break caught: caller-controlled output paths can write into public/ or an unrelated tree.
    const value = await fixture();
    const publicRoot = join(value.projectRoot, "public", "reference-extraction");
    await mkdir(publicRoot, { recursive: true });

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      localOutputRoot: publicRoot,
      execute: async () => {
        throw new Error("must not execute");
      },
    })).rejects.toThrow("local-assets/reference-extraction");
    await expect(access(join(publicRoot, "output"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a pre-existing source-hash junction that escapes the trusted local root", async () => {
    // Break caught: lexical source-hash containment follows a junction into public or an unrelated tree.
    const value = await fixture();
    const sourceHash = "5".repeat(64);
    const outside = join(value.projectRoot, "public", "escaped-output");
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(value.localRoot, sourceHash), process.platform === "win32" ? "junction" : "dir");
    let executed = false;

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => { executed = true; await completedRun(options, "junction"); },
    })).rejects.toThrow("safe canonical directory");
    expect(executed).toBe(true);
    expect(await readdir(outside)).toEqual([]);
  });


  it("isolates outputs by source hash and replaces successful reruns deterministically", async () => {
    // Break caught: two immutable sources share output or reruns merge stale artifacts.
    const value = await fixture();
    const firstSource = "1".repeat(64);
    const secondSource = "2".repeat(64);
    let marker = "first";
    const execute = async (options: ReferenceExtractionRun) => completedRun(options, marker);

    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash: firstSource,
      execute,
    });
    const firstDirectory = join(value.localRoot, firstSource);
    const firstRunDirectory = await currentRunDirectory(firstDirectory);
    expect(await imageColor(join(firstRunDirectory, "target-preview.png"))).toEqual(markerColor("preview-first"));

    marker = "second";
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash: firstSource,
      execute,
    });
    const secondRunDirectory = await currentRunDirectory(firstDirectory);
    expect(await imageColor(join(secondRunDirectory, "target-preview.png"))).toEqual(markerColor("preview-second"));
    expect(await imageColor(join(firstRunDirectory, "target-preview.png"))).toEqual(markerColor("preview-first"));

    marker = "isolated";
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash: secondSource,
      execute,
    });
    expect(await imageColor(join(await currentRunDirectory(firstDirectory), "target-preview.png")))
      .toEqual(markerColor("preview-second"));
    expect(await imageColor(join(
      await currentRunDirectory(join(value.localRoot, secondSource)),
      "target-preview.png",
    ))).toEqual(markerColor("preview-isolated"));
    expect(await readdir(value.localRoot)).toEqual([firstSource, secondSource]);
  });

  it("reuses the same immutable content address for byte-identical reruns", async () => {
    // Break caught: random run names create duplicate mutable-looking directories for identical evidence.
    const value = await fixture();
    const sourceHash = "e".repeat(64);
    const execute = async (options: ReferenceExtractionRun) => completedRun(options, "identical");
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot, sourceHash, execute,
    });
    const finalDirectory = join(value.localRoot, sourceHash);
    const first = await currentRunDirectory(finalDirectory);
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot, sourceHash, execute,
    });
    expect(await currentRunDirectory(finalDirectory)).toBe(first);
    expect(await readdir(join(finalDirectory, "runs"))).toEqual([first.split(/[\\/]/).at(-1)]);
  });

  it("uses the Task 2 calibrated source hash when the caller does not override test dependencies", async () => {
    // Break caught: a copied/stale CLI constant separates output from the immutable source Task 2 verified.
    const value = await fixture();
    let observed: ReferenceExtractionRun | undefined;
    await expect(runReferenceExtractionCliProduction(["--target", value.target], {
      projectRoot: value.projectRoot,
      execute: async (options) => {
        observed = options;
        throw new Error("calibrated-default-observed");
      },
    })).rejects.toThrow("calibrated-default-observed");

    expect(observed?.sourceHash).toBe(CALIBRATED_REFERENCE_INPUT_HASHES.sourceImageSha256);
    expect(observed?.expectedSharedUuids).toBe(429);
    expect(observed?.finalDirectory).toBe(join(
      value.localRoot,
      CALIBRATED_REFERENCE_INPUT_HASHES.sourceImageSha256,
    ));
  });

  it("fails closed unless the real target intersects exactly 429 reference UUIDs", async () => {
    // Break caught: a different save can pass generic reconstruction thresholds and be mistaken for the reviewed target.
    const value = await fixture();
    const sourceHash = "9".repeat(64);
    await mkdir(join(value.projectRoot, "public", "data", "generated"), { recursive: true });
    await writeFile(value.target, "target-save");
    const inputs = {
      source: {
        sha256: sourceHash,
        width: 1,
        height: 1,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      },
      uuidIntersection: { shared: ["only-one"], referenceOnly: [], targetOnly: [] },
      referenceWorld: { bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, cells: [] },
      defaultWorld: { bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, cells: [] },
      targetWorld: { bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, cells: [] },
      targetSaveSha256: "d".repeat(64),
    } as unknown as ReferenceExtractionInputs;
    let extracted = false;

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      expectedSharedUuids: 2,
      pipeline: {
        loadInputs: async () => inputs,
        extractCandidates: async () => { extracted = true; return []; },
        selectCandidates: () => [],
        reconstruct: async () => { throw new Error("must not reconstruct"); },
        evaluate: () => { throw new Error("must not evaluate"); },
        renderTargetPreview: async () => Buffer.alloc(0),
      },
    })).rejects.toThrow("exactly 2 shared UUIDs");
    expect(extracted).toBe(false);
  });

  it("rejects a passed report that omits required diagnostics or its attested run summary", async () => {
    // Break caught: any hash-valid arbitrary file is mistaken for a complete promotable evaluation report.
    const value = await fixture();
    const sourceHash = "8".repeat(64);

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => {
        await writeFile(join(options.stagingDirectory, "artifact.txt"), "partial");
        await writeFile(join(options.stagingDirectory, "quality-report.json"), JSON.stringify({
          status: "passed",
          sourceHashes: { sourceImageSha256: sourceHash },
          artifacts: { extra: { path: "artifact.txt", sha256: digest("partial") } },
        }));
      },
    })).rejects.toThrow("complete report");
    await expect(access(join(value.localRoot, sourceHash))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an invalid expected shared UUID configuration before execution", async () => {
    // Break caught: a malformed configured inventory disables the identity gate.
    const value = await fixture();
    let executed = false;
    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      expectedSharedUuids: 0,
      execute: async () => { executed = true; },
    })).rejects.toThrow("positive integer");
    expect(executed).toBe(false);
  });

  it("rejects tampered required artifacts and a tampered run-summary self hash", async () => {
    // Break caught: edits after evaluation can be promoted despite a superficially complete report.
    for (const tamper of ["artifact", "summary"] as const) {
      const value = await fixture();
      const sourceHash = tamper === "artifact" ? "a".repeat(64) : "b".repeat(64);
      await expect(runReferenceExtractionCli(["--target", value.target], {
        projectRoot: value.projectRoot,
        sourceHash,
        execute: async (options) => {
          await completedRun(options, tamper);
          if (tamper === "artifact") {
            await writeFile(join(options.stagingDirectory, "default-difference.png"), "tampered");
          } else {
            const path = join(options.stagingDirectory, "run-summary.json");
            const summary = JSON.parse(await readFile(path, "utf8"));
            summary.inventory.targetOnly.push("late-edit");
            summary.inventory.targetOnlyCount = 1;
            await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
          }
        },
      })).rejects.toThrow(tamper === "artifact" ? "hash mismatch" : "root-manifest-hash");
      await expect(access(join(value.localRoot, sourceHash))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("recomputes the exact UUID inventory from the authenticated playable reference and target worlds", async () => {
    // Break caught: a resealed summary substitutes a false shared UUID and drives target coverage from that claim.
    const value = await fixture();
    const sourceHash = "2".repeat(63) + "2";
    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => {
        await completedRun(options, "substituted-inventory");
        const substitutedReason = "target-eligible-cell-coverage-below-minimum";
        const reportPath = join(options.stagingDirectory, "quality-report.json");
        const report = JSON.parse(await readFile(reportPath, "utf8"));
        report.coverageEvidence.targetEligible = [];
        report.coverage.targetEligible = Object.fromEntries(
          ["type", "rotation", "cell"].map((metric) => [
            metric,
            { covered: 0, total: 0, ratio: 0 },
          ]),
        );
        report.status = "failed";
        report.reasons = [substitutedReason];
        const reportText = `${JSON.stringify(report, null, 2)}\n`;
        await writeFile(reportPath, reportText);
        const summaryPath = join(options.stagingDirectory, "run-summary.json");
        const summary = JSON.parse(await readFile(summaryPath, "utf8"));
        summary.inventory.shared = ["invented-shared"];
        summary.inventory.sharedCount = 1;
        summary.inventory.referenceOnly = ["fixture"];
        summary.inventory.referenceOnlyCount = 1;
        summary.status = "failed";
        summary.reasons = [substitutedReason];
        summary.coverage = report.coverage;
        summary.artifacts.qualityReport.bytes = Buffer.byteLength(reportText);
        summary.artifacts.qualityReport.sha256 = digest(reportText);
        await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
        await resealSummary(options.stagingDirectory);
      },
    })).rejects.toThrow(/UUID inventory|shared UUID inventory|provenance evidence/);
    await expect(access(join(value.localRoot, sourceHash))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unmanifested root content before and after promotion", async () => {
    // Break caught: two different complete run trees resolve to the same content address.
    const value = await fixture();
    const sourceHash = "2".repeat(63) + "3";
    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => {
        await completedRun(options, "extra-root-before");
        await writeFile(join(options.stagingDirectory, "unmanifested.txt"), "unexpected");
      },
    })).rejects.toThrow(/manifest|unexpected|complete report/);

    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "extra-root-after"),
    });
    const finalDirectory = join(value.localRoot, sourceHash);
    const runDirectory = await currentRunDirectory(finalDirectory);
    await writeFile(join(runDirectory, "unmanifested.txt"), "unexpected");
    await expect(resolveReferenceExtractionCurrentRun(finalDirectory, sourceHash, 1))
      .rejects.toThrow(/manifest|unexpected|complete report/);
  });

  it("binds selected candidate provenance to the exact candidate manifest path and hash", async () => {
    // Break caught: selected provenance can name a missing or byte-different candidate and still promote.
    for (const mutation of ["missing-path", "wrong-hash", "wrong-provenance"] as const) {
      const value = await fixture();
      const suffix = { "missing-path": "4", "wrong-hash": "5", "wrong-provenance": "a" }[mutation];
      const sourceHash = "2".repeat(63) + suffix;
      await expect(runReferenceExtractionCli(["--target", value.target], {
        projectRoot: value.projectRoot,
        sourceHash,
        execute: async (options) => {
          await completedRun(options, `candidate-${mutation}`);
          const reportPath = join(options.stagingDirectory, "quality-report.json");
          const report = JSON.parse(await readFile(reportPath, "utf8"));
          if (mutation === "missing-path") {
            report.groups[0].selected.localFilename = "fixture/missing.png";
          } else if (mutation === "wrong-hash") {
            report.groups[0].selected.sha256 = "f".repeat(64);
          } else {
            report.groups[0].rotation = 1;
            report.groups[0].id = "fixture/r1/ox0/oy0";
            report.coverageEvidence.fullReference[0].groupId = report.groups[0].id;
            report.coverageEvidence.playableReference[0].groupId = report.groups[0].id;
            report.coverageEvidence.targetEligible[0].groupId = report.groups[0].id;
          }
          const reportText = `${JSON.stringify(report, null, 2)}\n`;
          await writeFile(reportPath, reportText);
          const summaryPath = join(options.stagingDirectory, "run-summary.json");
          const summary = JSON.parse(await readFile(summaryPath, "utf8"));
          summary.artifacts.qualityReport.bytes = Buffer.byteLength(reportText);
          summary.artifacts.qualityReport.sha256 = digest(reportText);
          await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
          await resealSummary(options.stagingDirectory);
        },
      })).rejects.toThrow(/candidate.*(manifest|provenance)|artifact attestation|unavailable or invalid/i);
    }
  });

  it("rejects missing, extra, and byte-substituted physical candidates", async () => {
    // Break caught: the root address authenticates a stale candidate index instead of the complete physical tree.
    for (const mutation of ["missing", "extra", "substituted"] as const) {
      const value = await fixture();
      const suffix = { missing: "7", extra: "8", substituted: "9" }[mutation];
      const sourceHash = "2".repeat(63) + suffix;
      await expect(runReferenceExtractionCli(["--target", value.target], {
        projectRoot: value.projectRoot,
        sourceHash,
        execute: async (options) => {
          await completedRun(options, `physical-candidate-${mutation}`);
          const candidatePath = join(
            options.stagingDirectory,
            "candidates",
            "fixture",
            "r0-ox+0-oy+0-span1x1-x-64-y-48-x-right-y-up.png",
          );
          if (mutation === "missing") {
            await rm(candidatePath);
          } else if (mutation === "extra") {
            await writeFile(join(
              options.stagingDirectory,
              "candidates",
              "fixture",
              "r0-ox+0-oy+0-span1x1-x-63-y-48-x-right-y-up.png",
            ), await fixtureImage("unmanifested-candidate", "png"));
          } else {
            await writeFile(candidatePath, await fixtureImage("substituted-candidate", "png"));
          }
        },
      })).rejects.toThrow(/candidate|artifact attestation/i);
      await expect(access(join(value.localRoot, sourceHash))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects unmanifested empty candidate directories before and after promotion", async () => {
    // Break caught: file-only hashing assigns the same content address to different candidate directory trees.
    const value = await fixture();
    const sourceHash = "2".repeat(63) + "b";
    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => {
        await completedRun(options, "empty-candidate-before");
        await mkdir(join(options.stagingDirectory, "candidates", "unmanifested-empty"));
      },
    })).rejects.toThrow(/candidate.*(directory|manifest|tree)/i);

    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "empty-candidate-after"),
    });
    const finalDirectory = join(value.localRoot, sourceHash);
    const runDirectory = await currentRunDirectory(finalDirectory);
    await mkdir(join(runDirectory, "candidates", "unmanifested-empty"));
    await expect(resolveReferenceExtractionCurrentRun(finalDirectory, sourceHash, 1))
      .rejects.toThrow(/candidate.*(directory|manifest|tree)/i);
  });

  it("rejects a pointer whose immutable directory name is not the recalculated root manifest hash", async () => {
    // Break caught: a run directory name is accepted as content-addressed without deriving it from its manifest.
    const value = await fixture();
    const sourceHash = "2".repeat(63) + "6";
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "wrong-directory-hash"),
    });
    const finalDirectory = join(value.localRoot, sourceHash);
    const runDirectory = await currentRunDirectory(finalDirectory);
    const wrongHash = "f".repeat(64);
    const wrongDirectory = join(finalDirectory, "runs", wrongHash);
    await rename(runDirectory, wrongDirectory);
    await writeFile(join(finalDirectory, "current.json"), `${JSON.stringify({
      schemaVersion: 2,
      runDirectory: `runs/${wrongHash}`,
      rootManifestSha256: wrongHash,
    })}\n`);
    await expect(resolveReferenceExtractionCurrentRun(finalDirectory, sourceHash, 1))
      .rejects.toThrow(/manifest|pointer does not match/);
  });

  it("recomputes global and per-group quality outcomes instead of trusting claimed passed status", async () => {
    // Break caught: a self-consistent passed manifest carries threshold-failing or truncated evidence.
    for (const invalid of ["global", "group", "truncated", "playable", "target", "self-consistent"] as const) {
      const value = await fixture();
      const suffix = {
        global: "2", group: "3", truncated: "4", playable: "5", target: "6", "self-consistent": "7",
      }[invalid];
      const sourceHash = "1".repeat(63) + suffix;
      await expect(runReferenceExtractionCli(["--target", value.target], {
        projectRoot: value.projectRoot,
        sourceHash,
        execute: async (options) => {
          await completedRun(options, `claimed-${invalid}`);
          const reportPath = join(options.stagingDirectory, "quality-report.json");
          const summaryPath = join(options.stagingDirectory, "run-summary.json");
          const report = JSON.parse(await readFile(reportPath, "utf8"));
          if (invalid === "global") report.imageDifference = { mean: 1, maximum: 1, samples: 1 };
          if (invalid === "group") report.groups[0].imageDifference = { mean: 1, maximum: 1, samples: 1 };
          if (invalid === "truncated") report.groups[0] = {
            id: report.groups[0].id,
            status: "accepted",
            placedReferenceCells: report.groups[0].placedReferenceCells,
          };
          if (invalid === "playable") report.coverageEvidence.playableReference = [];
          if (invalid === "target") report.coverageEvidence.targetEligible[0].groupId = "missing/r0/ox0/oy0";
          if (invalid === "self-consistent") {
            report.coverageEvidence.fullReference = [];
            report.coverageEvidence.playableReference = [];
            report.coverageEvidence.targetEligible = [];
            report.coverage = Object.fromEntries(["fullReference", "playableReference", "targetEligible"].map(
              (domain) => [domain, Object.fromEntries(["type", "rotation", "cell"].map(
                (metric) => [metric, { covered: 0, total: 0, ratio: 0 }],
              ))],
            ));
            report.reasons = [
              "full-reference-type-coverage-below-minimum",
              "full-reference-rotation-coverage-below-minimum",
              "full-reference-cell-coverage-below-minimum",
              "playable-reference-cell-coverage-below-minimum",
              "target-eligible-cell-coverage-below-minimum",
            ];
          }
          const reportText = `${JSON.stringify(report, null, 2)}\n`;
          await writeFile(reportPath, reportText);
          const summary = JSON.parse(await readFile(summaryPath, "utf8"));
          summary.artifacts.qualityReport.bytes = Buffer.byteLength(reportText);
          summary.artifacts.qualityReport.sha256 = digest(reportText);
          if (invalid === "self-consistent") {
            summary.coverage = report.coverage;
            summary.reasons = report.reasons;
            summary.status = "failed";
          }
          summary.rootManifestSha256 = "0".repeat(64);
          for (;;) {
            const bytes = Buffer.byteLength(`${JSON.stringify(summary, null, 2)}\n`);
            if (summary.rootManifestBytes === bytes) break;
            summary.rootManifestBytes = bytes;
          }
          summary.rootManifestSha256 = digest(`${JSON.stringify(summary, null, 2)}\n`);
          await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
        },
      })).rejects.toThrow(/quality evidence|complete report/);
    }
  });

  it("resolves current pointers only after re-verifying their immutable run", async () => {
    // Break caught: a consumer follows a syntactically valid pointer to post-promotion tampering.
    const value = await fixture();
    const sourceHash = "c".repeat(64);
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "consumer"),
    });
    const finalDirectory = join(value.localRoot, sourceHash);
    const runDirectory = await resolveReferenceExtractionCurrentRun(finalDirectory, sourceHash, 1);
    expect(runDirectory).toBe(await currentRunDirectory(finalDirectory));
    await writeFile(join(runDirectory, "target-preview.png"), "tampered-after-promotion");
    await expect(resolveReferenceExtractionCurrentRun(finalDirectory, sourceHash, 1))
      .rejects.toThrow("hash mismatch");
  });

  it("preserves the previous successful output when execution or its quality gate fails", async () => {
    // Break caught: a partial or failed rerun destroys the last reviewable successful evidence.
    const value = await fixture();
    const sourceHash = "3".repeat(64);
    const finalDirectory = join(value.localRoot, sourceHash);
    await mkdir(finalDirectory);
    await writeFile(join(finalDirectory, "artifact.txt"), "previous-success");

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => {
        await writeFile(join(options.stagingDirectory, "partial.txt"), "partial");
        throw new Error("evaluation failed");
      },
    })).rejects.toThrow("evaluation failed");
    expect(await readFile(join(finalDirectory, "artifact.txt"), "utf8")).toBe("previous-success");

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "unacceptable", "failed"),
    })).rejects.toThrow("quality gate");
    expect(await readFile(join(finalDirectory, "artifact.txt"), "utf8")).toBe("previous-success");
    const failedRunDirectory = await currentRunDirectory(`${finalDirectory}.failed`);
    expect(await imageColor(join(failedRunDirectory, "target-preview.png")))
      .toEqual(markerColor("preview-unacceptable"));
    expect(await readdir(value.localRoot)).toEqual([sourceHash, `${sourceHash}.failed`]);
  });

  it("keeps the previous pointer readable when promotion is interrupted before its atomic rename", async () => {
    // Break caught: a crash window removes or redirects the only pointer to the last verified run.
    const value = await fixture();
    const sourceHash = "6".repeat(64);
    const finalDirectory = join(value.localRoot, sourceHash);
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "previous"),
    });
    const previousRun = await currentRunDirectory(finalDirectory);

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "interrupted"),
      promotion: {
        beforePointerRename: () => { throw new Error("simulated pointer interruption"); },
      },
    })).rejects.toThrow("simulated pointer interruption");

    expect(await currentRunDirectory(finalDirectory)).toBe(previousRun);
    expect(await imageColor(join(previousRun, "target-preview.png")))
      .toEqual(markerColor("preview-previous"));
    expect((await readdir(finalDirectory)).filter((name) => name.startsWith(".current-")))
      .toEqual([]);
  });

  it("syncs staged artifacts before the run rename and directories around pointer promotion", async () => {
    // Break caught: current.json becomes visible without durable run/artifact ordering.
    const value = await fixture();
    const sourceHash = "2".repeat(63) + "1";
    const events: Array<{ kind: "file" | "directory"; path: string }> = [];
    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "durable"),
      promotion: { onSync: (kind, path) => { events.push({ kind, path }); } },
    });

    const finalDirectory = join(value.localRoot, sourceHash);
    const current = await currentRunDirectory(finalDirectory);
    const pointerIndex = events.findIndex(({ kind, path }) =>
      kind === "directory" && path === finalDirectory,
    );
    expect(events.some(({ kind, path }) => kind === "file" && path.endsWith("run-summary.json"))).toBe(true);
    expect(events.some(({ kind, path }) => kind === "directory" && path.endsWith("candidates"))).toBe(true);
    expect(events.some(({ kind, path }) => kind === "directory" && path === join(finalDirectory, "runs"))).toBe(true);
    expect(pointerIndex).toBeGreaterThan(-1);
    expect(await access(current)).toBeUndefined();
  });

  it("serializes concurrent promotions and leaves the pointer on one complete immutable run", async () => {
    // Break caught: concurrent pointer writers interleave files or expose an unverified directory.
    const value = await fixture();
    const sourceHash = "7".repeat(64);
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((resolve) => { firstLocked = resolve; });
    let secondWaiting!: () => void;
    const secondWaited = new Promise<void>((resolve) => { secondWaiting = resolve; });

    const first = runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "concurrent-a"),
      promotion: {
        onLockAcquired: async () => { firstLocked(); await holdFirst; },
      },
    });
    await firstHasLock;
    const second = runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "concurrent-b"),
      promotion: { onLockWaiting: () => { secondWaiting(); } },
    });
    await secondWaited;
    releaseFirst();
    await Promise.all([first, second]);

    const finalDirectory = join(value.localRoot, sourceHash);
    const current = await currentRunDirectory(finalDirectory);
    expect(current).toMatch(new RegExp(`[\\\\/]runs[\\\\/][0-9a-f]{64}$`));
    expect((await readdir(join(finalDirectory, "runs"))).sort()).toHaveLength(2);
    expect(await access(join(finalDirectory, "current.json"))).toBeUndefined();
    await expect(access(`${finalDirectory}.promotion.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers only an expired promotion lock whose owner is confirmed dead", async () => {
    // Break caught: an abandoned lock permanently blocks reruns, or a live lock is stolen unsafely.
    const value = await fixture();
    const sourceHash = "d".repeat(64);
    const finalDirectory = join(value.localRoot, sourceHash);
    await writeFile(`${finalDirectory}.promotion.lock`, JSON.stringify({
      pid: 123456789, createdAt: 1, token: "stale-owner",
    }));
    const future = Date.now() + 1_000_000;

    await runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "stale-lock"),
      promotion: {
        now: () => future,
        lockStaleMs: 10,
        isProcessAlive: () => false,
      },
    });

    expect(await imageColor(join(await currentRunDirectory(finalDirectory), "target-preview.png")))
      .toEqual(markerColor("preview-stale-lock"));
    await expect(access(`${finalDirectory}.promotion.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes simultaneous stale-lock reclaimers without deleting the winner's live lock", async () => {
    // Break caught: two waiters both unlink an observed stale lock, then both enter promotion.
    const value = await fixture();
    const sourceHash = "0".repeat(63) + "1";
    const finalDirectory = join(value.localRoot, sourceHash);
    await writeFile(`${finalDirectory}.promotion.lock`, JSON.stringify({
      pid: 123456789, createdAt: 1, token: "stale-owner",
    }));
    const future = Date.now() + 1_000_000;
    let activeLocks = 0;
    let maximumActiveLocks = 0;
    let allowStaleRemoval!: () => void;
    const staleRemovalBlocked = new Promise<void>((resolve) => { allowStaleRemoval = resolve; });
    let firstAtRemoval!: () => void;
    const firstReachedRemoval = new Promise<void>((resolve) => { firstAtRemoval = resolve; });
    const hook = (marker: string) => ({
      now: () => future,
      lockStaleMs: 10,
      isProcessAlive: () => false,
      beforeStaleLockRemoval: marker === "reclaimer-a" ? async () => {
        firstAtRemoval();
        await staleRemovalBlocked;
      } : undefined,
      onLockAcquired: async () => {
        activeLocks += 1;
        maximumActiveLocks = Math.max(maximumActiveLocks, activeLocks);
        await new Promise((resolve) => setTimeout(resolve, marker === "reclaimer-a" ? 40 : 10));
        activeLocks -= 1;
      },
    });
    const first = runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "reclaimer-a"),
      promotion: hook("reclaimer-a"),
    });
    await firstReachedRemoval;
    const second = runReferenceExtractionCli(["--target", value.target], {
        projectRoot: value.projectRoot,
        sourceHash,
        execute: async (options) => completedRun(options, "reclaimer-b"),
        promotion: hook("reclaimer-b"),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeLocks).toBe(0);
    allowStaleRemoval();
    await Promise.all([first, second]);

    expect(maximumActiveLocks).toBe(1);
    expect((await readdir(join(finalDirectory, "runs"))).sort()).toHaveLength(2);
    await expect(access(`${finalDirectory}.promotion.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not steal an expired promotion lock while its owner is alive", async () => {
    // Break caught: mtime alone is treated as ownership proof and concurrent writers are admitted.
    const value = await fixture();
    const sourceHash = "f".repeat(64);
    const finalDirectory = join(value.localRoot, sourceHash);
    await writeFile(`${finalDirectory}.promotion.lock`, JSON.stringify({ pid: process.pid, createdAt: 1 }));
    const future = Date.now() + 1_000_000;

    await expect(runReferenceExtractionCli(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      execute: async (options) => completedRun(options, "live-lock"),
      promotion: {
        now: () => future,
        lockStaleMs: 10,
        lockTimeoutMs: 0,
        isProcessAlive: () => true,
      },
    })).rejects.toThrow("lock timed out");
    expect(await readFile(`${finalDirectory}.promotion.lock`, "utf8"))
      .toContain(`"pid":${process.pid}`);
  });

  it("wires input loading, grouping, reconstruction, quality evaluation, and accepted-only preview", async () => {
    // Break caught: the CLI skips a Task 1–4 stage or renders the target from selector-rejected groups.
    const value = await fixture();
    const sourceHash = "4".repeat(64);
    const acceptedCandidate = {
      uuid: "accepted", rotation: 0, offset: { x: 0, y: 0 }, footprint: { width: 1, height: 1 },
      world: { x: 0, y: 0 }, sha256: "", localFilename: "",
    };
    const qualityRejectedCandidate = {
      uuid: "quality-rejected", rotation: 0, offset: { x: 0, y: 0 }, footprint: { width: 1, height: 1 },
      world: { x: 1, y: 0 }, sha256: "", localFilename: "",
    };
    const accepted = {
      status: "accepted",
      selected: acceptedCandidate,
      image: { rotation: 0 },
    } as unknown as CandidateDecision;
    const qualityRejected = {
      status: "accepted",
      selected: qualityRejectedCandidate,
      image: { rotation: 0 },
    } as unknown as CandidateDecision;
    const rejected = { status: "rejected", cluster: [{ uuid: "rejected" }] } as unknown as CandidateDecision;
    const inputs = {
      source: {
        sha256: sourceHash,
        width: 4,
        height: 2,
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
      },
      uuidIntersection: {
        shared: ["accepted", "quality-rejected"],
        referenceOnly: [],
        targetOnly: [],
      },
      referenceWorld: {
        id: "fixture-reference", source: "reference", gameVersion: "fixture",
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
        cells: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, xOffset: 0, yOffset: 0,
            flags: 0, terrainType: "fixture" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0, xOffset: 0, yOffset: 0,
            flags: 0, terrainType: "fixture" },
        ],
        locations: [], connections: [],
      },
      defaultWorld: { cells: [] },
      targetWorld: {
        id: "fixture-target", source: "save", gameVersion: "fixture",
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 }, cells: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, xOffset: 0, yOffset: 0,
            flags: 0, terrainType: "fixture" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0, xOffset: 0, yOffset: 0,
            flags: 0, terrainType: "fixture" },
        ], locations: [], connections: [],
      },
      targetSaveSha256: "c".repeat(64),
    } as unknown as ReferenceExtractionInputs;
    const referenceWorldPath = join(value.projectRoot, "public", "data", "generated", "reference-world.json");
    await mkdir(join(value.projectRoot, "public", "data", "generated"), { recursive: true });
    await writeFile(referenceWorldPath, JSON.stringify(inputs.referenceWorld));
    await writeFile(value.target, "target-save");
    const canonicalReferenceWorld = JSON.stringify(inputs.referenceWorld);
    const canonicalTargetWorld = JSON.stringify(inputs.targetWorld);
    const reconstruction = {
      sourceHashes: { sourceImageSha256: sourceHash },
      coverageCells: {
        fullReference: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, groupId: "accepted/r0/ox0/oy0" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0,
            groupId: "quality-rejected/r0/ox0/oy0" },
        ],
        playableReference: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, groupId: "accepted/r0/ox0/oy0" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0,
            groupId: "quality-rejected/r0/ox0/oy0" },
        ],
        targetEligible: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, groupId: "accepted/r0/ox0/oy0" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0,
            groupId: "quality-rejected/r0/ox0/oy0" },
        ],
      },
    } as unknown as ReconstructionResult;
    const report = {
      status: "failed",
      reasons: [
        "mean-image-difference-exceeded",
        "full-reference-type-coverage-below-minimum",
        "full-reference-rotation-coverage-below-minimum",
        "full-reference-cell-coverage-below-minimum",
        "playable-reference-cell-coverage-below-minimum",
        "target-eligible-cell-coverage-below-minimum",
      ],
      sourceHashes: {
        sourceImageSha256: sourceHash,
        referenceWorldSha256: digest(canonicalReferenceWorld),
        targetWorldSha256: digest(canonicalTargetWorld),
        targetSaveSha256: "c".repeat(64),
      },
      thresholds: DEFAULT_REFERENCE_QUALITY_THRESHOLDS,
      imageDifference: { mean: 1, maximum: 1, samples: 1 },
      seam: { mean: 0, maximum: 0, samples: 1 },
      seamEvidence: {
        state: "measured",
        expectedSamples: 1,
        placedToPlaced: 1,
        placedToMissing: 0,
        missingToMissing: 0,
      },
      coverage: {
        fullReference: Object.fromEntries(["type", "rotation", "cell"].map((metric) => [
          metric, { covered: 1, total: 2, ratio: 0.5 },
        ])),
        playableReference: Object.fromEntries(["type", "rotation", "cell"].map((metric) => [
          metric, { covered: 1, total: 2, ratio: 0.5 },
        ])),
        targetEligible: Object.fromEntries(["type", "rotation", "cell"].map((metric) => [
          metric, { covered: 1, total: 2, ratio: 0.5 },
        ])),
      },
      coverageEvidence: {
        fullReference: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, groupId: "accepted/r0/ox0/oy0" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0,
            groupId: "quality-rejected/r0/ox0/oy0" },
        ],
        playableReference: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, groupId: "accepted/r0/ox0/oy0" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0,
            groupId: "quality-rejected/r0/ox0/oy0" },
        ],
        targetEligible: [
          { x: 0, y: 0, uuid: "accepted", rotation: 0, groupId: "accepted/r0/ox0/oy0" },
          { x: 1, y: 0, uuid: "quality-rejected", rotation: 0,
            groupId: "quality-rejected/r0/ox0/oy0" },
        ],
      },
      artifacts: {
        reconstruction: { path: join(value.localRoot, "staged", "reconstruction.webp"), sha256: "5".repeat(64) },
        difference: { path: join(value.localRoot, "staged", "difference.png"), sha256: "6".repeat(64) },
      },
      canonicalJson: JSON.stringify({
        status: "failed",
        reasons: ["fixture-global-gate"],
        sourceHashes: { sourceImageSha256: sourceHash },
        groups: [
          { id: "accepted/r0/ox0/oy0", status: "accepted" },
          { id: "quality-rejected/r0/ox0/oy0", status: "rejected" },
        ],
      }),
      groups: [
        {
          id: "accepted/r0/ox0/oy0", uuid: "accepted", rotation: 0,
          offset: { x: 0, y: 0 }, footprint: { width: 1, height: 1 },
          selectorStatus: "accepted", selectorReasons: [], selected: {
            sha256: "d".repeat(64), localFilename: "accepted/candidate.png",
            sourceWorld: { x: 0, y: 0 }, sourceRotation: 0, synthesized: false,
          }, rejectedCandidates: [], status: "accepted",
          placedReferenceCells: [{ x: 0, y: 0 }], imageDifference: { mean: 0, maximum: 0, samples: 1 },
          seam: { mean: 0, maximum: 0, samples: 1 }, seamEvidence: { expectedSamples: 1 }, reasons: [],
        },
        {
          id: "quality-rejected/r0/ox0/oy0", uuid: "quality-rejected", rotation: 0,
          offset: { x: 0, y: 0 }, footprint: { width: 1, height: 1 },
          selectorStatus: "accepted", selectorReasons: [], selected: {
            sha256: "e".repeat(64), localFilename: "quality-rejected/candidate.png",
            sourceWorld: { x: 0, y: 0 }, sourceRotation: 0, synthesized: false,
          }, rejectedCandidates: [], status: "rejected",
          placedReferenceCells: [], imageDifference: { mean: 0, maximum: 0, samples: 0 },
          seam: { mean: 0, maximum: 0, samples: 0 }, seamEvidence: { expectedSamples: 0 },
          reasons: ["no-reference-cells-placed"],
        },
        {
          id: "rejected/r0/ox0/oy0", uuid: "rejected", rotation: 0,
          offset: { x: 0, y: 0 }, footprint: { width: 1, height: 1 },
          selectorStatus: "rejected", selectorReasons: ["fixture-selector"], rejectedCandidates: [],
          status: "rejected", placedReferenceCells: [],
          imageDifference: { mean: 0, maximum: 0, samples: 0 },
          seam: { mean: 0, maximum: 0, samples: 0 }, seamEvidence: { expectedSamples: 0 },
          reasons: ["fixture-selector"],
        },
      ],
    } as unknown as ReferenceQualityReport;
    const calls: string[] = [];
    const previewDecisions: CandidateDecision[] = [];
    let stagingDirectory = "";

    await expect(runReferenceExtractionCliProduction(["--target", value.target], {
      projectRoot: value.projectRoot,
      sourceHash,
      expectedSharedUuids: 2,
      pipeline: {
        loadInputs: async () => { calls.push("load"); return inputs; },
        extractCandidates: async (_input, candidateRoot) => {
          calls.push("extract");
          const candidates = await Promise.all([
            [acceptedCandidate, "accepted/r0-ox+0-oy+0-span1x1-x+0-y+0-x-right-y-up.png"] as const,
            [qualityRejectedCandidate, "quality-rejected/r0-ox+0-oy+0-span1x1-x+1-y+0-x-right-y-up.png"] as const,
          ].map(async ([candidate, localFilename], index) => {
            const bytes = await fixtureImage(`pipeline-candidate-${index}`, "png");
            candidate.sha256 = digestBytes(bytes);
            candidate.localFilename = localFilename;
            await mkdir(join(candidateRoot, candidate.uuid), { recursive: true });
            await writeFile(join(candidateRoot, ...localFilename.split("/")), bytes);
            return candidate;
          }));
          report.groups[0].selected!.sha256 = candidates[0]!.sha256;
          report.groups[0].selected!.localFilename = candidates[0]!.localFilename;
          report.groups[1].selected!.sha256 = candidates[1]!.sha256;
          report.groups[1].selected!.localFilename = candidates[1]!.localFilename;
          report.groups[1].selected!.sourceWorld = { x: 1, y: 0 };
          return candidates as unknown as ExtractionCandidate[];
        },
        selectCandidates: () => { calls.push("select"); return [accepted, qualityRejected, rejected]; },
        reconstruct: async (options) => {
          calls.push("reconstruct");
          const referenceBytes = options.worldProvenance.referenceWorld.bytes;
          expect(JSON.parse(Buffer.from(referenceBytes).toString("utf8"))).toEqual(inputs.referenceWorld);
          expect(options.worldProvenance.referenceWorld.sha256).toBe(createHash("sha256")
            .update(referenceBytes).digest("hex"));
          expect(options.sourceHashes.referenceWorldSha256)
            .toBe(options.worldProvenance.referenceWorld.sha256);
          stagingDirectory = join(options.reconstructionPath, "..");
          const reconstructionBytes = await fixtureImage("pipeline-reconstruction", "webp");
          const differenceBytes = await fixtureImage("pipeline-difference", "png");
          await writeFile(options.reconstructionPath, reconstructionBytes);
          await writeFile(options.differencePath, differenceBytes);
          report.artifacts.reconstruction.sha256 = digestBytes(reconstructionBytes);
          report.artifacts.difference.sha256 = digestBytes(differenceBytes);
          report.artifacts.reconstruction.path = options.reconstructionPath;
          report.artifacts.difference.path = options.differencePath;
          return reconstruction;
        },
        evaluate: () => { calls.push("evaluate"); return report; },
        renderTargetPreview: async (_inputs, decisions) => {
          calls.push("preview"); previewDecisions.push(...decisions);
          return fixtureImage("pipeline-preview", "png");
        },
      },
    })).rejects.toThrow("quality gate");

    expect(calls).toEqual(["load", "extract", "select", "reconstruct", "evaluate", "preview"]);
    expect(previewDecisions).toEqual([accepted]);
    const finalDirectory = `${join(value.localRoot, sourceHash)}.failed`;
    expect(stagingDirectory).not.toBe("");
    const currentDirectory = await currentRunDirectory(finalDirectory);
    expect(await imageColor(join(currentDirectory, "target-preview.png")))
      .toEqual(markerColor("pipeline-preview"));
    expect(JSON.parse(await readFile(join(currentDirectory, "quality-report.json"), "utf8")))
      .toMatchObject({ status: "failed", sourceHashes: { sourceImageSha256: sourceHash } });
    expect(JSON.parse(await readFile(join(currentDirectory, "run-summary.json"), "utf8")))
      .toMatchObject({ checkedInputHashes: CALIBRATED_REFERENCE_INPUT_HASHES });
    expect(JSON.parse(await readFile(join(currentDirectory, "run-summary.json"), "utf8")))
      .not.toHaveProperty("durationMs");
  });
});
