# Player Map Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private, browser-persisted player markers with create, search, edit, delete, map/save isolation, and English map UI.

**Architecture:** Keep player records separate from official `MapLocation` data. A versioned store owns persistence, a dedicated Leaflet layer owns map rendering and placement coordinates, focused shell/editor components own forms, and `app-controller` coordinates the active map scope and region.

**Tech Stack:** TypeScript 5.8, Leaflet 1.9, DOM APIs, `localStorage`, Web Crypto SHA-256, Vitest/jsdom, Playwright, Vite.

## Global Constraints

- All visible UI and accessible copy is English.
- Marker data stays in the browser and never modifies or uploads a Scrap Mechanic save.
- The built-in map and every imported world have isolated marker collections.
- Marker types are exactly `resource`, `danger`, `base`, `vehicle`, and `note`.
- Marker icons default to visible; names additionally follow `Location Names`.
- The existing dirty worktree and unrelated capture assets must be preserved.
- Every production behavior is implemented only after its focused test fails for the expected missing behavior.

---

### Task 1: Versioned marker model, scope identity, and local store

**Files:**
- Create: `src/player-markers/player-marker.ts`
- Create: `src/player-markers/player-marker-store.ts`
- Create: `src/player-markers/player-marker-store.test.ts`
- Create: `src/player-markers/player-marker-scope.ts`
- Create: `src/player-markers/player-marker-scope.test.ts`

**Interfaces:**
- Produces `PlayerMarkerType`, `PlayerMarker`, `PlayerMarkerDraft`, and `PLAYER_MARKER_TYPES`.
- Produces `createPlayerMarkerScopeId(world: WorldMap): Promise<string>`.
- Produces `PlayerMarkerStore` with `list(mapScopeId, regionId)`, `create(draft)`, `update(id, changes)`, and `delete(id)`.
- `PlayerMarkerStore` accepts `Storage` and an optional clock/ID factory so tests use real store logic without global mocks.

- [ ] **Step 1: Write failing model/store tests**

```ts
it("persists and restores only markers from the requested map scope and region", () => {
  const storage = new MemoryStorage();
  const store = new PlayerMarkerStore(storage, {
    now: () => "2026-08-10T00:00:00.000Z",
    createId: () => "marker-1"
  });
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 12.5, y: -4 },
    name: "Cotton field",
    type: "resource",
    notes: "Return with storage crates"
  });
  expect(new PlayerMarkerStore(storage).list("default", "surface"))
    .toMatchObject([{ id: "marker-1", name: "Cotton field" }]);
  expect(new PlayerMarkerStore(storage).list("save:2:abc", "surface"))
    .toEqual([]);
});

it("does not replace persisted data when a write fails", () => {
  const storage = new ThrowingWriteStorage(validDocument);
  const store = new PlayerMarkerStore(storage);
  expect(() => store.create(validDraft)).toThrow("Player marker could not be saved");
  expect(storage.currentValue).toBe(validDocument);
});

it("ignores invalid records and reports a malformed document", () => {
  const store = new PlayerMarkerStore(new MemoryStorage("{"));
  expect(store.load()).toEqual({ markers: [], warning: "Saved player markers could not be read." });
});
```

- [ ] **Step 2: Run store tests and verify RED**

Run: `npm.cmd test -- --run src/player-markers/player-marker-store.test.ts`

Expected: FAIL because `PlayerMarkerStore` and marker types do not exist.

- [ ] **Step 3: Implement the marker model and store**

Use this persisted envelope and validation boundary:

```ts
export const PLAYER_MARKER_STORAGE_KEY = "sm-overview.player-markers";
export interface PlayerMarkerDocument {
  version: 1;
  markers: PlayerMarker[];
}

export class PlayerMarkerStore {
  load(): { markers: PlayerMarker[]; warning?: string };
  list(mapScopeId: string, regionId: string): PlayerMarker[];
  create(draft: PlayerMarkerDraft): PlayerMarker;
  update(id: string, changes: Pick<PlayerMarker, "name" | "type" | "notes">): PlayerMarker;
  delete(id: string): void;
}
```

Trim names, reject empty names, require finite coordinates, reject unknown types, preserve the form-facing error message on a failed `setItem`, and never mutate caller-owned objects.

- [ ] **Step 4: Write and run failing scope-identity tests**

