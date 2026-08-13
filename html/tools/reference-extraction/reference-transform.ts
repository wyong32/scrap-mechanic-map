export type ReferenceOrientation =
  | "x-right-y-down"
  | "x-left-y-down"
  | "x-right-y-up"
  | "x-left-y-up";

export interface ReferenceTransformInput {
  imageWidth: number;
  imageHeight: number;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  orientation: ReferenceOrientation;
}

export interface PixelEdges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ReferenceTransform {
  orientation: ReferenceOrientation;
  cellPixelEdges(x: number, y: number): PixelEdges;
  columnEdges(): number[];
  rowEdges(): number[];
}

const edge = (index: number, count: number, pixels: number) =>
  Math.round(index * pixels / count);

const orientations: readonly ReferenceOrientation[] = [
  "x-right-y-down",
  "x-left-y-down",
  "x-right-y-up",
  "x-left-y-up"
];

function validateInput(input: ReferenceTransformInput): void {
  const values = [
    input.imageWidth,
    input.imageHeight,
    input.bounds.minX,
    input.bounds.minY,
    input.bounds.maxX,
    input.bounds.maxY
  ];
  if (!values.every(Number.isInteger) || input.imageWidth <= 0 || input.imageHeight <= 0) {
    throw new Error("Reference transform dimensions and bounds must be finite integers");
  }
  if (input.bounds.maxX < input.bounds.minX || input.bounds.maxY < input.bounds.minY) {
    throw new Error("Reference transform bounds must contain at least one cell");
  }
  if (!orientations.includes(input.orientation)) {
    throw new Error("Reference transform orientation is unsupported");
  }
}

function flippedEdges(index: number, count: number, pixels: number, flipped: boolean): [number, number] {
  const start = flipped ? count - index - 1 : index;
  const end = flipped ? count - index : index + 1;
  return [edge(start, count, pixels), edge(end, count, pixels)];
}

export function createReferenceTransform(input: ReferenceTransformInput): ReferenceTransform {
  validateInput(input);
  const columns = input.bounds.maxX - input.bounds.minX + 1;
  const rows = input.bounds.maxY - input.bounds.minY + 1;
  const xFlipped = input.orientation === "x-left-y-down" || input.orientation === "x-left-y-up";
  const yFlipped = input.orientation === "x-right-y-up" || input.orientation === "x-left-y-up";
  const columnEdges = Array.from({ length: columns + 1 }, (_, index) => edge(index, columns, input.imageWidth));
  const rowEdges = Array.from({ length: rows + 1 }, (_, index) => edge(index, rows, input.imageHeight));

  return {
    orientation: input.orientation,
    cellPixelEdges(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < input.bounds.minX || x > input.bounds.maxX || y < input.bounds.minY || y > input.bounds.maxY) {
        throw new Error("Cell is outside the reference transform bounds");
      }
      const [left, right] = flippedEdges(x - input.bounds.minX, columns, input.imageWidth, xFlipped);
      const [top, bottom] = flippedEdges(y - input.bounds.minY, rows, input.imageHeight, yFlipped);
      return { left, top, right, bottom };
    },
    columnEdges: () => [...columnEdges],
    rowEdges: () => [...rowEdges]
  };
}
