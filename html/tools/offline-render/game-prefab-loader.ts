import { readFileSync } from "node:fs";

import { resolveGamePath } from "./game-asset-catalog";
import { expandPrefabReferences } from "./prefab-expander";
import { parsePrefabScene, type PrefabAssetInstance, type PrefabReference, type PrefabScene } from "./prefab-v13-reader";

export interface ExpandedGamePrefabs {
  assets: PrefabAssetInstance[];
  prefabFiles: string[];
}

export function expandGamePrefabReferences(
  gameRoot: string,
  references: readonly PrefabReference[]
): ExpandedGamePrefabs {
  const scenes = new Map<string, PrefabScene>();
  const prefabFiles: string[] = [];
  const loadScene = (tokenizedPath: string): PrefabScene => {
    const path = resolveGamePath(gameRoot, tokenizedPath);
    const cached = scenes.get(path);
    if (cached) return cached;
    const scene = parsePrefabScene(readFileSync(path));
    scenes.set(path, scene);
    prefabFiles.push(path);
    return scene;
  };
  return {
    assets: expandPrefabReferences(references, loadScene),
    prefabFiles
  };
}
