import type { CellBounds, MapLocation } from "../../src/domain/map-model.ts";

interface RegionBounds { id: string; bounds: CellBounds }

function center(bounds: CellBounds): { x: number; y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function regionLabel(region: RegionBounds, name: string, category: string, extras: Pick<MapLocation, "questIds" | "resourceIds" | "enemyIds" | "relatedRegionIds">): MapLocation {
  return { id: region.id, regionId: region.id, name, category, precision: "area-reference", position: center(region.bounds), bounds: region.bounds, ...extras };
}

/** Stable guide labels. Coordinates are region-local references, never save-derived facts. */
export function buildReferenceLocations(regions: RegionBounds[]): MapLocation[] {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const requireRegion = (id: string): RegionBounds => {
    const region = byId.get(id);
    if (!region) throw new Error(`location catalog references missing region '${id}'`);
    return region;
  };
  const labels: Array<[string, string, string, Pick<MapLocation, "questIds" | "resourceIds" | "enemyIds" | "relatedRegionIds">]> = [
    ["excavation-island", "Excavation Island Entrance", "quest", { questIds: ["excavation"], resourceIds: [], enemyIds: [], relatedRegionIds: ["surface"] }],
    ...[1, 2, 3, 4, 5, 6, 7].map((number): [string, string, string, Pick<MapLocation, "questIds" | "resourceIds" | "enemyIds" | "relatedRegionIds">] => [`grow-lab-${number}`, `Grow Lab ${number}`, "quest", { questIds: [`grow-lab-${number}`], resourceIds: [], enemyIds: [], relatedRegionIds: [] }]),
    ["mining-hub", "Mining Hub", "poi", { questIds: [], resourceIds: ["ore"], enemyIds: [], relatedRegionIds: [] }],
    ["scrapyard", "Scrapyard", "poi", { questIds: [], resourceIds: [], enemyIds: ["farmbot"], relatedRegionIds: [] }],
    ...[1, 2].map((number): [string, string, string, Pick<MapLocation, "questIds" | "resourceIds" | "enemyIds" | "relatedRegionIds">] => [`underground-station-${number}`, `Underground Station ${number}`, "poi", { questIds: [], resourceIds: [], enemyIds: [], relatedRegionIds: [] }]),
    ["final-boss-hall", "Final Boss Hall", "boss", { questIds: [], resourceIds: [], enemyIds: ["final-boss"], relatedRegionIds: [] }],
    ["trashbot-boss", "Trashbot Boss Area", "boss", { questIds: [], resourceIds: [], enemyIds: ["trashbot"], relatedRegionIds: [] }],
    ...[1, 2].map((number): [string, string, string, Pick<MapLocation, "questIds" | "resourceIds" | "enemyIds" | "relatedRegionIds">] => [`drilling-area-${number}`, `Drilling Area ${number}`, "resource", { questIds: [], resourceIds: ["drill"], enemyIds: [], relatedRegionIds: [] }]),
    ["underground-guidance", "Underground Guidance Area", "guide", { questIds: [], resourceIds: [], enemyIds: [], relatedRegionIds: [] }],
  ];
  const surface = requireRegion("surface");
  return [
    { id: "mechanic-station", regionId: "surface", name: "Mechanic Station", category: "poi", precision: "area-reference" as const, position: { x: -36, y: -40 }, bounds: { minX: -40, minY: -44, maxX: -32, maxY: -36 }, questIds: [], resourceIds: [], enemyIds: [], relatedRegionIds: [] },
    ...labels.map(([id, name, category, extras]) => regionLabel(requireRegion(id), name, category, extras)),
  ].map((location) => ({ ...location, bounds: location.bounds ?? surface.bounds }));
}
