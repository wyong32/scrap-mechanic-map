import { expect, it } from "vitest";
import { createReferenceTransform } from "./reference-transform";

it("maps the full x-right-y-down world bounds to exact image edges", () => {
  const transform = createReferenceTransform({
    imageWidth: 10_775,
    imageHeight: 8_480,
    bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 },
    orientation: "x-right-y-down"
  });

  expect(transform.cellPixelEdges(-72, -56)).toEqual({
    left: 0,
    top: 0,
    right: 75,
    bottom: 76
  });
  expect(transform.cellPixelEdges(71, 55)).toEqual({
    left: 10_700,
    top: 8_404,
    right: 10_775,
    bottom: 8_480
  });
  expect(transform.rowEdges()).toEqual(expect.arrayContaining([0, 8_480]));
});

it.each([
  ["x-right-y-down", { left: 0, top: 0, right: 5, bottom: 10 }],
  ["x-left-y-down", { left: 5, top: 0, right: 10, bottom: 10 }],
  ["x-right-y-up", { left: 0, top: 10, right: 5, bottom: 20 }],
  ["x-left-y-up", { left: 5, top: 10, right: 10, bottom: 20 }]
] as const)("maps the origin cell for %s without inferring orientation", (orientation, expected) => {
  const transform = createReferenceTransform({
    imageWidth: 10,
    imageHeight: 20,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    orientation
  });

  expect(transform.orientation).toBe(orientation);
  expect(transform.cellPixelEdges(0, 0)).toEqual(expected);
});

it("rejects an unsupported orientation supplied at the runtime boundary", () => {
  const input: unknown = {
    imageWidth: 10,
    imageHeight: 20,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    orientation: "sideways"
  };

  expect(() => createReferenceTransform(input as Parameters<typeof createReferenceTransform>[0]))
    .toThrow("Reference transform orientation is unsupported");
});

it.each([
  "x-right-y-down",
  "x-left-y-down",
  "x-right-y-up",
  "x-left-y-up"
] as const)("shares every fractional edge without gaps or overlaps for %s", (orientation) => {
  const transform = createReferenceTransform({
    imageWidth: 10_775,
    imageHeight: 8_480,
    bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 },
    orientation
  });
  const columnEdges = transform.columnEdges();
  const rowEdges = transform.rowEdges();

  expect(columnEdges).toHaveLength(145);
  expect(rowEdges).toHaveLength(113);
  expect(columnEdges[0]).toBe(0);
  expect(columnEdges.at(-1)).toBe(10_775);
  expect(rowEdges[0]).toBe(0);
  expect(rowEdges.at(-1)).toBe(8_480);

  for (let index = 0; index < columnEdges.length - 1; index += 1) {
    expect(columnEdges[index]).toBeLessThan(columnEdges[index + 1]!);
  }
  for (let index = 0; index < rowEdges.length - 1; index += 1) {
    expect(rowEdges[index]).toBeLessThan(rowEdges[index + 1]!);
  }

  for (let y = -56; y <= 55; y += 1) {
    for (let x = -72; x <= 71; x += 1) {
      const cell = transform.cellPixelEdges(x, y);
      expect(cell.left).toBeLessThan(cell.right);
      expect(cell.top).toBeLessThan(cell.bottom);
      if (x < 71) {
        const next = transform.cellPixelEdges(x + 1, y);
        const sharedEdge = orientation.startsWith("x-right") ? cell.right : cell.left;
        const nextSharedEdge = orientation.startsWith("x-right") ? next.left : next.right;
        expect(sharedEdge).toBe(nextSharedEdge);
      }
      if (y < 55) {
        const next = transform.cellPixelEdges(x, y + 1);
        const sharedEdge = orientation.endsWith("y-down") ? cell.bottom : cell.top;
        const nextSharedEdge = orientation.endsWith("y-down") ? next.top : next.bottom;
        expect(sharedEdge).toBe(nextSharedEdge);
      }
    }
  }
});

it.each([
  ["zero image width", { imageWidth: 0, imageHeight: 20, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, orientation: "x-right-y-down" }],
  ["inverted x bounds", { imageWidth: 10, imageHeight: 20, bounds: { minX: 1, minY: 0, maxX: 0, maxY: 1 }, orientation: "x-right-y-down" }],
  ["fractional y bounds", { imageWidth: 10, imageHeight: 20, bounds: { minX: 0, minY: 0.5, maxX: 1, maxY: 1 }, orientation: "x-right-y-down" }]
] as const)("rejects %s", (_name, input) => {
  expect(() => createReferenceTransform(input)).toThrow();
});
