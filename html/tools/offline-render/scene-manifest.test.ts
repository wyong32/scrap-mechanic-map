import { describe, expect, it } from "vitest";

import type { GameAssetDefinition } from "./game-asset-catalog";
import { createRenderableSceneManifest, placeTileCellEntities } from "./scene-manifest";

describe("createRenderableSceneManifest", () => {
  it("converts cell-local coordinates to tile coordinates", () => {
    expect(placeTileCellEntities([
      { cellX: 0, cellY: 0, position: [1, 2, 3] as [number, number, number] },
      { cellX: 2, cellY: 3, position: [1, 2, 3] as [number, number, number] }
    ])).toEqual([
      { cellX: 0, cellY: 0, position: [1, 2, 3] },
      { cellX: 2, cellY: 3, position: [129, 194, 3] }
    ]);
  });

  it("keeps authentic instances and reports UUIDs without visible renderables", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const invisible = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const definition: GameAssetDefinition = {
      uuid,
      name: "Official asset",
      renderablePath: null,
      meshPath: "official.fbx",
      materials: []
    };
    const catalog = new Map([[uuid, definition]]);

    expect(createRenderableSceneManifest([
      { uuid, position: [1, 2, 3], rotation: [0, 0, 0, 1], size: [1, 1, 1], materialColors: {} },
      { uuid: invisible, position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [1, 1, 1], materialColors: {} }
    ], catalog)).toEqual({
      assets: [{ uuid, position: [1, 2, 3], rotation: [0, 0, 0, 1], size: [1, 1, 1], materialColors: {} }],
      definitions: { [uuid]: definition },
      skippedUuids: [invisible]
    });
  });
});
