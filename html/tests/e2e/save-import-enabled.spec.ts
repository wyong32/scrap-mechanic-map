import { expect, test } from "@playwright/test";

test("enabled production release exposes the local save entry controls", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?region=surface&z=-3&x=0&y=0");

  const saveInput = page.getByLabel("Select a Scrap Mechanic .db save file");
  await expect(saveInput).toBeAttached();
  await expect(saveInput).toBeEnabled();
  await expect(page.getByRole("button", { name: "Select Save", exact: true }))
    .toBeVisible();
  await expect(page.locator("[data-save-drop-zone]")).toContainText(
    "or drop a .db save file here"
  );
  await expect(page.locator("[data-save-drop-zone]")).toBeVisible();
  await expect(page.locator("[data-save-path-hint]")).toContainText(
    "Find your Survival save here:"
  );
  await expect(page.locator("[data-save-path-hint]")).toBeVisible();

  const [catalogResponse, atlasResponse] = await Promise.all([
    page.request.get("/data/generated/tile-catalog.json"),
    page.request.get("/atlas/official/official-tile-atlas.json")
  ]);
  expect(catalogResponse.ok()).toBe(true);
  expect((await catalogResponse.json()).tiles).toBeDefined();
  expect(atlasResponse.ok()).toBe(true);
  const atlas = await atlasResponse.json();
  expect(atlas.schemaVersion).toBe(1);
  expect(Object.keys(atlas.pages).length).toBeGreaterThan(0);
});
