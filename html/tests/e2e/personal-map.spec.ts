import { expect, test } from "./fixtures/legacy-map-fixture";
import type { SyntheticTerrainGrid } from "./fixtures/synthetic-save";
import type { Page } from "@playwright/test";

const selectSave = "Select Save";
const replaceSave = "Replace Save";
const exitSaveMode = "Exit Personal Map";
const baseMap = "Base Map";
const saveMap = "Personal Map";
const saveInput = "Select a Scrap Mechanic .db save file";
const regionNavigation = "Region Selection";
const warehouseTileUuid = "669a9132-e9c2-4961-a6ad-869044058024";

function warehouseGrid(count: 1 | 2): SyntheticTerrainGrid {
  const width = count * 4;
  return {
    minX: 0,
    minY: 0,
    width,
    height: 4,
    cells: Array.from({ length: width * 4 }, (_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      return {
        uuid: warehouseTileUuid,
        xOffset: x % 4,
        yOffset: y,
        rotation: 0,
        flags: 0
      };
    })
  };
}

async function installStatusHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const values: string[] = [];
    Object.defineProperty(window, "__saveStatusHistory", { value: values });
    const collect = () => {
      const value = document.querySelector<HTMLElement>("[data-status]")?.textContent?.trim();
      if (value && values.at(-1) !== value) values.push(value);
    };
    new MutationObserver(collect).observe(document, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
}

function isOrderedSubsequence(actual: string[], expected: string[]): boolean {
  let expectedIndex = 0;
  for (const value of actual) {
    if (value === expected[expectedIndex]) {
      expectedIndex += 1;
    }
  }
  return expectedIndex === expected.length;
}

test("loads a runtime-generated local save, replaces it, and returns to the base map", async ({
  page,
  syntheticSaves
}) => {
  await installStatusHistory(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".reference-surface-backdrop")).toBeVisible();
  const first = await syntheticSaves.create({ name: "synthetic-v28-a.db" });
  const second = await syntheticSaves.create({ name: "synthetic-v28-b.db", seed: 525252, layout: 1 });

  await page.getByLabel(saveInput).setInputFiles(first.path);
  await expect(page.locator("[data-status]")).toContainText("Your personal map is ready", {
    timeout: 15_000
  });
  await expect(page.locator("[data-mode-badge]")).toHaveText(saveMap);
  await expect(page.locator(".reference-surface-backdrop")).toHaveCount(0);
  await expect(page.locator("[data-mode-file]")).toHaveText(first.name);
  await expect(page.locator("[data-mode-meta]")).toHaveText("Seed 424242 · Save Version 28");
  await expect(page.getByRole("button", { name: replaceSave })).toBeVisible();
  await expect(page.getByRole("button", { name: exitSaveMode })).toBeVisible();
  const terrainCoverage = page.locator("[data-terrain-coverage]");
  await expect(terrainCoverage).toContainText("4 cells");
  await expect(terrainCoverage).toContainText("Legacy images 0 cells");
  await expect(terrainCoverage).toContainText("Missing images 4 cells");
  await expect(terrainCoverage).toContainText("Official 1.0 images 0 cells");
  await expect(terrainCoverage).not.toContainText(first.name);
  await expect(terrainCoverage).not.toContainText(String(first.seed));
  await expect(terrainCoverage).not.toContainText("UUID");
  const terrainCanvas = page.locator("canvas[data-terrain-frame='committed']");
  await expect(terrainCanvas).toBeVisible();
  const renderedTerrainEvidence = await terrainCanvas.evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) {
      return { opaqueSamples: 0, distinctOpaqueColors: 0 };
    }
    const colors = new Set<string>();
    let opaqueSamples = 0;
    for (let row = 0; row <= 32; row += 1) {
      for (let column = 0; column <= 32; column += 1) {
        const x = Math.min(canvas.width - 1, Math.floor(canvas.width * column / 32));
        const y = Math.min(canvas.height - 1, Math.floor(canvas.height * row / 32));
        const pixel = context.getImageData(x, y, 1, 1).data;
        if (pixel[3] === 0) continue;
        opaqueSamples += 1;
        colors.add([...pixel].join(","));
      }
    }
    return { opaqueSamples, distinctOpaqueColors: colors.size };
  });
  expect(renderedTerrainEvidence.opaqueSamples).toBeGreaterThan(0);
  expect(renderedTerrainEvidence.distinctOpaqueColors).toBeGreaterThan(0);
  const firstFrame = await terrainCanvas.evaluate((canvas) => canvas.toDataURL());
  const statusHistory = await page.evaluate(() => (window as Window & { __saveStatusHistory: string[] }).__saveStatusHistory);
  expect(isOrderedSubsequence(statusHistory, [
    "Reading the local save…",
    "Checking Survival data…",
    "Decompressing terrain data…",
    "Decoding terrain…",
    "Validating the personal map…",
    "Preparing the first map frame…"
  ])).toBe(true);

  await page.getByLabel(saveInput).setInputFiles(second.path);
  await expect(page.locator("[data-mode-file]")).toHaveText(second.name);
  await expect(page.locator("[data-mode-meta]")).toHaveText("Seed 525252 · Save Version 28");
  await expect.poll(() => terrainCanvas.evaluate((canvas) => canvas.toDataURL())).not.toBe(firstFrame);

  await page
    .getByRole("navigation", { name: regionNavigation })
    .locator('[data-region-id="grow-lab-2"]')
    .click();
  await expect(page).toHaveURL(/(?:\?|&)region=grow-lab-2(?:&|$)/);
  await expect(page.locator("[data-mode-badge]")).toHaveText(saveMap);
  await expect(page.getByRole("heading", { name: "Under Development" }))
    .toBeVisible();
  await page
    .getByRole("navigation", { name: regionNavigation })
    .locator('[data-region-id="surface"]')
    .click();
  await expect(terrainCanvas).toBeVisible();

  await page.getByRole("button", { name: exitSaveMode }).click();
  await expect(page.locator("[data-mode-badge]")).toHaveText(baseMap);
  await expect(page.getByRole("button", { name: selectSave })).toBeVisible();
  await expect(page.locator(".reference-surface-backdrop")).toBeVisible();
  await expect(terrainCoverage).toContainText(
    "Select a Scrap Mechanic 1.0 Survival save to build the map from its actual terrain layout."
  );
  await expect(terrainCoverage).not.toContainText("Legacy images 2 cells");
});

