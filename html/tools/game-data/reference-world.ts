import { readFile } from "node:fs/promises";
import type { CellBounds, WorldMap } from "../../src/domain/map-model.ts";

/**
 * Deliberately small, sanitized base-world fixture. It describes only the
 * public reference extent; player terrain is supplied by the local save reader
 * in the later personalized-map phase.
 */
export const referenceSurfaceBounds: CellBounds = { minX: -72, minY: -56, maxX: 71, maxY: 55 };

export function createReferenceSurface(gameVersion: string): WorldMap {
  return {
    id: "reference-surface",
    source: "reference",
    gameVersion,
    bounds: referenceSurfaceBounds,
    cells: [],
    locations: [],
    connections: [{ id: "surface-to-excavation-island", fromRegionId: "surface", toRegionId: "excavation-island" }],
  };
}

export async function loadReferenceSurface(path: string, gameVersion: string): Promise<WorldMap> {
  let world: WorldMap;
  try {
    world = JSON.parse(await readFile(path, "utf8")) as WorldMap;
  } catch {
    throw new Error("Default reference world is unavailable or invalid JSON.");
  }
  const expected = (referenceSurfaceBounds.maxX - referenceSurfaceBounds.minX + 1)
    * (referenceSurfaceBounds.maxY - referenceSurfaceBounds.minY + 1);
  if (
    world.id !== "reference-surface"
    || world.source !== "reference"
    || world.gameVersion !== gameVersion
    || JSON.stringify(world.bounds) !== JSON.stringify(referenceSurfaceBounds)
    || world.cells.length !== expected
    || world.seed === undefined
  ) {
    throw new Error("Default reference world does not contain the complete reviewed 1.0 surface.");
  }
  return world;
}
