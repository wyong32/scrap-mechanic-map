import type { WorldMap } from "../domain/map-model";
import { classifyGeneratedPoi } from "./location-type-catalog";
import { createPoiMapInstances } from "./poi-instances";

export interface LocationNameInstance {
  id: string;
  source: "fixed-story" | "generated";
  typeId: string;
  label: string;
  position: { x: number; y: number };
}

export interface LocationNameType {
  id: string;
  name: string;
  count: number;
}

export interface LocationNameGroup {
  id: "fixed-story" | "generated";
  name: string;
  count: number;
  types: LocationNameType[];
}

export interface LocationNameInventory {
  groups: LocationNameGroup[];
  instances: LocationNameInstance[];
}

const groupNames = {
  "fixed-story": "Fixed & Story Locations",
  generated: "Generated Locations"
} as const;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sortTypes(types: Iterable<LocationNameType>): LocationNameType[] {
  return [...types].sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export function buildLocationNameInventory(world: WorldMap): LocationNameInventory {
  const instances: LocationNameInstance[] = [];
  const fixedTypes = new Map<string, LocationNameType>();
  const generatedTypes = new Map<string, LocationNameType>();

  for (const location of world.locations) {
    const position = location.position ??
      (location.bounds
        ? {
            x: (location.bounds.minX + location.bounds.maxX) / 2,
            y: (location.bounds.minY + location.bounds.maxY) / 2
          }
        : undefined);
    if (!position) continue;

    const typeId = `fixed:${slug(location.name)}`;
    instances.push({
      id: typeId,
      source: "fixed-story",
      typeId,
      label: location.name,
      position: { x: position.x, y: position.y }
    });
    const type = fixedTypes.get(typeId);
    if (type) {
      type.count += 1;
    } else {
      fixedTypes.set(typeId, { id: typeId, name: location.name, count: 1 });
    }
  }

  for (const poi of createPoiMapInstances(world.cells)) {
    const classification = classifyGeneratedPoi(poi.poiType);
    if (!classification) continue;

    instances.push({
      id: `${classification.typeId}:${poi.origin.x}:${poi.origin.y}`,
      source: "generated",
      typeId: classification.typeId,
      label: classification.label,
      position: { x: poi.center.x, y: poi.center.y }
    });
    const type = generatedTypes.get(classification.typeId);
    if (type) {
      type.count += 1;
    } else {
      generatedTypes.set(classification.typeId, {
        id: classification.typeId,
        name: classification.typeName,
        count: 1
      });
    }
  }

  const groups: LocationNameGroup[] = [];
  if (fixedTypes.size > 0) {
    groups.push({
      id: "fixed-story",
      name: groupNames["fixed-story"],
      count: [...fixedTypes.values()].reduce((total, type) => total + type.count, 0),
      types: sortTypes(fixedTypes.values())
    });
  }
  if (generatedTypes.size > 0) {
    groups.push({
      id: "generated",
      name: groupNames.generated,
      count: [...generatedTypes.values()].reduce(
        (total, type) => total + type.count,
        0
      ),
      types: sortTypes(generatedTypes.values())
    });
  }

  return {
    groups,
    instances: instances.sort(
      (left, right) =>
        left.position.y - right.position.y ||
        left.position.x - right.position.x ||
        left.id.localeCompare(right.id, "en")
    )
  };
}
