export interface MapPoint {
  x: number;
  y: number;
}

export interface MapPointBounds {
  min: MapPoint;
  max: MapPoint;
}

export interface CellBoundsLike {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const TERRAIN_CELL_SIZE = 64;

export function cellToMapPoint(cell: MapPoint): MapPoint {
  return {
    x: cell.x * TERRAIN_CELL_SIZE,
    y: cell.y * TERRAIN_CELL_SIZE
  };
}

export function mapPointToCell(point: MapPoint): MapPoint {
  return {
    x: Object.is(point.x, -0) ? 0 : point.x / TERRAIN_CELL_SIZE,
    y: Object.is(point.y, -0) ? 0 : point.y / TERRAIN_CELL_SIZE
  };
}

export function cellBoundsToMapPointBounds(bounds: CellBoundsLike): MapPointBounds {
  return {
    min: cellToMapPoint({ x: bounds.minX, y: bounds.minY }),
    max: cellToMapPoint({ x: bounds.maxX + 1, y: bounds.maxY + 1 })
  };
}
