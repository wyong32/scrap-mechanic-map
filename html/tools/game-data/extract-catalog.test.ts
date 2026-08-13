import { describe, expect, it } from "vitest";
import { assertKnownVariablePathAddTileWrappers, extractCatalog, readPoiRegistrations, readTerrainRegistrationTypes } from "./extract-catalog.ts";
import { resolveGamePaths } from "./paths.ts";

describe("extractCatalog", () => {
  it("preserves first POI registration while sorting the emitted list", () => {
    const tiles = new Map([
      ["Survival/Terrain/Tiles/poi/Kiosk_64_01.tile", { uuid: "kiosk" }],
      ["Survival/Terrain/Tiles/poi/Ruin_Forest_64_01.tile", { uuid: "forest" }],
    ]);
    const poi = readPoiRegistrations(`
      addPoiTileLegacy( POI_ROAD_KIOSK, 1, "$SURVIVAL_DATA/Terrain/Tiles/poi/Kiosk_64_01.tile" )
      addPoiTile( POI_EXCAVATION_BRIDGE, "$SURVIVAL_DATA/Terrain/Tiles/poi/Kiosk_64_01.tile" )
      addPoiTileLegacy( POI_FOREST_RUIN, 1, "$SURVIVAL_DATA/Terrain/Tiles/poi/Ruin_Forest_64_01.tile" )
      addPoiTileLegacy( POI_FOREST_RANDOM, 1, "$SURVIVAL_DATA/Terrain/Tiles/poi/Ruin_Forest_64_01.tile" )
    `, tiles);
    expect(poi).toEqual([
      { poiType: "POI_FOREST_RUIN", tileUuid: "forest", relativePath: "Survival/Terrain/Tiles/poi/Ruin_Forest_64_01.tile" },
      { poiType: "POI_ROAD_KIOSK", tileUuid: "kiosk", relativePath: "Survival/Terrain/Tiles/poi/Kiosk_64_01.tile" },
    ]);
  });

  it("extracts literal terrain type metadata without using source categories", () => {
    const registrations = readTerrainRegistrationTypes([
      `AddTile( nil, "$SURVIVAL_DATA/Terrain/Tiles/default.tile", nil, nil )\nAddTile( 4, "$SURVIVAL_DATA/Terrain/Tiles/explicit.tile", 7, nil )`,
    ]);
    expect(registrations.get("Survival/Terrain/Tiles/default.tile")).toBe(1);
    expect(registrations.get("Survival/Terrain/Tiles/explicit.tile")).toBe(7);
    expect(registrations.get("Survival/Terrain/Tiles/unregistered.tile")).toBeUndefined();
  });

  it("covers the literal biome-road wrapper and rejects unknown or changed variable-path wrappers", () => {
    const biome = `function addBiomeRoadTile( path ) AddTile( nil, path, nil, nil ) end\naddBiomeRoadTile( "$SURVIVAL_DATA/Terrain/Tiles/roads_biomes/Road(0101)_Forest(1001)_01.tile" )`;
    expect(readTerrainRegistrationTypes([biome]).get("Survival/Terrain/Tiles/roads_biomes/Road(0101)_Forest(1001)_01.tile")).toBe(1);
    expect(() => assertKnownVariablePathAddTileWrappers(["function addFutureTile( tilePath ) AddTile( nil, tilePath, nil, nil ) end"])).toThrow(/addFutureTile/);
    expect(() => assertKnownVariablePathAddTileWrappers(["local function addFutureTile( p ) AddTile( nil, p, nil, nil ) end"])).toThrow(/addFutureTile/);
    expect(() => assertKnownVariablePathAddTileWrappers(["function addBiomeRoadTile( path ) AddTile( nil, path, 7, nil ) end"])).toThrow(/addBiomeRoadTile/);
  });

  it.skipIf(!process.env.SM_GAME_ROOT)("extracts deterministic, path-private 1.0 tiles, POIs and fixed worlds", async () => {
    const paths = await resolveGamePaths(process.env.SM_GAME_ROOT!);
    const [first, second] = await Promise.all([extractCatalog(paths), extractCatalog(paths)]);

    expect(first).toEqual(second);
    expect(first.tiles.length).toBeGreaterThan(1_000);
    expect(first.worlds).toHaveLength(19);
    expect(first.pois.length).toBe(159);
    expect(first.worlds.reduce((count, world) => count + world.cells.length, 0)).toBe(3_804);
    expect(first.worlds.reduce((count, world) => count + world.emptyCells.length, 0)).toBe(6_372);
    const roads = first.tiles.filter((tile) => tile.relativePath.includes("/roads_biomes/"));
    expect(roads).toHaveLength(47);
    expect(roads.filter((tile) => tile.terrainType === 1)).toHaveLength(46);
    expect(roads.find((tile) => tile.relativePath.endsWith("Road(0101)_Lake(1111)_03.tile"))?.terrainType).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain(paths.gameRoot);
    expect(first.tiles.some((tile) => tile.uuid === "3f6460cf-db7c-44c0-a91e-a42c617a1750")).toBe(true);
    expect(first.legacyBridge.some((entry) => entry.legacyId === 1000001 && entry.tilePath.endsWith("Meadow_64(1111)_01.tile"))).toBe(true);
  }, 30_000);
});