test("updates Warehouse counts and labels after committing a different save", async ({
  page,
  syntheticSaves
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const firstSave = await syntheticSaves.create({
    name: "location-tree-one-warehouse.db",
    grid: warehouseGrid(1)
  });
  const differentSave = await syntheticSaves.create({
    name: "location-tree-two-warehouses.db",
    grid: warehouseGrid(2)
  });
  const tree = page.locator("[data-map-layer-tree]");
  const warehouse = tree.locator(
    "input[data-location-type-id='generated:warehouse']"
  );
  const warehouseRow = warehouse.locator("..");
  const generatedDisclosure = tree.locator(
    "button[data-location-disclosure-id='generated']"
  );
  const locationNamesDisclosure = tree.locator(
    "button[data-location-master-disclosure]"
  );
  const warehouseLabels = page.locator(".poi-place-label", {
    hasText: "Warehouse"
  });

  await page.getByLabel(saveInput).setInputFiles(firstSave.path);
  await expect(page.locator("[data-status]")).toContainText(
    "Your personal map is ready"
  );
  await expect(warehouseRow).toHaveText("Warehouse (1)");
  await locationNamesDisclosure.evaluate((button: HTMLButtonElement) => button.click());
  await generatedDisclosure.click();
  await warehouse.check();
  await expect(warehouseLabels).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("locationTypes")).toBe(
    "fixed:mechanic-station,generated:warehouse"
  );

  await page.getByLabel(saveInput).setInputFiles(differentSave.path);
  await expect(page.locator("[data-mode-file]")).toHaveText(differentSave.name);
  await expect(page.locator("[data-status]")).toContainText(
    "Your personal map is ready"
  );
  await expect(warehouseRow).toHaveText("Warehouse (2)");
  await expect(warehouseLabels).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get("locationTypes")).toBe(
    "fixed:mechanic-station,generated:warehouse"
  );
});

test("shows unfinished regions as under development", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?region=surface&z=-3&x=12&y=-8&locationTypes=generated%3Awarehouse&layers=terrain%2Clabels"
  );
  await page.waitForLoadState("networkidle");

  const regions = page.getByRole("navigation", { name: regionNavigation });
  await expect(regions.locator('[data-region-id="surface"]'))
    .toHaveText("Surface World");
  await expect(regions.locator('[data-region-id="drilling-area-1"]'))
    .toHaveText("Drilling Area 1");
  await regions.locator('[data-region-id="drilling-area-1"]').click();

  await expect(page.getByRole("heading", { name: "Under Development" }))
    .toBeVisible();
  await expect(page.getByText("This region map is not available yet."))
    .toBeVisible();
  await expect(page.locator("#map")).toBeHidden();
  await expect(page.locator("#location-panel")).toBeHidden();
  await expect(page.locator("[data-location-details]")).toBeHidden();
  await expect(page.locator(".filter-toggle")).toBeHidden();
  expect(new URL(page.url()).search).toBe("?region=drilling-area-1");

  await page
    .getByRole("navigation", { name: regionNavigation })
    .locator('[data-region-id="surface"]')
    .click();

  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("[data-map-controls]")).toBeVisible();
  await expect(page.locator("[data-region-development]")).toBeHidden();
});
