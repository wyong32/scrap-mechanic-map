import { readFileSync, writeFileSync } from "node:fs";

import { loadGameAssetCatalog } from "./game-asset-catalog";
import { expandGamePrefabReferences } from "./game-prefab-loader";
import { createRenderableSceneManifest, placeTileCellEntities } from "./scene-manifest";
import { parseTileScene } from "./tile-v15-scene";

const [gameRoot, tilePath, outputPath] = process.argv.slice(2);
if (!gameRoot || !tilePath || !outputPath) {
  throw new Error("Usage: build-scene-cli <game-root> <tile-file> <output.json>");
}

const tile = parseTileScene(readFileSync(tilePath));
const placedAssets = placeTileCellEntities(tile.assets);
const expanded = expandGamePrefabReferences(gameRoot, placeTileCellEntities(tile.prefabs));
const manifest = createRenderableSceneManifest(
  [...placedAssets, ...expanded.assets],
  loadGameAssetCatalog(gameRoot)
);
writeFileSync(outputPath, `${JSON.stringify(manifest)}\n`);
console.log(JSON.stringify({
  outputPath,
  directAssets: tile.assets.length,
  expandedAssets: expanded.assets.length,
  renderableAssets: manifest.assets.length,
  definitions: Object.keys(manifest.definitions).length,
  skippedUuids: manifest.skippedUuids,
  harvestablesPending: tile.harvestables.length,
  prefabFiles: expanded.prefabFiles.length
}));
