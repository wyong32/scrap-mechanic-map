import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  clearLegacyRenderCapture,
  expect,
  installLegacyRenderCapture,
  OFFICIAL_ROTATION_CELLS,
  test,
  type LegacyRenderRecord
} from "./fixtures/legacy-map-fixture";

const saveInput = "\u9009\u62e9 Scrap Mechanic .db \u5b58\u6863";
const saveMap = "\u4e13\u5c5e\u5730\u56fe";
const searchLocations = "\u641c\u7d22\u5730\u70b9";
const locationDetails = "\u5730\u70b9\u8be6\u60c5";
const mechanicStation = "\u6280\u5e08\u7ad9";
const mapLayers = "\u5730\u56fe\u56fe\u5c42";
const coordinateGrid = "\u5750\u6807\u7f51\u683c";
const zoomIn = "\u653e\u5927";
const zoomOut = "\u7f29\u5c0f";
const resetView = "\u91cd\u7f6e\u89c6\u56fe";

function canonicalizeGenerated(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeGenerated);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalizeGenerated((value as Record<string, unknown>)[key])
        ])
    );
  }
  return value;
}

function rehashGenerated<T extends Record<string, unknown>>(document: T): T {
  const { contentHash: _contentHash, ...unsigned } = document;
  document.contentHash = createHash("sha256")
    .update(JSON.stringify(canonicalizeGenerated(unsigned)))
    .digest("hex");
  return document;
}

async function installMappedFixedWorld(page: Page): Promise<void> {
  const [buildText, fixedText] = await Promise.all([
    readFile("public/data/generated/build-info.json", "utf8"),
    readFile("public/data/generated/worlds/growlab_01.json", "utf8")
  ]);
  const build = JSON.parse(buildText) as Record<string, unknown> & {
    files: Array<{ name: string; contentHash: string; bytes: number }>;
  };
  const fixed = JSON.parse(fixedText) as Record<string, unknown> & {
    world: Record<string, unknown>;
    contentHash: string;
  };
  fixed.world = {
    ...fixed.world,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    cells: [{
      x: 0,
      y: 0,
      uuid: OFFICIAL_ROTATION_CELLS[0].uuid,
      xOffset: 0,
      yOffset: 0,
      rotation: 0,
      flags: 0,
      terrainType: "fixture"
    }]
  };
  rehashGenerated(fixed);
  const nextFixedText = `${JSON.stringify(fixed)}\n`;
  const listed = build.files.find(
    (file) => file.name === "worlds/growlab_01.json"
  );
  if (!listed) {
    throw new Error("Mapped fixed-world fixture is absent from build-info.");
  }
  listed.contentHash = fixed.contentHash;
  listed.bytes = Buffer.byteLength(nextFixedText);
  rehashGenerated(build);
  const nextBuildText = `${JSON.stringify(build)}\n`;
  await page.route("**/data/generated/build-info.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: nextBuildText
    }));
  await page.route("**/data/generated/worlds/growlab_01.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: nextFixedText
    }));
}

async function renderRecords(page: Page): Promise<LegacyRenderRecord[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __legacyRenderRecords: LegacyRenderRecord[];
        }
      ).__legacyRenderRecords
  );
}

function imageDraws(records: LegacyRenderRecord[]): LegacyRenderRecord[] {
  return records.filter(
    (record) => record.operation === "drawImage" && record.sourceKind === "image"
  );
}

function fallbackFills(records: LegacyRenderRecord[]): LegacyRenderRecord[] {
  const fallbackColors = new Set(["#65894d", "#897e4d"]);
  return records.filter(
    (record) =>
      record.operation === "fillRect" &&
      typeof record.fillStyle === "string" &&
      fallbackColors.has(record.fillStyle)
  );
}

interface CommittedStage {
  commit: LegacyRenderRecord;
  records: LegacyRenderRecord[];
}

function committedStages(records: LegacyRenderRecord[]): CommittedStage[] {
  return records
    .filter(
      (record) =>
        record.operation === "drawImage" &&
        record.sourceKind === "canvas" &&
        record.targetIsTerrain === true &&
        record.sourceCanvasId !== undefined
    )
    .map((commit) => ({
      commit,
      records: records.filter(
        (record) =>
          record.targetCanvasId === commit.sourceCanvasId &&
          record.sequence !== undefined &&
          commit.sequence !== undefined &&
          record.sequence < commit.sequence
      )
    }))
    .filter((stage) =>
      stage.records.some(
        (record) =>
          (record.operation === "drawImage" &&
            record.sourceKind === "image") ||
          record.operation === "fillRect"
      )
    );
}

