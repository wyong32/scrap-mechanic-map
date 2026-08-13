import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadGameAssetCatalog } from "./game-asset-catalog";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loadGameAssetCatalog", () => {
  it("resolves an asset UUID through assetset and rend files", () => {
    const root = mkdtempSync(join(tmpdir(), "sm-assets-"));
    temporaryRoots.push(root);
    const database = join(root, "Data", "Terrain", "Database");
    const sets = join(database, "AssetSets");
    const renderable = join(root, "Data", "Terrain", "Renderable");
    mkdirSync(sets, { recursive: true });
    mkdirSync(renderable, { recursive: true });
    writeFileSync(join(database, "assetsets.json"), JSON.stringify({
      assetSetList: [{ assetSet: "$GAME_DATA/Terrain/Database/AssetSets/test.assetset" }]
    }));
    writeFileSync(join(sets, "test.assetset"), JSON.stringify({
      assetListRenderable: [
        {
          uuid: "11111111-2222-3333-4444-555555555555",
          name: "test_asset",
          renderable: "$GAME_DATA/Terrain/Renderable/test.rend"
        },
        {
          uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          name: "inline_asset",
          renderable: {
            lodList: [{
              mesh: "$GAME_DATA/Terrain/Mesh/inline.fbx",
              subMeshMap: {
                body: { material: "Dif", textureList: ["$GAME_DATA/Terrain/Textures/inline_dif.tga"] }
              }
            }]
          }
        }
      ]
    }));
    writeFileSync(join(renderable, "test.rend"), `// official files may contain comments\n${JSON.stringify({
      lodList: [{
        mesh: "$GAME_DATA/Terrain/Mesh/test.fbx",
        subMeshList: [{ material: "Bush", textureList: ["$GAME_DATA/Terrain/Textures/test_dif.tga"] }]
      }]
    })}`);

    expect(loadGameAssetCatalog(root).get("11111111-2222-3333-4444-555555555555")).toEqual({
      uuid: "11111111-2222-3333-4444-555555555555",
      name: "test_asset",
      renderablePath: join(renderable, "test.rend"),
      meshPath: join(root, "Data", "Terrain", "Mesh", "test.fbx"),
      materials: [{
        name: "Bush",
        texturePaths: [join(root, "Data", "Terrain", "Textures", "test_dif.tga")]
      }]
    });
    expect(loadGameAssetCatalog(root).get("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toEqual({
      uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      name: "inline_asset",
      renderablePath: null,
      meshPath: join(root, "Data", "Terrain", "Mesh", "inline.fbx"),
      materials: [{
        name: "Dif",
        texturePaths: [join(root, "Data", "Terrain", "Textures", "inline_dif.tga")]
      }]
    });
  });
});
