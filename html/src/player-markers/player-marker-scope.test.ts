import { expect, it } from "vitest";
import type { WorldMap } from "../domain/map-model";
import { createPlayerMarkerScopeId } from "./player-marker-scope";

const referenceWorld: WorldMap = {
  id: "reference-surface",
  source: "reference",
  gameVersion: "0.7.0",
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  cells: [],
  locations: [],
  connections: []
};

const saveWorldA: WorldMap = {
  ...referenceWorld,
  id: "imported-save-a",
  source: "save",
  seed: 42,
  cells: [
    { x: 2, y: 1, uuid: "z-cell", rotation: 1, xOffset: 3, yOffset: 4, flags: 0, terrainType: "forest" },
    { x: 0, y: 0, uuid: "a-cell", rotation: 0, xOffset: 0, yOffset: 0, flags: 1, terrainType: "field" }
  ]
};

const saveWorldB: WorldMap = {
  ...saveWorldA,
  id: "imported-save-b",
  cells: [
    ...saveWorldA.cells.slice(0, 1),
    { x: 1, y: 0, uuid: "different-cell", rotation: 0, xOffset: 0, yOffset: 0, flags: 1, terrainType: "field" }
  ]
};

it("uses one fixed scope for the built-in map", async () => {
  expect(await createPlayerMarkerScopeId(referenceWorld)).toBe("default");
});

it("returns the same scope after a save file is renamed", async () => {
  expect(await createPlayerMarkerScopeId(saveWorldA))
    .toBe(await createPlayerMarkerScopeId({ ...saveWorldA, id: "renamed" }));
});

it("returns different scopes for different layouts sharing a seed", async () => {
  expect(await createPlayerMarkerScopeId(saveWorldA))
    .not.toBe(await createPlayerMarkerScopeId(saveWorldB));
});

it("ignores unstable cell order and non-layout cell fields", async () => {
  const reordered = {
    ...saveWorldA,
    cells: [
      { ...saveWorldA.cells[1]!, flags: 999, terrainType: "changed" },
      { ...saveWorldA.cells[0]!, flags: 123, terrainType: "changed" }
    ]
  };

  expect(await createPlayerMarkerScopeId(reordered))
    .toBe(await createPlayerMarkerScopeId(saveWorldA));
});

it("includes offsets and rotation when otherwise-identical cells are ordered", async () => {
  const baseCell = saveWorldA.cells[0]!;
  const withOffset = {
    ...saveWorldA,
    cells: [{ ...baseCell, xOffset: baseCell.xOffset + 1 }]
  };
  const withRotation = {
    ...saveWorldA,
    cells: [{ ...baseCell, rotation: 2 as const }]
  };
  const baseline = { ...saveWorldA, cells: [baseCell] };

  expect(await createPlayerMarkerScopeId(withOffset))
    .not.toBe(await createPlayerMarkerScopeId(baseline));
  expect(await createPlayerMarkerScopeId(withRotation))
    .not.toBe(await createPlayerMarkerScopeId(baseline));
});