async function renderCursor(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __legacyRenderRecords: LegacyRenderRecord[];
        }
      ).__legacyRenderRecords.length
  );
}

async function recordsAfter(
  page: Page,
  cursor: number
): Promise<LegacyRenderRecord[]> {
  return (await renderRecords(page)).filter(
    (record) => record.sequence !== undefined && record.sequence >= cursor
  );
}

function expectedCellSize(page: Page): number {
  const zoom = Number(new URL(page.url()).searchParams.get("z") ?? "0");
  expect(Number.isInteger(zoom)).toBe(true);
  return 64 * 2 ** zoom;
}

function viewportFromUrl(page: Page): {
  zoom: number;
  x: number;
  y: number;
} {
  const url = new URL(page.url());
  const viewport = {
    zoom: Number(url.searchParams.get("z") ?? "0"),
    x: Number(url.searchParams.get("x") ?? "0"),
    y: Number(url.searchParams.get("y") ?? "0")
  };
  expect(Object.values(viewport).every(Number.isFinite)).toBe(true);
  return viewport;
}

async function waitForMechanicStages(
  page: Page,
  cursor: number,
  expectedCellSize: number
): Promise<CommittedStage[]> {
  await expect
    .poll(async () => {
      const stages = committedStages(await recordsAfter(page, cursor));
      const station = imageDraws(stages.at(-1)?.records ?? []).filter(
        (record) => record.sourceUrl === "/legacy/img/mechanic_station.png"
      );
      return {
        stages: stages.length,
        stationWidth: station.at(-1)?.width
      };
    })
    .toEqual({
      stages: expect.any(Number),
      stationWidth: expectedCellSize * 2
    });
  return committedStages(await recordsAfter(page, cursor));
}

function expectedMechanicDraws(
  canvas: { width: number; height: number },
  cellSize: number,
  viewport: { x: number; y: number },
  rotation: 0 | 1 | 2 | 3 = 0
): Array<Partial<LegacyRenderRecord>> {
  const offsets = [
    { x: 0, y: 0 },
    { x: 0, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 0 }
  ] as const;
  const transforms = [
    { a: 1, b: 0, c: 0, d: 1 },
    { a: 0, b: -1, c: 1, d: 0 },
    { a: -1, b: 0, c: 0, d: -1 },
    { a: 0, b: 1, c: -1, d: 0 }
  ] as const;
  const offset = offsets[rotation];
  return [
    {
      sourceUrl: "/legacy/img/mechanic_station.png",
      left: -cellSize,
      top: -cellSize,
      width: cellSize * 2,
      height: cellSize * 2,
      centerX:
        canvas.width / 2
        + (-37 - viewport.x + 1 + offset.x) * cellSize,
      centerY:
        canvas.height / 2
        + (-41 - viewport.y + 1 + offset.y) * cellSize,
      transform: transforms[rotation]
    },
    {
      sourceUrl: "/legacy/img/tiles/10105.jpg",
      left: -cellSize / 2,
      top: -cellSize / 2,
      width: cellSize,
      height: cellSize,
      centerX: canvas.width / 2 + (-35 - viewport.x + 0.5) * cellSize,
      centerY: canvas.height / 2 + (-41 - viewport.y + 0.5) * cellSize,
      transform: { a: 1, b: 0, c: 0, d: 1 }
    },
    {
      sourceUrl: "/legacy/img/tiles/10106.jpg",
      left: -cellSize / 2,
      top: -cellSize / 2,
      width: cellSize,
      height: cellSize,
      centerX: canvas.width / 2 + (-35 - viewport.x + 0.5) * cellSize,
      centerY: canvas.height / 2 + (-40 - viewport.y + 0.5) * cellSize,
      transform: { a: 1, b: 0, c: 0, d: 1 }
    }
  ];
}

function mechanicStageViolations(
  stage: CommittedStage,
  canvas: { width: number; height: number },
  cellSize: number,
  viewport: { x: number; y: number }
): string[] {
  const draws = imageDraws(stage.records);
  const expected = expectedMechanicDraws(canvas, cellSize, viewport);
  const comparable = draws.map(
    ({
      sourceUrl,
      left,
      top,
      width,
      height,
      centerX,
      centerY,
      transform
    }) => ({
      sourceUrl,
      left,
      top,
      width,
      height,
      centerX,
      centerY,
      transform
    })
  );
  const violations: string[] = [];
  if (JSON.stringify(comparable) !== JSON.stringify(expected)) {
    violations.push("stage image sequence or geometry differs");
  }
  if (
    draws.filter(
      (record) => record.sourceUrl === "/legacy/img/mechanic_station.png"
    ).length !== 1
  ) {
    violations.push("mechanic station draw count is not one");
  }
  if (
    draws.some(
      (record) =>
        record.sourceUrl === "/legacy/img/mechanic_station.png" &&
        (record.sourceWidth !== 675 || record.sourceHeight !== 675)
    )
  ) {
    violations.push("mechanic station source bounds are not 675 by 675");
  }
  if (
    draws.some(
      (record) => record.sourceUrl === "/legacy/img/tiles/10901.jpg"
    )
  ) {
    violations.push("mechanic constituent was drawn as an ordinary tile");
  }
  return violations;
}

