import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { GameInventory, GamePaths, InventoryFile } from "./types.ts";

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [directory];

  while (pending.length > 0) {
    const currentDirectory = pending.pop();
    if (!currentDirectory) continue;
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  }

  return files;
}

function toPosixRelativePath(gameRoot: string, absolutePath: string): string {
  return relative(gameRoot, absolutePath).split(sep).join("/");
}

async function createInventoryFile(gameRoot: string, absolutePath: string): Promise<InventoryFile> {
  const contents = await readFile(absolutePath);
  return {
    relativePath: toPosixRelativePath(gameRoot, absolutePath),
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function inventoryFiles(gameRoot: string, sourceRoot: string, extension: string): Promise<InventoryFile[]> {
  const files = (await listFiles(sourceRoot)).filter((file) => file.toLowerCase().endsWith(extension));
  const inventory = await Promise.all(files.map((file) => createInventoryFile(gameRoot, file)));
  return inventory.sort((left, right) => {
    if (left.relativePath < right.relativePath) return -1;
    if (left.relativePath > right.relativePath) return 1;
    return 0;
  });
}

/** Reads source files only; it never writes to the game installation. */
export async function inventoryGameData(paths: GamePaths): Promise<GameInventory> {
  const [tileFiles, worldFiles, luaFiles] = await Promise.all([
    // Terrain cells also ship in Data and Challenge packages, not only Survival.
    inventoryFiles(paths.gameRoot, paths.gameRoot, ".tile"),
    inventoryFiles(paths.gameRoot, paths.survivalRoot, ".world"),
    inventoryFiles(paths.gameRoot, paths.survivalRoot, ".lua"),
  ]);

  return { gameRoot: paths.gameRoot, tileFiles, worldFiles, luaFiles };
}
