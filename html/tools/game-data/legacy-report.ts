import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LegacyAssetRecord } from "./legacy/legacy-assets.ts";
import type { LegacyBridgeEntry } from "./legacy/legacy-bridge.ts";
import {
  buildCoverageReport,
  loadGeneratedWorlds,
  loadOptionalVerifiedAtlasManifest,
  type AggregateCoverageReport
} from "./atlas/verify-atlas.ts";

export async function loadLegacyCoverageReport(
  outputDirectory: string,
  atlasDirectory: string,
  legacyManifestPath = join(process.cwd(), "local-assets", "legacy", "legacy-assets.json")
): Promise<AggregateCoverageReport> {
  const [worlds, catalog, assets] = await Promise.all([
    loadGeneratedWorlds(outputDirectory),
    readFile(join(outputDirectory, "tile-catalog.json"), "utf8").then(
      (text) => JSON.parse(text) as {
        gameVersion?: string;
        legacyBridge: LegacyBridgeEntry[];
      }
    ),
    readFile(legacyManifestPath, "utf8").then(
      (text) => JSON.parse(text) as { assets: LegacyAssetRecord[] }
    )
  ]);
  const gameVersion =
    catalog.gameVersion ?? worlds[0]?.gameVersion ?? "1.0.0";
  const atlasManifest = await loadOptionalVerifiedAtlasManifest(
    atlasDirectory,
    gameVersion
  );
  return buildCoverageReport({
    worlds,
    legacyBridge: catalog.legacyBridge,
    legacyAssets: assets.assets,
    atlasManifest
  });
}
