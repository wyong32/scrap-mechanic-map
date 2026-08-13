import { describe, expect, it } from "vitest";
import { classifyGeneratedPoi } from "./location-type-catalog";

describe("classifyGeneratedPoi", () => {
  it.each([
    ["POI_WAREHOUSE2_LARGE", "generated:warehouse", "Warehouse", "Warehouse"],
    ["POI_FOREST_CAMP", "generated:camps-ruins", "Camps & Ruins", "Forest Camp"],
    ["POI_AUTUMNFOREST_RUIN", "generated:camps-ruins", "Camps & Ruins", "Autumn Forest Ruin"],
    ["POI_ROAD_KIOSK", "generated:road", "Road Locations", "Kiosk"],
    ["POI_ROAD_SCHEMATICSTATION", "generated:road", "Road Locations", "Schematic Station"],
    ["POI_CHEMLAKE_MEDIUM", "generated:resource-hazard", "Resource & Hazard", "Chemical Lake"],
    ["POI_DESERT_OILPOOL", "generated:resource-hazard", "Resource & Hazard", "Oil Pool"],
    ["POI_HIDEOUT_XL", "generated:major", "Major Generated Locations", "Hideout"],
    ["POI_PACKINGSTATIONFRUIT_MEDIUM", "generated:major", "Major Generated Locations", "Fruit Packing Station"],
    ["POI_BUILDERQUEST_WOCHOUSE", "generated:builder-quest", "Builder Quest Locations", "Builder Quest Location"]
  ])("classifies %s", (poiType, typeId, typeName, label) => {
    expect(classifyGeneratedPoi(poiType)).toEqual({ typeId, typeName, label });
  });

  it.each([
    "POI_RANDOM_PLACEHOLDER",
    "POI_TEST",
    "POI_CRASHSITE_AREA",
    "POI_MECHANICSTATION_MEDIUM",
    "POI_MEADOW_GROWLAB_QUEST_LARGE",
    "POI_BURNTFOREST_FARMBOTSCRAPYARD_LARGE",
    "POI_SERVICE_ELEVATOR",
    "POI_EXCAVATION_BRIDGE",
    "POI_EXCAVATION",
    "POI_BURNTFOREST_RANDOM",
    "POI_AUTUMNFOREST_RANDOM",
    "POI_NOT_IN_1_0"
  ])("fails %s closed", (poiType) => {
    expect(classifyGeneratedPoi(poiType)).toBeUndefined();
  });
});
