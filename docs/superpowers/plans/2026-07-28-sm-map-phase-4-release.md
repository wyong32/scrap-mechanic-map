# Scrap Mechanic 1.0 Map Phase 4: Progress and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay reliable save-derived locations and progress, then finish privacy, accessibility, performance, documentation, and release verification.

**Architecture:** A location resolver merges fixed catalog records, tile-derived POIs, world connections, and explicitly supported progress records into immutable display records with precision labels. Hardening tests exercise only public behavior and production artifacts, while the base and personalized modes continue to share the same UI controller.

**Tech Stack:** TypeScript, Vitest, Playwright, Leaflet, axe-core, Vite.

## Global Constraints

- Precision is always one of `exact`, `save-exact`, `area-reference`, or `unknown`; UI copy must explain each value.
- Progress is always one of `locked`, `available`, `visited`, `completed`, or `unknown`.
- Unsupported or ambiguous progress is displayed as unknown; no heuristic may label it completed.
- Fixed regions remain available in both modes; save-derived progress may augment but not replace their reference content.
- All buttons, filters, lists, drawers, sheets, map alternatives, status, and errors must be keyboard and screen-reader operable.
- Production runtime must make zero network requests except fetching its own static origin assets.

---

### Task 1: Resolve fixed, tile-derived, connection, and progress locations

**Files:**
- Create: `html/src/locations/location-resolver.ts`
- Create: `html/src/locations/location-resolver.test.ts`
- Create: `html/src/locations/progress-resolver.ts`
- Create: `html/src/locations/progress-resolver.test.ts`
- Create: `html/src/locations/precision.ts`
- Modify: `html/src/save/save-protocol.ts`
- Modify: `html/src/save/save-worker.ts`

**Interfaces:**
- Produces: `resolveLocations(input: LocationResolutionInput): MapLocation[]`.
- Produces: `resolveProgress(records: SupportedProgressRecord[]): Map<string, Progress>`.
- Consumes: fixed catalog, normalized terrain POI types, decoded world connections, and explicitly supported progress records.

  ```ts
  export interface LocationResolutionInput {
    baseLocations: MapLocation[];
    terrainCells: TerrainCell[];
    connections: WorldConnection[];
    progressRecords: SupportedProgressRecord[];
  }
  ```

- [ ] **Step 1: Write merge and precision tests**

  Cover fixed exact locations, tile-derived save-exact POIs, bounded area-reference records, unknown coordinates, duplicate IDs, cross-region connections, and stable sorting. Assert save-exact replaces the matching base reference record while unrelated base records remain.

- [ ] **Step 2: Write conservative progress tests**

  Map only documented record states to locked/available/visited/completed. Assert missing, conflicting, malformed, and unsupported records become `unknown`.

- [ ] **Step 3: Run tests and verify they fail**

  Run: `npm test -- src/locations`

  Expected: FAIL because resolvers do not exist.

- [ ] **Step 4: Implement immutable resolution**

  Key matches by stable catalog ID first and UUID/region/coordinate tuple second. Never match by translated display name. Preserve provenance internally so details can state `基础资料`, `存档精确`, `参考区域`, or `无法判定`.

- [ ] **Step 5: Extend Worker output with supported records only**

  Query and decode only the minimal `GenericData`, `Portal`, or ScriptData records proven necessary by fixtures. Return normalized connection/progress records, not raw rows or blobs.

- [ ] **Step 6: Verify and commit**

  Run: `npm test -- src/locations src/save`

  Expected: PASS.

  Commit:

  ```bash
  git add html/src/locations html/src/save
  git commit -m "feat: resolve save locations and progress"
  ```

### Task 2: Surface location provenance and progress in the shared UI

**Files:**
- Modify: `html/src/components/location-browser.ts`
- Modify: `html/src/components/location-details.ts`
- Modify: `html/src/map/location-layer.ts`
- Modify: `html/src/app/app-controller.ts`
- Create: `html/src/components/location-details.test.ts`
- Modify: `html/tests/e2e/personal-map.spec.ts`

