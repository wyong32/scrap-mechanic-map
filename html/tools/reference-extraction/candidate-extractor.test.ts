import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { WorldMap } from "../../src/domain/map-model.ts";
import type { ReferenceExtractionInputs } from "./reference-extraction-types.ts";
import {
  decodeCandidateSource,
  extractCandidates,
  type CandidateExtractionInput,
} from "./candidate-extractor.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function fixtureWorld(): WorldMap {
  return {
    id: "fixture",
    source: "reference",
    gameVersion: "1",
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    cells: [{
      x: 0,
      y: 0,
      uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      rotation: 2,
      xOffset: 0,
      yOffset: 0,
      flags: 0,
      terrainType: "fixture",
    }],
    locations: [],
    connections: [],
  };
}

async function fixture(orientation: CandidateExtractionInput["orientation"]) {
  const root = await mkdtemp(join(tmpdir(), "candidate-extractor-"));
  directories.push(root);
  const sourceImagePath = join(root, "source.png");
  const trustedLocalRoot = join(root, "local-assets", "reference-extraction");
  const outputRoot = join(trustedLocalRoot, "candidates");
  await mkdir(outputRoot, { recursive: true });
  const rgb = Buffer.from([
    10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52,
    60, 61, 62, 70, 71, 72, 80, 81, 82, 90, 91, 92, 100, 101, 102,
  ]);
  await sharp(rgb, { raw: { width: 5, height: 2, channels: 3 } }).png().toFile(sourceImagePath);
  const sourceBytes = await readFile(sourceImagePath);
  const referenceWorld = fixtureWorld();
  const base = {
    source: {
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      width: 5,
      height: 2,
      bounds: referenceWorld.bounds,
    },
    referenceWorld,
    defaultWorld: referenceWorld,
    targetWorld: referenceWorld,
    targetSaveSha256: "1".repeat(64),
    catalog: { gameVersion: "1", tiles: {}, legacyBridge: [] },
    uuidIntersection: { shared: [], referenceOnly: [], targetOnly: [] },
  } satisfies ReferenceExtractionInputs;
  return {
    input: { inputs: base, sourceImagePath, orientation, trustedLocalRoot, maximumFootprintSpan: 16 },
    outputRoot,
    root,
    rgb,
  };
}

