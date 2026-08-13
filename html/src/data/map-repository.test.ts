import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapLocation, RegionDefinition, WorldMap } from "../domain/map-model";
import { JsonMapRepository } from "./map-repository";

const regions: RegionDefinition[] = [
  {
    id: "surface",
    name: "Surface",
    group: "surface",
    source: "reference",
    bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 },
  },
  {
    id: "excavation-island",
    name: "Excavation Island",
    group: "story",
    source: "fixed-region",
    bounds: { minX: -8, minY: -8, maxX: 8, maxY: 8 },
  },
];

const referenceWorld: WorldMap = {
  id: "reference-surface",
  source: "reference",
  gameVersion: "1.0.0",
  bounds: regions[0].bounds,
  cells: [
    {
      x: 0,
      y: 0,
      uuid: "surface-cell",
      rotation: 0,
      xOffset: 0,
      yOffset: 0,
      flags: 0,
      terrainType: "meadow",
    },
  ],
  locations: [],
  connections: [],
};

const locations: MapLocation[] = [
  {
    id: "mechanic-station",
    regionId: "surface",
    name: "Mechanic Station",
    category: "poi",
    precision: "exact",
    questIds: [],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: [],
  },
  {
    id: "excavation-entry",
    regionId: "excavation-island",
    name: "Excavation Entry",
    category: "quest",
    precision: "exact",
    questIds: [],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: [],
  },
];

function installFixtureFetch(): void {
  const dataByPath = new Map<string, unknown>([
    ["/data/regions.json", regions],
    ["/data/reference-world.json", referenceWorld],
    ["/data/locations.json", locations],
  ]);

  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const data = dataByPath.get(String(input));
    return new Response(JSON.stringify(data), { status: data === undefined ? 404 : 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("JsonMapRepository.loadWorld", () => {
  it("returns the global location catalog without changing region worlds", async () => {
    installFixtureFetch();

    const repository = new JsonMapRepository();
    const catalog = await repository.loadLocations();
    const surface = await repository.loadWorld("surface");

    expect(catalog.map((location) => location.id)).toEqual([
      "mechanic-station",
      "excavation-entry",
    ]);
    expect(surface.locations.map((location) => location.id)).toEqual([
      "mechanic-station",
    ]);
  });

  it("returns the reference terrain for the surface region", async () => {
    installFixtureFetch();

    const world = await new JsonMapRepository().loadWorld("surface");

    expect(world).toMatchObject({
      id: "reference-surface",
      source: "reference",
      bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 },
      cells: [{ uuid: "surface-cell" }],
      locations: [{ id: "mechanic-station" }],
    });
  });

  it("returns fixture bounds and source for a fixed region", async () => {
    installFixtureFetch();

    const world = await new JsonMapRepository().loadWorld("excavation-island");

    expect(world).toMatchObject({
      id: "excavation-island",
      source: "fixed-region",
      bounds: { minX: -8, minY: -8, maxX: 8, maxY: 8 },
      cells: [],
      connections: [],
      locations: [{ id: "excavation-entry" }],
    });
  });

  it("rejects an unknown region ID", async () => {
    installFixtureFetch();

    await expect(new JsonMapRepository().loadWorld("not-a-region")).rejects.toThrow(
      "Unknown map region: not-a-region",
    );
  });
});
