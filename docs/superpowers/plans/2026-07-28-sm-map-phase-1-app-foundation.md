# Scrap Mechanic 1.0 Map Phase 1: Application Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy single-map page with the approved responsive industrial atlas UI while preserving a fully usable no-save base mode.

**Architecture:** Vite owns the static build and TypeScript modules own domain state, Leaflet rendering, and UI composition. The base mode loads checked-in JSON fixtures through a repository interface so later game-data and save-data phases can replace the source without changing the interface.

**Tech Stack:** Vite, TypeScript, Leaflet, Vitest with jsdom, Playwright, CSS.

## Global Constraints

- Work inside the existing `html/` directory; keep legacy map images under `html/assets/img/` until Phase 2 verifies their replacements.
- Use `L.CRS.Simple`; game coordinates must not be represented as geographic latitude/longitude.
- Bundle Leaflet, fonts, icons, and all scripts locally; remove CDN and Google Fonts references.
- Base mode must work with no save and must expose region navigation, search, filters, result count/list, map, and details.
- Desktop uses header + left list + center map + right details; mobile uses full map + filter drawer + bottom details sheet.
- UI text is Simplified Chinese for the first release, with stable machine-readable IDs in English.

---

### Task 1: Establish the Vite, TypeScript, and browser-test baseline

**Files:**
- Modify: `html/package.json`
- Modify: `html/package-lock.json`
- Modify: `html/index.html`
- Create: `html/tsconfig.json`
- Create: `html/vite.config.ts`
- Create: `html/playwright.config.ts`
- Create: `html/src/main.ts`
- Create: `html/src/vite-env.d.ts`
- Create: `html/src/test/setup.ts`
- Create: `html/tests/e2e/app-smoke.spec.ts`

**Interfaces:**
- Produces: Vite entry module `html/src/main.ts`; scripts `dev`, `build`, `preview`, `lint`, `test`, and `test:e2e`.
- Produces: DOM root `<div id="app"></div>` used by every later UI task.

- [ ] **Step 1: Replace package metadata and install pinned major dependencies**

  Set scripts and dependencies in `package.json`:

  ```json
  {
    "name": "scrap-mechanic-1-map",
    "private": true,
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc --noEmit && vite build",
      "preview": "vite preview",
      "lint": "tsc --noEmit",
      "test": "vitest run",
      "test:e2e": "playwright test"
    },
    "dependencies": {
      "leaflet": "^1.9.4"
    },
    "devDependencies": {
      "@playwright/test": "^1.55.0",
      "@types/leaflet": "^1.9.20",
      "jsdom": "^26.1.0",
      "typescript": "^5.8.3",
      "vite": "^7.0.0",
      "vitest": "^3.2.4"
    }
  }
  ```

  Run: `npm install`

- [ ] **Step 2: Write the failing browser smoke test**

  ```ts
  import { expect, test } from "@playwright/test";

  test("opens the base atlas without requesting a save", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "机械工坊地图" })).toBeVisible();
    await expect(page.getByText("基础地图", { exact: true })).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
  });
  ```

- [ ] **Step 3: Run the test and verify the baseline fails**

  Run: `npm run build && npm run test:e2e -- tests/e2e/app-smoke.spec.ts`

  Expected: FAIL because the new application heading and map shell do not exist.