describe("extractCandidates", () => {
  it.each([
    ["x-right-y-down", { left: 0, top: 0, right: 2, bottom: 1 }, [10, 11, 12, 20, 21, 22]],
    ["x-left-y-down", { left: 3, top: 0, right: 5, bottom: 1 }, [40, 41, 42, 50, 51, 52]],
    ["x-right-y-up", { left: 0, top: 1, right: 2, bottom: 2 }, [60, 61, 62, 70, 71, 72]],
    ["x-left-y-up", { left: 3, top: 1, right: 5, bottom: 2 }, [90, 91, 92, 100, 101, 102]],
  ] as const)("crops exact fractional edges for %s", async (orientation, edges, pixels) => {
    // Break caught: a crop uses rounded width or inferred axes instead of absolute transform edges.
    const { input, outputRoot } = await fixture(orientation);

    const [candidate] = await extractCandidates(input, outputRoot);

    expect(candidate).toMatchObject({
      uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      rotation: 2,
      offset: { x: 0, y: 0 },
      footprint: { width: 1, height: 1 },
      world: { x: 0, y: 0 },
      pixelEdges: edges,
      width: 2,
      height: 1,
      localFilename: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/r2-ox+0-oy+0-span1x1-x+0-y+0-${orientation}.png`,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const savedBytes = await readFile(join(outputRoot, candidate!.localFilename));
    expect(createHash("sha256").update(savedBytes).digest("hex")).toBe(candidate!.sha256);
    const saved = await sharp(savedBytes)
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...saved]).toEqual(pixels);
  });

  it("preserves distinct offsets and the observed footprint in candidate provenance", async () => {
    // Break caught: cells from different pieces of one multi-cell asset collapse to one UUID/rotation identity.
    const fixtureData = await fixture("x-right-y-down");
    fixtureData.input.inputs.defaultWorld.cells.push({
      ...fixtureData.input.inputs.defaultWorld.cells[0]!,
      x: 1,
      xOffset: 1,
    });
    fixtureData.input.inputs.referenceWorld.cells = fixtureData.input.inputs.defaultWorld.cells;

    const candidates = await extractCandidates(fixtureData.input, fixtureData.outputRoot);

    expect(candidates.map(({ offset, footprint, localFilename }) => ({ offset, footprint, localFilename }))).toEqual([
      {
        offset: { x: 0, y: 0 },
        footprint: { width: 2, height: 1 },
        localFilename: expect.stringContaining("r2-ox+0-oy+0-span2x1-"),
      },
      {
        offset: { x: 1, y: 0 },
        footprint: { width: 2, height: 1 },
        localFilename: expect.stringContaining("r2-ox+1-oy+0-span2x1-"),
      },
    ]);
  });

  it("decodes the source once and emits byte-equivalent deterministic crops for every candidate", async () => {
    // Break caught: the full source image is decoded once per crop instead of once per extraction run.
    const fixtureData = await fixture("x-right-y-down");
    const original = fixtureData.input.inputs.defaultWorld.cells[0]!;
    fixtureData.input.inputs.defaultWorld.cells = [
      original,
      { ...original, x: 1 },
      { ...original, x: 2 },
    ];
    fixtureData.input.inputs.referenceWorld.cells = fixtureData.input.inputs.defaultWorld.cells;
    let decodes = 0;
    const decodeSource = async (bytes: Uint8Array) => {
      decodes += 1;
      const decoded = await decodeCandidateSource(bytes);
      expect(decoded.channels).toBe(4);
      return decoded;
    };

    const first = await extractCandidates(fixtureData.input, fixtureData.outputRoot, { decodeSource });
    const firstBytes = await Promise.all(first.map((candidate) =>
      readFile(join(fixtureData.outputRoot, candidate.localFilename)),
    ));
    expect(decodes).toBe(1);

    for (let index = 0; index < first.length; index += 1) {
      const candidate = first[index]!;
      const edges = candidate.pixelEdges;
      const expected = await sharp(fixtureData.input.sourceImagePath)
        .extract({
          left: edges.left,
          top: edges.top,
          width: edges.right - edges.left,
          height: edges.bottom - edges.top,
        })
        .removeAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer();
      expect(Buffer.from(candidate.pixels)).toEqual(expected);
      expect(createHash("sha256").update(firstBytes[index]!).digest("hex"))
        .toBe(candidate.sha256);
    }

    const second = await extractCandidates(fixtureData.input, fixtureData.outputRoot, { decodeSource });
    const secondBytes = await Promise.all(second.map((candidate) =>
      readFile(join(fixtureData.outputRoot, candidate.localFilename)),
    ));
    expect(decodes).toBe(2);
    expect(second.map(({ sha256 }) => sha256)).toEqual(first.map(({ sha256 }) => sha256));
    expect(secondBytes).toEqual(firstBytes);
  });

  it("fails closed when an observed offset exceeds the caller-supported footprint span", async () => {
    // Break caught: corrupt or unsupported multi-cell offsets are used to emit misleading crop provenance.
    const fixtureData = await fixture("x-right-y-down");
    fixtureData.input.inputs.referenceWorld.cells[0]!.xOffset = 16;

    await expect(extractCandidates(fixtureData.input, fixtureData.outputRoot))
      .rejects.toThrow("footprint");
  });

  it("rejects a same-sized source that does not match validated provenance", async () => {
    // Break caught: a substituted image with the expected dimensions silently produces trusted crops.
    const { input, outputRoot } = await fixture("x-right-y-down");
    input.inputs.source.sha256 = "0".repeat(64);

    await expect(extractCandidates(input, outputRoot)).rejects.toThrow("hash");
  });

  it("refuses an output root reached through a junction", async () => {
    // Break caught: canonical containment is bypassed by an output-root junction.
    const fixtureData = await fixture("x-right-y-down");
    const outside = await mkdtemp(join(tmpdir(), "candidate-outside-"));
    directories.push(outside);
    const alias = join(fixtureData.outputRoot, "linked");
    await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");

    await expect(extractCandidates(fixtureData.input, alias)).rejects.toThrow("canonical local output root");
  });

  it("refuses a junction inside an otherwise canonical output root", async () => {
    // Break caught: a UUID directory junction redirects individual crop writes outside the root.
    const fixtureData = await fixture("x-right-y-down");
    const outside = await mkdtemp(join(tmpdir(), "candidate-outside-"));
    directories.push(outside);
    await symlink(
      outside,
      join(fixtureData.outputRoot, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(extractCandidates(fixtureData.input, fixtureData.outputRoot))
      .rejects.toThrow("canonical local output root");
  });

  it("anchors output below the exact injected trusted local root", async () => {
    // Break caught: any path segment named local-assets is mistaken for authorization.
    const fixtureData = await fixture("x-right-y-down");
    const untrustedSibling = join(fixtureData.root, "local-assets", "candidates");
    const publicRoot = join(fixtureData.root, "public", "local-assets", "candidates");
    await Promise.all([
      mkdir(untrustedSibling, { recursive: true }),
      mkdir(publicRoot, { recursive: true }),
    ]);

    await expect(extractCandidates(fixtureData.input, untrustedSibling)).rejects.toThrow("trusted local root");
    await expect(extractCandidates(fixtureData.input, publicRoot)).rejects.toThrow("trusted local root");
  });
});
