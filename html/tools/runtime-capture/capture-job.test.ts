import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeCaptureJob,
  serializeRuntimeCaptureJob,
} from "./capture-job.ts";

const SAVE_HASH = "a".repeat(64);

describe("buildRuntimeCaptureJob", () => {
  it("builds the exact north-up 5-by-5 row-major capture grid", () => {
    // Break caught: a coordinate, traversal order, or fixed camera contract changes.
    const job = buildRuntimeCaptureJob(SAVE_HASH);

    expect(job.points).toHaveLength(25);
    expect(job.points[0]).toMatchObject({
      id: "r0-c0",
      row: 0,
      column: 0,
      x: -3164,
      y: 1948,
      z: 250,
    });
    expect(job.points[12]).toMatchObject({
      id: "r2-c2",
      row: 2,
      column: 2,
      x: -2464,
      y: 1248,
      z: 250,
    });
    expect(job.points[24]).toMatchObject({
      id: "r4-c4",
      row: 4,
      column: 4,
      x: -1764,
      y: 548,
      z: 250,
    });
    expect(job.points.map(({ id }) => id)).toEqual([
      "r0-c0", "r0-c1", "r0-c2", "r0-c3", "r0-c4",
      "r1-c0", "r1-c1", "r1-c2", "r1-c3", "r1-c4",
      "r2-c0", "r2-c1", "r2-c2", "r2-c3", "r2-c4",
      "r3-c0", "r3-c1", "r3-c2", "r3-c3", "r3-c4",
      "r4-c0", "r4-c1", "r4-c2", "r4-c3", "r4-c4",
    ]);
    expect(job.camera).toEqual({
      direction: [0, 0, -1],
      northUp: true,
      fov: 90,
      window: { width: 1920, height: 1080 },
      crop: { left: 585, top: 165, width: 750, height: 750 },
    });
  });

  it("records the complete fixed validation and stitch contract", () => {
    // Break caught: later capture/validation stages receive a subtly incompatible job.
    expect(buildRuntimeCaptureJob(SAVE_HASH)).toMatchObject({
      schemaVersion: 1,
      gameVersion: "1.0.0",
      executableVersion: "1.0.1.869",
      sourceSaveSha256: SAVE_HASH,
      centerCell: { x: -39, y: 19, cellSize: 64 },
      spacing: 350,
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
    });
  });

  it("serializes canonically and derives a deterministic self hash", () => {
    // Break caught: insertion order, whitespace, or the self hash becomes nondeterministic.
    const first = buildRuntimeCaptureJob(SAVE_HASH);
    const second = buildRuntimeCaptureJob(SAVE_HASH);
    const text = serializeRuntimeCaptureJob(first);

    expect(first).toEqual(second);
    expect(first.contentHash).toBe(
      "cf0fdd62e7656ba468d860a38500dc3aa5defef7b874c513d2e7d9930d5d64c7",
    );
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toBe(serializeRuntimeCaptureJob(second));
    expect(Object.keys(JSON.parse(text))).toEqual([
      "camera",
      "centerCell",
      "contentHash",
      "executableVersion",
      "gameVersion",
      "points",
      "schemaVersion",
      "sourceSaveSha256",
      "spacing",
      "stitch",
      "validation",
    ]);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const { contentHash: _contentHash, ...unsigned } = parsed;
    expect(createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"))
      .toBe(first.contentHash);
  });

  it("rejects a non-canonical source save hash", () => {
    // Break caught: private path-like or malformed source identity enters a portable job.
    expect(() => buildRuntimeCaptureJob("A".repeat(64))).toThrow(
      "Source save SHA-256 must be 64 lowercase hexadecimal characters.",
    );
    expect(() => buildRuntimeCaptureJob("not-a-hash")).toThrow(
      "Source save SHA-256 must be 64 lowercase hexadecimal characters.",
    );
  });
});
