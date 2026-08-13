import { access, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { GamePaths } from "./types.ts";

async function requireDirectory(path: string, description: string): Promise<void> {
  try {
    const details = await stat(path);
    if (!details.isDirectory()) {
      throw new Error(`${description} is not a directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not a directory")) {
      throw error;
    }
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new Error(`${description} was not found: ${path}`, { cause: error });
    }
    throw new Error(`${description} could not be inspected: ${path}`, { cause: error });
  }
}

/** Resolves the read-only source directories required by the game data tools. */
export async function resolveGamePaths(gameRoot: string): Promise<GamePaths> {
  const requestedRoot = resolve(gameRoot);
  await requireDirectory(requestedRoot, "Scrap Mechanic game root");
  const canonicalGameRoot = await realpath(requestedRoot);
  const survivalRoot = resolve(canonicalGameRoot, "Survival");
  await requireDirectory(survivalRoot, "Scrap Mechanic Survival directory");

  const terrainRoot = resolve(survivalRoot, "Terrain");
  const worldsRoot = resolve(terrainRoot, "Worlds");
  const scriptsRoot = resolve(survivalRoot, "Scripts");
  const tileDatabasePath = resolve(scriptsRoot, "terrain", "overworld", "tile_database.lua");

  await Promise.all([
    requireDirectory(terrainRoot, "Scrap Mechanic Terrain directory"),
    requireDirectory(worldsRoot, "Scrap Mechanic Worlds directory"),
    requireDirectory(scriptsRoot, "Scrap Mechanic Scripts directory"),
    access(tileDatabasePath).catch(() => {
      throw new Error(`Required terrain tile database was not found: ${tileDatabasePath}`);
    }),
  ]);

  return {
    gameRoot: canonicalGameRoot,
    survivalRoot,
    terrainRoot,
    worldsRoot,
    scriptsRoot,
    tileDatabasePath,
  };
}

/** Prevent accidental writes into the user-provided game installation. */
function comparePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function resolveThroughNearestExistingAncestor(path: string): Promise<string> {
  const unresolvedParts: string[] = [];
  let candidate = resolve(path);

  while (true) {
    try {
      const canonicalAncestor = await realpath(candidate);
      return resolve(canonicalAncestor, ...unresolvedParts);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw new Error(`Output directory could not be resolved: ${candidate}`, { cause: error });
      }

      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new Error(`Output directory could not be resolved: ${path}`, { cause: error });
      }
      unresolvedParts.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * Resolves symlinks/junctions in the game source and target path before
 * permitting a later build step to create files there.
 */
export async function assertOutputOutsideGameRoot(
  gameRoot: string,
  outputDirectory: string,
): Promise<string> {
  const canonicalRoot = await realpath(resolve(gameRoot));
  const canonicalOutput = await resolveThroughNearestExistingAncestor(outputDirectory);
  const rootForComparison = process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
  const outputForComparison = process.platform === "win32" ? canonicalOutput.toLowerCase() : canonicalOutput;
  const relativeOutput = relative(rootForComparison, outputForComparison);
  const isGameRoot = comparePath(canonicalRoot, canonicalOutput);
  const isDescendant =
    relativeOutput.length > 0 &&
    !relativeOutput.startsWith(`..${sep}`) &&
    relativeOutput !== ".." &&
    !isAbsolute(relativeOutput);

  if (isGameRoot || isDescendant) {
    throw new Error(`Output directory must be outside the game root: ${canonicalOutput}`);
  }

  return canonicalOutput;
}
