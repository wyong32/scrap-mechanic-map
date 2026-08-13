import type { GameAssetDefinition } from "./game-asset-catalog";

export interface SceneAssetInput {
  uuid: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  size: [number, number, number];
  materialColors: Record<string, string>;
}

export interface RenderableSceneManifest {
  assets: SceneAssetInput[];
  definitions: Record<string, GameAssetDefinition>;
  skippedUuids: string[];
}

export function placeTileCellEntities<T extends {
  cellX: number;
  cellY: number;
  position: [number, number, number];
}>(inputs: readonly T[]): T[] {
  return inputs.map((input) => ({
    ...input,
    position: [
      input.position[0] + input.cellX * 64,
      input.position[1] + input.cellY * 64,
      input.position[2]
    ]
  }));
}

export function createRenderableSceneManifest(
  inputs: readonly SceneAssetInput[],
  catalog: ReadonlyMap<string, GameAssetDefinition>
): RenderableSceneManifest {
  const assets: SceneAssetInput[] = [];
  const definitions: Record<string, GameAssetDefinition> = {};
  const skipped = new Set<string>();
  for (const input of inputs) {
    const uuid = input.uuid.toLowerCase();
    const definition = catalog.get(uuid);
    if (!definition) {
      skipped.add(uuid);
      continue;
    }
    assets.push({ ...input, uuid });
    definitions[uuid] = definition;
  }
  return { assets, definitions, skippedUuids: [...skipped].sort() };
}
