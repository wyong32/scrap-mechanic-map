# Under-Development Region Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every region tab visible while showing only Surface World as an interactive map and rendering a clear under-development page for every other region.

**Architecture:** A fail-closed region-availability policy defines which public region IDs are enabled. `AppController` uses that policy before repository loading, while `AppShell` owns a semantic map/development presentation switch that hides and makes inactive the complete map workspace.

**Tech Stack:** TypeScript, Vitest + JSDOM, Vite, Playwright Chromium, existing DOM/CSS architecture.

## Global Constraints

- `surface` is the only available region.
- Unknown and future region IDs fail closed.
- All other region tabs remain visible and selectable.
- Unavailable regions must not call `repository.loadWorld(regionId)` or display a map, temporary image, POI, player marker, sidebar, map control, or details panel.
- Visible interface copy remains English.
- No new runtime dependency.
- Preserve all unrelated dirty-worktree changes and commit only task-specific hunks.

---

### Task 1: Fail-Closed Region Availability Policy

**Files:**
- Create: `src/domain/region-availability.ts`
- Create: `src/domain/region-availability.test.ts`

**Interfaces:**
- Produces: `isRegionAvailable(regionId: string): boolean`.
- Consumed by: Task 3 controller integration.

- [ ] **Step 1: Write the failing policy tests**

```ts
import { describe, expect, it } from "vitest";
import { isRegionAvailable } from "./region-availability";

describe("isRegionAvailable", () => {
  it("allows only Surface World", () => {
    expect(isRegionAvailable("surface")).toBe(true);
    expect(isRegionAvailable("scrapyard")).toBe(false);
    expect(isRegionAvailable("grow-lab-1")).toBe(false);
    expect(isRegionAvailable("drilling-area-1")).toBe(false);
  });

  it("fails closed for unknown and empty region IDs", () => {
    expect(isRegionAvailable("future-region")).toBe(false);
    expect(isRegionAvailable("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run src/domain/region-availability.test.ts`

Expected: FAIL because `region-availability.ts` does not exist.

- [ ] **Step 3: Implement the minimal allowlist**

```ts
const AVAILABLE_REGION_IDS = new Set(["surface"]);

export function isRegionAvailable(regionId: string): boolean {
  return AVAILABLE_REGION_IDS.has(regionId);
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm.cmd test -- --run src/domain/region-availability.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the policy**

```powershell
git add -- src/domain/region-availability.ts src/domain/region-availability.test.ts
git commit -m "feat: define available map regions"
```

---

### Task 2: Semantic Under-Development Shell Mode

**Files:**
- Modify: `src/app/app-shell.ts`
- Modify: `src/app/app-shell.test.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- Produces: `AppShell.setRegionContentMode(mode: "map" | "under-development"): void`.
- Consumed by: Task 3 controller integration.

- [ ] **Step 1: Write failing shell behavior tests**

Add tests using the real `createAppShell`:

```ts
it("shows a semantic development page and makes the map workspace inactive", () => {
  const shell = createAppShell(document.querySelector("#app")!, {});
  shell.setRegionContentMode("under-development");

  expect(document.querySelector("[data-region-development] h2")?.textContent)
    .toBe("Under Development");
  expect(document.querySelector("[data-region-development] p")?.textContent)
    .toBe("This region map is not available yet.");
  expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#location-panel")?.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("[data-location-details]")?.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("[data-region-development]")?.hidden).toBe(false);
});

it("restores the complete interactive workspace", () => {
  const shell = createAppShell(document.querySelector("#app")!, {});
  shell.setRegionContentMode("under-development");
  shell.setRegionContentMode("map");

  expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>("#location-panel")?.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>("[data-location-details]")?.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>("[data-region-development]")?.hidden).toBe(true);
});
```

Also assert the hidden map/sidebar/details containers are inert and the mobile filter toggle is hidden in development mode, then restored in map mode.

- [ ] **Step 2: Run the shell tests and verify RED**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts`

Expected: FAIL because the shell API and development page do not exist.

- [ ] **Step 3: Add the development section and presentation API**

Add this sibling after the map workspace in the shell template:

```html
<section class="region-development" data-region-development hidden>
  <div class="region-development__content">
    <span class="region-development__eyebrow">REGION MAP</span>
    <h2>Under Development</h2>
    <p>This region map is not available yet.</p>
  </div>
</section>
```

Implement `setRegionContentMode` by toggling `hidden` and `inert` on `#map`, `#location-panel`, and `[data-location-details]`, toggling the development section inversely, closing the mobile drawer, and hiding the filter toggle. Do not destroy or recreate the Leaflet map instance.

- [ ] **Step 4: Add focused layout styles**