- [ ] **Step 4: Add the minimal entry document and application shell**

  `index.html` must contain no remote URL and `main.ts` must render:

  ```ts
  import "leaflet/dist/leaflet.css";
  import "./styles/app.css";

  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <h1>机械工坊地图</h1>
        <span class="mode-badge">基础地图</span>
      </header>
      <aside class="location-panel" aria-label="地点浏览"></aside>
      <section id="map" aria-label="互动地图"></section>
      <aside class="detail-panel" aria-label="地点详情"></aside>
    </main>`;
  ```

- [ ] **Step 5: Verify and commit**

  Run: `npm run lint && npm run build && npm run test:e2e -- tests/e2e/app-smoke.spec.ts`

  Expected: all commands PASS and `dist/` contains static assets.

  Commit:

  ```bash
  git add html/package.json html/package-lock.json html/index.html html/tsconfig.json html/vite.config.ts html/playwright.config.ts html/src html/tests
  git commit -m "build: establish typed static map app"
  ```

### Task 2: Define domain models, base fixtures, and URL state

**Files:**
- Create: `html/src/domain/map-model.ts`
- Create: `html/src/domain/ui-state.ts`
- Create: `html/src/domain/ui-state.test.ts`
- Create: `html/src/data/map-repository.ts`
- Create: `html/src/data/reference-repository.ts`
- Create: `html/public/data/reference-world.json`
- Create: `html/public/data/regions.json`
- Create: `html/public/data/locations.json`

**Interfaces:**
- Produces: `WorldMap`, `TerrainCell`, `MapLocation`, `RegionDefinition`, `MapUiState`.
- Produces: `parseUiState(search: string): MapUiState` and `serializeUiState(state: MapUiState): string`.
- Produces: `MapRepository.loadWorld(regionId: string): Promise<WorldMap>`.

- [ ] **Step 1: Write tests for safe URL serialization**

  ```ts
  import { describe, expect, it } from "vitest";
  import { parseUiState, serializeUiState } from "./ui-state";

  it("round-trips non-sensitive map state", () => {
    const state = parseUiState("?region=surface&z=2&x=12&y=-8&q=lab&cat=boss,quest&selected=grow-lab-1");
    expect(state).toMatchObject({ regionId: "surface", zoom: 2, center: { x: 12, y: -8 }, query: "lab" });
    expect(serializeUiState(state)).toContain("selected=grow-lab-1");
  });

  it("drops save-like keys", () => {
    const state = parseUiState("?region=surface&save=C%3A%5Cprivate.db&seed=123");
    const encoded = serializeUiState(state);
    expect(encoded).not.toContain("save");
    expect(encoded).not.toContain("seed");
  });
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm test -- src/domain/ui-state.test.ts`

  Expected: FAIL because the model and functions do not exist.

- [ ] **Step 3: Implement exact public model types**

  Define the approved fields in `map-model.ts`, including:

  ```ts
  export type Precision = "exact" | "save-exact" | "area-reference" | "unknown";
  export type Progress = "locked" | "available" | "visited" | "completed" | "unknown";
  export interface CellBounds { minX: number; minY: number; maxX: number; maxY: number }
  export interface TerrainCell {
    x: number; y: number; uuid: string; rotation: 0 | 1 | 2 | 3;
    xOffset: number; yOffset: number; flags: number; terrainType: string; poiType?: string;
  }
  export interface MapLocation {
    id: string; regionId: string; name: string; category: string; precision: Precision;
    position?: { x: number; y: number; z?: number }; bounds?: CellBounds;
    questIds: string[]; resourceIds: string[]; enemyIds: string[];
    progress?: Progress; relatedRegionIds: string[];
  }
  export interface WorldMap {
    id: string; source: "reference" | "save" | "fixed-region"; gameVersion: string;
    saveVersion?: number; seed?: number; bounds: CellBounds; cells: TerrainCell[];
    locations: MapLocation[]; connections: WorldConnection[];
  }
  export interface WorldConnection {
    id: string; fromRegionId: string; toRegionId: string;
    fromPosition?: { x: number; y: number; z?: number };
    toPosition?: { x: number; y: number; z?: number };
  }
  export interface RegionDefinition {
    id: string; name: string; group: "surface" | "story" | "grow-lab" | "underground" | "boss";
    source: "reference" | "fixed-region" | "generated"; bounds: CellBounds;
  }
  export interface MapUiState {
    regionId: string; zoom: number; center: { x: number; y: number };
    query: string; categoryIds: string[]; layerIds: string[]; selectedLocationId?: string;
  }
  export interface MapRepository {
    loadRegions(): Promise<RegionDefinition[]>;
    loadWorld(regionId: string): Promise<WorldMap>;
  }
  ```

- [ ] **Step 4: Implement strict URL parsing and base repository fixtures**

  Accept only known query keys, finite numeric centers, zoom `0..6`, comma-separated category/layer IDs, and string IDs limited to 100 characters. Populate fixture regions for surface, excavation island, Grow Labs 1–7, mining hub, scrapyard, underground stations, boss areas, drilling areas, and underground guidance.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- src/domain/ui-state.test.ts && npm run lint`

  Expected: PASS.

  Commit:

  ```bash
  git add html/src/domain html/src/data html/public/data
  git commit -m "feat: define map domain and base catalog"
  ```

