export type GeneratedLocationTypeId =
  | "generated:warehouse"
  | "generated:camps-ruins"
  | "generated:road"
  | "generated:resource-hazard"
  | "generated:major"
  | "generated:builder-quest";

export interface GeneratedLocationClassification {
  typeId: GeneratedLocationTypeId;
  typeName: string;
  label: string;
}

const excluded = new Set([
  "POI_RANDOM_PLACEHOLDER",
  "POI_TEST",
  "POI_CRASHSITE_AREA",
  "POI_WAREHOUSE4_QUEST_LARGE",
  "POI_MECHANICSTATION_MEDIUM",
  "POI_MECHANICSTATION_QUEST_MEDIUM",
  "POI_SERVICE_ELEVATOR",
  "POI_EXCAVATION_BRIDGE",
  "POI_EXCAVATION",
  "POI_BURNTFOREST_RANDOM",
  "POI_AUTUMNFOREST_RANDOM"
]);

const roadLocations = new Map<string, string>([
  ["POI_ROAD_KIOSK", "Kiosk"],
  ["POI_ROAD_SCHEMATICSTATION", "Schematic Station"],
  ["POI_ROAD_CHEMPOOL", "Chemical Pool Facility"]
]);

const resourceHazardLocations = new Map<string, string>([
  ["POI_CHEMLAKE_MEDIUM", "Chemical Lake"],
  ["POI_DESERT_OILPOOL", "Oil Pool"],
  ["POI_OILLAKE_MEDIUM", "Oil Lake"]
]);

const majorLocations = new Map<string, string>([
  ["POI_HIDEOUT_XL", "Hideout"],
  ["POI_RUINCITY_XL", "Ruined City"],
  ["POI_CRASHEDSHIP_LARGE", "Crashed Ship"],
  ["POI_LABYRINTH_MEDIUM", "Labyrinth"],
  ["POI_PACKINGSTATIONVEG_MEDIUM", "Vegetable Packing Station"],
  ["POI_PACKINGSTATIONFRUIT_MEDIUM", "Fruit Packing Station"],
  ["POI_FARMINGPATCH", "Farm Plot"]
]);

const campRuinPoiTypes = new Set([
  "POI_CAMP_LARGE",
  "POI_CAMP",
  "POI_RUIN",
  "POI_RUIN_MEDIUM",
  "POI_FOREST_CAMP",
  "POI_FOREST_RUIN",
  "POI_FOREST_RUIN_MEDIUM",
  "POI_FIELD_RUIN",
  "POI_BURNTFOREST_CAMP",
  "POI_BURNTFOREST_RUIN",
  "POI_AUTUMNFOREST_CAMP",
  "POI_AUTUMNFOREST_RUIN",
  "POI_LAKE_RUIN_MEDIUM"
]);

const biomeNames = new Map<string, string>([
  ["FOREST", "Forest"],
  ["FIELD", "Field"],
  ["BURNTFOREST", "Burnt Forest"],
  ["AUTUMNFOREST", "Autumn Forest"],
  ["LAKE", "Lake"]
]);

const builderQuestPoiTypes = new Set([
  "POI_BUILDERQUEST_RESOURCECAR",
  "POI_BUILDERQUEST_WOCHOUSE",
  "POI_BUILDERQUEST_CARDBOARDPOOP",
  "POI_BUILDERQUEST_XYLOPHONE",
  "POI_BUILDERQUEST_BEESUIT",
  "POI_BUILDERQUEST_CAROUSEL",
  "POI_BUILDERQUEST_CROWBAR",
  "POI_BUILDERQUEST_COMPASS",
  "POI_BUILDERQUEST_NICEHOUSE_MEDIUM",
  "POI_BUILDERQUEST_STEELBRIDGE_MEDIUM",
  "POI_BUILDERQUEST_SLEDGEHAMMER_MEDIUM",
  "POI_BUILDERQUEST_BAGUETTE_MEDIUM",
  "POI_FOREST_BUILDERQUEST_SAWBLADEARM",
  "POI_DESERT_BUILDERQUEST_BIGFAN",
  "POI_DESERT_BUILDERQUEST_GARDEN",
  "POI_FIELD_BUILDERQUEST_CORNHEART",
  "POI_FIELD_BUILDERQUEST_COZYBED",
  "POI_BURNTFOREST_BUILDERQUEST_TOTEBOTKEY",
  "POI_BURNTFOREST_BUILDERQUEST_CATAPULT_MEDIUM",
  "POI_AUTUMNFOREST_BUILDERQUEST_POPCORN",
  "POI_AUTUMNFOREST_BUILDERQUEST_MUSICBOX_MEDIUM"
]);

function classification(
  typeId: GeneratedLocationTypeId,
  typeName: string,
  label: string
): GeneratedLocationClassification {
  return { typeId, typeName, label };
}

function campRuinLabel(poiType: string): string | undefined {
  if (!campRuinPoiTypes.has(poiType)) return undefined;

  const match = /^POI_(?:(FOREST|FIELD|BURNTFOREST|AUTUMNFOREST|LAKE)_)?(CAMP|RUIN)(?:_(?:MEDIUM|LARGE))?$/.exec(poiType);
  if (!match) return undefined;

  const [, biome, location] = match;
  return `${biome ? `${biomeNames.get(biome)} ` : ""}${location === "CAMP" ? "Camp" : "Ruin"}`;
}

export function classifyGeneratedPoi(
  poiType: string
): GeneratedLocationClassification | undefined {
  if (
    excluded.has(poiType) ||
    poiType.includes("_GROWLAB_") ||
    poiType.includes("FARMBOTSCRAPYARD") ||
    /^POI_.*_RANDOM(?:_MEDIUM)?$/.test(poiType)
  ) {
    return undefined;
  }

  if (/^POI_WAREHOUSE[234]_LARGE$/.test(poiType)) {
    return classification("generated:warehouse", "Warehouse", "Warehouse");
  }

  const campRuin = campRuinLabel(poiType);
  if (campRuin) {
    return classification("generated:camps-ruins", "Camps & Ruins", campRuin);
  }

  const roadLabel = roadLocations.get(poiType);
  if (roadLabel) {
    return classification("generated:road", "Road Locations", roadLabel);
  }

  const resourceHazardLabel = resourceHazardLocations.get(poiType);
  if (resourceHazardLabel) {
    return classification(
      "generated:resource-hazard",
      "Resource & Hazard",
      resourceHazardLabel
    );
  }

  const majorLabel = majorLocations.get(poiType);
  if (majorLabel) {
    return classification("generated:major", "Major Generated Locations", majorLabel);
  }

  if (builderQuestPoiTypes.has(poiType)) {
    return classification(
      "generated:builder-quest",
      "Builder Quest Locations",
      "Builder Quest Location"
    );
  }

  return undefined;
}
