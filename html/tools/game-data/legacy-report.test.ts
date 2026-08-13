import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import type { WorldMap } from "../../src/domain/map-model.ts";
import { atlasKey } from "./atlas/atlas-manifest.ts";
import { buildAtlas } from "./atlas/pack-atlas.ts";
import { loadLegacyCoverageReport } from "./legacy-report.ts";

const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const world: WorldMap = {
  id: "fixture",
  source: "fixed-region",
  gameVersion: "1.0.0",
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  cells: [{
    x: 0,
    y: 0,
    uuid,
    xOffset: 11,
    yOffset: 22,
    rotation: 3,
    flags: 0,
    terrainType: "fixture"
  }],
  locations: [],
  connections: []
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key])
        ])
    );
  }
  return value;
}

function generated<T extends Record<string, unknown>>(payload: T) {
  const result = { ...payload, contentHash: "" };
  const { contentHash: _contentHash, ...unsigned } = result;
  result.contentHash = createHash("sha256")
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest("hex");
  return result;
}

async function fixture(): Promise<{
  outputDirectory: string;
  atlasDirectory: string;
  imagePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "sm-legacy-report-"));
  const outputDirectory = join(root, "generated");
  const atlasDirectory = join(root, "atlas");
  await Promise.all([
    mkdir(join(outputDirectory, "worlds"), { recursive: true }),
    mkdir(atlasDirectory, { recursive: true })
  ]);
  const worldDocument = generated({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: ["fixture"],
    world
  });
  const worldText = `${JSON.stringify(worldDocument)}\n`;
  const buildDocument = generated({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: ["fixture"],
    files: [{
      name: "worlds/fixture.json",
      contentHash: worldDocument.contentHash,
      bytes: Buffer.byteLength(worldText)
    }]
  });
  await Promise.all([
    writeFile(
      join(outputDirectory, "build-info.json"),
      `${JSON.stringify(buildDocument)}\n`
    ),
    writeFile(
      join(outputDirectory, "worlds", "fixture.json"),
      worldText
    ),
    writeFile(
      join(outputDirectory, "tile-catalog.json"),
      JSON.stringify({ legacyBridge: [] })
    ),
    writeFile(
      join(outputDirectory, "legacy-assets.json"),
      JSON.stringify({ assets: [] })
    )
  ]);
  const imagePath = join(root, "cell.png");
  await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: "green"
    }
  }).png().toFile(imagePath);
  return { outputDirectory, atlasDirectory, imagePath };
}

it("reports zero optional 1.0 renders when no committed atlas manifest exists", async () => {
  const { outputDirectory, atlasDirectory } = await fixture();

  await expect(
    loadLegacyCoverageReport(outputDirectory, atlasDirectory)
  ).resolves.toMatchObject({
    oneDotZeroRenderedUuids: 0,
    fallbackUuids: 1
  });
});

it("strictly verifies an optional atlas and reports only its real cell key", async () => {
  const { outputDirectory, atlasDirectory, imagePath } = await fixture();
  await buildAtlas([{
    key: atlasKey(uuid, 11, 22, 3),
    imagePath,
    logicalSize: 2,
    sourceHash: "fixture"
  }], atlasDirectory);

  await expect(
    loadLegacyCoverageReport(outputDirectory, atlasDirectory)
  ).resolves.toMatchObject({
    oneDotZeroRenderedUuids: 1,
    fallbackUuids: 0
  });
});

it("fails closed when an optional atlas manifest or page is corrupt or missing", async () => {
  const tampered = await fixture();
  const tamperedManifest = await buildAtlas([{
    key: atlasKey(uuid, 11, 22, 3),
    imagePath: tampered.imagePath,
    logicalSize: 2,
    sourceHash: "fixture"
  }], tampered.atlasDirectory);
  await writeFile(
    join(tampered.atlasDirectory, "terrain-cell-atlas.json"),
    JSON.stringify({ ...tamperedManifest, pageSize: 2048 })
  );
  await expect(
    loadLegacyCoverageReport(tampered.outputDirectory, tampered.atlasDirectory)
  ).rejects.toThrow(/contentHash/i);

  const corrupt = await fixture();
  const corruptManifest = await buildAtlas([{
    key: atlasKey(uuid, 11, 22, 3),
    imagePath: corrupt.imagePath,
    logicalSize: 2,
    sourceHash: "fixture"
  }], corrupt.atlasDirectory);
  const corruptPage = Object.keys(corruptManifest.pages)[0]!;
  await writeFile(join(corrupt.atlasDirectory, corruptPage), "corrupt");
  await expect(
    loadLegacyCoverageReport(corrupt.outputDirectory, corrupt.atlasDirectory)
  ).rejects.toThrow();

  const missing = await fixture();
  const missingManifest = await buildAtlas([{
    key: atlasKey(uuid, 11, 22, 3),
    imagePath: missing.imagePath,
    logicalSize: 2,
    sourceHash: "fixture"
  }], missing.atlasDirectory);
  const missingPage = Object.keys(missingManifest.pages)[0]!;
  await rm(join(missing.atlasDirectory, missingPage));
  await expect(
    loadLegacyCoverageReport(missing.outputDirectory, missing.atlasDirectory)
  ).rejects.toThrow();
});
