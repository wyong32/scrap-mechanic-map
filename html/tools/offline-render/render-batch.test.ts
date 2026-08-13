import { expect, it } from "vitest";
import { selectTerrainRenderCandidates } from "./render-batch.ts";

it("selects 1.0 surface tiles while retaining the canonical deep-water surface", () => {
  const rows = [
    {
      uuid: "11111111-1111-4111-8111-111111111111",
      relativePath: "Survival/Terrain/Tiles/road/Road_64_01.tile",
      width: 1,
      height: 1,
      version: 15
    },
    {
      uuid: "22222222-2222-4222-8222-222222222222",
      relativePath: "Survival/Terrain/Tiles/lake/Lake(1111)_01.tile",
      width: 1,
      height: 1,
      version: 15
    },
    {
      uuid: "33333333-3333-4333-8333-333333333333",
      relativePath: "Survival/DungeonTiles/GrowLab.tile",
      width: 4,
      height: 4,
      version: 15
    }
  ];

  expect(selectTerrainRenderCandidates(rows)).toEqual([rows[0]]);
});

it("rejects non-v15 terrain inputs instead of silently producing a false map", () => {
  expect(() => selectTerrainRenderCandidates([{
    uuid: "44444444-4444-4444-8444-444444444444",
    relativePath: "Survival/Terrain/Tiles/road/old.tile",
    width: 1,
    height: 1,
    version: 14
  }])).toThrow("version 14");
});
