import type { TerrainCell } from "../domain/map-model";

export interface PoiMapInstance {
  id: string;
  uuid: string;
  poiType: string;
  name?: string;
  origin: { x: number; y: number };
  span: { width: number; height: number };
  center: { x: number; y: number };
}

export function genericPoiName(
  poiType: string,
  _tilePath?: string
): string | undefined {
  if (/^POI_WAREHOUSE/.test(poiType)) return "Warehouse";
  if (poiType === "POI_RUINCITY_XL") return "Ruined City";
  if (poiType === "POI_HIDEOUT_XL") return "Hideout";
  if (poiType === "POI_PACKINGSTATIONFRUIT_MEDIUM") return "Fruit Packing Station";
  if (poiType === "POI_PACKINGSTATIONVEG_MEDIUM") return "Vegetable Packing Station";
  if (poiType === "POI_ROAD_SCHEMATICSTATION") return "Schematic Station";
  if (poiType === "POI_ROAD_KIOSK") return "Kiosk";
  if (poiType === "POI_BUNK_BURIAL_QUEST_MEDIUM") return "Investigation Shelter";
  if (poiType === "POI_ROAD_CHEMPOOL") return "Chemical Pool Facility";
  if (poiType === "POI_FARMINGPATCH") return "Farm Plot";
  return undefined;
}

function coordinateKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function placementKey(cell: TerrainCell): string {
  if (cell.rotation === 0) {
    return `${cell.x - cell.xOffset}:${cell.y - cell.yOffset}:0`;
  }
  if (cell.rotation === 1) {
    return `${cell.x + cell.yOffset}:${cell.y - cell.xOffset}:1`;
  }
  if (cell.rotation === 2) {
    return `${cell.x + cell.xOffset}:${cell.y + cell.yOffset}:2`;
  }
  return `${cell.x - cell.yOffset}:${cell.y + cell.xOffset}:3`;
}

export function createPoiMapInstances(
  cells: readonly TerrainCell[]
): PoiMapInstance[] {
  const groups = new Map<string, Map<string, TerrainCell>>();

  for (const cell of cells) {
    if (!cell.poiType) continue;
    const groupKey =
      `${cell.uuid}\0${cell.poiType}\0${placementKey(cell)}`;
    const group = groups.get(groupKey) ?? new Map<string, TerrainCell>();
    group.set(coordinateKey(cell.x, cell.y), cell);
    groups.set(groupKey, group);
  }

  const instances: PoiMapInstance[] = [];
  for (const group of groups.values()) {
    const remaining = new Map(group);

    while (remaining.size > 0) {
      const first = remaining.values().next().value as TerrainCell;
      const pending = [first];
      remaining.delete(coordinateKey(first.x, first.y));
      let minX = first.x;
      let minY = first.y;
      let maxX = first.x;
      let maxY = first.y;

      for (let index = 0; index < pending.length; index += 1) {
        const cell = pending[index]!;
        minX = Math.min(minX, cell.x);
        minY = Math.min(minY, cell.y);
        maxX = Math.max(maxX, cell.x);
        maxY = Math.max(maxY, cell.y);

        for (const [x, y] of [
          [cell.x - 1, cell.y],
          [cell.x + 1, cell.y],
          [cell.x, cell.y - 1],
          [cell.x, cell.y + 1]
        ]) {
          const neighborKey = coordinateKey(x, y);
          const neighbor = remaining.get(neighborKey);
          if (!neighbor) continue;
          remaining.delete(neighborKey);
          pending.push(neighbor);
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const { uuid } = first;
      const poiType = first.poiType!;
      const name = genericPoiName(poiType);
      instances.push({
        id: `${poiType}:${uuid}:${minX}:${minY}`,
        uuid,
        poiType,
        ...(name ? { name } : {}),
        origin: { x: minX, y: minY },
        span: { width, height },
        center: { x: minX + width / 2, y: minY + height / 2 }
      });
    }
  }

  return instances.sort(
    (left, right) =>
      left.origin.y - right.origin.y ||
      left.origin.x - right.origin.x ||
      left.poiType.localeCompare(right.poiType) ||
      left.uuid.localeCompare(right.uuid)
  );
}