**Interfaces:**
- Consumes: resolved `MapLocation[]`.
- Produces: visible precision/progress badges, category/layer filters, connection links, and region navigation.

- [ ] **Step 1: Write rendering tests**

  Assert Chinese copy for all four precision values and five progress values, separate resource/enemy/quest lists, coordinate formatting, related-region buttons, and an explicit `无法从该存档判定` for unknown progress.

- [ ] **Step 2: Run tests and verify they fail**

  Run: `npm test -- src/components/location-details.test.ts`

  Expected: FAIL because provenance/progress rendering is incomplete.

- [ ] **Step 3: Implement details, filters, and map symbols**

  Use text plus shape/icon for category and progress; preserve sufficient contrast; expose marker equivalents in the location list; selecting a related region loads it and selects the linked endpoint after the region is ready.

- [ ] **Step 4: Verify both modes**

  Run: `npm test && npm run test:e2e -- tests/e2e/base-map.spec.ts tests/e2e/personal-map.spec.ts`

  Expected: PASS; base mode shows no personal progress and personalized mode clearly distinguishes exact/reference/unknown records.

- [ ] **Step 5: Commit**

  ```bash
  git add html/src/components html/src/map html/src/app html/tests
  git commit -m "feat: show map provenance and progress"
  ```

### Task 3: Complete accessibility and reduced-motion behavior

**Files:**
- Modify: `html/package.json`
- Modify: `html/package-lock.json`
- Create: `html/tests/e2e/accessibility.spec.ts`
- Modify: `html/src/styles/app.css`
- Modify: `html/src/components/region-selector.ts`
- Modify: `html/src/components/location-browser.ts`
- Modify: `html/src/components/location-details.ts`
- Modify: `html/src/components/save-entry.ts`

**Interfaces:**
- Produces: keyboard-complete atlas navigation and automated axe checks.

- [ ] **Step 1: Add `@axe-core/playwright` and accessibility tests**

  Test base desktop, mobile filter drawer, mobile details sheet, save error, and personalized mode. Assert no serious/critical axe violations, visible focus, Escape close behavior, focus return to opener, and polite live-region announcements.

- [ ] **Step 2: Run tests and record failures**

  Run: `npm run test:e2e -- tests/e2e/accessibility.spec.ts`

  Expected: FAIL until focus order, labels, contrast, and drawer/sheet semantics comply.

- [ ] **Step 3: Fix semantics and keyboard flows**

  Use actual buttons/inputs, roving focus only inside the region selector, `aria-expanded`/`aria-controls` for drawers, `aria-current` for selected region/location, and do not move focus when a map marker is selected by pointer.

- [ ] **Step 4: Verify reduced motion and non-color communication**

  Emulate reduced motion and assert drawer/sheet transitions are disabled. Screenshot markers in grayscale and confirm categories/progress remain distinguishable by symbol and text.

- [ ] **Step 5: Verify and commit**

  Run: `npm run test:e2e -- tests/e2e/accessibility.spec.ts && npm run build`

  Expected: PASS.

  Commit:

  ```bash
  git add html/package.json html/package-lock.json html/src html/tests/e2e/accessibility.spec.ts
  git commit -m "fix: complete accessible map interaction"
  ```

### Task 4: Enforce privacy, lifecycle, offline, and performance budgets

**Files:**
- Create: `html/tests/e2e/privacy.spec.ts`
- Create: `html/tests/e2e/offline.spec.ts`
- Create: `html/tests/e2e/performance.spec.ts`
- Create: `html/src/app/resource-tracker.ts`
- Create: `html/src/app/resource-tracker.test.ts`
- Modify: `html/src/app/app-controller.ts`
- Modify: `html/src/save/save-client.ts`
- Modify: `html/src/map/personal-terrain-layer.ts`

