import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLegacyAssetManifest, computeLegacyAssetContentHash, type LegacyAssetsPayload, verifyLegacyAssetManifest } from "./legacy-assets.ts";
import { legacyPoiRules } from "./original-poi-rules.ts";

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sm-legacy-assets-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "tiles"));
  return directory;
}

async function writeFixtureImage(directory: string, relativePath: string, content: Buffer): Promise<void> {
  const file = join(directory, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// Break caught: accepting a partial or non-image legacy tile set would silently publish a broken map.
describe("buildLegacyAssetManifest", () => {
  it("publishes exactly the original runtime's reviewed numeric JPEG whitelist", async () => {
    const root = join(process.cwd(), "local-assets", "legacy", "img");
    const manifest = await buildLegacyAssetManifest({ assetDirectory: root, poiRules: legacyPoiRules });
    const tiles = manifest.assets.filter((asset) => asset.key.startsWith("tile:"));
    const source = await readFile(
      join(process.cwd(), "assets", "js", "sm_overview_map.js"),
      "utf8"
    );
    const whitelist = /function getTileURL\(tileid,x,y\)\s*\{\s*var tiles = \[([\s\S]*?)\];/
      .exec(source)?.[1]
      ?.match(/\d+/g)
      ?.map(Number);
    if (!whitelist) {
      throw new Error("Original runtime tile whitelist was not found.");
    }
    const actualIds = tiles.map((asset) => Number(asset.key.slice(5)));

    expect(actualIds).toEqual([...whitelist].sort((left, right) => left - right));
    expect(new Set(actualIds).size).toBe(297);
    expect(actualIds).not.toContain(111502);
    expect(tiles.find((asset) => asset.key === "tile:1000001")).toMatchObject({
      url: "/legacy/img/tiles/1000001.jpg",
      width: 500,
      height: 500,
      source: "the1killer/sm_overview",
    });
    expect(manifest.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256))).toBe(true);
    expect(manifest.assets.every((asset) => asset.url.startsWith("/legacy/img/") && !/[A-Za-z]:|\\\\/.test(asset.url))).toBe(true);
  }, 30_000);

  it("rejects duplicate numeric IDs even when their source filenames differ", async () => {
    const root = await fixtureDirectory();
    await writeFixtureImage(root, "tiles/1.jpg", Buffer.from("not a jpeg"));
    await writeFixtureImage(root, "tiles/001.jpg", Buffer.from("not a jpeg"));

    await expect(buildLegacyAssetManifest({ assetDirectory: root, poiRules: [] })).rejects.toThrow(/duplicate.*tile.*1/i);
  });

  it("rejects unreadable and zero-byte images before creating records", async () => {
    const root = await fixtureDirectory();
    await writeFixtureImage(root, "tiles/1.jpg", Buffer.alloc(0));

    await expect(buildLegacyAssetManifest({ assetDirectory: root, poiRules: [] })).rejects.toThrow(/zero|empty|unreadable/i);
  });
});

// Break caught: a valid-looking JSON file whose image, hash, or rule reference is stale must not pass the portability gate.
describe("verifyLegacyAssetManifest", () => {
  it("rejects a missing tile record", async () => {
    const root = await fixtureDirectory();
    const assets = join(process.cwd(), "local-assets", "legacy", "img");
    const manifest = await buildLegacyAssetManifest({ assetDirectory: assets, poiRules: legacyPoiRules });
    const manifestFile = join(root, "legacy-assets.json");
    const tampered = rehash({ ...manifest, assets: manifest.assets.slice(1) });
    await writeFile(manifestFile, `${JSON.stringify(tampered)}\n`, "utf8");

    await expect(verifyLegacyAssetManifest({ assetDirectory: assets, manifestFile, poiRules: legacyPoiRules })).rejects.toThrow(/differs/i);
  }, 30_000);

  it.each([
    ["altered image hash", (payload: LegacyAssetsPayload) => ({ ...payload, assets: payload.assets.map((asset, index) => index === 0 ? { ...asset, sha256: "0".repeat(64) } : asset) })],
    ["wrong dimensions", (payload: LegacyAssetsPayload) => ({ ...payload, assets: payload.assets.map((asset, index) => index === 0 ? { ...asset, width: asset.width + 1 } : asset) })],
    ["duplicate key", (payload: LegacyAssetsPayload) => ({ ...payload, assets: [...payload.assets, { ...payload.assets[0]! }] })],
    ["unsafe asset URL", (payload: LegacyAssetsPayload) => ({ ...payload, assets: payload.assets.map((asset, index) => index === 0 ? { ...asset, url: "/legacy/img/../outside.jpg" } : asset) })],
  ])("rejects %s", async (_name, mutate) => {
    const root = await fixtureDirectory();
    const assets = join(process.cwd(), "local-assets", "legacy", "img");
    const manifest = await buildLegacyAssetManifest({ assetDirectory: assets, poiRules: legacyPoiRules });
    const manifestFile = join(root, "legacy-assets.json");
    await writeFile(manifestFile, `${JSON.stringify(rehash(mutate(manifest)))}\n`, "utf8");

    await expect(verifyLegacyAssetManifest({ assetDirectory: assets, manifestFile, poiRules: legacyPoiRules })).rejects.toThrow(/differs|duplicate|unsafe/i);
  }, 30_000);

  it("rejects CRLF JSON and POI rules with absent images", async () => {
    const root = await fixtureDirectory();
    const assets = join(process.cwd(), "local-assets", "legacy", "img");
    const manifest = await buildLegacyAssetManifest({ assetDirectory: assets, poiRules: legacyPoiRules });
    const manifestFile = join(root, "legacy-assets.json");
    await writeFile(manifestFile, `${JSON.stringify(manifest)}\r\n`, "utf8");

    await expect(verifyLegacyAssetManifest({ assetDirectory: assets, manifestFile, poiRules: legacyPoiRules })).rejects.toThrow(/CRLF/i);
    await writeFile(manifestFile, `${JSON.stringify(manifest)}\n`, "utf8");
    await expect(verifyLegacyAssetManifest({ assetDirectory: assets, manifestFile, poiRules: [{ kind: "multi-cell-poi", poiType: "POI_TEST", imageKey: "poi:missing.jpg", sizeCells: 2 }] })).rejects.toThrow(/absent/i);
  }, 30_000);
});

function rehash(payload: LegacyAssetsPayload): LegacyAssetsPayload {
  const result = structuredClone(payload);
  result.contentHash = computeLegacyAssetContentHash(result as unknown as Record<string, unknown>);
  return result;
}