```ts
it("uses one fixed scope for the built-in map", async () => {
  expect(await createPlayerMarkerScopeId(referenceWorld)).toBe("default");
});

it("returns the same scope after a save file is renamed", async () => {
  expect(await createPlayerMarkerScopeId(saveWorldA))
    .toBe(await createPlayerMarkerScopeId({ ...saveWorldA, id: "renamed" }));
});

it("returns different scopes for different layouts sharing a seed", async () => {
  expect(await createPlayerMarkerScopeId(saveWorldA))
    .not.toBe(await createPlayerMarkerScopeId(saveWorldB));
});
```

Run: `npm.cmd test -- --run src/player-markers/player-marker-scope.test.ts`

Expected: FAIL because `createPlayerMarkerScopeId` does not exist.

- [ ] **Step 5: Implement deterministic map-scope hashing**

Return `default` for non-save reference startup. For save worlds, sort cells by `y`, `x`, UUID, offsets, and rotation; serialize only seed plus those stable layout fields; hash with `crypto.subtle.digest("SHA-256", ...)`; return `save:${world.seed ?? 0}:${hexDigest}`. The controller retains this scope while visiting fixed regions in personal-map mode.

- [ ] **Step 6: Run Task 1 tests and commit**

Run: `npm.cmd test -- --run src/player-markers/player-marker-store.test.ts src/player-markers/player-marker-scope.test.ts`

Expected: PASS.

Commit only Task 1 files:

```powershell
git add -- src/player-markers/player-marker.ts src/player-markers/player-marker-store.ts src/player-markers/player-marker-store.test.ts src/player-markers/player-marker-scope.ts src/player-markers/player-marker-scope.test.ts
git commit -m "feat: persist scoped player markers"
```

---

### Task 2: Dedicated marker map layer and placement events

**Files:**
- Create: `src/map/player-marker-layer.ts`
- Create: `src/map/player-marker-layer.test.ts`
- Modify: `src/map/map-view.ts`
- Modify: `src/map/map-view.test.ts`
- Modify: `src/domain/map-layers.ts`
- Create: `src/domain/map-layers.test.ts`

**Interfaces:**
- Consumes `PlayerMarker` from Task 1.
- Produces `PlayerMarkerLayer.setMarkers`, `.setVisible`, `.setLabelsVisible`, `.selectMarker`, and `.destroy`.
- Extends `MapViewCallbacks` with `onPlayerMarkerSelect(id)` and `onMarkerPlacement(position)`.
- Extends `MapView` with `setPlayerMarkers(markers)`, `selectPlayerMarker(id?)`, and `setMarkerPlacementMode(enabled)`.

- [ ] **Step 1: Write failing layer rendering tests**

```ts
it("renders typed player icons and toggles names independently", () => {
  const layer = createPlayerMarkerLayer(map, vi.fn());
  layer.setMarkers([resourceMarker]);
  layer.setVisible(true);
  expect(container.querySelector('[data-player-marker-id="marker-1"]')).not.toBeNull();
  expect(container.querySelector(".player-marker__name")).toBeNull();
  layer.setLabelsVisible(true);
  expect(container.querySelector(".player-marker__name")?.textContent).toBe("Cotton field");
});
```

- [ ] **Step 2: Run layer tests and verify RED**

Run: `npm.cmd test -- --run src/map/player-marker-layer.test.ts`

Expected: FAIL because the layer does not exist.

- [ ] **Step 3: Implement the Leaflet player-marker layer**

Create markers with escaped text, `data-player-marker-id`, a type-specific `data-marker-type`, keyboard-accessible buttons, and a selected state. Keep icon visibility and name visibility as separate booleans. Use `cellToMapPoint` for rendering.

- [ ] **Step 4: Write failing map placement tests**

```ts
it("reports one game-cell coordinate for a placement click and exits placement mode", () => {
  const onMarkerPlacement = vi.fn();
  const view = createMapView(element, { ...callbacks, onMarkerPlacement });
  view.setMarkerPlacementMode(true);
  fireLeafletClick(element, { lat: -8, lng: 12 });
  expect(onMarkerPlacement).toHaveBeenCalledWith({ x: 12, y: 8 });
  expect(element.dataset.markerPlacement).toBe("false");
});
```

- [ ] **Step 5: Run map tests and verify RED**

Run: `npm.cmd test -- --run src/map/map-view.test.ts -t "placement"`

Expected: FAIL because placement callbacks and mode are absent.

