import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildRuntimeCaptureJob } from "./capture-job.ts";
import {
  acceptRuntimeFrame,
  validateRuntimeFramePair,
} from "./frame-validation.ts";
import type {
  RuntimeCaptureJob,
  RuntimeCapturePoint,
  RuntimeFrameEvidence,
} from "./runtime-types.ts";

const REVIEWED_EXECUTABLE_SHA256 =
  "fcb71ab85fb0e70033c370fec373e65293ac97c51544b49eedca83355096d7c3";
const WIDTH = 1920;
const HEIGHT = 1080;
const CHANNELS = 3;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createRgbPng(
  path: string,
  width = WIDTH,
  height = HEIGHT,
  pixels?: Buffer,
): Promise<void> {
  await sharp(pixels ?? Buffer.alloc(width * height * CHANNELS, 100), {
    raw: { width, height, channels: CHANNELS },
  }).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(path);
}

function setCropRgbDifference(
  pixels: Buffer,
  totalDifference: number,
  job: RuntimeCaptureJob,
): void {
  let remaining = totalDifference;
  const { left, top, width, height } = job.camera.crop;
  for (let y = top; y < top + height && remaining > 0; y += 1) {
    for (let x = left; x < left + width && remaining > 0; x += 1) {
      const offset = (y * WIDTH + x) * CHANNELS;
      for (let channel = 0; channel < CHANNELS && remaining > 0; channel += 1) {
        const increment = Math.min(155, remaining);
        pixels[offset + channel] += increment;
        remaining -= increment;
      }
    }
  }
  expect(remaining).toBe(0);
}

function setDarkCropPixels(
  pixels: Buffer,
  darkPixels: number,
  job: RuntimeCaptureJob,
): void {
  const { left, top, width, height } = job.camera.crop;
  let remaining = darkPixels;
  for (let y = top; y < top + height && remaining > 0; y += 1) {
    for (let x = left; x < left + width && remaining > 0; x += 1) {
      const offset = (y * WIDTH + x) * CHANNELS;
      pixels.fill(0, offset, offset + CHANNELS);
      remaining -= 1;
    }
  }
  expect(remaining).toBe(0);
}

interface Fixture {
  root: string;
  job: RuntimeCaptureJob;
  point: RuntimeCapturePoint;
  first: string;
  second: string;
  evidencePath: string;
  cameraLog: string;
  output: string;
  evidence: RuntimeFrameEvidence;
}

async function makeFixture(name: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), `sm-frame-${name}-`));
  const source = join(root, "source");
  const evidenceRoot = join(root, "evidence");
  await Promise.all([
    mkdir(source, { recursive: true }),
    mkdir(evidenceRoot, { recursive: true }),
  ]);
  const job = buildRuntimeCaptureJob("a".repeat(64));
  const point = job.points[0];
  const first = join(source, `${point.id}-a1.png`);
  const second = join(source, `${point.id}-b1.png`);
  const cameraLog = join(evidenceRoot, `${point.id}.log`);
  const evidencePath = join(evidenceRoot, `${point.id}-a1.json`);
  const output = join(root, "accepted", `${point.id}.png`);
  await Promise.all([createRgbPng(first), createRgbPng(second)]);
  const log = `12:34:56 (1/0) [Main:4242] [Lua] SM_OVERVIEW_CAPTURE_READY x=${point.x.toFixed(3)} y=${point.y.toFixed(3)} z=${point.z.toFixed(3)} fov=90 direction=0,0,-1 gui=hidden\n`;
  await writeFile(cameraLog, log, "utf8");
  const evidence: RuntimeFrameEvidence = {
    schemaVersion: 1,
    pointId: point.id,
    pid: 4242,
    executableSha256: REVIEWED_EXECUTABLE_SHA256,
    firstFrame: first,
    secondFrame: second,
    cameraLog,
    cameraLogSha256: sha256(log),
    cursorOutsideCrop: true,
    hudReviewedHidden: true,
    capturedAt: "2026-08-01T12:34:56.000Z",
  };
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  return { root, job, point, first, second, evidencePath, cameraLog, output, evidence };
}

async function validate(fixture: Fixture, attempt: 1 | 2 | 3 = 1) {
  return validateRuntimeFramePair(fixture.job, fixture.point, {
    captureRoot: fixture.root,
    firstFrame: fixture.first,
    secondFrame: fixture.second,
    evidencePath: fixture.evidencePath,
    outputFile: fixture.output,
    attempt,
  });
}

