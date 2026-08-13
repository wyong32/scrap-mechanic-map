import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  assertGeneratedBundleMatches,
  assertLegacyAssetManifest,
  assertLegacyBridgeMatches,
  validateRelativeGeneratedPath
} from "./verify-generated.ts";
import { buildLegacyAssetManifest } from "./legacy/legacy-assets.ts";
import { legacyPoiRules } from "./legacy/original-poi-rules.ts";
import { computeBundleContentHash } from "./build-data.ts";
async function pair() { const root = await mkdtemp(join(tmpdir(), "sm-bundle-")); const a = join(root, "a"), b = join(root, "b"); await Promise.all([mkdir(join(a, "worlds"), { recursive: true }), mkdir(join(b, "worlds"), { recursive: true })]); await Promise.all([writeFile(join(a, "build-info.json"), "same"), writeFile(join(b, "build-info.json"), "same"), writeFile(join(a, "worlds", "one.json"), "world"), writeFile(join(b, "worlds", "one.json"), "world")]); return { a, b }; }
it("accepts exact bundles and rejects missing, changed, and extra payloads", async () => { const { a, b } = await pair(); await expect(assertGeneratedBundleMatches(a, b)).resolves.toBeUndefined(); await writeFile(join(b, "worlds", "one.json"), "changed"); await expect(assertGeneratedBundleMatches(a, b)).rejects.toThrow("byte mismatch"); await writeFile(join(b, "worlds", "one.json"), "world"); await import("node:fs/promises").then(({ rm }) => rm(join(b, "worlds", "one.json"))); await expect(assertGeneratedBundleMatches(a, b)).rejects.toThrow("inventory mismatch"); await writeFile(join(b, "worlds", "one.json"), "world"); await writeFile(join(b, "extra.json"), "x"); await expect(assertGeneratedBundleMatches(a, b)).rejects.toThrow("inventory mismatch"); });
it("rejects traversal and absolute generated relative paths", () => { expect(() => validateRelativeGeneratedPath("../evil.json")).toThrow("Unsafe"); expect(() => validateRelativeGeneratedPath("/evil.json")).toThrow("Unsafe"); });
it("keeps canonical reference-world provenance, hash, portable bytes, and manifest entry consistent after CRLF checkout", async () => {
  const generatedDirectory = join(process.cwd(), "public", "data", "generated");
  const referenceText = await readFile(join(generatedDirectory, "reference-world.json"), "utf8");
  const checkoutText = referenceText.replace(/\r?\n/g, "\r\n");
  const portableText = checkoutText.replace(/\r\n/g, "\n");
  const reference = JSON.parse(checkoutText) as Record<string, unknown> & {
    contentHash: string;
    generatedFrom: string[];
  };
  const buildInfo = JSON.parse(
    await readFile(join(generatedDirectory, "build-info.json"), "utf8")
  ) as Record<string, unknown> & {
    contentHash: string;
    files: Array<{ bytes: number; contentHash: string; name: string }>;
  };

  expect(reference.generatedFrom).toEqual([
    "html/tools/game-data/source/reference-world.json"
  ]);
  expect(reference.contentHash).toBe(computeBundleContentHash(reference));
  expect(buildInfo.files.find(({ name }) => name === "reference-world.json")).toEqual({
    bytes: new TextEncoder().encode(portableText).byteLength,
    contentHash: reference.contentHash,
    name: "reference-world.json"
  });
  expect(buildInfo.contentHash).toBe(computeBundleContentHash(buildInfo));
});
it("verifies the generated legacy image manifest against the local original bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sm-legacy-verify-"));
  const assets = join(process.cwd(), "local-assets", "legacy", "img");
  const manifest = await buildLegacyAssetManifest({ assetDirectory: assets, poiRules: legacyPoiRules });
  await writeFile(join(root, "legacy-assets.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  await expect(assertLegacyAssetManifest(root, assets)).resolves.toBeUndefined();
  await writeFile(join(root, "legacy-assets.json"), `${JSON.stringify({ ...manifest, contentHash: "0".repeat(64) })}\n`, "utf8");
  await expect(assertLegacyAssetManifest(root, assets)).rejects.toThrow(/hash/i);
}, 30_000);

it("compares the rebuilt official bridge without gating unrelated generated data", async () => {
  const root = await mkdtemp(join(tmpdir(), "sm-legacy-bridge-"));
  const expected = join(root, "expected");
  const target = join(root, "target");
  await Promise.all([mkdir(expected), mkdir(target)]);
  const bridge = [{
    legacyId: 101,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    tilePath: "Survival/Terrain/Tiles/one.tile",
    status: "active",
    evidence: "fixture.lua:AddTile"
  }];
  await Promise.all([
    writeFile(
      join(expected, "tile-catalog.json"),
      JSON.stringify({ tiles: ["rebuilt"], legacyBridge: bridge })
    ),
    writeFile(
      join(target, "tile-catalog.json"),
      JSON.stringify({ tiles: ["committed"], legacyBridge: bridge })
    )
  ]);

  await expect(assertLegacyBridgeMatches(expected, target)).resolves.toBeUndefined();

  await writeFile(
    join(target, "tile-catalog.json"),
    JSON.stringify({ legacyBridge: [{ ...bridge[0], legacyId: 102 }] })
  );
  await expect(assertLegacyBridgeMatches(expected, target)).rejects.toThrow(
    /legacy bridge/i
  );
});