async function expectCommittedCanvasMatchesReference(
  page: Page,
  cells: ReadonlyArray<{
    sourceUrl?: string;
    fillStyle?: string;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    rotation: 0 | 1 | 2 | 3;
  }>,
  points: ReadonlyArray<{ x: number; y: number }>
): Promise<void> {
  const comparison = await page
    .locator("canvas[data-terrain-frame='committed']")
    .evaluate(
      async (canvas, { cells: expectedCells, points: expectedPoints }) => {
        const reference = document.createElement("canvas");
        reference.width = canvas.width;
        reference.height = canvas.height;
        const referenceContext = reference.getContext("2d");
        const actualContext = canvas.getContext("2d");
        if (!referenceContext || !actualContext) return [];
        const renderedImages = (
          window as Window & {
            __legacyRenderImages: Map<string, HTMLImageElement>;
          }
        ).__legacyRenderImages;
        const degrees = [0, 270, 180, 90] as const;
        for (const cell of expectedCells) {
          if (cell.sourceUrl) {
            let image = renderedImages.get(cell.sourceUrl);
            if (!image) {
              image = new Image();
              image.src = cell.sourceUrl;
              await image.decode();
            }
            referenceContext.save();
            referenceContext.translate(cell.centerX, cell.centerY);
            referenceContext.rotate(degrees[cell.rotation] * Math.PI / 180);
            referenceContext.drawImage(
              image,
              -cell.width / 2,
              -cell.height / 2,
              cell.width,
              cell.height
            );
            referenceContext.restore();
          } else {
            referenceContext.fillStyle = cell.fillStyle!;
            referenceContext.fillRect(
              cell.centerX - cell.width / 2,
              cell.centerY - cell.height / 2,
              cell.width,
              cell.height
            );
          }
        }
        return expectedPoints.map(({ x, y }) => ({
          x,
          y,
          actual: [...actualContext.getImageData(x, y, 1, 1).data],
          expected: [...referenceContext.getImageData(x, y, 1, 1).data]
        }));
      },
      { cells, points }
    );
  expect(comparison).not.toEqual([]);
  for (const sample of comparison) {
    expect(sample.actual, `pixel ${sample.x},${sample.y}`).toEqual(
      sample.expected
    );
  }
}

