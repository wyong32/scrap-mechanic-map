import { describe, expect, it } from "vitest";

import type { PrefabScene } from "./prefab-v13-reader";
import { expandPrefabReferences } from "./prefab-expander";

const identity: [number, number, number, number] = [0, 0, 0, 1];

describe("expandPrefabReferences", () => {
  it("applies the parent prefab transform to contained assets", () => {
    const scene: PrefabScene = {
      assets: [{
        position: [1, 0, 0],
        rotation: identity,
        size: [1, 2, 3],
        uuid: "11111111-2222-3333-4444-555555555555",
        materialColors: {},
        flags: 0
      }],
      prefabs: []
    };

    const assets = expandPrefabReferences([{
      path: "root.prefab",
      position: [10, 20, 0],
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      size: [2, 2, 2],
      flag: ""
    }], () => scene);

    expect(assets[0]).toEqual(expect.objectContaining({
      position: [10, 22, 0],
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      size: [2, 4, 6]
    }));
  });

  it("recursively expands nested prefab references", () => {
    const scenes: Record<string, PrefabScene> = {
      "root.prefab": {
        assets: [],
        prefabs: [{ path: "child.prefab", position: [3, 0, 0], rotation: identity, size: [1, 1, 1], flag: "" }]
      },
      "child.prefab": {
        assets: [{
          position: [2, 0, 0], rotation: identity, size: [1, 1, 1],
          uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", materialColors: {}, flags: 0
        }],
        prefabs: []
      }
    };

    const assets = expandPrefabReferences([{
      path: "root.prefab", position: [10, 0, 0], rotation: identity, size: [2, 2, 2], flag: ""
    }], (path) => scenes[path]);

    expect(assets).toEqual([
      expect.objectContaining({ uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", position: [20, 0, 0], size: [2, 2, 2] })
    ]);
  });
});
