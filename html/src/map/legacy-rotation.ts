export const LEGACY_ROTATION_DEGREES = [0, 270, 180, 90] as const;

export function legacyPoiDestinationOffset(
  rotation: 0 | 1 | 2 | 3,
  spanCells: number,
  cellSize: number
): { x: number; y: number } {
  const span = spanCells * cellSize;
  switch (rotation) {
    case 1:
      return { x: 0, y: -span };
    case 2:
      return { x: span, y: -span };
    case 3:
      return { x: span, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}
