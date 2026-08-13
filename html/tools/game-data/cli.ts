import { inventoryGameData } from "./inventory.ts";
import { buildGameData } from "./build-data.ts";
import { assertOutputOutsideGameRoot, resolveGamePaths } from "./paths.ts";
import { join } from "node:path";
import { buildAtlas } from "./atlas/pack-atlas.ts";
import { loadGeneratedWorlds } from "./atlas/verify-atlas.ts";
import { deriveAtlasIntake } from "./atlas/intake.ts";
import {
  assertGeneratedBundleMatches,
  assertLegacyAssetManifest,
  assertLegacyBridgeMatches
} from "./verify-generated.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadLegacyCoverageReport } from "./legacy-report.ts";
import { buildOfficialTileAtlas } from "./atlas/official-tile-atlas.ts";
import { loadReferenceSurface } from "./reference-world.ts";

function readOption(name: string): string | undefined {
  const optionIndex = process.argv.indexOf(name);
  return optionIndex >= 0 ? process.argv[optionIndex + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const gameRoot = readOption("--game-root");

  if (command !== "inventory" && command !== "build" && command !== "verify" && command !== "atlas" && command !== "legacy" && command !== "official-atlas") {
    throw new Error(`Unsupported data command: ${command ?? "(missing)"}`);
  }
  if (!gameRoot) {
    throw new Error("Missing required option: --game-root <path>");
  }

  if (command === "build") {
    const referenceWorld = await loadReferenceSurface(join(process.cwd(), "tools", "game-data", "source", "reference-world.json"), "1.0.0");
    const report = await buildGameData({ gameRoot, referenceWorld });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "verify") {
    // Validate the supplied source root even though atlas verification reads only
    // sanitized generated data. This keeps the command's contract honest.
    await resolveGamePaths(gameRoot);
    const outputDirectory = readOption("--output-directory") ?? join(process.cwd(), "public", "data", "generated");
    const fresh = await mkdtemp(join(tmpdir(), "sm-map-verify-"));
    try { const referenceWorld = await loadReferenceSurface(join(process.cwd(), "tools", "game-data", "source", "reference-world.json"), "1.0.0"); await buildGameData({ gameRoot, outputDirectory: fresh, referenceWorld }); await assertGeneratedBundleMatches(fresh, outputDirectory); } finally { await rm(fresh, { recursive: true, force: true }); }
    console.log(JSON.stringify({ generatedBundle: "verified" }, null, 2));
    return;
  }

  if (command === "official-atlas") {
    const catalogPath =
      readOption("--catalog")
      ?? join(process.cwd(), "public", "data", "generated", "tile-catalog.json");
    const outputDirectory = await assertOutputOutsideGameRoot(
      gameRoot,
      readOption("--atlas-directory")
        ?? join(process.cwd(), "public", "atlas", "official")
    );
    console.log(JSON.stringify(
      await buildOfficialTileAtlas({ gameRoot, catalogPath, outputDirectory }),
      null,
      2
    ));
    return;
  }

  if (command === "legacy") {
    await resolveGamePaths(gameRoot);
    const outputDirectory =
      readOption("--output-directory")
      ?? join(process.cwd(), "public", "data", "generated");
    const atlasDirectory =
      readOption("--atlas-directory") ?? join(process.cwd(), "public", "atlas");
    const localLegacyDirectory =
      readOption("--legacy-directory") ?? join(process.cwd(), "local-assets", "legacy");
    const fresh = await mkdtemp(join(tmpdir(), "sm-map-legacy-"));
    try {
      await buildGameData({ gameRoot, outputDirectory: fresh });
      await assertLegacyBridgeMatches(fresh, outputDirectory);
      await assertLegacyAssetManifest(localLegacyDirectory);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
    console.log(JSON.stringify(
      await loadLegacyCoverageReport(outputDirectory, atlasDirectory, join(localLegacyDirectory, "legacy-assets.json")),
      null,
      2
    ));
    return;
  }

  if (command === "atlas") {
    const outputDirectory = readOption("--output-directory") ?? join(process.cwd(), "public", "data", "generated"); const inputDirectory = readOption("--input-directory");
    if (!inputDirectory) throw new Error("Missing required option: --input-directory <north-up-png-directory>");
    const atlasDirectory = await assertOutputOutsideGameRoot(gameRoot, readOption("--atlas-directory") ?? join(process.cwd(), "public", "atlas"));
    const intake = await deriveAtlasIntake(await loadGeneratedWorlds(outputDirectory), inputDirectory);
    if (intake.missing.length) { for (const name of intake.missing) console.error(`MISSING ATLAS INPUT ${name}`); throw new Error(`Cannot pack atlas: ${intake.missing.length} required render input(s) missing`); }
    const manifest = await buildAtlas(intake.cells, atlasDirectory); console.log(JSON.stringify({ outputDirectory: atlasDirectory, entries: Object.keys(manifest.entries).length, pages: Object.keys(manifest.pages).length }, null, 2)); return;
  }

  const inventory = await inventoryGameData(await resolveGamePaths(gameRoot));
  console.log(
    JSON.stringify(
      {
        tileFiles: inventory.tileFiles.length,
        worldFiles: inventory.worldFiles.length,
        luaFiles: inventory.luaFiles.length,
        requiredSources: {
          tileDatabase: inventory.luaFiles.some((file) =>
            file.relativePath.endsWith("Scripts/terrain/overworld/tile_database.lua"),
          ),
          world: inventory.worldFiles.length > 0,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
