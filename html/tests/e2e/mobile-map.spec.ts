import { expect, test } from "@playwright/test";

const interactiveMap = "\u4e92\u52a8\u5730\u56fe";
const openFilters = "\u6253\u5f00\u5730\u70b9\u7b5b\u9009";
const regionNavigation = "\u533a\u57df\u9009\u62e9";
const searchLocations = "\u641c\u7d22\u5730\u70b9";
const locationDetails = "\u5730\u70b9\u8be6\u60c5";

test("keeps region switching and location selection usable in the mobile drawer", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const map = page.getByRole("region", { name: interactiveMap });
  const toggle = page.getByRole("button", { name: openFilters });
  await expect(map).toBeVisible();
  await expect(page.locator("[data-map-location-id]")).toHaveCount(1);

  await toggle.click();
  const drawer = page.locator("#location-panel");
  const mobileRegions = drawer.getByRole("navigation", { name: regionNavigation });
  await mobileRegions.locator('[data-region-id="grow-lab-2"]').click();

  await expect(page).toHaveURL(/(?:\?|&)region=grow-lab-2(?:&|$)/);
  await expect(page.locator('[data-map-location-id="grow-lab-2"]')).toHaveCount(1);
  await expect(map).toBeVisible();

  await drawer.getByRole("searchbox", { name: searchLocations }).fill("Grow Lab 3");
  await expect(drawer.getByTestId("result-count")).toHaveText("1 \u4e2a\u5730\u70b9");
  await drawer
    .locator("[data-location-list]")
    .getByRole("button", { name: /Grow Lab 3/ })
    .click();

  await expect(page).toHaveURL(/(?:\?|&)region=grow-lab-3(?:&|$)/);
  await expect(page.locator('[data-map-location-id="grow-lab-3"]')).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: locationDetails })).toContainText(
    "Grow Lab 3"
  );
  await expect(drawer).toHaveAttribute("aria-hidden", "true");
  await expect(
    page.getByRole("complementary", { name: locationDetails })
  ).toBeFocused();
  await expect(map).toBeVisible();
});
