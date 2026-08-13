import type { WorldMap } from "../domain/map-model";
import type { TileCatalog } from "./normalize-terrain";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TerrainValidationReport {
  valid: boolean;
  expectedCellCount: number;
  actualCellCount: number;
  duplicateCoordinates: string[];
  missingCoordinates: string[];
  unknownUuids: string[];
  errors: string[];
}

export function validateTerrain(
  world: WorldMap,
  catalog: TileCatalog
): TerrainValidationReport {
  const width = world.bounds.maxX - world.bounds.minX + 1;
  const height = world.bounds.maxY - world.bounds.minY + 1;
  const expectedCellCount =
    Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
      ? width * height
      : 0;
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unknown = new Set<string>();
  const errors: string[] = [];

  for (const cell of world.cells) {
    const coordinate = `${cell.x},${cell.y}`;
    if (seen.has(coordinate)) duplicates.add(coordinate);
    seen.add(coordinate);
    if (!catalog.tiles[cell.uuid.toLowerCase()]) unknown.add(cell.uuid.toLowerCase());
    if (!UUID_PATTERN.test(cell.uuid.toLowerCase())) {
      errors.push(`Cell ${coordinate} has a malformed UUID.`);
    }
    if (
      cell.x < world.bounds.minX
      || cell.x > world.bounds.maxX
      || cell.y < world.bounds.minY
      || cell.y > world.bounds.maxY
    ) {
      errors.push(`Cell ${coordinate} lies outside world bounds.`);
    }
    if (!Number.isInteger(cell.rotation) || cell.rotation < 0 || cell.rotation > 3) {
      errors.push(`Cell ${coordinate} has invalid rotation ${cell.rotation}.`);
    }
    for (const [name, value] of [
      ["x", cell.x],
      ["y", cell.y],
      ["xOffset", cell.xOffset],
      ["yOffset", cell.yOffset],
      ["flags", cell.flags]
    ] as const) {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        errors.push(`Cell ${coordinate} has invalid ${name}.`);
      }
    }
  }

  const missingCoordinates: string[] = [];
  if (expectedCellCount > 0) {
    for (let y = world.bounds.minY; y <= world.bounds.maxY; y += 1) {
      for (let x = world.bounds.minX; x <= world.bounds.maxX; x += 1) {
        const coordinate = `${x},${y}`;
        if (!seen.has(coordinate)) missingCoordinates.push(coordinate);
      }
    }
  } else {
    errors.push("World bounds are empty or invalid.");
  }
  const duplicateCoordinates = [...duplicates].sort();
  const unknownUuids = [...unknown].sort();
  if (world.cells.length !== expectedCellCount) {
    errors.push(
      `Terrain cell count is ${world.cells.length}; expected ${expectedCellCount}.`
    );
  }
  if (duplicateCoordinates.length > 0) {
    errors.push(`Terrain has ${duplicateCoordinates.length} duplicate coordinate(s).`);
  }
  if (missingCoordinates.length > 0) {
    errors.push(`Terrain has ${missingCoordinates.length} missing coordinate(s).`);
  }
  if (unknownUuids.length > 0) {
    errors.push(`Terrain has ${unknownUuids.length} unknown tile UUID(s).`);
  }
  return {
    valid: errors.length === 0,
    expectedCellCount,
    actualCellCount: world.cells.length,
    duplicateCoordinates,
    missingCoordinates,
    unknownUuids,
    errors
  };
}
