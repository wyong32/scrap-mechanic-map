import { expect, it } from "vitest";
import {
  cellBoundsToMapPointBounds,
  cellToMapPoint,
  mapPointToCell
} from "./coordinate-system";

it("round-trips game cell coordinates without geographic projection", () => {
  const point = cellToMapPoint({ x: -36, y: -41 });

  expect(point).toEqual({ x: -2304, y: -2624 });
  expect(mapPointToCell(point)).toEqual({ x: -36, y: -41 });
});

it("includes both endpoint cells when converting world bounds", () => {
  expect(
    cellBoundsToMapPointBounds({
      minX: -2,
      minY: -3,
      maxX: 4,
      maxY: 5
    })
  ).toEqual({
    min: { x: -128, y: -192 },
    max: { x: 320, y: 384 }
  });
});
