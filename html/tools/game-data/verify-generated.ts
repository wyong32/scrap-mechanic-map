import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { verifyLegacyAssetManifest } from "./legacy/legacy-assets.ts";
import { legacyPoiRules } from "./legacy/original-poi-rules.ts";

export function validateRelativeGeneratedPath(file: string): void {
  const segments = file.split("/");
  if (
    !file
    || file.startsWith("/")
    || file.includes("\\")
    || file.includes(":")
    || segments.some(
      (segment) => !segment || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`Unsafe generated bundle path: ${file}`);
  }
}
async function files(root: string, current = root): Promise<string[]> { const entries = await readdir(current, { withFileTypes: true }); const result: string[] = []; for (const entry of entries) { const path = join(current, entry.name); if (entry.isDirectory()) result.push(...await files(root, path)); else if (entry.isFile() && entry.name !== ".gitkeep") { const file = relative(root, path).replace(/\\/g, "/"); validateRelativeGeneratedPath(file); result.push(file); } } return result.sort(); }
/** Byte-level provenance gate: target must be exactly the fresh bundle from game source. */
export async function assertGeneratedBundleMatches(expectedDirectory: string, targetDirectory: string): Promise<void> { const [expected, target] = await Promise.all([files(expectedDirectory), files(targetDirectory)]); if (JSON.stringify(expected) !== JSON.stringify(target)) throw new Error(`Generated bundle inventory mismatch: expected ${expected.length} files, found ${target.length}`); for (const file of expected) { validateRelativeGeneratedPath(file); const [left, right] = await Promise.all([readFile(join(expectedDirectory, file)), readFile(join(targetDirectory, file))]); if (!left.equals(right)) throw new Error(`Generated bundle byte mismatch: ${file}`); } }

/** Checks that generated legacy image metadata still describes the published original bytes. */
export async function assertLegacyAssetManifest(generatedDirectory: string, assetDirectory = join(process.cwd(), "local-assets", "legacy", "img")): Promise<void> {
  await verifyLegacyAssetManifest({ assetDirectory, manifestFile: join(generatedDirectory, "legacy-assets.json"), poiRules: legacyPoiRules });
}

async function readLegacyBridge(directory: string): Promise<unknown[]> {
  const payload = JSON.parse(
    await readFile(join(directory, "tile-catalog.json"), "utf8")
  ) as { legacyBridge?: unknown };
  if (!Array.isArray(payload.legacyBridge)) {
    throw new Error("Generated tile catalog has no legacy bridge");
  }
  return payload.legacyBridge;
}

/** Compares only the official bridge rebuilt from game source. */
export async function assertLegacyBridgeMatches(
  expectedDirectory: string,
  targetDirectory: string
): Promise<void> {
  const [expected, target] = await Promise.all([
    readLegacyBridge(expectedDirectory),
    readLegacyBridge(targetDirectory)
  ]);
  if (JSON.stringify(expected) !== JSON.stringify(target)) {
    throw new Error("Generated legacy bridge differs from current official mappings");
  }
}