### Task 3: Build the mechanical workshop responsive shell

**Files:**
- Create: `html/src/app/app-shell.ts`
- Create: `html/src/app/app-shell.test.ts`
- Create: `html/src/components/region-selector.ts`
- Create: `html/src/components/location-browser.ts`
- Create: `html/src/components/location-details.ts`
- Create: `html/src/components/save-entry.ts`
- Create: `html/src/styles/tokens.css`
- Create: `html/src/styles/app.css`
- Modify: `html/src/main.ts`

**Interfaces:**
- Consumes: `MapLocation`, `RegionDefinition`, and `MapUiState`.
- Produces: `createAppShell(root: HTMLElement, callbacks: AppCallbacks): AppShell`.
- Produces: `AppShell.renderLocations`, `renderDetails`, `setMode`, `setStatus`, and `destroy`.

- [ ] **Step 1: Write the component behavior test**

  ```ts
  import { expect, it, vi } from "vitest";
  import { createAppShell } from "./app-shell";

  it("filters locations and opens details with keyboard input", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const onLocationSelect = vi.fn();
    const shell = createAppShell(document.querySelector("#app")!, { onLocationSelect });
    shell.renderLocations([
      { id: "lab", regionId: "surface", name: "Grow Lab 入口", category: "quest", precision: "exact",
        questIds: [], resourceIds: [], enemyIds: [], relatedRegionIds: [] }
    ]);
    document.querySelector<HTMLButtonElement>('[data-location-id="lab"]')!.click();
    expect(onLocationSelect).toHaveBeenCalledWith("lab");
  });
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npm test -- src/app/app-shell.test.ts`

  Expected: FAIL because `createAppShell` does not exist.

- [ ] **Step 3: Implement the shell and accessible components**

  Use semantic buttons, labels, `<dialog>` only where browser focus trapping is desired, and `aria-live="polite"` for parsing status. `save-entry.ts` must support both file-button selection and `.db` drag/drop, then emit a selected `File` without reading it:

  ```ts
  export interface AppCallbacks {
    onRegionChange?(regionId: string): void;
    onQueryChange?(query: string): void;
    onCategoryChange?(categoryIds: string[]): void;
    onLocationSelect?(locationId: string): void;
    onSaveSelect?(file: File): void;
    onExitSaveMode?(): void;
  }
  ```

