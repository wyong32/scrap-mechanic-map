import { describe, expect, it } from "vitest";
import { readLegacyBridge } from "./legacy-bridge.ts";

const meadowPath = "Survival/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile";
const meadowUuid = "11111111-2222-4333-8444-555555555555";

describe("readLegacyBridge", () => {
  it("derives a direct AddTile legacy bridge from the registered tile header", () => {
    const source = {
      relativePath: "Survival/Scripts/terrain/overworld/type_meadow.lua",
      text: `AddTile( 1000001, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile", 1 )`
    };
    const paths = new Map([[meadowPath, meadowUuid]]);

    expect(readLegacyBridge([source], paths)).toEqual([{
      legacyId: 1000001,
      uuid: meadowUuid,
      tilePath: meadowPath,
      status: "active",
      evidence: "Survival/Scripts/terrain/overworld/type_meadow.lua:AddTile"
    }]);
  });

  it("derives active and retired POI wrappers from their numeric constants", () => {
    const source = {
      relativePath: "Survival/Scripts/terrain/overworld/poi.lua",
      text: `
        POI_CRASHSITE_AREA = 101
        addPoiTileLegacy(POI_CRASHSITE_AREA, 1, "$SURVIVAL_DATA/Terrain/Tiles/start_area/SurvivalStartArea_CrashedShip_01.tile")
        addPoiTileRetired(POI_CRASHSITE_AREA, 8, "$SURVIVAL_DATA/Terrain/Tiles/start_area/Retired.tile")
      `
    };
    const paths = new Map([
      ["Survival/Terrain/Tiles/start_area/SurvivalStartArea_CrashedShip_01.tile", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
      ["Survival/Terrain/Tiles/start_area/Retired.tile", "ffffffff-1111-4222-8333-444444444444"]
    ]);

    expect(readLegacyBridge([source], paths)).toEqual([
      { legacyId: 10101, uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", tilePath: "Survival/Terrain/Tiles/start_area/SurvivalStartArea_CrashedShip_01.tile", status: "active", evidence: "Survival/Scripts/terrain/overworld/poi.lua:addPoiTileLegacy" },
      { legacyId: 10108, uuid: "ffffffff-1111-4222-8333-444444444444", tilePath: "Survival/Terrain/Tiles/start_area/Retired.tile", status: "retired", evidence: "Survival/Scripts/terrain/overworld/poi.lua:addPoiTileRetired" }
    ]);
  });

  it("derives an official explicit remap through the UUID found in a tile header", () => {
    const source = { relativePath: "Survival/Scripts/terrain/overworld/poi.lua", text: `AddLegacyUpgrade(1000001, sm.uuid.new("${meadowUuid}"))` };
    expect(readLegacyBridge([source], new Map([[meadowPath, meadowUuid]]))).toEqual([{
      legacyId: 1000001, uuid: meadowUuid, tilePath: meadowPath, status: "remapped", evidence: "Survival/Scripts/terrain/overworld/poi.lua:AddLegacyUpgrade"
    }]);
  });

  it("collapses identical registrations deterministically and rejects incompatible UUIDs", () => {
    const source = { relativePath: "Survival/Scripts/terrain/overworld/a.lua", text: `AddTile(1000001, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile")\nAddTile(1000001, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile")` };
    const paths = new Map([[meadowPath, meadowUuid], ["Survival/Terrain/Tiles/other.tile", "99999999-2222-4333-8444-555555555555"]]);
    expect(readLegacyBridge([source], paths)).toHaveLength(1);
    expect(() => readLegacyBridge([{ ...source, text: `AddTile(1000001, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile")\nAddTile(1000001, "$SURVIVAL_DATA/Terrain/Tiles/other.tile")` }], paths)).toThrow(/1000001/);
  });

  it("fails closed for unknown constants and tiles, and ignores non-literal registrations", () => {
    const paths = new Map([[meadowPath, meadowUuid]]);
    expect(() => readLegacyBridge([{ relativePath: "poi.lua", text: `addPoiTileLegacy(POI_UNKNOWN, 1, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile")` }], paths)).toThrow(/POI_UNKNOWN/);
    expect(() => readLegacyBridge([{ relativePath: "a.lua", text: `AddTile(1000001, "$SURVIVAL_DATA/Terrain/Tiles/missing.tile")` }], paths)).toThrow(/missing/);
    expect(readLegacyBridge([{ relativePath: "a.lua", text: `AddTile(nil, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile")\nAddTile(1000000 + 1, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile")\nAddTile(1000002, "Meadow_64(1111)_01.tile")` }], paths)).toEqual([]);
  });

  it("ignores line and long-block comments plus dynamically concatenated paths", () => {
    const paths = new Map([[meadowPath, meadowUuid]]);
    const source = {
      relativePath: "Survival/Scripts/terrain/overworld/a.lua",
      text: `
        -- AddTile(1000001, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile")
        --[[ addPoiTileLegacy(POI_COMMENTED, 1, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile") ]]
        --[=[ AddTile(1000002, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile") ]=]
        POI_COMMENTED = 101
        AddTile(1000003, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile" .. suffix)
        addPoiTileLegacy(POI_COMMENTED, 4, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile" .. suffix)
      `
    };

    expect(readLegacyBridge([source], paths)).toEqual([]);
  });
});
