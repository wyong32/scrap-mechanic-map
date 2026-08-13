import type { WorldMap } from "../../src/domain/map-model.ts";
import type { TileDefinition } from "../game-data/extract-catalog.ts";
import {
  AUTHENTIC_LAYER_IDS,
  type AuthenticCaptureJob,
} from "./authentic-map-types.ts";

const EXPECTED_UUID = "d3d4d976-d2a6-4d21-95bd-fada26b6b371";
const EXPECTED_PATH =
  "Survival/DungeonTiles/Minidungeon/Minidungeon_Interior_01.tile";
const EXPECTED_BOUNDS = { minX: -8, minY: -8, maxX: 7, maxY: 7 } as const;

const failSource = (): never => {
  throw new Error("Grow Lab 1 is not the reviewed official capture source.");
};

const failExtent = (): never => {
  throw new Error("Grow Lab 1 does not contain the reviewed 10x10 rectangular source extent.");
};

const failTile = (): never => {
  throw new Error("Grow Lab 1 catalog does not contain the reviewed official tile definition.");
};

export function buildGrowLabCaptureJob(
  world: WorldMap,
  tiles: readonly TileDefinition[],
): AuthenticCaptureJob {
  if (
    world.id !== "growlab_01"
    || world.gameVersion !== "1.0.0"
    || world.source !== "fixed-region"
    || world.bounds.minX !== EXPECTED_BOUNDS.minX
    || world.bounds.minY !== EXPECTED_BOUNDS.minY
    || world.bounds.maxX !== EXPECTED_BOUNDS.maxX
    || world.bounds.maxY !== EXPECTED_BOUNDS.maxY
  ) {
    failSource();
  }

  if (world.cells.length !== 100) failExtent();

  for (const cell of world.cells) {
    if (`${cell.uuid}|${cell.rotation}` !== `${EXPECTED_UUID}|0`) {
      failSource();
    }
  }

  const minX = Math.min(...world.cells.map(({ x }) => x));
  const minY = Math.min(...world.cells.map(({ y }) => y));
  const maxX = Math.max(...world.cells.map(({ x }) => x));
  const maxY = Math.max(...world.cells.map(({ y }) => y));
  if (maxX - minX + 1 !== 10 || maxY - minY + 1 !== 10) failExtent();

  const occupied = new Set<string>();
  for (const cell of world.cells) {
    const expectedXOffset = cell.x - minX;
    const expectedYOffset = cell.y - minY;
    const key = `${cell.x},${cell.y}`;
    if (
      occupied.has(key)
      || cell.xOffset !== expectedXOffset
      || cell.yOffset !== expectedYOffset
      || expectedXOffset < 0
      || expectedXOffset > 9
      || expectedYOffset < 0
      || expectedYOffset > 9
    ) {
      failExtent();
    }
    occupied.add(key);
  }

  const sourceOriginCells = {
    x: minX - world.bounds.minX,
    y: minY - world.bounds.minY,
  };
  if (sourceOriginCells.x !== 3 || sourceOriginCells.y !== 3) failExtent();

  const matches = tiles.filter(({ uuid }) => uuid === EXPECTED_UUID);
  if (matches.length !== 1) failTile();
  const tile = matches[0];
  if (
    tile.relativePath !== EXPECTED_PATH
    || tile.width !== 10
    || tile.height !== 10
  ) {
    failTile();
  }

  return {
    regionId: "grow-lab-1",
    worldId: "growlab_01",
    gameVersion: "1.0.0",
    sourceTile: {
      uuid: EXPECTED_UUID,
      relativePath: EXPECTED_PATH,
      widthCells: 10,
      heightCells: 10,
    },
    worldBounds: EXPECTED_BOUNDS,
    sourceOriginCells: { x: 3, y: 3 },
    pixelsPerCell: 128,
    outputPixels: { width: 2048, height: 2048 },
    layers: AUTHENTIC_LAYER_IDS,
  };
}
