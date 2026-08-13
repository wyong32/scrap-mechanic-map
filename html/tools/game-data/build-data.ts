import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CellBounds, MapLocation, RegionDefinition, WorldMap } from "../../src/domain/map-model.ts";
import { extractCatalog, type GeneratedCatalog } from "./extract-catalog.ts";
import { buildReferenceLocations } from "./location-catalog.ts";
import { assertOutputOutsideGameRoot, resolveGamePaths } from "./paths.ts";
import { createReferenceSurface, referenceSurfaceBounds } from "./reference-world.ts";
import type { FixedWorldDefinition } from "./world-reader.ts";

export const GENERATED_SCHEMA_VERSION = 1;
const DEFAULT_GAME_VERSION = "1.0.0";

export interface BuildGameDataOptions {
  gameRoot: string;
  outputDirectory?: string;
  gameVersion?: string;
  /** Test seam; production callers always extract the catalog from gameRoot. */
  catalog?: GeneratedCatalog;
  /** Reviewed default surface imported from the local source data. */
  referenceWorld?: WorldMap;
}

export interface BuildReport {
  outputDirectory: string;
  gameVersion: string;
  files: Array<{ name: string; contentHash: string; bytes: number }>;
  regionCount: number;
  fixedWorldCount: number;
}

interface GeneratedEnvelope<T> {
  schemaVersion: number;
  gameVersion: string;
  generatedFrom: string[];
  contentHash: string;
  [key: string]: unknown;
}

interface GeneratedRegion extends RegionDefinition { worldIds?: string[] }
interface RegionsPayload extends GeneratedEnvelope<GeneratedRegion[]> { displayNames: Record<string, string>; regions: GeneratedRegion[] }
interface LocationsPayload extends GeneratedEnvelope<MapLocation[]> { locations: MapLocation[] }
interface ReferenceWorldPayload extends GeneratedEnvelope<WorldMap> { world: WorldMap }
interface TileCatalogPayload extends GeneratedEnvelope<GeneratedCatalog> { tiles: GeneratedCatalog["tiles"]; pois: GeneratedCatalog["pois"]; legacyBridge: GeneratedCatalog["legacyBridge"] }
interface BuildInfoPayload extends GeneratedEnvelope<unknown> { files: Array<{ name: string; contentHash: string; bytes: number }> }
interface FixedWorldPayload extends GeneratedEnvelope<WorldMap> { world: WorldMap; zonePortals: FixedWorldDefinition["connections"] }

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/** SHA-256 of canonical JSON with this document's contentHash omitted. */
export function computeBundleContentHash(payload: Record<string, unknown>): string {
  const { contentHash: _selfHash, ...withoutSelfHash } = payload;
  return createHash("sha256").update(JSON.stringify(canonicalize(withoutSelfHash))).digest("hex");
}

function withHash<T extends Record<string, unknown>>(payload: T): T & { contentHash: string } {
  const hashed: Record<string, unknown> = { ...payload, contentHash: "" };
  hashed.contentHash = computeBundleContentHash(hashed);
  return canonicalize(hashed) as T & { contentHash: string };
}