test.beforeEach(async ({ page }) => {
  await installLegacyRenderCapture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("renders four officially mapped legacy tiles with all four rotations", async ({
  page,
  legacyMapSaves
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const save = await legacyMapSaves.createRotations(
    "legacy-four-rotations.db"
  );
  await clearLegacyRenderCapture(page);

  await page.getByLabel(saveInput).setInputFiles(save.path);

  await expect(page.locator("[data-status]")).toContainText(
    "\u4e13\u5c5e\u5730\u56fe\u5df2\u5c31\u7eea",
    { timeout: 15_000 }
  );
  await expect(page.locator("[data-mode-badge]")).toHaveText(saveMap);
  await expect(page.locator("[data-mode-file]")).toHaveText(save.name);
  await expect(page.locator("[data-mode-meta]")).toHaveText(
    `Seed ${save.seed} \u00b7 \u5b58\u6863\u7248\u672c 28`
  );
  await expect(page.locator("[data-terrain-coverage]")).toContainText(
    "\u539f\u7248\u5e95\u56fe 4 \u683c"
  );
  await expect(page.locator("[data-terrain-coverage]")).toContainText(
    "1.0 \u5206\u7c7b\u5e95\u8272 0 \u683c"
  );

  const history = await page.evaluate(
    () =>
      (
        window as Window & {
          __legacyStatusHistory: string[];
        }
      ).__legacyStatusHistory
  );
  expect(history).toEqual([
    "\u6b63\u5728\u8bfb\u53d6\u672c\u5730\u5b58\u6863\u2026",
    "\u6b63\u5728\u68c0\u67e5 Survival \u6570\u636e\u2026",
    "\u6b63\u5728\u89e3\u538b\u5730\u5f62\u6570\u636e\u2026",
    "\u6b63\u5728\u89e3\u6790\u5730\u5f62\u2026",
    "\u6b63\u5728\u6821\u9a8c\u4e13\u5c5e\u5730\u56fe\u2026",
    "\u6b63\u5728\u51c6\u5907\u5730\u56fe\u9996\u5e27\u2026",
    "\u4e13\u5c5e\u5730\u56fe\u5df2\u5c31\u7eea\uff1b\u771f\u5b9e\u5e03\u5c40\u5df2\u4fdd\u7559\uff0c\u539f\u7248\u5e95\u56fe\u7f3a\u53e3\u4f7f\u7528 1.0 \u5206\u7c7b\u5e95\u8272\u3002"
  ]);

  const stages = committedStages(await renderRecords(page));
  expect(stages.length).toBeGreaterThan(0);
  for (const stage of stages) {
    expect(imageDraws(stage.records).map((record) => record.sourceUrl)).toEqual(
      OFFICIAL_ROTATION_CELLS.map((cell) => cell.sourceUrl)
    );
  }

  const canvas = await page
    .locator("canvas[data-terrain-frame='committed']")
    .evaluate((element) => ({ width: element.width, height: element.height }));
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);
  const cellSize = expectedCellSize(page);
  const viewport = viewportFromUrl(page);
  const expectedGeometry = OFFICIAL_ROTATION_CELLS.map((cell) => ({
    sourceUrl: cell.sourceUrl,
    left: -cellSize / 2,
    top: -cellSize / 2,
    width: cellSize,
    height: cellSize,
    centerX:
      canvas.width / 2 + (cell.x - viewport.x + 0.5) * cellSize,
    centerY:
      canvas.height / 2 + (cell.y - viewport.y + 0.5) * cellSize,
    transform: [
      { a: 1, b: 0, c: 0, d: 1 },
      { a: 0, b: -1, c: 1, d: 0 },
      { a: -1, b: 0, c: 0, d: -1 },
      { a: 0, b: 1, c: -1, d: 0 }
    ][cell.rotation]
  }));
  const finalDraws = imageDraws(stages.at(-1)!.records);
  expect(
    finalDraws.map(
      ({
        sourceUrl,
        left: destinationX,
        top: destinationY,
        width,
        height,
        centerX,
        centerY,
        transform
      }) => ({
        sourceUrl,
        left: destinationX,
        top: destinationY,
        width,
        height,
        centerX,
        centerY,
        transform
      })
    )
  ).toEqual(expectedGeometry);

  const centers = expectedGeometry.map(({ centerX, centerY }) => ({
    x: centerX,
    y: centerY
  }));
  const verticalBoundary =
    canvas.width / 2 + (1 - viewport.x) * cellSize;
  const horizontalBoundary =
    canvas.height / 2 + (1 - viewport.y) * cellSize;
  await expectCommittedCanvasMatchesReference(
    page,
    OFFICIAL_ROTATION_CELLS.map((cell, index) => ({
      sourceUrl: cell.sourceUrl,
      centerX: expectedGeometry[index]!.centerX,
      centerY: expectedGeometry[index]!.centerY,
      width: cellSize,
      height: cellSize,
      rotation: cell.rotation
    })),
    [
      ...centers,
      { x: verticalBoundary - 1, y: centers[0]!.y },
      { x: verticalBoundary + 1, y: centers[1]!.y },
      { x: verticalBoundary - 1, y: centers[2]!.y },
      { x: verticalBoundary + 1, y: centers[3]!.y },
      { x: centers[0]!.x, y: horizontalBoundary - 1 },
      { x: centers[2]!.x, y: horizontalBoundary + 1 },
      { x: centers[1]!.x, y: horizontalBoundary - 1 },
      { x: centers[3]!.x, y: horizontalBoundary + 1 }
    ]
  );
});

test("keeps a mixed two-legacy two-fallback layout on exact cell boundaries", async ({
  page,
  legacyMapSaves
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const save = await legacyMapSaves.createMixed("legacy-mixed.db");
  await clearLegacyRenderCapture(page);

  await page.getByLabel(saveInput).setInputFiles(save.path);

  await expect(page.locator("[data-status]")).toContainText(
    "\u4e13\u5c5e\u5730\u56fe\u5df2\u5c31\u7eea",
    { timeout: 15_000 }
  );
  const coverage = page.locator("[data-terrain-coverage]");
  await expect(coverage).toContainText("\u5171 4 \u683c");
  await expect(coverage).toContainText("\u539f\u7248\u5e95\u56fe 2 \u683c");
  await expect(coverage).toContainText("1.0 \u5206\u7c7b\u5e95\u8272 2 \u683c");
  await expect(coverage).toContainText(
    "\u5206\u7c7b\u5e95\u8272\u6d89\u53ca 2 \u79cd\u5730\u5f62"
  );

  const stages = committedStages(await renderRecords(page));
  expect(stages.length).toBeGreaterThan(0);
  const finalStage = stages.at(-1)!;
  const draws = imageDraws(finalStage.records);
  const fills = fallbackFills(finalStage.records);
  expect(draws).toHaveLength(2);
  expect(fills).toHaveLength(2);
  const canvas = await page
    .locator("canvas[data-terrain-frame='committed']")
    .evaluate((element) => ({ width: element.width, height: element.height }));
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);
  const cellSize = expectedCellSize(page);
  const viewport = viewportFromUrl(page);
  const left = canvas.width / 2 + (0 - viewport.x) * cellSize;
  const top = canvas.height / 2 + (0 - viewport.y) * cellSize;
  const expectedDraws = OFFICIAL_ROTATION_CELLS.slice(0, 2).map(
    (cell) => ({
      sourceUrl: cell.sourceUrl,
      left: -cellSize / 2,
      top: -cellSize / 2,
      width: cellSize,
      height: cellSize,
      centerX: left + (cell.x + 0.5) * cellSize,
      centerY: top + cellSize / 2
    })
  );
  expect(
    draws.map(
      ({
        sourceUrl,
        left: destinationX,
        top: destinationY,
        width,
        height,
        centerX,
        centerY
      }) => ({
        sourceUrl,
        left: destinationX,
        top: destinationY,
        width,
        height,
        centerX,
        centerY
      })
    )
  ).toEqual(expectedDraws);
  expect(
    fills.map(({ fillStyle, left, top, width, height }) => ({
      fillStyle,
      left,
      top,
      width,
      height
    }))
  ).toEqual([
    {
      fillStyle: "#65894d",
      left,
      top: top + cellSize,
      width: cellSize,
      height: cellSize
    },
    {
      fillStyle: "#897e4d",
      left: left + cellSize,
      top: top + cellSize,
      width: cellSize,
      height: cellSize
    }
  ]);
  await expectCommittedCanvasMatchesReference(
    page,
    [
      ...expectedDraws.map((draw, index) => ({
        sourceUrl: draw.sourceUrl,
        centerX: draw.centerX,
        centerY: draw.centerY,
        width: cellSize,
        height: cellSize,
        rotation: 0 as const
      })),
      {
        fillStyle: "#65894d",
        centerX: left + cellSize / 2,
        centerY: top + cellSize * 1.5,
        width: cellSize,
        height: cellSize,
        rotation: 0 as const
      },
      {
        fillStyle: "#897e4d",
        centerX: left + cellSize * 1.5,
        centerY: top + cellSize * 1.5,
        width: cellSize,
        height: cellSize,
        rotation: 0 as const
      }
    ],
    [
      ...expectedDraws.map(({ centerX, centerY }) => ({
        x: centerX,
        y: centerY
      })),
      { x: left + cellSize / 2, y: top + cellSize * 1.5 },
      { x: left + cellSize * 1.5, y: top + cellSize * 1.5 },
      { x: left + cellSize - 1, y: top + cellSize / 2 },
      { x: left + cellSize + 1, y: top + cellSize / 2 },
      { x: left + cellSize / 2, y: top + cellSize - 1 },
      { x: left + cellSize / 2, y: top + cellSize + 1 }
    ]
  );
});

test("uses the resolved legacy terrain after a personal map navigates to a fixed region", async ({
  page,
  legacyMapSaves
}) => {
  await installMappedFixedWorld(page);
  const atlasRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/atlas/")) {
      atlasRequests.push(request.url());
    }
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const save = await legacyMapSaves.createMixed(
    "personal-to-fixed-region.db"
  );
  await page.getByLabel(saveInput).setInputFiles(save.path);
  await expect(page.locator("[data-mode-file]")).toHaveText(save.name);
  await clearLegacyRenderCapture(page);

  await page
    .locator('[data-region-id="grow-lab-1"]')
    .first()
    .click();
  await expect(page).toHaveURL(/(?:\?|&)region=grow-lab-1(?:&|$)/);
  await expect
    .poll(async () => {
      const stage = committedStages(await renderRecords(page)).at(-1);
      return imageDraws(stage?.records ?? []).length;
    }, { timeout: 20_000 })
    .toBeGreaterThan(0);

  expect(atlasRequests).toEqual([]);
  await expect(page.locator("[data-atlas-error]")).toHaveCount(0);
  await expect(
    page.locator("canvas[data-terrain-frame='committed']")
  ).toBeVisible();
  await expect(page.locator("[data-mode-file]")).toHaveText(save.name);
});

test("restores the prior frame, viewport, and URL after a distant prepared restage fails", async ({
  page,
  legacyMapSaves
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const committed = await legacyMapSaves.createMixed(
    "atomic-committed.db"
  );
  const candidate = await legacyMapSaves.createDistantRotations(
    "atomic-distant-candidate.db"
  );
  await page.evaluate(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.drawImage;
    const known = new Set<HTMLImageElement>();
    const control = {
      collecting: true,
      failUnknown: false
    };
    Object.defineProperty(window, "__atomicLegacyDrawControl", {
      value: control
    });
    prototype.drawImage = function (
      ...args: Parameters<CanvasRenderingContext2D["drawImage"]>
    ) {
      const source = args[0];
      if (source instanceof HTMLImageElement) {
        if (control.collecting) {
          known.add(source);
        } else if (control.failUnknown && !known.has(source)) {
          throw new Error("injected atomic restage failure");
        }
      }
      return original.apply(this, args);
    };
  });
  await page.getByLabel(saveInput).setInputFiles(committed.path);
  await expect(page.locator("[data-mode-file]")).toHaveText(committed.name);
  const canvas = page.locator("canvas[data-terrain-frame='committed']");
  const committedFrame = await canvas.evaluate((element) =>
    element.toDataURL()
  );
  const committedUrl = page.url();

  await page.evaluate(() => {
    const control = (
      window as Window & {
        __atomicLegacyDrawControl: {
          collecting: boolean;
          failUnknown: boolean;
        };
      }
    ).__atomicLegacyDrawControl;
    control.collecting = false;
    control.failUnknown = true;
  });

  await page.getByLabel(saveInput).setInputFiles(candidate.path);
  await expect(page.locator("[data-status]")).toContainText(
    "injected atomic restage failure"
  );
  await expect(page.locator("[data-mode-file]")).toHaveText(committed.name);
  expect(page.url()).toBe(committedUrl);
  await expect.poll(() => canvas.evaluate((element) =>
    element.toDataURL()
  )).toBe(committedFrame);
  await expect(
    page.locator("canvas[data-terrain-frame='prepared']")
  ).toHaveCount(0);
});

test("matches asymmetric pixels and final bounds for rotated 2 by 2 POI offsets", async ({
  page,
  legacyMapSaves
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const saves = await Promise.all(
    ([1, 2, 3] as const).map((rotation) =>
      legacyMapSaves.createMechanicStation(
        `legacy-mechanic-rotation-${rotation}.db`,
        rotation
      ))
  );

  for (const [index, rotation] of ([1, 2, 3] as const).entries()) {
    const save = saves[index]!;
    await clearLegacyRenderCapture(page);
    await page.getByLabel(saveInput).setInputFiles(save.path);
    await expect(page.locator("[data-mode-file]")).toHaveText(save.name);
    let zoom = Number(new URL(page.url()).searchParams.get("z") ?? "0");
    while (zoom > 0) {
      const prior = zoom;
      await page.getByRole("button", { name: zoomOut }).click();
      await expect.poll(
        () => Number(new URL(page.url()).searchParams.get("z") ?? "0")
      ).toBe(prior - 1);
      zoom = prior - 1;
    }

    const canvas = await page
      .locator("canvas[data-terrain-frame='committed']")
      .evaluate((element) => ({
        width: element.width,
        height: element.height
      }));
    const cellSize = expectedCellSize(page);
    expect(cellSize).toBe(64);
    const viewport = viewportFromUrl(page);
    const stages = await waitForMechanicStages(page, 0, cellSize);
    const expected = expectedMechanicDraws(
      canvas,
      cellSize,
      viewport,
      rotation
    );
    const comparable = imageDraws(stages.at(-1)!.records).map(
      ({
        sourceUrl,
        left,
        top,
        width,
        height,
        centerX,
        centerY,
        transform
      }) => ({
        sourceUrl,
        left,
        top,
        width,
        height,
        centerX,
        centerY,
        transform
      })
    );
    expect(comparable).toEqual(expected);
    const station = expected[0]!;
    const stationX = station.centerX!;
    const stationY = station.centerY!;
    await expectCommittedCanvasMatchesReference(
      page,
      expected.map((draw, drawIndex) => ({
        sourceUrl: draw.sourceUrl!,
        centerX: draw.centerX!,
        centerY: draw.centerY!,
        width: draw.width!,
        height: draw.height!,
        rotation: drawIndex === 0 ? rotation : 0
      })),
      [
        { x: stationX, y: stationY },
        { x: stationX - cellSize / 2, y: stationY - cellSize / 2 },
        { x: stationX + cellSize / 2, y: stationY - cellSize / 2 },
        { x: stationX - cellSize / 2, y: stationY + cellSize / 2 },
        { x: stationX + cellSize / 2, y: stationY + cellSize / 2 },
        { x: stationX - cellSize + 1, y: stationY },
        { x: stationX + cellSize - 1, y: stationY },
        { x: stationX, y: stationY - cellSize + 1 },
        { x: stationX, y: stationY + cellSize - 1 }
      ]
    );
  }
});

test("draws one mechanic-station image across 2 by 2 cells and keeps its UI usable", async ({
  page,
  legacyMapSaves
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const save = await legacyMapSaves.createMechanicStation(
    "legacy-mechanic-station.db"
  );
  await clearLegacyRenderCapture(page);

  await page.getByLabel(saveInput).setInputFiles(save.path);

  await expect(page.locator("[data-status]")).toContainText(
    "\u4e13\u5c5e\u5730\u56fe\u5df2\u5c31\u7eea",
    { timeout: 15_000 }
  );
  await expect(page.locator("[data-terrain-coverage]")).toContainText(
    "\u539f\u7248\u5e95\u56fe 6 \u683c"
  );
  await expect(page.locator("[data-terrain-coverage]")).toContainText(
    "1.0 \u5206\u7c7b\u5e95\u8272 0 \u683c"
  );

  const canvasLocator = page.locator(
    "canvas[data-terrain-frame='committed']"
  );
  const canvas = await canvasLocator.evaluate((element) => ({
    width: element.width,
    height: element.height
  }));
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);
  const initialViewport = viewportFromUrl(page);
  const baseCellSize = expectedCellSize(page);
  const initialStages = await waitForMechanicStages(page, 0, baseCellSize);
  expect(initialStages.length).toBeGreaterThan(0);
  for (const stage of initialStages) {
    expect(
      mechanicStageViolations(
        stage,
        canvas,
        baseCellSize,
        initialViewport
      )
    ).toEqual([]);
  }
  const initialStage = initialStages.at(-1)!;
  const initialExpected = expectedMechanicDraws(
    canvas,
    baseCellSize,
    initialViewport
  );
  const mechanicReferenceCells = (
    expected: Array<Partial<LegacyRenderRecord>>
  ) =>
    expected.map((draw) => ({
      sourceUrl: draw.sourceUrl,
      centerX: draw.centerX!,
      centerY: draw.centerY!,
      width: draw.width!,
      height: draw.height!,
      rotation: 0 as const
    }));
  const mechanicReferencePoints = (
    expected: Array<Partial<LegacyRenderRecord>>,
    cellSize: number
  ) => [
      { x: expected[0]!.centerX!, y: expected[0]!.centerY! },
      { x: expected[1]!.centerX!, y: expected[1]!.centerY! },
      { x: expected[2]!.centerX!, y: expected[2]!.centerY! },
      {
        x: expected[0]!.centerX! + cellSize - 1,
        y: expected[1]!.centerY!
      },
      {
        x: expected[0]!.centerX! + cellSize + 1,
        y: expected[1]!.centerY!
      },
      {
        x: expected[0]!.centerX!,
        y: expected[0]!.centerY! - 1
      },
      {
        x: expected[0]!.centerX!,
        y: expected[0]!.centerY! + 1
      }
    ];
  const initialPoints = mechanicReferencePoints(
    initialExpected,
    baseCellSize
  );
  await expectCommittedCanvasMatchesReference(
    page,
    mechanicReferenceCells(initialExpected),
    initialPoints
  );
  const initialFrame = await canvasLocator.evaluate((canvas) =>
    canvas.toDataURL()
  );

  const marker = page.locator('[data-map-location-id="mechanic-station"]');
  await expect(marker).toHaveCount(1);
  await page
    .locator("[data-location-list]")
    .getByRole("button", { name: new RegExp(mechanicStation) })
    .click();
  await expect(
    page.getByRole("complementary", { name: locationDetails })
  ).toContainText(mechanicStation);
  await expect(marker).toHaveAttribute("aria-pressed", "true");

  const layers = page.getByRole("group", { name: mapLayers });
  const poi = layers.getByRole("checkbox", { name: "POI", exact: true });
  const terrain = layers.getByRole("checkbox", {
    name: /^\u5730\u5f62/
  });
  const grid = layers.getByRole("checkbox", {
    name: coordinateGrid,
    exact: true
  });
  await poi.uncheck();
  await expect(marker).toHaveCount(0);
  await poi.check();
  await expect(marker).toHaveCount(1);
  await grid.uncheck();
  await expect(page.locator("[data-coordinate-grid]")).toBeHidden();
  const toggleViewport = viewportFromUrl(page);
  const toggleCellSize = expectedCellSize(page);
  const offCursor = await renderCursor(page);
  await terrain.uncheck();
  await expect(canvasLocator).toBeHidden();
  expect(committedStages(await recordsAfter(page, offCursor))).toEqual([]);

  const onCursor = await renderCursor(page);
  await terrain.check();
  await expect(canvasLocator).toBeVisible();
  const onStages = await waitForMechanicStages(
    page,
    onCursor,
    toggleCellSize
  );
  expect(onStages).toHaveLength(1);
  expect(
    mechanicStageViolations(
      onStages[0]!,
      canvas,
      toggleCellSize,
      toggleViewport
    )
  ).toEqual([]);
  const toggleExpected = expectedMechanicDraws(
    canvas,
    toggleCellSize,
    toggleViewport
  );
  await expectCommittedCanvasMatchesReference(
    page,
    mechanicReferenceCells(toggleExpected),
    mechanicReferencePoints(toggleExpected, toggleCellSize)
  );

  const zoomCursor = await renderCursor(page);
  await page.getByRole("button", { name: zoomIn }).click();
  await expect
    .poll(() => Number(new URL(page.url()).searchParams.get("z")))
    .toBe(toggleViewport.zoom + 1);
  const zoomCellSize = toggleCellSize * 2;
  const zoomStages = await waitForMechanicStages(
    page,
    zoomCursor,
    zoomCellSize
  );
  const zoomViewport = viewportFromUrl(page);
  expect(zoomStages.length).toBeGreaterThan(0);
  for (const stage of zoomStages) {
    expect(
      mechanicStageViolations(
        stage,
        canvas,
        zoomCellSize,
        zoomViewport
      )
    ).toEqual([]);
  }
  const zoomExpected = expectedMechanicDraws(
    canvas,
    zoomCellSize,
    zoomViewport
  );
  const zoomRightBoundary =
    zoomExpected[0]!.centerX! + zoomCellSize;
  const ordinaryVisibleX = Math.min(
    canvas.width - 2,
    zoomRightBoundary + zoomCellSize / 4
  );
  await expectCommittedCanvasMatchesReference(
    page,
    mechanicReferenceCells(zoomExpected),
    [
      { x: zoomExpected[0]!.centerX!, y: zoomExpected[0]!.centerY! },
      { x: zoomRightBoundary - 1, y: zoomExpected[1]!.centerY! },
      { x: zoomRightBoundary + 1, y: zoomExpected[1]!.centerY! },
      { x: ordinaryVisibleX, y: zoomExpected[1]!.centerY! },
      { x: ordinaryVisibleX, y: zoomExpected[2]!.centerY! }
    ]
  );
  const zoomFrame = await canvasLocator.evaluate((canvas) =>
    canvas.toDataURL()
  );
  expect(zoomFrame).not.toBe(initialFrame);

  const resetCursor = await renderCursor(page);
  await page.getByRole("button", { name: resetView }).click();
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return [
        Number(url.searchParams.get("z")),
        Number(url.searchParams.get("x")),
        Number(url.searchParams.get("y"))
      ];
    })
    .toEqual([
      initialViewport.zoom,
      initialViewport.x,
      initialViewport.y
    ]);
  const resetStages = await waitForMechanicStages(
    page,
    resetCursor,
    baseCellSize
  );
  expect(resetStages.length).toBeGreaterThan(0);
  for (const stage of resetStages) {
    expect(
      mechanicStageViolations(
        stage,
        canvas,
        baseCellSize,
        initialViewport
      )
    ).toEqual([]);
  }
  await expectCommittedCanvasMatchesReference(
    page,
    mechanicReferenceCells(initialExpected),
    initialPoints
  );
  expect(await canvasLocator.evaluate((canvas) => canvas.toDataURL())).toBe(
    initialFrame
  );

  const injectedDuplicate: CommittedStage = {
    ...initialStage,
    records: [
      ...initialStage.records,
      {
        ...imageDraws(initialStage.records)[0]!,
        sequence: Number.MAX_SAFE_INTEGER
      }
    ]
  };
  expect(
    mechanicStageViolations(
      injectedDuplicate,
      canvas,
      baseCellSize,
      initialViewport
    )
  ).toContain("mechanic station draw count is not one");
  expect(
    mechanicStageViolations(
      onStages[0]!,
      canvas,
      zoomCellSize,
      toggleViewport
    )
  ).not.toEqual([]);
  expect(
    mechanicStageViolations(
      zoomStages.at(-1)!,
      canvas,
      baseCellSize,
      zoomViewport
    )
  ).not.toEqual([]);
  await expect(marker).toHaveCount(1);
});
