import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorldMap } from "../../src/domain/map-model.ts";
import type { TileDefinition } from "../game-data/extract-catalog.ts";
import { buildGrowLabCaptureJob } from "./grow-lab-job.ts";

const worldEnvelope = JSON.parse(
  readFileSync("public/data/generated/worlds/growlab_01.json", "utf8"),
) as { world: WorldMap };
const catalogEnvelope = JSON.parse(
  readFileSync("public/data/generated/tile-catalog.json", "utf8"),
) as { tiles: TileDefinition[] };

const cloneWorld = (): WorldMap => structuredClone(worldEnvelope.world);
const cloneTiles = (): TileDefinition[] => structuredClone(catalogEnvelope.tiles);

describe("buildGrowLabCaptureJob", () => {
  it("derives the one official 10x10 tile inside the 16x16 Grow Lab 1 canvas", () => {
    expect(buildGrowLabCaptureJob(cloneWorld(), cloneTiles())).toEqual({
      regionId: "grow-lab-1",
      worldId: "growlab_01",
      gameVersion: "1.0.0",
      sourceTile: {
        uuid: "d3d4d976-d2a6-4d21-95bd-fada26b6b371",
        relativePath:
          "Survival/DungeonTiles/Minidungeon/Minidungeon_Interior_01.tile",
        widthCells: 10,
        heightCells: 10,
      },
      worldBounds: { minX: -8, minY: -8, maxX: 7, maxY: 7 },
      sourceOriginCells: { x: 3, y: 3 },
      pixelsPerCell: 128,
      outputPixels: { width: 2048, height: 2048 },
      layers: [
        "terrain",
        "surfaces",
        "structures",
        "props",
        "vegetation",
        "shadows",
        "effects",
      ],
    });
  });

  it("rejects mixed UUIDs and non-zero rotations without leaking a game path", () => {
    const mixed = cloneWorld();
    mixed.cells[0].uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(() => buildGrowLabCaptureJob(mixed, cloneTiles())).toThrow(
      "Grow Lab 1 is not the reviewed official capture source.",
    );

    const rotated = cloneWorld();
    rotated.cells[0].rotation = 1;
    expect(() => buildGrowLabCaptureJob(rotated, cloneTiles())).toThrow(
      "Grow Lab 1 is not the reviewed official capture source.",
    );
  });

  it("rejects a non-rectangular 10x10 placement", () => {
    const world = cloneWorld();
    world.cells.pop();
    expect(() => buildGrowLabCaptureJob(world, cloneTiles())).toThrow(
      /10x10 rectangular source extent/,
    );
  });

  it("rejects an absolute catalog path without echoing it", () => {
    const tiles = cloneTiles();
    const tile = tiles.find(
      ({ uuid }) => uuid === "d3d4d976-d2a6-4d21-95bd-fada26b6b371",
    )!;
    tile.relativePath =
      "G:\\shared\\Scrap Mechanic\\Survival\\DungeonTiles\\Minidungeon\\Minidungeon_Interior_01.tile";

    let message = "";
    try {
      buildGrowLabCaptureJob(cloneWorld(), tiles);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/reviewed official tile definition/);
    expect(message).not.toContain("G:\\");
  });

  it("rejects catalog dimensions that do not match the reviewed extent", () => {
    const tiles = cloneTiles();
    const tile = tiles.find(
      ({ uuid }) => uuid === "d3d4d976-d2a6-4d21-95bd-fada26b6b371",
    )!;
    tile.width = 9;
    expect(() => buildGrowLabCaptureJob(cloneWorld(), tiles)).toThrow(
      /reviewed official tile definition/,
    );
  });
});
