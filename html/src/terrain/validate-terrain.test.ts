import { expect, it } from "vitest";
import type { WorldMap } from "../domain/map-model";
import { validateTerrain } from "./validate-terrain";
import type { TileCatalog } from "./normalize-terrain";

const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const catalog: TileCatalog = {
  gameVersion: "1.0.0",
  tiles: { [uuid]: { terrainType: "meadow" } }
};
const validWorld: WorldMap = {
  id: "personal-surface",
  source: "save",
  gameVersion: "1.0.0",
  saveVersion: 28,
  seed: 42,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
  cells: [
    { x: 0, y: 0, uuid, rotation: 0, xOffset: 0, yOffset: 0, flags: 0, terrainType: "meadow" },
    { x: 1, y: 0, uuid, rotation: 1, xOffset: 0, yOffset: 0, flags: 0, terrainType: "meadow" }
  ],
  locations: [],
  connections: []
};

it("reports a complete valid terrain world", () => {
  expect(validateTerrain(validWorld, catalog)).toEqual({
    valid: true,
    expectedCellCount: 2,
    actualCellCount: 2,
    duplicateCoordinates: [],
    missingCoordinates: [],
    unknownUuids: [],
    errors: []
  });
});

it("reports duplicate, missing, unknown and invariant failures together", () => {
  const unknown = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeee2";
  const report = validateTerrain({
    ...validWorld,
    cells: [
      validWorld.cells[0]!,
      { ...validWorld.cells[0]!, uuid: unknown, rotation: 7 as 0 }
    ]
  }, catalog);

  expect(report.valid).toBe(false);
  expect(report.expectedCellCount).toBe(2);
  expect(report.actualCellCount).toBe(2);
  expect(report.duplicateCoordinates).toEqual(["0,0"]);
  expect(report.missingCoordinates).toEqual(["1,0"]);
  expect(report.unknownUuids).toEqual([unknown]);
  expect(report.errors).toContain("Cell 0,0 has invalid rotation 7.");
});

it("reports malformed cell identity and coordinates outside world bounds", () => {
  const report = validateTerrain({
    ...validWorld,
    cells: [
      { ...validWorld.cells[0]!, uuid: "not-a-uuid", x: -1 },
      validWorld.cells[1]!
    ]
  }, catalog);

  expect(report.valid).toBe(false);
  expect(report.errors).toContain("Cell -1,0 has a malformed UUID.");
  expect(report.errors).toContain("Cell -1,0 lies outside world bounds.");
});