**Interfaces:**
- Produces: `ResourceTracker.trackWorker`, `trackObjectUrl`, `trackBitmap`, `trackAbortController`, and `dispose`.
- Produces budgets: base interactive under 3 seconds on Playwright desktop, first personalized overview under 10 seconds for the sanitized 12,288-cell fixture, and no long task over 500 ms on the main thread during decoding.

- [ ] **Step 1: Write lifecycle and privacy tests**

  Spy on Worker termination, URL revocation, bitmap close, listener removal, storage APIs, console calls, network requests, and URL state when replacing/exiting a save.

- [ ] **Step 2: Run tests and verify they fail**

  Run: `npm test -- src/app/resource-tracker.test.ts && npm run test:e2e -- tests/e2e/privacy.spec.ts tests/e2e/offline.spec.ts`

  Expected: FAIL because unified resource disposal and offline assertions are absent.

- [ ] **Step 3: Implement deterministic disposal**

  Make `dispose()` idempotent, invoke it before replacement and on exit, clear references to raw bytes/decoded values, abort pending fetch/image work, and restore the last base region/view without reloading the page.

- [ ] **Step 4: Add offline and performance assertions**

  Route all non-local-origin requests to failure and assert the application still completes both modes. Record performance marks for reading, SQLite, decompression, decoding, normalization, overview, and native rendering; test the stated budgets with a warm local server.

- [ ] **Step 5: Verify and commit**

  Run: `npm test && npm run build && npm run test:e2e -- tests/e2e/privacy.spec.ts tests/e2e/offline.spec.ts tests/e2e/performance.spec.ts`

  Expected: PASS.

  Commit:

  ```bash
  git add html/src html/tests
  git commit -m "fix: enforce local-only save lifecycle"
  ```

### Task 5: Document, visually verify, and prepare the static release

**Files:**
- Modify: `Readme.md`
- Create: `docs/data-update.md`
- Create: `docs/privacy.md`
- Create: `docs/attribution.md`
- Create: `html/tests/e2e/visual.spec.ts`
- Create: `html/tests/e2e/visual.spec.ts-snapshots/`
- Modify: `html/index.html`

**Interfaces:**
- Produces: operator/user documentation and approved visual baselines.

- [ ] **Step 1: Write visual regression journeys**

  Capture base surface, Grow Lab, excavation island, personalized surface, invalid-save message, dense POI view, desktop 1440×900, mobile 390×844, and reduced-motion mobile details.

- [ ] **Step 2: Run visual tests and inspect every image**

  Run: `npm run test:e2e -- tests/e2e/visual.spec.ts --update-snapshots`

  Inspect for clipped labels, unreadable contrast, map gaps, wrong tile rotations, drawer/sheet overlap, and missing focus indicators. Correct defects and regenerate only affected snapshots.

- [ ] **Step 3: Write user and maintainer documentation**

  README must include Node requirement, `npm ci`, local dev/build/preview commands, common Windows save location, supported save version 28, 256 MB limit, base/personal mode behavior, privacy statement, game-data refresh command, atlas intake workflow, license, original author attribution, repository link, and Axolot non-affiliation.

- [ ] **Step 4: Run final source and artifact checks**

  Run:

  ```bash
  npm ci
  npm run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"
  npm run lint
  npm test
  npm run build
  npm run test:e2e
  ```

  Search tracked files for private `.db` paths, the local Steam user ID, and source game-root paths. Inspect `dist/` for remote `http://` or `https://` runtime dependencies; only attribution links in rendered copy may remain.

  Run the complete browser suite in Playwright projects for Chromium, Firefox, and the installed Microsoft Edge channel. If the Edge channel is unavailable on a build machine, mark that job skipped with the detected browser-path error while keeping it required on the Windows release workstation.

- [ ] **Step 5: Commit release documentation and baselines**

  ```bash
  git add Readme.md docs html/index.html html/tests/e2e
  git commit -m "docs: prepare Scrap Mechanic 1.0 map release"
  ```