- [ ] **Step 6: Integrate the layer and placement mode into MapView**

Register one Leaflet `click` handler. When placement mode is active, convert `event.latlng` through `mapPointToCell`, call `onMarkerPlacement`, and disable placement. Set `element.dataset.markerPlacement` for styling. Route `player-markers` layer visibility to icons and route `labels` visibility to marker names. Clear placement mode on world replacement and destroy.

Add an available `player-markers` definition to `MAP_LAYER_DEFINITIONS` and include it in default visible layer IDs.

- [ ] **Step 7: Run Task 2 tests and commit**

Run: `npm.cmd test -- --run src/map/player-marker-layer.test.ts src/map/map-view.test.ts src/domain/map-layers.test.ts`

Expected: PASS.

```powershell
git add -- src/map/player-marker-layer.ts src/map/player-marker-layer.test.ts src/map/map-view.ts src/map/map-view.test.ts src/domain/map-layers.ts src/domain/map-layers.test.ts
git commit -m "feat: render and place player map markers"
```

---

### Task 3: English marker editor and map controls

**Files:**
- Create: `src/components/player-marker-editor.ts`
- Create: `src/components/player-marker-editor.test.ts`
- Modify: `src/app/app-shell.ts`
- Modify: `src/app/app-shell.test.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes `PlayerMarker`, `PlayerMarkerDraft`, and `PlayerMarkerType`.
- Produces `PlayerMarkerEditor.renderEmpty()`, `.renderDraft(draft)`, `.renderMarker(marker)`, `.renderEdit(marker)`, `.setError(message)`, and `.destroy()`.
- Extends `AppCallbacks` with add/cancel/save/edit/delete marker intents.
- Extends `AppShell` with `renderPlayerMarkerDraft`, `renderPlayerMarker`, `renderPlayerMarkerEdit`, `setMarkerPlacementMode`, and `setMarkerEditorError`.

- [ ] **Step 1: Write failing editor tests**

```ts
it("submits a trimmed English marker form without losing notes", () => {
  const onSave = vi.fn();
  const editor = createPlayerMarkerEditor(root, { onSave });
  editor.renderDraft({ mapScopeId: "default", regionId: "surface", position: { x: 4, y: 6 } });
  input("Name").value = "  Cotton field  ";
  select("Type").value = "resource";
  textarea("Notes").value = "Bring crates";
  click("Save Marker");
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    name: "Cotton field", type: "resource", notes: "Bring crates"
  }));
});

it("keeps entered values visible when the controller reports a save error", () => {
  editor.renderDraft(draft);
  input("Name").value = "Cotton";
  editor.setError("Player marker could not be saved.");
  expect(input("Name").value).toBe("Cotton");
});
```

- [ ] **Step 2: Run editor tests and verify RED**

Run: `npm.cmd test -- --run src/components/player-marker-editor.test.ts`

Expected: FAIL because the editor does not exist.

- [ ] **Step 3: Implement editor modes and validation**

Use native `label`, `input`, `select`, `textarea`, and `button` elements. Put `Resource`, `Danger`, `Base`, `Vehicle`, and `Note` in the select. Reject an empty trimmed name inline. Render coordinates read-only. In view mode render `Edit` and `Delete`; render a named confirmation section with `Delete Marker` and `Keep Marker` before emitting delete.

- [ ] **Step 4: Write failing shell-control tests**

```ts
it("toggles Add Marker and Cancel Adding without affecting zoom controls", () => {
  const onAddMarker = vi.fn();
  const onCancelMarker = vi.fn();
  const shell = createAppShell(root, { onAddMarker, onCancelMarker });
  click("Add Marker");
  expect(onAddMarker).toHaveBeenCalledOnce();
  shell.setMarkerPlacementMode(true);
  expect(button("Cancel Adding")).not.toBeNull();
  click("Cancel Adding");
  expect(onCancelMarker).toHaveBeenCalledOnce();
});
```

- [ ] **Step 5: Run shell tests and verify RED**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts -t "Marker"`

Expected: FAIL because marker controls are absent.

- [ ] **Step 6: Integrate editor and controls into the shell**

Add `Add Marker` beside Reset View and add a checked-by-default `Player Markers` layer label. Delegate the details panel to either official `LocationDetails` or `PlayerMarkerEditor`, never both. Handle `Escape` by cancelling placement or editing before applying the existing drawer behavior. Preserve focus rules from the design.

