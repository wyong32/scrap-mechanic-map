import { describe, expect, it } from "vitest";
import type { MapLocation, TerrainCell, WorldMap } from "../domain/map-model";
import { buildLocationNameInventory } from "./location-name-inventory";

function location(name: string, x: number, y: number): MapLocation {
  return {
    id: name.toLowerCase().replaceAll(" ", "-"),
    regionId: "surface",
    name,
    category: "poi",
    precision: "area-reference",
    position: { x, y },
    questIds: [],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  };
}

function boundsLocation(
  name: string,
  bounds: NonNullable<MapLocation["bounds"]>
): MapLocation {
  return {
    id: name.toLowerCase().replaceAll(" ", "-"),
    regionId: "surface",
    name,
    category: "quest",
    precision: "area-reference",
    bounds,
    questIds: [],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  };
}

function poiCell(
  x: number,
  y: number,
  poiType: string,
  uuid: string
): TerrainCell {
  return {
    x,
    y,
    uuid,
    rotation: 0,
    xOffset: 0,
    yOffset: 0,
    flags: 0,
    terrainType: "poi",
    poiType
  };
}

function world(
  locations: MapLocation[] = [],
  cells: TerrainCell[] = []
): WorldMap {
  return {
    id: "surface",
    source: "reference",
    gameVersion: "1.0",
    bounds: { minX: -64, minY: -64, maxX: 64, maxY: 64 },
    cells,
    locations,
    connections: []
  };
}

describe("buildLocationNameInventory", () => {
  it("groups fixed locations and classified generated placements", () => {
    expect(
      buildLocationNameInventory(
        world(
          [location("Mechanic Station", -36, -40)],
          [
            poiCell(4, 3, "POI_WAREHOUSE2_LARGE", "warehouse-one"),
            poiCell(10, 8, "POI_WAREHOUSE3_LARGE", "warehouse-two")
          ]
        )
      )
    ).toEqual({
      groups: [
        {
          id: "fixed-story",
          name: "Fixed & Story Locations",
          count: 1,
          types: [
            {
              id: "fixed:mechanic-station",
              name: "Mechanic Station",
              count: 1
            }
          ]
        },
        {
          id: "generated",
          name: "Generated Locations",
          count: 2,
          types: [
            {
              id: "generated:warehouse",
              name: "Warehouse",
              count: 2
            }
          ]
        }
      ],
      instances: [
        {
          id: "fixed:mechanic-station",
          source: "fixed-story",
          typeId: "fixed:mechanic-station",
          label: "Mechanic Station",
          position: { x: -36, y: -40 }
        },
        {
          id: "generated:warehouse:4:3",
          source: "generated",
          typeId: "generated:warehouse",
          label: "Warehouse",
          position: { x: 4.5, y: 3.5 }
        },
        {
          id: "generated:warehouse:10:8",
          source: "generated",
          typeId: "generated:warehouse",
          label: "Warehouse",
          position: { x: 10.5, y: 8.5 }
        }
      ]
    });
  });

  it("omits zero-count groups and unsupported generated POIs", () => {
    expect(
      buildLocationNameInventory(
        world([], [poiCell(0, 0, "POI_TEST", "unsupported")])
      )
    ).toEqual({ groups: [], instances: [] });
  });

  it("uses the center of fixed-location bounds when position is absent", () => {
    expect(
      buildLocationNameInventory(
        world([
          boundsLocation("Excavation Island Entrance", {
            minX: -8,
            minY: 10,
            maxX: 3,
            maxY: 14
          })
        ])
      )
    ).toEqual({
      groups: [
        {
          id: "fixed-story",
          name: "Fixed & Story Locations",
          count: 1,
          types: [
            {
              id: "fixed:excavation-island-entrance",
              name: "Excavation Island Entrance",
              count: 1
            }
          ]
        }
      ],
      instances: [
        {
          id: "fixed:excavation-island-entrance",
          source: "fixed-story",
          typeId: "fixed:excavation-island-entrance",
          label: "Excavation Island Entrance",
          position: { x: -2.5, y: 12 }
        }
      ]
    });
  });

  it("sorts types by English name and instances by Y, X, then ID", () => {
    const inventory = buildLocationNameInventory(
      world(
        [
          location("Zebra", 4.5, 4.5),
          location("Alpha", 8, -1),
          location("Middle", 0, 4.5)
        ],
        [
          poiCell(4, 4, "POI_WAREHOUSE2_LARGE", "warehouse"),
          poiCell(0, 10, "POI_CAMP", "camp")
        ]
      )
    );

    expect(inventory.groups.map((group) => group.types.map((type) => type.name)))
      .toEqual([
        ["Alpha", "Middle", "Zebra"],
        ["Camps & Ruins", "Warehouse"]
      ]);
    expect(inventory.instances.map((instance) => instance.id)).toEqual([
      "fixed:alpha",
      "fixed:middle",
      "fixed:zebra",
      "generated:warehouse:4:4",
      "generated:camps-ruins:0:10"
    ]);
  });
});
