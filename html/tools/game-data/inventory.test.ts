import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inventoryGameData } from "./inventory.ts";
import { assertOutputOutsideGameRoot, resolveGamePaths } from "./paths.ts";

const temporaryRoots: string[] = [];

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sm-game-data-"));
  temporaryRoots.push(root);

  const files = [
    ["Survival/Scripts/terrain/overworld/tile_database.lua", "return { tiles = {} }\n"],
    ["Survival/Terrain/Worlds/GrowLab1.world", '{"world":"grow-lab-1"}\n'],
    ["Survival/Terrain/Tiles/surface.tile", "surface-tile\n"],
  ] as const;

  await Promise.all(
    files.map(async ([relativePath, contents]) => {
      const filePath = join(root, ...relativePath.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }),
  );

  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("game data inventory", () => {
  it("discovers supported source paths and inventories only normalized relative paths", async () => {
    const root = await makeFixture();
    const paths = await resolveGamePaths(root);
    const inventory = await inventoryGameData(paths);

    expect(paths.gameRoot).toBe(root);
    expect(inventory.tileFiles).toEqual([
      expect.objectContaining({
        relativePath: "Survival/Terrain/Tiles/surface.tile",
        bytes: Buffer.byteLength("surface-tile\n"),
      }),
    ]);
    expect(inventory.worldFiles).toEqual([
      expect.objectContaining({ relativePath: "Survival/Terrain/Worlds/GrowLab1.world" }),
    ]);
    expect(inventory.luaFiles).toEqual([
      expect.objectContaining({
        relativePath: "Survival/Scripts/terrain/overworld/tile_database.lua",
      }),
    ]);
    expect(inventory.tileFiles[0]?.sha256).toBe(
      "3256c18bde2eea209b9a28f3177553eb01a6fbac5fc791b6b5f28c6b204e4f61",
    );
    const { gameRoot: _runtimeOnlyGameRoot, ...portableInventory } = inventory;
    expect(JSON.stringify(portableInventory)).not.toContain(root);
  });

  it("fails with a clear error when the game installation lacks Survival", async () => {
    const root = await mkdtemp(join(tmpdir(), "sm-game-data-missing-"));
    temporaryRoots.push(root);

    await expect(resolveGamePaths(root)).rejects.toThrow(/Survival directory/i);
  });

  it("rejects an output directory that is the game root or a descendant", async () => {
    const root = await makeFixture();

    await expect(assertOutputOutsideGameRoot(root, root)).rejects.toThrow(/outside the game root/i);
    await expect(assertOutputOutsideGameRoot(root, join(root, "generated"))).rejects.toThrow(
      /outside the game root/i,
    );
  });

  it("rejects a symlink or junction alias into the game root", async () => {
    const root = await makeFixture();
    const alias = `${root}-alias`;
    temporaryRoots.push(alias);
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");

    await expect(assertOutputOutsideGameRoot(root, join(alias, "generated"))).rejects.toThrow(
      /outside the game root/i,
    );
  });

  it("allows an output sibling outside the canonical game root", async () => {
    const root = await makeFixture();
    const sibling = `${root}-generated`;

    await expect(assertOutputOutsideGameRoot(root, sibling)).resolves.toBe(sibling);
  });
});
