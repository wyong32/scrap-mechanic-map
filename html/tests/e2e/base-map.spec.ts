import { expect, test } from "@playwright/test";

const searchLocations = "\u641c\u7d22\u5730\u70b9";
const locationDetails = "\u5730\u70b9\u8be6\u60c5";
const selectSave = "\u9009\u62e9\u5b58\u6863";
const saveInput = "\u9009\u62e9 Scrap Mechanic .db \u5b58\u6863";
const mechanicStation = "\u6280\u5e08\u7ad9";
const mapLayers = "\u5730\u56fe\u56fe\u5c42";
const coordinateGrid = "\u5750\u6807\u7f51\u683c";
const zoomIn = "\u653e\u5927";
const zoomOut = "\u7f29\u5c0f";
const resetView = "\u91cd\u7f6e\u89c6\u56fe";
const regionNavigation = "\u533a\u57df\u9009\u62e9";
const baseMap = "\u57fa\u7840\u5730\u56fe";

test("keeps the no-save reference map useful without inventing a player surface", async ({
  page
}) => {
  const atlasRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/atlas/")) {
      atlasRequests.push(request.url());
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("[data-mode-badge]")).toHaveText(baseMap);
  await expect(page.locator("[data-mode-file]")).toBeHidden();
  await expect(page.locator("[data-mode-meta]")).toBeHidden();
  await expect(page.locator("[data-terrain-coverage]")).toHaveAttribute(
    "data-personal",
    "false"
  );
  await expect(page.locator("[data-terrain-coverage]")).toContainText(
    "\u9009\u62e9 1.0 Survival \u5b58\u6863\u540e"
  );
  await expect(page.getByRole("button", { name: selectSave })).toBeVisible();
  await expect(page.getByLabel(saveInput)).toBeVisible();
  expect(atlasRequests).toEqual([]);
  await expect(page.locator("[data-atlas-error]")).toHaveCount(0);
  await expect(
    page.locator("canvas[data-terrain-frame='committed']")
  ).toBeVisible();
  await expect(page.locator(".reference-surface-backdrop")).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".reference-surface-backdrop").evaluate(
        (image) => (image as HTMLImageElement).naturalWidth
      )
    )
    .toBeGreaterThan(0);
  const mapBox = await page.locator("#map").boundingBox();
  const surfaceBox = await page
    .locator(".reference-surface-backdrop")
    .boundingBox();
  expect(mapBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(surfaceBox!.width).toBeLessThanOrEqual(mapBox!.width + 2);
  expect(surfaceBox!.height).toBeLessThanOrEqual(mapBox!.height + 2);


  const regions = page.getByRole("navigation", { name: regionNavigation });
  await expect(regions.locator("[data-region-id]")).toHaveCount(18);
  const marker = page.locator('[data-map-location-id="mechanic-station"]');
  await expect(marker).toHaveCount(1);
  await page
    .locator("[data-location-list]")
    .getByRole("button", { name: new RegExp(mechanicStation) })
    .click();
  await expect(page.getByRole("complementary", { name: locationDetails }))
    .toContainText(mechanicStation);

  await page.getByRole("searchbox", { name: searchLocations }).fill("Grow Lab");
  await expect(page.getByTestId("result-count")).toHaveText("7 \u4e2a\u5730\u70b9");
  await page.locator('.category-filter input[value="quest"]').check({
    force: true
  });
  await expect(page.getByTestId("result-count")).toHaveText("7 \u4e2a\u5730\u70b9");
  await regions.locator('[data-region-id="grow-lab-2"]').click();
  await expect(page).toHaveURL(/(?:\?|&)region=grow-lab-2(?:&|$)/);
  await expect(page.locator('[data-map-location-id="grow-lab-2"]')).toHaveCount(
    1
  );
  await expect(page.locator("[data-mode-badge]")).toHaveText(baseMap);
  await expect(page.locator("[data-atlas-error]")).toHaveCount(0);
  await expect(
    page.locator("canvas[data-terrain-frame='committed']")
  ).toBeVisible();
  await expect(page.locator(".reference-surface-backdrop")).toHaveCount(0);
  await expect(page.locator(".fixed-region-backdrop")).toBeVisible();
  expect(
    atlasRequests.some((url) =>
      new URL(url).pathname.endsWith("/terrain-cell-atlas.json"))
  ).toBe(true);

  await regions.locator('[data-region-id="surface"]').click();
  await expect(page.locator(".reference-surface-backdrop")).toBeVisible();
});

test("searches the global catalog while keeping the active map region-congruent", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("[data-map-location-id]")).toHaveCount(1);
  await page.getByRole("searchbox", { name: searchLocations }).fill("Grow Lab");
  await expect(page.getByTestId("result-count")).toHaveText("7 \u4e2a\u5730\u70b9");
  await expect(page.locator("[data-map-location-id]")).toHaveCount(0);

  await page
    .locator("[data-location-list]")
    .getByRole("button", { name: /Grow Lab 1/ })
    .click();

  await expect(page.getByRole("complementary", { name: locationDetails })).toContainText(
    "Grow Lab 1"
  );
  await expect(page.locator("[data-map-location-id]")).toHaveCount(1);
  await expect(
    page.locator('[data-map-location-id="grow-lab-1"]')
  ).toHaveAttribute("aria-pressed", "true");

  const selectedUrl = new URL(page.url());
  expect(selectedUrl.searchParams.get("region")).toBe("grow-lab-1");
  expect(selectedUrl.searchParams.get("selected")).toBe("grow-lab-1");
  expect(selectedUrl.searchParams.get("q")).toBe("Grow Lab");
});