async function replaceEvidence(
  fixture: Fixture,
  mutate: (evidence: RuntimeFrameEvidence) => void,
): Promise<void> {
  const evidence = structuredClone(fixture.evidence);
  mutate(evidence);
  await writeFile(fixture.evidencePath, JSON.stringify(evidence), "utf8");
}

describe("validateRuntimeFramePair", () => {
  it.each([
    ["unknown ID", { id: "r9-c9" }],
    ["altered coordinates", { x: -3163 }],
  ])("rejects a forged job point with %s through both exported APIs", async (_case, change) => {
    // Break caught: callers bypass the CLI and accept a location not present in the signed job.
    const fixture = await makeFixture(`forged-${_case.replace(" ", "-")}`);
    const forged = { ...fixture.point, ...change } as RuntimeCapturePoint;
    await expect(validateRuntimeFramePair(fixture.job, forged, {
      captureRoot: fixture.root,
      firstFrame: fixture.first,
      secondFrame: fixture.second,
      evidencePath: fixture.evidencePath,
      outputFile: fixture.output,
      attempt: 1,
    })).rejects.toThrow("capture point does not match");
    await expect(acceptRuntimeFrame(fixture.job, forged, {
      captureRoot: fixture.root,
      firstFrame: fixture.first,
      secondFrame: fixture.second,
      evidencePath: fixture.evidencePath,
      attempt: 1,
    })).rejects.toThrow("capture point does not match");
    await expect(access(fixture.output)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(fixture.root, "capture-manifest.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts two identical 1920x1080 frames as one deterministic 750x750 crop", async () => {
    // Break caught: valid official-runtime frames are resized, rejected, or encoded nondeterministically.
    const fixture = await makeFixture("identical");
    const accepted = await validate(fixture);
    const metadata = await sharp(fixture.output).metadata();
    const firstHash = sha256(await readFile(fixture.output));

    await validate(fixture);

    expect(accepted).toMatchObject({
      pointId: "r0-c0",
      file: "accepted/r0-c0.png",
      sha256: firstHash,
      width: 750,
      height: 750,
      normalizedMeanAbsoluteDifference: 0,
      darkRatio: 0,
      attempt: 1,
    });
    expect(metadata).toMatchObject({ width: 750, height: 750, format: "png" });
    expect(sha256(await readFile(fixture.output))).toBe(firstHash);
  });

  it("accepts the last representable MAD below 0.015 and rejects the first value above 0.0151", async () => {
    // Break caught: stability uses the wrong denominator or a strict comparison at the boundary.
    const passing = await makeFixture("mad-pass");
    const denominator = 750 * 750 * CHANNELS * 255;
    const passPixels = Buffer.alloc(WIDTH * HEIGHT * CHANNELS, 100);
    setCropRgbDifference(passPixels, Math.floor(denominator * 0.015), passing.job);
    await createRgbPng(passing.second, WIDTH, HEIGHT, passPixels);
    expect((await validate(passing)).normalizedMeanAbsoluteDifference)
      .toBeLessThanOrEqual(0.015);

    const failing = await makeFixture("mad-fail");
    const failPixels = Buffer.alloc(WIDTH * HEIGHT * CHANNELS, 100);
    setCropRgbDifference(failPixels, Math.ceil(denominator * 0.0151), failing.job);
    await createRgbPng(failing.second, WIDTH, HEIGHT, failPixels);
    await expect(validate(failing)).rejects.toThrow("unstable");
    await expect(access(failing.output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts dark ratio 0.85 and rejects 0.8501", async () => {
    // Break caught: loading-screen rejection uses the wrong pixel count or boundary comparison.
    const passing = await makeFixture("dark-pass");
    const passPixels = Buffer.alloc(WIDTH * HEIGHT * CHANNELS, 100);
    setDarkCropPixels(passPixels, 478_125, passing.job);
    await Promise.all([
      createRgbPng(passing.first, WIDTH, HEIGHT, passPixels),
      createRgbPng(passing.second, WIDTH, HEIGHT, passPixels),
    ]);
    expect((await validate(passing)).darkRatio).toBe(0.85);

    const failing = await makeFixture("dark-fail");
    const failPixels = Buffer.alloc(WIDTH * HEIGHT * CHANNELS, 100);
    setDarkCropPixels(failPixels, 478_182, failing.job);
    await Promise.all([
      createRgbPng(failing.first, WIDTH, HEIGHT, failPixels),
      createRgbPng(failing.second, WIDTH, HEIGHT, failPixels),
    ]);
    await expect(validate(failing)).rejects.toThrow("dark");
  });

  it.each([[1919, 1080], [1920, 1079]])(
    "rejects a %ix%i source frame",
    async (width, height) => {
      // Break caught: a partial or scaled window capture enters the accepted set.
      const fixture = await makeFixture(`dimensions-${width}-${height}`);
      await createRgbPng(fixture.first, width, height);
      await expect(validate(fixture)).rejects.toThrow("1920x1080");
    },
  );

  it.each([
    ["marker", "not the ready marker", "camera proof"],
    ["x", "x=-3163.000", "camera proof"],
    ["y", "y=1949.000", "camera proof"],
    ["z", "z=249.000", "camera proof"],
    ["fov", "fov=89", "camera proof"],
    ["direction", "direction=0,1,0", "camera proof"],
    ["gui", "gui=visible", "camera proof"],
  ])("rejects wrong %s camera-log evidence", async (field, replacement, message) => {
    // Break caught: a screenshot from the wrong camera state is trusted.
    const fixture = await makeFixture(`log-${field}`);
    const original = await readFile(fixture.cameraLog, "utf8");
    const changed = field === "marker"
      ? original.replace("SM_OVERVIEW_CAPTURE_READY", replacement)
      : original.replace(/(?:x=-3164\.000|y=1948\.000|z=250\.000|fov=90|direction=0,0,-1|gui=hidden)/g,
        (token) => token.startsWith(field) ? replacement : token);
    await writeFile(fixture.cameraLog, changed, "utf8");
    await replaceEvidence(fixture, (evidence) => {
      evidence.cameraLogSha256 = sha256(changed);
    });
    await expect(validate(fixture)).rejects.toThrow(message);
  });

  it.each([
    ["cursorOutsideCrop", false],
    ["hudReviewedHidden", false],
  ] as const)("rejects %s=false", async (field, value) => {
    // Break caught: an unreviewed cursor or HUD-contaminated capture is accepted.
    const fixture = await makeFixture(field);
    await replaceEvidence(fixture, (evidence) => {
      (evidence as unknown as Record<string, unknown>)[field] = value;
    });
    await expect(validate(fixture)).rejects.toThrow("evidence");
  });

  it("rejects a PID that does not match the exact log line", async () => {
    // Break caught: camera proof from another process is attached to the frame pair.
    const fixture = await makeFixture("pid");
    await replaceEvidence(fixture, (evidence) => { evidence.pid = 4243; });
    await expect(validate(fixture)).rejects.toThrow("PID");
  });

  it("rejects an executable hash other than the reviewed runtime", async () => {
    // Break caught: a non-reviewed executable can masquerade as official-runtime evidence.
    const fixture = await makeFixture("exe");
    await replaceEvidence(fixture, (evidence) => {
      evidence.executableSha256 = "b".repeat(64);
    });
    await expect(validate(fixture)).rejects.toThrow("executable");
  });

  it("rejects output traversal and junction escapes from the declared capture root", async () => {
    // Break caught: accepted artifacts can be written outside the operator-approved root.
    const traversal = await makeFixture("output-traversal");
    traversal.output = join(traversal.root, "..", "escaped.png");
    await expect(validate(traversal)).rejects.toThrow("capture root");

    const junction = await makeFixture("output-junction");
    const outside = await mkdtemp(join(tmpdir(), "sm-frame-outside-"));
    await symlink(outside, join(junction.root, "accepted"), "junction");
    await expect(validate(junction)).rejects.toThrow("capture root");
  });

  it("rejects source and evidence paths that escape through a junction", async () => {
    // Break caught: untrusted evidence is read from outside the declared capture root.
    const fixture = await makeFixture("input-junction");
    const outside = await mkdtemp(join(tmpdir(), "sm-frame-source-outside-"));
    const outsideFrame = join(outside, "outside.png");
    await createRgbPng(outsideFrame);
    await symlink(outside, join(fixture.root, "linked-source"), "junction");
    fixture.first = join(fixture.root, "linked-source", "outside.png");
    await replaceEvidence(fixture, (evidence) => { evidence.firstFrame = fixture.first; });
    await expect(validate(fixture)).rejects.toThrow("capture root");
  });
});

describe("acceptRuntimeFrame", () => {
  it("atomically writes one manifest entry only after validation passes", async () => {
    // Break caught: a rejected attempt leaves a crop or partial manifest entry behind.
    const fixture = await makeFixture("manifest-pass");
    const manifest = await acceptRuntimeFrame(fixture.job, fixture.point, {
      captureRoot: fixture.root,
      firstFrame: fixture.first,
      secondFrame: fixture.second,
      evidencePath: fixture.evidencePath,
      attempt: 1,
    });
    const disk = JSON.parse(await readFile(join(fixture.root, "capture-manifest.json"), "utf8"));
    expect(manifest).toEqual(disk);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      jobContentHash: fixture.job.contentHash,
      frames: [{ pointId: fixture.point.id, attempt: 1 }],
    });

    const rejected = await makeFixture("manifest-reject");
    await replaceEvidence(rejected, (evidence) => {
      (evidence as unknown as { hudReviewedHidden: boolean }).hudReviewedHidden = false;
    });
    await expect(acceptRuntimeFrame(rejected.job, rejected.point, {
      captureRoot: rejected.root,
      firstFrame: rejected.first,
      secondFrame: rejected.second,
      evidencePath: rejected.evidencePath,
      attempt: 1,
    })).rejects.toThrow("evidence");
    await expect(access(join(rejected.root, "accepted", "r0-c0.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(rejected.root, "capture-manifest.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects attempt 4 and a different image for an already accepted point", async () => {
    // Break caught: retry limits or accepted evidence can be silently overwritten.
    const fixture = await makeFixture("attempts");
    await expect(acceptRuntimeFrame(fixture.job, fixture.point, {
      captureRoot: fixture.root,
      firstFrame: fixture.first,
      secondFrame: fixture.second,
      evidencePath: fixture.evidencePath,
      attempt: 4,
    })).rejects.toThrow("attempt");

    await acceptRuntimeFrame(fixture.job, fixture.point, {
      captureRoot: fixture.root,
      firstFrame: fixture.first,
      secondFrame: fixture.second,
      evidencePath: fixture.evidencePath,
      attempt: 1,
    });
    const changed = Buffer.alloc(WIDTH * HEIGHT * CHANNELS, 101);
    await createRgbPng(fixture.second, WIDTH, HEIGHT, changed);
    await replaceEvidence(fixture, (evidence) => {
      evidence.firstFrame = fixture.second;
      evidence.secondFrame = fixture.second;
    });
    await expect(acceptRuntimeFrame(fixture.job, fixture.point, {
      captureRoot: fixture.root,
      firstFrame: fixture.second,
      secondFrame: fixture.second,
      evidencePath: fixture.evidencePath,
      attempt: 2,
    })).rejects.toThrow("already accepted");
  });

  it("removes a new final crop when the atomic manifest replacement fails", async () => {
    // Break caught: an I/O failure leaves an untracked accepted crop behind.
    const fixture = await makeFixture("manifest-write-failure");
    await expect(acceptRuntimeFrame(fixture.job, fixture.point, {
      captureRoot: fixture.root,
      firstFrame: fixture.first,
      secondFrame: fixture.second,
      evidencePath: fixture.evidencePath,
      attempt: 1,
    }, {
      writeManifest: async () => { throw new Error("injected manifest failure"); },
    })).rejects.toThrow("injected manifest failure");
    await expect(access(join(fixture.root, "accepted", "r0-c0.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(fixture.root, "capture-manifest.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["unknown point", "wrong hash"])(
    "rejects an existing manifest with %s",
    async (corruption) => {
      // Break caught: Task 5 receives a manifest entry not backed by this job and exact crop bytes.
      const fixture = await makeFixture(`manifest-${corruption.replace(" ", "-")}`);
      await acceptRuntimeFrame(fixture.job, fixture.point, {
        captureRoot: fixture.root,
        firstFrame: fixture.first,
        secondFrame: fixture.second,
        evidencePath: fixture.evidencePath,
        attempt: 1,
      });
      const manifestPath = join(fixture.root, "capture-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (corruption === "unknown point") {
        manifest.frames[0].pointId = "r9-c9";
        manifest.frames[0].file = "accepted/r9-c9.png";
      } else {
        manifest.frames[0].sha256 = "b".repeat(64);
      }
      await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
      await expect(acceptRuntimeFrame(fixture.job, fixture.point, {
        captureRoot: fixture.root,
        firstFrame: fixture.first,
        secondFrame: fixture.second,
        evidencePath: fixture.evidencePath,
        attempt: 1,
      })).rejects.toThrow("manifest is invalid");
    },
  );
});