Add responsive CSS for `.player-marker`, the five type variants, placement cursor, form fields, action row, errors, and delete confirmation. Reuse existing spacing and orange accent variables.

- [ ] **Step 7: Run Task 3 tests and commit**

Run: `npm.cmd test -- --run src/components/player-marker-editor.test.ts src/app/app-shell.test.ts`

Expected: PASS.

```powershell
git add -- src/components/player-marker-editor.ts src/components/player-marker-editor.test.ts src/app/app-shell.ts src/app/app-shell.test.ts src/styles/app.css
git commit -m "feat: add player marker editor controls"
```

---

### Task 4: Controller, search, type filters, and map/save isolation

**Files:**
- Modify: `src/domain/map-model.ts`
- Modify: `src/domain/ui-state.ts`
- Modify: `src/domain/ui-state.test.ts`
- Modify: `src/components/location-browser.ts`
- Create: `src/components/location-browser.test.ts`
- Modify: `src/app/app-controller.ts`
- Modify: `src/app/app-controller.test.ts`

**Interfaces:**
- Consumes the store, scope helper, layer, and editor APIs from Tasks 1–3.
- Adds `playerMarkerTypeIds: PlayerMarkerType[]` to `MapUiState`, serialized as `markers=`.
- Changes `LocationBrowser.render` to accept `{ locations, playerMarkers, state }` and adds `onPlayerMarkerTypeChange` and `onPlayerMarkerSelect` callbacks.
- Adds optional `playerMarkerStore` dependency injection to `AppControllerOptions`.

- [ ] **Step 1: Write failing URL and browser-filter tests**

```ts
it("round-trips selected player marker types", () => {
  const state = parseUiState("?markers=resource%2Cbase");
  expect(state.playerMarkerTypeIds).toEqual(["base", "resource"]);
  expect(serializeUiState(state)).toContain("markers=base%2Cresource");
});

it("searches player marker names and notes separately from official categories", () => {
  browser.render({ locations: [], playerMarkers: [cottonMarker, baseMarker], state });
  typeSearch("crates");
  expect(onQueryChange).toHaveBeenCalledWith("crates");
  browser.render({ locations: [], playerMarkers: [cottonMarker], state: queriedState });
  expect(playerMarkerCards()).toHaveLength(1);
});
```

- [ ] **Step 2: Run URL/browser tests and verify RED**

Run: `npm.cmd test -- --run src/domain/ui-state.test.ts src/components/location-browser.test.ts`

Expected: FAIL because marker type state and marker result inputs are absent.

- [ ] **Step 3: Implement player-marker filtering UI**

Validate and sort the five marker type IDs in URL state. Render a `Player Marker Types` fieldset separately from official `Category Filters`, with all types selected when the URL parameter is absent. Render player cards with `data-player-marker-id`; include notes in matching but do not render full notes in the compact list.

- [ ] **Step 4: Write failing controller workflow tests**

```ts
it("creates, restores, edits, and deletes a marker in the active default scope", async () => {
  const store = new PlayerMarkerStore(storage, deterministicOptions);
  await startApp(root, repository, { playerMarkerStore: store });
  click("Add Marker");
  mapCallbacks.onMarkerPlacement({ x: 8, y: -3 });
  submitMarker({ name: "Oil pond", type: "resource", notes: "Pump later" });
  expect(store.list("default", "surface")).toHaveLength(1);
  selectPlayerMarker("marker-1");
  editMarker({ name: "Oil source" });
  expect(store.list("default", "surface")[0]?.name).toBe("Oil source");
  confirmDelete();
  expect(store.list("default", "surface")).toEqual([]);
});

it("restores the same imported layout scope without exposing another layout", async () => {
  await importSave(saveA);
  addMarker("Save A base");
  await exitPersonalMap();
  await importSave(saveB);
  expect(playerMarkerCards()).toHaveLength(0);
  await exitPersonalMap();
  await importSave(saveARenamed);
  expect(playerMarkerCards()).toHaveText("Save A base");
});
```

- [ ] **Step 5: Run controller tests and verify RED**

Run: `npm.cmd test -- --run src/app/app-controller.test.ts -t "player marker"`

Expected: FAIL because the controller does not coordinate markers.

- [ ] **Step 6: Implement controller coordination**

