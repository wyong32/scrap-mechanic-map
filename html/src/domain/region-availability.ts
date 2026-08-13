const AVAILABLE_REGION_IDS = new Set(["surface"]);

export function isRegionAvailable(regionId: string): boolean {
  return AVAILABLE_REGION_IDS.has(regionId);
}
