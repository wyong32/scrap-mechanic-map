import { describe, expect, it } from "vitest";
import { legacyPoiRules, resolveOriginalPoiRule } from "./original-poi-rules.ts";

// Break caught: replacing a bespoke original POI image with a generic image loses map-identifying detail.
describe("resolveOriginalPoiRule", () => {
  it.each([
    ["POI_MECHANICSTATION_MEDIUM", 0, undefined, undefined, "poi:mechanic_station.png", 2],
    ["POI_PACKINGSTATIONFRUIT_MEDIUM", 0, undefined, undefined, "poi:packing_fruit.jpg", 2],
    ["POI_PACKINGSTATIONVEG_MEDIUM", 0, undefined, undefined, "poi:packing_veg.jpg", 2],
    ["POI_HIDEOUT_XL", 0, undefined, undefined, "poi:hideout.png", 8],
    ["POI_RUINCITY_XL", 0, undefined, undefined, "poi:scrapcity.jpg", 8],
    ["POI_SILODISTRICT_XL", 0, undefined, undefined, "poi:silodistrict.jpg", 8],
    ["POI_CAMP_LARGE", 0, undefined, undefined, "poi:camp_large.jpg", 4],
    ["POI_WAREHOUSE2_LARGE", 0, undefined, undefined, "poi:warehouse2.jpg", 4],
  ])("keeps %s on its original image and cell size", (poiType, legacyId, x, y, imageKey, sizeCells) => {
    expect(resolveOriginalPoiRule(poiType, legacyId, x, y)).toMatchObject({ imageKey, sizeCells });
  });

  it.each([
    ["POI_RUIN_MEDIUM", 12003, "poi:ruin_medium_3.jpg"],
    ["POI_RUIN_MEDIUM", 12004, "poi:ruin_medium_4.jpg"],
    ["POI_FOREST_RUIN_MEDIUM", 20402, "poi:forest_ruin_medium_2.jpg"],
    ["POI_FOREST_RUIN_MEDIUM", 20401, "poi:forest_ruin_medium_1.jpg"],
    ["POI_LAKE_UNDERWATER_MEDIUM", 80203, "poi:underwater_med_3.jpg"],
    ["POI_LAKE_UNDERWATER_MEDIUM", 80202, "poi:underwater_med_4.jpg"],
    ["POI_LAKE_UNDERWATER_MEDIUM", 80204, "poi:underwater_med_4.jpg"],
    ["POI_WAREHOUSE4_LARGE", 0, "poi:warehouse4.png"],
    ["POI_WAREHOUSE3_LARGE", 0, "poi:warehouse3_large.png"],
  ])("keeps legacy-ID-specific image selection for %s (%i)", (poiType, legacyId, imageKey) => {
    expect(resolveOriginalPoiRule(poiType, legacyId)).toMatchObject({ imageKey });
  });

  it("keeps only start_crashsite1 as a multi-cell crash-site POI", () => {
    expect(
      resolveOriginalPoiRule("POI_CRASHSITE_AREA", 10101, -38, -42)
    ).toMatchObject({
      imageKey: "poi:start_crashsite1.jpg",
      sizeCells: 2,
      coordinate: { x: -38, y: -42 }
    });
  });

  it.each([
    [-37, -39, "poi:start_crashsite_-37_-39.jpg"],
    [-37, -40, "poi:start_crashsite_-37_-40.jpg"],
    [-36, -40, "poi:start_crashsite_-36_-40.jpg"],
    [-36, -41, "poi:start_crashsite_-36_-41.jpg"],
  ])("models crash-site coordinate image (%i, %i) as a distinct single-cell override", (x, y, imageKey) => {
    const coordinateRule = legacyPoiRules.find(
      (entry) =>
        entry.coordinate?.x === x
        && entry.coordinate.y === y
        && entry.imageKey === imageKey
    );
    expect(coordinateRule).toMatchObject({
      kind: "coordinate-tile-override",
      imageKey,
      coordinate: { x, y }
    });
    expect(coordinateRule).not.toHaveProperty("sizeCells");
  });

  it("uses only explicit local table data and includes every supported cell size", () => {
    const multiCellRules = legacyPoiRules.filter(
      (rule) => rule.kind === "multi-cell-poi"
    );
    const coordinateOverrides = legacyPoiRules.filter(
      (rule) => rule.kind === "coordinate-tile-override"
    );
    expect(
      multiCellRules.every(
        (rule) =>
          rule.imageKey.startsWith("poi:")
          && [2, 4, 8].includes(rule.sizeCells)
      )
    ).toBe(true);
    expect(new Set(multiCellRules.map((rule) => rule.sizeCells))).toEqual(
      new Set([2, 4, 8])
    );
    expect(coordinateOverrides).toHaveLength(4);
  });
});
