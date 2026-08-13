export interface LegacyMultiCellPoiRule {
  kind: "multi-cell-poi";
  poiType: string;
  legacyIds?: number[];
  imageKey: `poi:${string}`;
  sizeCells: 1 | 2 | 4 | 8;
  coordinate?: { x: number; y: number };
}

export interface LegacyCoordinateTileOverride {
  kind: "coordinate-tile-override";
  imageKey: `poi:${string}`;
  coordinate: { x: number; y: number };
  sizeCells?: 1 | 2 | 4 | 8;
  worldAligned?: boolean;
}

export type LegacyPoiRule =
  | LegacyMultiCellPoiRule
  | LegacyCoordinateTileOverride;

const rule = (poiType: string, imageKey: `poi:${string}`, sizeCells: 2 | 4 | 8, legacyIds?: number[], coordinate?: { x: number; y: number }): LegacyMultiCellPoiRule => ({ kind: "multi-cell-poi", poiType, imageKey, sizeCells, ...(legacyIds ? { legacyIds } : {}), ...(coordinate ? { coordinate } : {}) });
const coordinateOverride = (
  imageKey: `poi:${string}`,
  x: number,
  y: number
): LegacyCoordinateTileOverride => ({
  kind: "coordinate-tile-override",
  imageKey,
  coordinate: { x, y }
});

/** Explicit table ported from the original map's POI image and size branches. */
export const legacyPoiRules: LegacyPoiRule[] = [
  rule("POI_MECHANICSTATION_MEDIUM", "poi:mechanic_station.png", 2),
  rule("POI_HIDEOUT_XL", "poi:hideout.png", 8),
  rule("POI_CAMP_LARGE", "poi:camp_large.jpg", 4),
  rule("POI_WAREHOUSE4_LARGE", "poi:warehouse4.png", 4),
  rule("POI_WAREHOUSE3_LARGE", "poi:warehouse3_large.png", 4),
  rule("POI_WAREHOUSE2_LARGE", "poi:warehouse2.jpg", 4),
  rule("POI_SILODISTRICT_XL", "poi:silodistrict.jpg", 8),
  rule("POI_RUINCITY_XL", "poi:scrapcity.jpg", 8),
  rule("POI_PACKINGSTATIONVEG_MEDIUM", "poi:packing_veg.jpg", 2),
  rule("POI_PACKINGSTATIONFRUIT_MEDIUM", "poi:packing_fruit.jpg", 2),
  rule("POI_CHEMLAKE_MEDIUM", "poi:chemlake_medium_3.jpg", 2, [12103]),
  rule("POI_CHEMLAKE_MEDIUM", "poi:chemlake_medium_2.jpg", 2, [12102]),
  rule("POI_CHEMLAKE_MEDIUM", "poi:chemlake_medium_1.jpg", 2),
  rule("POI_RUIN_MEDIUM", "poi:ruin_medium_3.jpg", 2, [12003]),
  rule("POI_RUIN_MEDIUM", "poi:ruin_medium_4.jpg", 2),
  rule("POI_FOREST_RUIN_MEDIUM", "poi:forest_ruin_medium_2.jpg", 2, [20402]),
  rule("POI_FOREST_RUIN_MEDIUM", "poi:forest_ruin_medium_1.jpg", 2),
  rule("POI_LAKE_UNDERWATER_MEDIUM", "poi:underwater_med_3.jpg", 2, [80203]),
  rule("POI_LAKE_UNDERWATER_MEDIUM", "poi:underwater_med_4.jpg", 2, [80202, 80204]),
  rule("POI_CRASHSITE_AREA", "poi:start_crashsite3.jpg", 2, [10103]),
  rule("POI_CRASHSITE_AREA", "poi:start_crashsite2.jpg", 2, [10102]),
  rule("POI_CRASHSITE_AREA", "poi:start_crashsite1.jpg", 2, [10101], { x: -38, y: -42 }),
  coordinateOverride("poi:start_crashsite_-37_-39.jpg", -37, -39),
  coordinateOverride("poi:start_crashsite_-37_-40.jpg", -37, -40),
  coordinateOverride("poi:start_crashsite_-36_-40.jpg", -36, -40),
  coordinateOverride("poi:start_crashsite_-36_-41.jpg", -36, -41),
  rule("POI_CAPSULESCRAPYARD_MEDIUM", "poi:capsule_scrapyard.jpg", 2),
  rule("POI_BURNTFOREST_FARMBOTSCRAPYARD_LARGE", "poi:burntforest_farmbot_scrapyard.jpg", 4),
  rule("POI_CRASHEDSHIP_LARGE", "poi:crashed_ship.jpg", 4),
  rule("POI_LABYRINTH_MEDIUM", "poi:labyrinth.jpg", 2),
  rule("POI_BUILDAREA_MEDIUM", "poi:buildarea.jpg", 2),
];

export function resolveOriginalPoiRule(poiType: string, legacyId?: number, x?: number, y?: number): LegacyPoiRule | undefined {
  const candidates = legacyPoiRules.filter(
    (entry): entry is LegacyMultiCellPoiRule =>
      entry.kind === "multi-cell-poi" && entry.poiType === poiType
  );
  return candidates.find((entry) => entry.coordinate?.x === x && entry.coordinate?.y === y && (!entry.legacyIds || entry.legacyIds.includes(legacyId ?? Number.NaN)))
    ?? candidates.find((entry) => !entry.coordinate && entry.legacyIds?.includes(legacyId ?? Number.NaN))
    ?? candidates.find((entry) => !entry.coordinate && !entry.legacyIds);
}