Add `.region-development` styles that occupy the normal content columns, center a bordered mechanic-workshop panel, preserve the dark/orange visual language, and collapse cleanly at the existing mobile breakpoint. Do not increase sidebar widths or alter Surface World map sizing.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts`

Expected: all shell tests PASS.

- [ ] **Step 6: Commit the shell mode**

```powershell
git add -- src/app/app-shell.ts src/app/app-shell.test.ts src/styles/app.css
git commit -m "feat: add under-development region page"
```

---

### Task 3: Controller Navigation Without Unavailable World Loads

**Files:**
- Modify: `src/app/app-controller.ts`
- Modify: `src/app/app-controller.test.ts`

**Interfaces:**
- Consumes: `isRegionAvailable` from Task 1 and `AppShell.setRegionContentMode` from Task 2.
- Produces: canonical unavailable-region startup, navigation, cancellation, and Surface World return behavior.

- [ ] **Step 1: Write failing controller tests**

Add repository call tracking and tests that prove:

```ts
it("opens an unavailable region without loading or rendering its world", async () => {
  window.history.replaceState({}, "", "/?region=grow-lab-1");
  const repository = new TrackingRepository();
  await startApp(document.querySelector("#app")!, repository, options);

  expect(repository.loadedWorldIds).toEqual(["surface"]);
  expect(document.querySelector("[data-region-development]")?.hasAttribute("hidden"))
    .toBe(false);
  expect(new URL(window.location.href).searchParams.get("region"))
    .toBe("grow-lab-1");
});

it("does not load a selected unavailable region and returns to Surface World", async () => {
  const repository = new TrackingRepository();
  await startApp(document.querySelector("#app")!, repository, options);

  document.querySelector<HTMLButtonElement>("[data-region-id='drilling-area-1']")!.click();
  await vi.waitFor(() => expect(new URL(window.location.href).searchParams.get("region"))
    .toBe("drilling-area-1"));
  expect(repository.loadedWorldIds).not.toContain("drilling-area-1");

  document.querySelector<HTMLButtonElement>("[data-region-id='surface']")!.click();
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#map")?.hidden)
    .toBe(false));
});
```

Add regressions proving an unavailable navigation cancels a deferred fixed/save transition, removes selected-location state, leaves no marker placement work active, keeps the selected region tab active, and cannot be overwritten by an older asynchronous load completion.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `npm.cmd test -- --run src/app/app-controller.test.ts`

Expected: FAIL because unavailable regions are still loaded and no development mode is rendered.

- [ ] **Step 3: Integrate availability into startup**

Keep `state.regionId` as the requested valid region. If it is unavailable, load `surface` only as the internal backing world required by existing map/marker initialization, skip the first map-world render, render region navigation, activate `under-development` shell mode, and synchronize the public URL. Do not call `loadWorld` with the unavailable ID.

- [ ] **Step 4: Integrate availability into region changes**

At the start of `changeRegion`, retain the existing cancellation/generation sequence. For an unavailable region, update `state.regionId`, clear `selectedLocationId`, player-marker draft/placement, and unavailable location-type selection; render the region navigation; activate `under-development`; synchronize the URL; finish the transition; and return before `repository.loadWorld`.

For `surface`, activate map mode only after the Surface World is successfully committed. If loading fails, retain the prior visible mode and selected region rather than showing an empty map.

- [ ] **Step 5: Run focused integration tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/domain/region-availability.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts
```

Expected: all availability, shell, and controller tests PASS.

- [ ] **Step 6: Commit controller integration**

```powershell
git add -- src/app/app-controller.ts src/app/app-controller.test.ts
git commit -m "feat: gate unfinished region maps"
```

---

### Task 4: Build and Browser Acceptance

**Files:**
- Modify if selectors require it: `tests/e2e/personal-map.spec.ts`

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: verified local delivery.

- [ ] **Step 1: Add a focused browser acceptance test**

Use Chromium to click `Drilling Area 1`, assert the development heading/text are visible, assert `#map`, the location panel, details, and filter toggle are hidden/inactive, assert the URL contains only the public selected region state, then click Surface World and assert the interactive map and controls return.

- [ ] **Step 2: Verify the browser test fails before the final behavior is present**

Run:

```powershell
npm.cmd run test:e2e -- tests/e2e/personal-map.spec.ts --project=chromium --grep "shows unfinished regions as under development"
```

Expected: FAIL before the under-development navigation is integrated.

- [ ] **Step 3: Run focused regression**

Run:

```powershell
npm.cmd test -- --run src/domain/region-availability.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts src/map/map-view.test.ts
npm.cmd run lint
npm.cmd run build
```

Expected: tests, TypeScript checking, and production build exit 0.

- [ ] **Step 4: Run browser acceptance**

Run:

```powershell
npm.cmd run test:e2e -- tests/e2e/personal-map.spec.ts --project=chromium --grep "shows unfinished regions as under development"
```

Expected: focused Chromium test PASS.

- [ ] **Step 5: Validate the committed diff and preserve baseline failures separately**

Run `git diff --check` and inspect `git status --short`. Do not clean or stage unrelated work. If the full suite is run, record the two existing `tools/authentic-map/default-surface-job.test.ts` empty-inventory failures separately from this feature.

- [ ] **Step 6: Commit E2E changes if present**

```powershell
git add -- tests/e2e/personal-map.spec.ts
git diff --cached --quiet || git commit -m "test: verify unfinished region pages"
```