- [ ] **Step 4: Implement layout tokens and breakpoints**

  Use CSS custom properties `--metal-950`, `--metal-900`, `--metal-700`, `--safety-orange`, `--text-primary`, and `--focus-ring`. At widths `>= 1100px`, use columns `320px minmax(420px, 1fr) 340px`; below `760px`, the map fills the viewport, filters become a left drawer, and details use a bottom sheet. Honor `prefers-reduced-motion: reduce`.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- src/app/app-shell.test.ts && npm run build`

  Expected: PASS with no remote font or script URLs in `dist/index.html`.

  Commit:

  ```bash
  git add html/src/app html/src/components html/src/styles html/src/main.ts
  git commit -m "feat: add mechanical workshop map shell"
  ```

### Task 4: Add the Leaflet map adapter and base interaction

**Files:**
- Create: `html/src/map/map-view.ts`
- Create: `html/src/map/map-view.test.ts`
- Create: `html/src/map/coordinate-system.ts`
- Create: `html/src/map/coordinate-system.test.ts`
- Create: `html/src/map/location-layer.ts`
- Modify: `html/src/main.ts`

**Interfaces:**
- Consumes: normalized `WorldMap`, `MapLocation`, and `MapUiState`.
- Produces: `createMapView(element: HTMLElement, callbacks: MapViewCallbacks): MapView`.
- Produces: `MapView.setWorld`, `setLocations`, `selectLocation`, `setLayerVisibility`, `getViewport`, and `destroy`.

  ```ts
  export interface MapViewCallbacks {
    onViewportChange(viewport: { center: { x: number; y: number }; zoom: number }): void;
    onLocationSelect(locationId: string): void;
  }
  ```

- [ ] **Step 1: Write coordinate and lifecycle tests**

  ```ts
  import { expect, it } from "vitest";
  import { cellToMapPoint, mapPointToCell } from "./coordinate-system";

  it("round-trips game cell coordinates without geographic projection", () => {
    const point = cellToMapPoint({ x: -36, y: -41 });
    expect(mapPointToCell(point)).toEqual({ x: -36, y: -41 });
  });
  ```

  Add a DOM test asserting `destroy()` removes Leaflet listeners and the map container `_leaflet_id`.

- [ ] **Step 2: Run tests and verify they fail**

  Run: `npm test -- src/map`

  Expected: FAIL because the map modules do not exist.

- [ ] **Step 3: Implement the coordinate system and map adapter**

  Initialize Leaflet with:

  ```ts
  L.map(element, {
    crs: L.CRS.Simple,
    minZoom: 0,
    maxZoom: 6,
    zoomControl: false,
    attributionControl: true
  });
  ```

  Represent one terrain cell as 64 map units, invert only the screen Y axis in `coordinate-system.ts`, and keep all inversion logic out of components.

- [ ] **Step 4: Implement category layers and linked selection**

  Use one `L.LayerGroup` per category, marker buttons with icon + shape + text alternatives, and `fitBounds` for bounded locations. Selecting from map or list must call the same callback and update the details panel.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- src/map && npm run build`

  Expected: PASS.

  Commit:

  ```bash
  git add html/src/map html/src/main.ts
  git commit -m "feat: add normalized Leaflet map view"
  ```

### Task 5: Complete the no-save journey and responsive browser tests

**Files:**
- Create: `html/src/app/app-controller.ts`
- Create: `html/src/app/app-controller.test.ts`
- Modify: `html/src/main.ts`
- Modify: `html/tests/e2e/app-smoke.spec.ts`
- Create: `html/tests/e2e/base-map.spec.ts`
- Create: `html/tests/e2e/mobile-map.spec.ts`

**Interfaces:**
- Consumes: `MapRepository`, `AppShell`, `MapView`, URL state functions.
- Produces: `startApp(root: HTMLElement, repository: MapRepository): Promise<AppController>`.

- [ ] **Step 1: Write integration tests for search, region switching, details, and save entry**

  Browser assertions must cover:

  ```ts
  await page.getByRole("searchbox", { name: "搜索地点" }).fill("Grow Lab");
  await expect(page.getByTestId("result-count")).toHaveText("7 个地点");
  await page.getByRole("button", { name: /Grow Lab 1/ }).click();
  await expect(page.getByRole("complementary", { name: "地点详情" })).toContainText("Grow Lab 1");
  await page.getByRole("button", { name: "选择存档" }).click();
  ```

  Also assert that URL updates after selecting a region and no `save`, `seed`, or file name appears in it.

- [ ] **Step 2: Run integration tests and verify they fail**

  Run: `npm run test:e2e -- tests/e2e/base-map.spec.ts tests/e2e/mobile-map.spec.ts`

  Expected: FAIL because controller wiring and journeys are incomplete.

- [ ] **Step 3: Implement controller state flow**

  Load the selected region through `MapRepository`, derive visible locations from query/categories/layers, update shell + map atomically, and use `history.replaceState` for URL synchronization. File selection only sets `aria-live` text to `存档解析功能将在下一阶段启用` in this phase.

- [ ] **Step 4: Verify desktop and mobile journeys**

  Run: `npm test && npm run build && npm run test:e2e`

  Expected: all tests PASS at desktop `1440x900` and mobile `390x844`; the base map remains interactive without a file selection.

- [ ] **Step 5: Commit**

  ```bash
  git add html/src html/tests
  git commit -m "feat: complete interactive base map journey"
  ```