const regionBlueprints: Array<Omit<GeneratedRegion, "bounds"> & { bounds?: CellBounds; displayName: string }> = [
  { id: "surface", name: "surface", group: "surface", source: "reference", displayName: "Surface World" },
  { id: "excavation-island", name: "excavation-island", group: "story", source: "fixed-region", displayName: "Excavation Island", worldIds: ["overworld_excavation_island", "world_builder_excavationisland_01"] },
  ...[1, 2, 3, 4, 5, 6, 7].map((number) => ({ id: `grow-lab-${number}`, name: `grow-lab-${number}`, group: "grow-lab" as const, source: "fixed-region" as const, displayName: `Grow Lab ${number}`, worldIds: [`growlab_0${number}`] })),
  { id: "mining-hub", name: "mining-hub", group: "underground", source: "fixed-region", displayName: "Mining Hub", worldIds: ["undergroundworld_mininghub"] },
  { id: "scrapyard", name: "scrapyard", group: "surface", source: "fixed-region", displayName: "Scrapyard", worldIds: ["undergroundworld_scrapyard"] },
  ...[1, 2].map((number) => ({ id: `underground-station-${number}`, name: `underground-station-${number}`, group: "underground" as const, source: "fixed-region" as const, displayName: `Underground Station ${number}`, worldIds: [`undergroundworld_station_0${number}`] })),
  { id: "final-boss-hall", name: "final-boss-hall", group: "boss", source: "fixed-region", displayName: "Final Boss Hall", worldIds: ["undergroundworld_final_boss_lobby"] },
  { id: "trashbot-boss", name: "trashbot-boss", group: "boss", source: "fixed-region", displayName: "Trashbot Boss Area", worldIds: ["undergroundworld_trashbot_boss"] },
  ...[1, 2].map((number) => ({ id: `drilling-area-${number}`, name: `drilling-area-${number}`, group: "underground" as const, source: "fixed-region" as const, displayName: `Drilling Area ${number}`, worldIds: [`undergroundworld_drill_0${number}`] })),
  { id: "underground-guidance", name: "underground-guidance", group: "underground", source: "fixed-region", displayName: "Underground Guidance Area", worldIds: ["undergroundworld_onboarding", "undergroundworld_empty"] },
];

function fixedWorldToMap(world: FixedWorldDefinition, gameVersion: string): WorldMap {
  return {
    id: world.id,
    source: "fixed-region",
    gameVersion,
    bounds: world.bounds,
    cells: world.cells.map((cell) => ({ x: cell.x, y: cell.y, uuid: cell.tileUuid, rotation: cell.rotation as 0 | 1 | 2 | 3, xOffset: cell.offsetX, yOffset: cell.offsetY, flags: 0, terrainType: "fixed-region" })),
    locations: [],
    connections: [],
  };
}

export const supportedFixedWorldIds = regionBlueprints.flatMap((region) => region.worldIds ?? []);

function buildRegions(catalog: GeneratedCatalog, gameVersion: string): { regions: GeneratedRegion[]; fixedWorlds: FixedWorldDefinition[]; displayNames: Record<string, string> } {
  const worldsById = new Map(catalog.worlds.map((world) => [world.id, world]));
  const missing = supportedFixedWorldIds.filter((id) => !worldsById.has(id));
  if (missing.length > 0) throw new Error(`Missing required fixed-world source(s): ${missing.join(", ")}`);
  const displayNames: Record<string, string> = {};
  const regions = regionBlueprints.map((blueprint) => {
    displayNames[blueprint.id] = blueprint.displayName;
    const matchingWorld = blueprint.worldIds?.map((id) => worldsById.get(id)).find((world): world is FixedWorldDefinition => world !== undefined);
    if (blueprint.id !== "surface" && !matchingWorld) throw new Error(`Region '${blueprint.id}' has no mapped fixed world`);
    return { ...blueprint, bounds: blueprint.id === "surface" ? referenceSurfaceBounds : matchingWorld!.bounds };
  });
  return { regions, fixedWorlds: [...worldsById.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0), displayNames };
}

function safeRelativeSources(sources: string[]): string[] {
  return [...new Set(sources)].map((source) => source.replace(/\\/g, "/")).sort();
}

function contains(bounds: CellBounds, position: { x: number; y: number }): boolean {
  return position.x >= bounds.minX && position.x <= bounds.maxX && position.y >= bounds.minY && position.y <= bounds.maxY;
}

export function assertLocationsWithinRegions(locations: MapLocation[], regions: GeneratedRegion[]): void {
  const byId = new Map(regions.map((region) => [region.id, region]));
  for (const location of locations) {
    const region = byId.get(location.regionId);
    if (!region) throw new Error(`Location '${location.id}' references unknown region '${location.regionId}'`);
    if (location.position && !contains(region.bounds, location.position)) throw new Error(`Location '${location.id}' is outside region '${location.regionId}' bounds`);
    if (location.bounds && (!contains(region.bounds, { x: location.bounds.minX, y: location.bounds.minY }) || !contains(region.bounds, { x: location.bounds.maxX, y: location.bounds.maxY }))) throw new Error(`Location '${location.id}' bounds exceed region '${location.regionId}'`);
  }
}