test("enters the save picker without exposing local save metadata in the URL", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?region=grow-lab-2&q=Grow%20Lab");
  await page.waitForLoadState("networkidle");

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: selectSave }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "Survival-Secret.db",
    mimeType: "application/x-sqlite3",
    buffer: Buffer.from("SQLite format 3")
  });

  await expect(page.locator("[data-status]")).toContainText("not a SQLite");
  await expect(page.getByRole("button", { name: selectSave })).toBeVisible();
  await expect(page.getByLabel(saveInput)).toHaveValue("");

  const saveUrl = new URL(page.url());
  expect(saveUrl.searchParams.has("save")).toBe(false);
  expect(saveUrl.searchParams.has("seed")).toBe(false);
  expect(decodeURIComponent(saveUrl.href)).not.toContain("Survival-Secret.db");
});

test("normalizes the initial URL to allowlisted viewport state", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?region=surface&z=2&x=12&y=-8#save=Survival-Secret.db&seed=123"
  );
  await page.waitForLoadState("networkidle");

  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        zoom: url.searchParams.get("z"),
        x: url.searchParams.get("x"),
        y: url.searchParams.get("y"),
        hash: url.hash
      };
    })
    .toEqual({ zoom: "2", x: "12", y: "-8", hash: "" });
});

test("synchronizes the URL after bounded location selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page
    .locator("[data-location-list]")
    .getByRole("button", { name: new RegExp(mechanicStation) })
    .click();

  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        selected: url.searchParams.get("selected"),
        x: url.searchParams.get("x"),
        y: url.searchParams.get("y")
      };
    })
    .toEqual({ selected: "mechanic-station", x: "-35.5", y: "-39.5" });
});

test("preserves a user-panned viewport during query and category filtering", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page
    .locator("[data-location-list]")
    .getByRole("button", { name: new RegExp(mechanicStation) })
    .click();
  const readViewport = () => {
    const url = new URL(page.url());
    return {
      zoom: url.searchParams.get("z"),
      x: url.searchParams.get("x"),
      y: url.searchParams.get("y")
    };
  };
  const focusedViewport = readViewport();
  const map = page.getByRole("region", { name: "\u4e92\u52a8\u5730\u56fe" });
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(readViewport).not.toEqual(focusedViewport);
  const pannedViewport = readViewport();

  await page.getByRole("searchbox", { name: searchLocations }).fill(mechanicStation);

  await expect(page.getByTestId("result-count")).toHaveText("1 \u4e2a\u5730\u70b9");
  expect(readViewport()).toEqual(pannedViewport);
  expect(new URL(page.url()).searchParams.get("q")).toBe(mechanicStation);

  await page.locator('.category-filter input[value="poi"]').check({ force: true });

  await expect(page.locator('.category-filter input[value="poi"]')).toBeChecked();
  expect(new URL(page.url()).searchParams.get("cat")).toBe("poi");
  expect(readViewport()).toEqual(pannedViewport);
});

test("operates map overlays, zoom, reset, and the normalized readout", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-mode-badge]")).toHaveText(baseMap);
  await expect(
    page.locator("canvas[data-terrain-frame='committed']")
  ).toBeVisible();
  const layers = page.getByRole("group", { name: mapLayers });
  const poi = layers.getByRole("checkbox", { name: "POI", exact: true });
  const grid = layers.getByRole("checkbox", {
    name: coordinateGrid,
    exact: true
  });

  await expect(poi).toBeChecked();
  await poi.uncheck();
  await expect(page.locator("[data-map-location-id]")).toHaveCount(0);
  await poi.check();
  await expect(page.locator("[data-map-location-id]")).toHaveCount(1);

  await expect(page.locator("[data-coordinate-grid]")).toBeVisible();
  await grid.uncheck();
  await expect(page.locator("[data-coordinate-grid]")).toBeHidden();

  await page.getByRole("button", { name: zoomIn }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("z")).toBe("-3");
  await expect(page.locator("[data-map-readout]")).toContainText(
    "\u7f29\u653e -3"
  );
  await page.getByRole("button", { name: zoomOut }).click();

  const map = page.getByRole("region", { name: "\u4e92\u52a8\u5730\u56fe" });
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("x"))
    .not.toBe("0");
  await page.getByRole("button", { name: resetView }).click();
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        zoom: url.searchParams.get("z"),
        x: url.searchParams.get("x"),
        y: url.searchParams.get("y")
      };
    })
    .toEqual({ zoom: "-4", x: "0", y: "0" });
  await expect(page.locator("[data-map-readout]")).toHaveText(
    "\u5750\u6807 X 0 \u00b7 Y 0 \u00b7 \u7f29\u653e -4"
  );
});

test("preserves keyboard focus through category and location rerenders", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const poiCategory = page.locator('.category-filter input[value="poi"]');
  await poiCategory.focus();
  await page.keyboard.press("Space");
  await expect(poiCategory).toBeFocused();
  await expect(poiCategory).toBeChecked();

  const location = page.locator('[data-location-id="mechanic-station"]');
  await location.focus();
  await page.keyboard.press("Enter");
  await expect(location).toBeFocused();
  await expect(location).toHaveAttribute("aria-current", "true");
  await expect(page.locator("body")).not.toBeFocused();
});
