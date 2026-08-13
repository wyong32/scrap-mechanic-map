import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inventoryGameData } from "./inventory.ts";
import { readLegacyBridge, type LegacyBridgeEntry } from "./legacy/legacy-bridge.ts";
import { readTileHeader } from "./tile-reader.ts";
import type { GamePaths, InventoryFile } from "./types.ts";
import { readFixedWorld, type FixedWorldDefinition } from "./world-reader.ts";

export interface TileDefinition {
  uuid: string; relativePath: string; width: number; height: number;
  /** Game registration metadata, absent when no literal static registration exists. */
  terrainType?: number;
  /** Human source grouping only; never presented as the game's terrain type. */
  sourceCategory: string;
  sourceHash: string;
}
export interface PoiDefinition { poiType: string; tileUuid: string; relativePath: string }
export interface GeneratedCatalog { tiles: TileDefinition[]; pois: PoiDefinition[]; legacyBridge: LegacyBridgeEntry[]; worlds: FixedWorldDefinition[] }
type TileReference = Pick<TileDefinition, "uuid" | "width" | "height">;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const contentPath = (path: string) => path.replace(/^\$SURVIVAL_DATA\//, "Survival/");
const sourcePath = (gameRoot: string, file: InventoryFile) => resolve(gameRoot, ...file.relativePath.split("/"));

function sourceCategory(relativePath: string): string {
  const path = relativePath.toLowerCase();
  if (path.includes("/poi/")) return "poi";
  if (path.includes("/questtiles/")) return "quest";
  if (path.includes("/roads_and_cliffs/")) return "roads-and-cliffs";
  if (path.includes("/dungeontiles/")) return "dungeon";
  return "other";
}
function identity(relativePath: string): Pick<FixedWorldDefinition, "id" | "nameKey" | "group" | "relativePath"> {
  const id = relativePath.split("/").at(-1)!.replace(/\.world$/i, "");
  const group = id.startsWith("growlab_") ? "grow-labs" : id.includes("excavation") ? "excavation-island" : id.includes("mininghub") ? "mining-hub" : id.includes("scrapyard") ? "scrapyard" : id.includes("station") ? "underground-stations" : id.includes("boss") ? "boss" : id.includes("drill") ? "drill-sites" : id.includes("onboarding") ? "underground-guidance" : "underground";
  return { id, nameKey: id, group, relativePath };
}

/** Static-only parser for the literal POI helper calls used by the shipped 1.0 script. */
export function readPoiRegistrations(lua: string, tiles: Map<string, Pick<TileDefinition, "uuid">>): PoiDefinition[] {
  const firstByPath = new Map<string, PoiDefinition>();
  const expression = /\baddPoiTile(?:Legacy|Retired)?\s*\(\s*(POI_[A-Z0-9_]+)\s*,\s*(?:(?:\d+)\s*,\s*)?["'](\$SURVIVAL_DATA\/[^"']+\.tile)["'](?:\s*,\s*\d+)?\s*\)/g;
  for (const match of lua.matchAll(expression)) {
    const requestedPath = contentPath(match[2]); const resolvedPath = [...tiles.keys()].find((path) => path.toLowerCase() === requestedPath.toLowerCase()) ?? requestedPath; const tile = tiles.get(resolvedPath);
    if (!tile) throw new Error(`POI registration references unknown tile '${requestedPath}'`);
    if (!firstByPath.has(resolvedPath)) firstByPath.set(resolvedPath, { poiType: match[1], tileUuid: tile.uuid, relativePath: resolvedPath });
  }
  return [...firstByPath.values()].sort((a, b) => compare(a.poiType, b.poiType) || compare(a.relativePath, b.relativePath));
}

export function readTerrainRegistrationTypes(luaSources: string[]): Map<string, number> {
  const result = new Map<string, number>();
  assertKnownVariablePathAddTileWrappers(luaSources);
  for (const lua of luaSources) {
    const direct = /\bAddTile\s*\(\s*(?:nil|\d+)\s*,\s*["'](\$SURVIVAL_DATA\/[^"']+\.tile)["'](?:\s*,\s*(nil|\d+))?/g;
    for (const match of lua.matchAll(direct)) if (!result.has(contentPath(match[1]))) result.set(contentPath(match[1]), match[2] === undefined || match[2] === "nil" ? 1 : Number(match[2]));
    const poi = /\baddPoiTile(?:Legacy|Retired)?\s*\(\s*POI_[A-Z0-9_]+\s*,\s*(?:(?:\d+)\s*,\s*)?["'](\$SURVIVAL_DATA\/[^"']+\.tile)["'](?:\s*,\s*(\d+))?\s*\)/g;
    for (const match of lua.matchAll(poi)) if (!result.has(contentPath(match[1]))) result.set(contentPath(match[1]), match[2] === undefined ? 1 : Number(match[2]));
    const biomeRoad = /\baddBiomeRoadTile\s*\(\s*["'](\$SURVIVAL_DATA\/[^"']+\.tile)["']\s*\)/g;
    for (const match of lua.matchAll(biomeRoad)) if (!result.has(contentPath(match[1]))) result.set(contentPath(match[1]), 1);
  }
  return result;
}

interface WrapperContract { parameterCount: number; expected: Array<"nil" | number | "legacyId"> }
const variablePathWrapperContracts: Record<string, WrapperContract> = {
  addPoiTile: { parameterCount: 3, expected: ["nil", 1, 2, 0] },
  addPoiTileLegacy: { parameterCount: 4, expected: ["legacyId", 2, 3, 0] },
  addPoiTileRetired: { parameterCount: 4, expected: ["legacyId", 2, 3, 0] },
  addBiomeRoadTile: { parameterCount: 1, expected: ["nil", 0, "nil", "nil"] },
};

function argumentsMatchContract(args: string[], parameters: string[], contract: WrapperContract): boolean {
  if (parameters.length !== contract.parameterCount || args.length !== 4) return false;
  return contract.expected.every((expected, index) => {
    const actual = args[index].trim();
    if (expected === "nil") return actual === "nil";
    if (expected === "legacyId") return actual === "legacyId";
    return actual === parameters[expected];
  });
}

/** Fails closed when a function passes any formal parameter to AddTile's path slot. */
export function assertKnownVariablePathAddTileWrappers(luaSources: string[]): void {
  for (const lua of luaSources) {
    const starts = [...lua.matchAll(/\b(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g)];
    for (const [index, start] of starts.entries()) {
      const name = start[1];
      const parameters = start[2].split(",").map((parameter) => parameter.trim()).filter(Boolean);
      const body = lua.slice((start.index ?? 0) + start[0].length, starts[index + 1]?.index);
      const calls = [...body.matchAll(/\bAddTile\s*\(\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*([^,()]+)\s*\)/g)];
      const variableCalls = calls.filter((call) => parameters.includes(call[2].trim()));
      if (variableCalls.length === 0) continue;
      const contract = variablePathWrapperContracts[name];
      if (!contract || variableCalls.length !== 1 || !argumentsMatchContract(variableCalls[0].slice(1), parameters, contract)) {
        throw new Error(`unsupported variable-path AddTile wrapper '${name}'`);
      }
    }
  }
}

/** Reads game files only and emits canonical records without absolute source paths. */
export async function extractCatalog(paths: GamePaths): Promise<GeneratedCatalog> {
  const inventory = await inventoryGameData(paths);
  const [database, poiLua, tiles, overworldLua] = await Promise.all([
    readFile(paths.tileDatabasePath, "utf8"),
    readFile(resolve(paths.scriptsRoot, "terrain", "overworld", "poi.lua"), "utf8"),
    Promise.all(inventory.tileFiles.map(async (file): Promise<TileDefinition> => {
      const header = readTileHeader(await readFile(sourcePath(paths.gameRoot, file)), file.relativePath);
      return { uuid: header.uuid, relativePath: file.relativePath, width: header.width, height: header.height, sourceCategory: sourceCategory(file.relativePath), sourceHash: file.sha256 };
    })),
    Promise.all(inventory.luaFiles.filter((file) => file.relativePath.startsWith("Survival/Scripts/terrain/overworld/")).map(async (file) => ({ relativePath: file.relativePath, text: await readFile(sourcePath(paths.gameRoot, file), "utf8") }))),
  ]);
  if (!/function\s+GetTileDatabase\s*\(/.test(database)) throw new Error("tile database does not declare GetTileDatabase");
  const byPath = new Map<string, TileDefinition>(); const byFoldedPath = new Map<string, TileDefinition>(); const seenUuids = new Set<string>();
  for (const tile of tiles) { if (seenUuids.has(tile.uuid)) throw new Error(`duplicate tile UUID '${tile.uuid}' in game installation`); seenUuids.add(tile.uuid); byPath.set(tile.relativePath, tile); byFoldedPath.set(tile.relativePath.toLowerCase(), tile); }
  for (const [path, terrainType] of readTerrainRegistrationTypes(overworldLua.map((source) => source.text))) { const tile = byFoldedPath.get(path.toLowerCase()); if (tile) tile.terrainType = terrainType; }
  const worldIds = new Set<string>();
  const worlds = await Promise.all(inventory.worldFiles.map(async (file) => {
    const worldIdentity = identity(file.relativePath); if (worldIds.has(worldIdentity.id)) throw new Error(`duplicate fixed world id '${worldIdentity.id}'`); worldIds.add(worldIdentity.id);
    return readFixedWorld(await readFile(sourcePath(paths.gameRoot, file), "utf8"), worldIdentity, (path): TileReference | undefined => byFoldedPath.get(path.toLowerCase()));
  }));
  return {
    tiles: tiles.sort((a, b) => compare(a.uuid, b.uuid) || compare(a.relativePath, b.relativePath)),
    pois: readPoiRegistrations(poiLua, byPath),
    legacyBridge: readLegacyBridge(overworldLua, new Map(tiles.map((tile) => [tile.relativePath, tile.uuid]))),
    worlds: worlds.sort((a, b) => compare(a.id, b.id)),
  };
}