async function writePayload(directory: string, name: string, payload: Record<string, unknown>): Promise<{ name: string; contentHash: string; bytes: number }> {
  const text = `${JSON.stringify(canonicalize(payload), null, 2)}\n`;
  await mkdir(dirname(join(directory, name)), { recursive: true });
  await writeFile(join(directory, name), text, "utf8");
  return { name, contentHash: String(payload.contentHash), bytes: Buffer.byteLength(text) };
}

function addCatalogPoiTypes(
  world: WorldMap,
  catalog: GeneratedCatalog
): WorldMap {
  const poiTypes = new Map(
    catalog.pois.map((poi) => [poi.tileUuid.toLowerCase(), poi.poiType])
  );
  return {
    ...world,
    cells: world.cells.map((cell) => {
      if (cell.poiType) return cell;
      const poiType = poiTypes.get(cell.uuid.toLowerCase());
      return poiType ? { ...cell, poiType } : cell;
    })
  };
}

export async function buildGameData(options: BuildGameDataOptions): Promise<BuildReport> {
  const outputDirectory = await assertOutputOutsideGameRoot(options.gameRoot, options.outputDirectory ?? join(process.cwd(), "public", "data", "generated"));
  const gameVersion = options.gameVersion ?? DEFAULT_GAME_VERSION;
  const catalog = options.catalog ?? await extractCatalog(await resolveGamePaths(options.gameRoot));
  const { regions, fixedWorlds, displayNames } = buildRegions(catalog, gameVersion);
  const sourceWorlds = safeRelativeSources(fixedWorlds.map((world) => world.relativePath));
  const locations = buildReferenceLocations(regions);

  assertLocationsWithinRegions(locations, regions);
  const referencePayload: ReferenceWorldPayload = withHash({ schemaVersion: GENERATED_SCHEMA_VERSION, gameVersion, generatedFrom: ["html/tools/game-data/source/reference-world.json"], world: addCatalogPoiTypes(options.referenceWorld ?? createReferenceSurface(gameVersion), catalog) });
  const regionsPayload: RegionsPayload = withHash({ schemaVersion: GENERATED_SCHEMA_VERSION, gameVersion, generatedFrom: sourceWorlds, displayNames, regions });
  const locationsPayload: LocationsPayload = withHash({ schemaVersion: GENERATED_SCHEMA_VERSION, gameVersion, generatedFrom: ["html/tools/game-data/location-catalog.ts"], locations });
  const tileCatalogPayload: TileCatalogPayload = withHash({ schemaVersion: GENERATED_SCHEMA_VERSION, gameVersion, generatedFrom: safeRelativeSources([...catalog.tiles.map((tile) => tile.relativePath), ...catalog.pois.map((poi) => poi.relativePath), ...catalog.legacyBridge.map((entry) => entry.evidence.split(":", 1)[0]!)]), tiles: catalog.tiles, pois: catalog.pois, legacyBridge: catalog.legacyBridge });
  await mkdir(outputDirectory, { recursive: true });
  const reports = await Promise.all([
    writePayload(outputDirectory, "reference-world.json", referencePayload),
    writePayload(outputDirectory, "regions.json", regionsPayload),
    writePayload(outputDirectory, "locations.json", locationsPayload),
    writePayload(outputDirectory, "tile-catalog.json", tileCatalogPayload),
    ...fixedWorlds.map((fixedWorld) => writePayload(outputDirectory, `worlds/${fixedWorld.id}.json`, withHash({ schemaVersion: GENERATED_SCHEMA_VERSION, gameVersion, generatedFrom: [fixedWorld.relativePath], world: fixedWorldToMap(fixedWorld, gameVersion), zonePortals: fixedWorld.connections } as Omit<FixedWorldPayload, "contentHash">))),
  ]);
  const buildInfoPayload: BuildInfoPayload = withHash({ schemaVersion: GENERATED_SCHEMA_VERSION, gameVersion, generatedFrom: ["html/tools/game-data/build-data.ts"], files: reports.sort((left, right) => left.name.localeCompare(right.name)) });
  reports.push(await writePayload(outputDirectory, "build-info.json", buildInfoPayload));
  return { outputDirectory, gameVersion, files: reports.sort((left, right) => left.name.localeCompare(right.name)), regionCount: regions.length, fixedWorldCount: fixedWorlds.length };
}
