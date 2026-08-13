import { describe, expect, it } from "vitest";
import type { TerrainCell } from "../domain/map-model";
import { createPoiMapInstances, genericPoiName } from "./poi-instances";

const WAREHOUSE_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function poiCell(
  x: number,
  y: number,
  xOffset: number,
  yOffset: number,
  rotation: 0 | 1 | 2 | 3,
  uuid = WAREHOUSE_UUID,
  poiType = "POI_WAREHOUSE2_LARGE"
): TerrainCell {
  return {
    x,
    y,
    uuid,
    rotation,
    xOffset,
    yOffset,
    flags: 0,
    terrainType: "poi",
    poiType
  };
}

function warehouse(
  originX: number,
  originY: number,
  rotation: 0 | 1 | 2 | 3 = 0
): TerrainCell[] {
  return Array.from({ length: 16 }, (_, index) => {
    const xOffset = index % 4;
    const yOffset = Math.floor(index / 4);
    const [x, y] =
      rotation === 0 ? [originX + xOffset, originY + yOffset] :
      rotation === 1 ? [originX + 3 - yOffset, originY + xOffset] :
      rotation === 2 ? [originX + 3 - xOffset, originY + 3 - yOffset] :
      [originX + yOffset, originY + 3 - xOffset];
    return poiCell(x, y, xOffset, yOffset, rotation);
  });
}

describe("genericPoiName", () => {
  it.each([
    ["POI_WAREHOUSE2_LARGE", "Warehouse"],
    ["POI_WAREHOUSE4_LARGE", "Warehouse"],
    ["POI_RUINCITY_XL", "Ruined City"],
    ["POI_HIDEOUT_XL", "Hideout"],
    ["POI_PACKINGSTATIONFRUIT_MEDIUM", "Fruit Packing Station"],
    ["POI_PACKINGSTATIONVEG_MEDIUM", "Vegetable Packing Station"],
    ["POI_ROAD_SCHEMATICSTATION", "Schematic Station"],
    ["POI_ROAD_KIOSK", "Kiosk"],
    ["POI_BUNK_BURIAL_QUEST_MEDIUM", "Investigation Shelter"],
    ["POI_ROAD_CHEMPOOL", "Chemical Pool Facility"],
    ["POI_FARMINGPATCH", "Farm Plot"]
  ])("maps %s to its safe generic name", (poiType, expected) => {
    expect(genericPoiName(poiType)).toBe(expected);
  });

  it("does not expose an unknown internal POI type", () => {
    expect(genericPoiName("POI_UNKNOWN")).toBeUndefined();
  });
});

describe("createPoiMapInstances", () => {
  it("groups one orthogonally connected 4 by 4 warehouse", () => {
    expect(createPoiMapInstances(warehouse(10, 20))).toEqual([
      {
        id: `POI_WAREHOUSE2_LARGE:${WAREHOUSE_UUID}:10:20`,
        uuid: WAREHOUSE_UUID,
        poiType: "POI_WAREHOUSE2_LARGE",
        name: "Warehouse",
        origin: { x: 10, y: 20 },
        span: { width: 4, height: 4 },
        center: { x: 12, y: 22 }
      }
    ]);
  });

  it("treats a rotated multi-cell warehouse as one instance, not one per cell", () => {
    const instances = createPoiMapInstances(warehouse(10, 20, 1));

    expect(instances).toHaveLength(1);
    expect(instances).toEqual([
      expect.objectContaining({
        origin: { x: 10, y: 20 },
        span: { width: 4, height: 4 },
        center: { x: 12, y: 22 }
      })
    ]);
  });

  it("keeps touching warehouses separate when their local offsets restart", () => {
    const instances = createPoiMapInstances([
      ...warehouse(0, 0),
      ...warehouse(4, 0)
    ]);

    expect(instances).toHaveLength(2);
    expect(instances.map(({ origin, span }) => ({ origin, span }))).toEqual([
      { origin: { x: 0, y: 0 }, span: { width: 4, height: 4 } },
      { origin: { x: 4, y: 0 }, span: { width: 4, height: 4 } }
    ]);
    expect(new Set(instances.map(({ id }) => id)).size).toBe(2);
  });

  it("keeps disconnected repeated warehouses separate without numbering names", () => {
    const instances = createPoiMapInstances([
      ...warehouse(20, 30),
      ...warehouse(-5, -10)
    ]);

    expect(instances).toHaveLength(2);
    expect(instances.map(({ origin }) => origin)).toEqual([
      { x: -5, y: -10 },
      { x: 20, y: 30 }
    ]);
    expect(new Set(instances.map(({ id }) => id)).size).toBe(2);
    expect(instances.map(({ name }) => name)).toEqual([
      "Warehouse",
      "Warehouse"
    ]);
  });
});