Instantiate the store after startup, surface its load warning, and maintain `activeMapScopeId`, `visiblePlayerMarkers`, selected player ID, and draft/editor mode. Merge official and player search results only at the view boundary. On save import, await `createPlayerMarkerScopeId(candidateWorld)` before committing UI state. Keep that scope through fixed-region navigation; restore `default` on Exit Personal Map. Refresh the marker layer and sidebar after every mutation. On write failure, call `setMarkerEditorError` without closing the editor.

Cancel drafts on region changes, save changes, Exit Personal Map, and destroy. Ensure official location selection clears player selection and vice versa.

- [ ] **Step 7: Run Task 4 tests and commit**

Run: `npm.cmd test -- --run src/domain/ui-state.test.ts src/components/location-browser.test.ts src/app/app-controller.test.ts`

Expected: PASS.

```powershell
git add -- src/domain/map-model.ts src/domain/ui-state.ts src/domain/ui-state.test.ts src/components/location-browser.ts src/components/location-browser.test.ts src/app/app-controller.ts src/app/app-controller.test.ts
git commit -m "feat: integrate scoped player marker workflows"
```

---

### Task 5: Browser-level workflow and full verification

**Files:**
- Create: `tests/e2e/player-markers.spec.ts`
- Modify: `src/app/english-only.test.ts`
- Modify: `README.md`

**Interfaces:**
- Exercises the completed feature only through visible UI and persisted browser state.

- [ ] **Step 1: Write the failing end-to-end workflow**

```ts
test("player marker survives reload and can be edited and deleted", async ({ page }) => {
  await page.goto("/?region=surface&layers=terrain%2Clabels%2Cplayer-markers");
  await page.getByRole("button", { name: "Add Marker" }).click();
  await page.locator("#map").click({ position: { x: 520, y: 360 } });
  await page.getByLabel("Name").fill("Cotton field");
  await page.getByLabel("Type").selectOption("resource");
  await page.getByLabel("Notes").fill("Bring crates");
  await page.getByRole("button", { name: "Save Marker" }).click();
  await expect(page.getByRole("button", { name: /Cotton field/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Cotton field/ })).toBeVisible();
  await page.getByRole("button", { name: /Cotton field/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Cotton reserve");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete Marker" }).click();
  await expect(page.getByRole("button", { name: /Cotton reserve/ })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the E2E test and verify RED**

Run: `npm.cmd run test:e2e -- tests/e2e/player-markers.spec.ts`

Expected: FAIL at the missing `Add Marker` control before production integration is present, or pass only after Tasks 1–4 have supplied the full feature. If it already passes after Tasks 1–4, temporarily remove the `player-markers` layer from the test URL and assert the icon is absent to demonstrate the test detects the layer contract, then restore the intended test.

- [ ] **Step 3: Add English-only coverage and concise README documentation**

Extend the English-only visible-string inventory with all marker UI strings. Add a `Player markers` README section explaining local-only storage, per-map isolation, the five types, `Add Marker`, edit/delete, and browser-data loss implications.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
npm.cmd test -- --run src/player-markers src/map/player-marker-layer.test.ts src/map/map-view.test.ts src/components/player-marker-editor.test.ts src/components/location-browser.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts src/domain/ui-state.test.ts src/app/english-only.test.ts
npm.cmd run test:e2e -- tests/e2e/player-markers.spec.ts
npm.cmd run build
```

Expected: all focused tests and the E2E test pass; TypeScript and Vite build exit 0. If the unrelated pre-existing full suite is run, report any known unrelated failures separately and do not claim they were introduced by this feature without reproducing them against the pre-feature commit.

- [ ] **Step 5: Commit documentation and E2E coverage**

```powershell
git add -- tests/e2e/player-markers.spec.ts src/app/english-only.test.ts README.md
git commit -m "test: verify player marker workflow"
```

---

## Completion Checklist

- [ ] Default-map markers survive refresh.
- [ ] The same imported layout restores its markers after reimport.
- [ ] A different imported layout cannot see those markers.
- [ ] Add, cancel, view, edit, confirm-delete, and write-failure flows work.
- [ ] Five types have distinct icons and filters.
- [ ] `Player Markers` controls icons; `Location Names` controls names.
- [ ] Official POIs, labels, filters, save import, and fixed-region navigation remain functional.
- [ ] All new visible copy is English and keyboard accessible.
- [ ] Focused Vitest, Playwright E2E, and production build evidence is fresh.
