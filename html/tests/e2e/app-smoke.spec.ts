import { expect, test } from "@playwright/test";

const atlasHeading = "\u673a\u68b0\u5de5\u574a\u5730\u56fe";
const saveMap = "\u4e13\u5c5e\u5730\u56fe";
const locationBrowser = "\u5730\u70b9\u6d4f\u89c8";
const interactiveMap = "\u4e92\u52a8\u5730\u56fe";
const locationDetails = "\u5730\u70b9\u8be6\u60c5";
const openFilters = "\u6253\u5f00\u5730\u70b9\u7b5b\u9009";
const closeFilters = "\u5173\u95ed\u5730\u70b9\u7b5b\u9009";
const regionNavigation = "\u533a\u57df\u9009\u62e9";
const surfaceGroup = "\u5730\u8868";
const storyGroup = "\u5267\u60c5\u533a\u57df";
const growLabGroup = "Grow Labs";
const undergroundGroup = "\u5730\u4e0b\u8bbe\u65bd";
const bossGroup = "\u9996\u9886";

test("opens the bundled default save without requesting a file", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveTitle(atlasHeading);
  await expect(page.getByRole("heading", { name: atlasHeading })).toBeVisible();
  await expect(page.getByText(saveMap, { exact: true })).toBeVisible();
  await expect(page.locator("[data-mode-file]")).toHaveText("bilige.db");
  await expect(page.locator("[data-mode-meta]")).toContainText("Seed 360160198");
  await expect(page.getByRole("complementary", { name: locationBrowser })).toBeVisible();
  await expect(page.getByRole("region", { name: interactiveMap })).toBeVisible();
  await expect(page.getByRole("complementary", { name: locationDetails })).toBeVisible();
  await expect(page.getByTestId("result-count")).toHaveText("1 \u4e2a\u5730\u70b9");

  const regions = page.getByRole("navigation", { name: regionNavigation });
  await expect(regions.getByRole("group", { name: surfaceGroup })).toBeVisible();
  await expect(regions.getByRole("group", { name: storyGroup })).toBeVisible();
  await expect(regions.getByRole("group", { name: growLabGroup })).toBeVisible();
  await expect(
    regions.getByRole("group", { name: undergroundGroup })
  ).toBeVisible();
  await expect(regions.getByRole("group", { name: bossGroup })).toBeVisible();
  await expect(regions.locator("[data-region-id]")).toHaveCount(18);
  for (const regionId of [
    "surface",
    "excavation-island",
    "grow-lab-1",
    "grow-lab-2",
    "grow-lab-3",
    "grow-lab-4",
    "grow-lab-5",
    "grow-lab-6",
    "grow-lab-7",
    "mining-hub",
    "scrapyard",
    "underground-station-1",
    "underground-station-2",
    "final-boss-hall",
    "trashbot-boss",
    "drilling-area-1",
    "drilling-area-2",
    "underground-guidance"
  ]) {
    await expect(regions.locator(`[data-region-id="${regionId}"]`)).toHaveCount(1);
  }
});

test("opens the accessible mobile drawer with native keyboard activation", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const toggle = page.getByRole("button", { name: openFilters });
  const panel = page.locator("#location-panel");

  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await toggle.focus();
  await page.keyboard.press("Enter");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).not.toHaveAttribute("aria-hidden");
  await expect(
    panel.getByRole("navigation", { name: regionNavigation })
  ).toBeVisible();

  await panel.getByRole("button", { name: closeFilters }).click();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
});
