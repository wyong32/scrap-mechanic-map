import type { MapLocation, MapRepository, RegionDefinition, WorldMap } from "../domain/map-model";

type FetchJson = <T>(path: string) => Promise<T>;

function createFetchJson(basePath: string): FetchJson {
  return async <T>(path: string): Promise<T> => {
    const response = await fetch(`${basePath}/${path}`);
    if (!response.ok) {
      throw new Error(`Unable to load map data: ${path}`);
    }

    return (await response.json()) as T;
  };
}

export class JsonMapRepository implements MapRepository {
  private readonly fetchJson: FetchJson;

  constructor(basePath = "/data") {
    this.fetchJson = createFetchJson(basePath);
  }

  loadRegions(): Promise<RegionDefinition[]> {
    return this.fetchJson<RegionDefinition[]>("regions.json");
  }

  loadLocations(): Promise<MapLocation[]> {
    return this.fetchJson<MapLocation[]>("locations.json");
  }

  async loadWorld(regionId: string): Promise<WorldMap> {
    const regions = await this.loadRegions();
    const region = regions.find((candidate) => candidate.id === regionId);
    if (region === undefined) {
      throw new Error(`Unknown map region: ${regionId}`);
    }

    const [referenceWorld, locations] = await Promise.all([
      this.fetchJson<WorldMap>("reference-world.json"),
      this.loadLocations(),
    ]);

    const regionLocations = locations.filter((location) => location.regionId === regionId);
    if (region.id === "surface") {
      return { ...referenceWorld, locations: regionLocations };
    }

    return {
      id: region.id,
      source: region.source === "reference" ? "reference" : "fixed-region",
      gameVersion: referenceWorld.gameVersion,
      bounds: region.bounds,
      cells: [],
      locations: regionLocations,
      connections: [],
    };
  }
}
