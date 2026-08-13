import { expect, test } from "@playwright/test";

test("player marker survives reload and can be edited and deleted", async ({ page }) => {
  const markerCard = (name: string) =>
    page.locator("[data-location-browser]").getByRole("button", {
      name: new RegExp(`^${name}\\b`)
    });
  const mapMarker = (name: string) =>
    page.locator("#map").getByRole("button", {
      name: `Player marker: ${name}`,
      exact: true
    });
  const waitForMarkerActions = async () => {
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Add Marker" })).toBeEnabled({
      timeout: 30_000
    });
  };

  await page.route("**/data/default-save.db", (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?region=surface&layers=terrain%2Clabels%2Cplayer-markers");
  await waitForMarkerActions();
  await page.getByRole("button", { name: "Add Marker" }).click();
  await page.getByRole("button", { name: "Zoom In" }).click();
  await page.getByRole("button", { name: "Reset View" }).click();
  await page.getByRole("checkbox", { name: "Player Markers" }).uncheck();
  await page.getByRole("checkbox", { name: "Player Markers" }).check();
  await expect(page.getByRole("button", { name: "Cancel Adding" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.locator("#map").click({ position: { x: 520, y: 360 } });
  await page.getByLabel("Name", { exact: true }).fill("Cotton field");
  await page.getByLabel("Type", { exact: true }).selectOption("resource");
  await page.getByLabel("Notes", { exact: true }).fill("Bring crates");
  await page.getByRole("button", { name: "Save Marker" }).click();

  await expect(markerCard("Cotton field")).toBeVisible();
  await expect(mapMarker("Cotton field")).toBeVisible();

  await page.reload();
  await waitForMarkerActions();
  await expect(markerCard("Cotton field")).toBeVisible();
  await expect(mapMarker("Cotton field")).toBeVisible();
  await markerCard("Cotton field").click();
  const details = page.locator("[data-location-details]");
  await expect(details.getByRole("heading", { name: "Cotton field" })).toBeVisible();
  await expect(details).toContainText("Bring crates");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Cotton reserve");
  await page.getByRole("button", { name: "Save Changes" }).click();

  await expect(markerCard("Cotton reserve")).toBeVisible();
  await expect(markerCard("Cotton field")).toHaveCount(0);
  await expect(mapMarker("Cotton reserve")).toBeVisible();
  await expect(mapMarker("Cotton field")).toHaveCount(0);

  await page.reload();
  await waitForMarkerActions();
  await expect(markerCard("Cotton reserve")).toBeVisible();
  await expect(markerCard("Cotton field")).toHaveCount(0);
  await expect(mapMarker("Cotton reserve")).toBeVisible();
  await expect(mapMarker("Cotton field")).toHaveCount(0);
  await markerCard("Cotton reserve").click();
  await expect(details.getByRole("heading", { name: "Cotton reserve" })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete Marker" }).click();
  await expect(markerCard("Cotton reserve")).toHaveCount(0);
  await expect(mapMarker("Cotton reserve")).toHaveCount(0);
});
