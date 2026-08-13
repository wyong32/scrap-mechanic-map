import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimeCaptureJob } from "./capture-job.ts";
import { stitchRuntimeGrid } from "./stitch-runtime-grid.ts";
import type { RuntimeCaptureManifest } from "./runtime-types.ts";

const FRAME = 750;
const STRIDE = 525;
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function worldPixel(x: number, y: number): [number, number, number] {
  return [
    (x * 17 + y * 31 + ((x * y) % 251)) & 255,
    (x * 43 + y * 7 + ((x ^ y) % 239)) & 255,
    (x * 11 + y * 59 + ((x + y) % 227)) & 255,
  ];
}

function cropPixels(originX: number, originY: number): Buffer {
  const pixels = Buffer.alloc(FRAME * FRAME * 3);
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) {
      const offset = (y * FRAME + x) * 3;
      const rgb = worldPixel(originX + x, originY + y);
      pixels[offset] = rgb[0]; pixels[offset + 1] = rgb[1]; pixels[offset + 2] = rgb[2];
    }
  }
  return pixels;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sm-stitch-"));
  cleanupRoots.push(root);
  const accepted = join(root, "accepted");
  await mkdir(accepted, { recursive: true });
  const job = buildRuntimeCaptureJob("a".repeat(64));
  const frames: RuntimeCaptureManifest["frames"][number][] = [];
  for (const point of job.points) {
    const file = join(accepted, `${point.id}.png`);
    await sharp(cropPixels(point.column * STRIDE, point.row * STRIDE), {
      raw: { width: FRAME, height: FRAME, channels: 3 },
    }).png({ compressionLevel: 1, adaptiveFiltering: false }).toFile(file);
    frames.push({
      pointId: point.id,
      file: `accepted/${point.id}.png`,
      sha256: digest(await readFile(file)),
      width: 750,
      height: 750,
      normalizedMeanAbsoluteDifference: 0,
      darkRatio: 0,
      attempt: 1,
    });
  }
  const manifest: RuntimeCaptureManifest = {
    schemaVersion: 1,
    jobContentHash: job.contentHash,
    frames,
  };
  return { root, job, manifest };
}

async function absent(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("stitchRuntimeGrid", () => {
  it("stitches a complete north-up 5x5 grid with 40 alignments and deterministic bytes", async () => {
    const first = await fixture();
    const receipt = await stitchRuntimeGrid(first.job, first.manifest, first.root);
    expect(receipt.alignments).toHaveLength(40);
    expect(receipt.placements).toHaveLength(25);
    expect(receipt.placements.find((entry) => entry.pointId === "r0-c0")?.origin)
      .toEqual({ x: 0, y: 0 });
    expect(receipt.placements.find((entry) => entry.pointId === "r4-c4")?.origin)
      .toEqual({ x: 2100, y: 2100 });
    expect(receipt.output).toMatchObject({ width: 2850, height: 2850 });
    const output = join(first.root, "stitched", "default-surface-5x5.png");
    const report = join(first.root, "reports", "stitch-receipt.json");
    const raw = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const sample = (x: number, y: number) => [...raw.data.subarray((y * raw.info.width + x) * 3, (y * raw.info.width + x) * 3 + 3)];
    expect(sample(20, 20)).toEqual(worldPixel(20, 20));
    expect(sample(2840, 2840)).toEqual(worldPixel(2840, 2840));
    expect(sample(640, 640)).toEqual(worldPixel(640, 640));
    const firstImageHash = digest(await readFile(output));
    const firstReceiptHash = digest(await readFile(report));
    const repeated = await stitchRuntimeGrid(first.job, first.manifest, first.root);
    expect(repeated).toEqual(receipt);
    expect(digest(await readFile(output))).toBe(firstImageHash);
    expect(digest(await readFile(report))).toBe(firstReceiptHash);
  }, 120_000);

  it("blocks missing points, hash mismatch, wrong dimensions, and failed neighbors without output", async () => {
    const missing = await fixture();
    const missingManifest = { ...missing.manifest, frames: missing.manifest.frames.slice(1) };
    await expect(stitchRuntimeGrid(missing.job, missingManifest, missing.root)).rejects.toThrow("25");
    await absent(join(missing.root, "stitched", "default-surface-5x5.png"));

    const hash = await fixture();
    const hashManifest = structuredClone(hash.manifest) as { frames: Array<RuntimeCaptureManifest["frames"][number]> } & RuntimeCaptureManifest;
    hashManifest.frames[0] = { ...hashManifest.frames[0], sha256: "b".repeat(64) };
    await expect(stitchRuntimeGrid(hash.job, hashManifest, hash.root)).rejects.toThrow("hash");
    await absent(join(hash.root, "reports", "stitch-receipt.json"));

    const dimensions = await fixture();
    const badFile = join(dimensions.root, "accepted", "r0-c0.png");
    await sharp(Buffer.alloc(749 * 750 * 3, 100), { raw: { width: 749, height: 750, channels: 3 } }).png().toFile(badFile);
    const bytes = await readFile(badFile);
    const dimensionsManifest = structuredClone(dimensions.manifest) as { frames: Array<RuntimeCaptureManifest["frames"][number]> } & RuntimeCaptureManifest;
    dimensionsManifest.frames[0] = { ...dimensionsManifest.frames[0], sha256: digest(bytes) };
    await expect(stitchRuntimeGrid(dimensions.job, dimensionsManifest, dimensions.root)).rejects.toThrow("750x750");
    await absent(join(dimensions.root, "stitched", "default-surface-5x5.png"));

    const failed = await fixture();
    const wrong = Buffer.alloc(FRAME * FRAME * 3, 255);
    const failedPath = join(failed.root, "accepted", "r0-c1.png");
    await sharp(wrong, { raw: { width: FRAME, height: FRAME, channels: 3 } }).png().toFile(failedPath);
    const failedManifest = structuredClone(failed.manifest) as { frames: Array<RuntimeCaptureManifest["frames"][number]> } & RuntimeCaptureManifest;
    failedManifest.frames[1] = { ...failedManifest.frames[1], sha256: digest(await readFile(failedPath)) };
    await expect(stitchRuntimeGrid(failed.job, failedManifest, failed.root)).rejects.toThrow("alignment error");
    await absent(join(failed.root, "reports", "stitch-receipt.json"));
  }, 120_000);

  it("rejects forged jobs and traversal or junction frame paths before output", async () => {
    const forged = await fixture();
    const badJob = { ...forged.job, spacing: 351 } as unknown as typeof forged.job;
    await expect(stitchRuntimeGrid(badJob, forged.manifest, forged.root)).rejects.toThrow("canonical job");

    const traversal = await fixture();
    const traversalManifest = structuredClone(traversal.manifest) as { frames: Array<RuntimeCaptureManifest["frames"][number]> } & RuntimeCaptureManifest;
    traversalManifest.frames[0] = { ...traversalManifest.frames[0], file: "../outside.png" };
    await expect(stitchRuntimeGrid(traversal.job, traversalManifest, traversal.root)).rejects.toThrow("non-canonical");

    const junction = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "sm-stitch-outside-"));
    cleanupRoots.push(outside);
    await rename(join(junction.root, "accepted"), join(outside, "accepted"));
    await symlink(join(outside, "accepted"), join(junction.root, "accepted"), "junction");
    await expect(stitchRuntimeGrid(junction.job, junction.manifest, junction.root)).rejects.toThrow("canonical path");
    await absent(join(junction.root, "stitched", "default-surface-5x5.png"));
  }, 120_000);
});
