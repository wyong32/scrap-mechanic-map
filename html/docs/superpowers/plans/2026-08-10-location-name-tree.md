# Location Name Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move usable map-layer controls into the left panel and add a default-off, count-aware, hierarchical selector for fixed/story and save-generated location names.

**Architecture:** A checked-in Scrap Mechanic 1.0 classification module converts raw official POI constants into safe public location types. A pure inventory builder combines stable catalog locations with grouped POI placements; the controller gives the same inventory and selected type IDs to a dedicated left-panel tree and the map label layer so counts and rendered labels cannot diverge.

**Tech Stack:** TypeScript, Vitest, jsdom, Leaflet, Vite, existing vanilla DOM component patterns.

## Global Constraints

- All visible UI copy is English.
- Location names are all off by default.
- Do not add a runtime dependency.
- Never expose raw `POI_*` constants, save paths, save names, seeds, UUIDs, or private metadata in UI or URL state.
- Use the installed Scrap Mechanic 1.0 `poi_types.lua` as the catalog evidence, but ship a reviewed checked-in mapping; the browser must not read the game installation.
- Placeholder, test, retired, no-longer-used, predefined story, and unsupported POI types fail closed.
- A multi-cell POI counts once after rotation-aware placement grouping.
- Zero-count type rows and empty source groups are omitted.
- Keep terrain, player markers, coordinate grid, search, save import, region switching, and the `-3..0` zoom range unchanged.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Official 1.0 Generated-Location Classification

**Files:**
- Create: `src/map/location-type-catalog.ts`
- Create: `src/map/location-type-catalog.test.ts`
- Reference only: `G:/共享文件/Scrap Mechanic/Survival/Scripts/terrain/overworld/poi_types.lua`

**Interfaces:**
- Produces: `GeneratedLocationTypeId`, `GeneratedLocationClassification`, `classifyGeneratedPoi(poiType: string): GeneratedLocationClassification | undefined`.
- Consumed by: Task 2 inventory construction.

- [ ] **Step 1: Write the failing catalog tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyGeneratedPoi } from "./location-type-catalog";

describe("classifyGeneratedPoi", () => {
  it.each([
    ["POI_WAREHOUSE2_LARGE", "generated:warehouse", "Warehouse", "Warehouse"],
    ["POI_FOREST_CAMP", "generated:camps-ruins", "Camps & Ruins", "Forest Camp"],
    ["POI_AUTUMNFOREST_RUIN", "generated:camps-ruins", "Camps & Ruins", "Autumn Forest Ruin"],
    ["POI_ROAD_KIOSK", "generated:road", "Road Locations", "Kiosk"],
    ["POI_ROAD_SCHEMATICSTATION", "generated:road", "Road Locations", "Schematic Station"],
    ["POI_CHEMLAKE_MEDIUM", "generated:resource-hazard", "Resource & Hazard", "Chemical Lake"],
    ["POI_DESERT_OILPOOL", "generated:resource-hazard", "Resource & Hazard", "Oil Pool"],
    ["POI_HIDEOUT_XL", "generated:major", "Major Generated Locations", "Hideout"],
    ["POI_PACKINGSTATIONFRUIT_MEDIUM", "generated:major", "Major Generated Locations", "Fruit Packing Station"],
    ["POI_BUILDERQUEST_WOCHOUSE", "generated:builder-quest", "Builder Quest Locations", "Builder Quest Location"]
  ])("classifies %s", (poiType, typeId, typeName, label) => {
    expect(classifyGeneratedPoi(poiType)).toEqual({ typeId, typeName, label });
  });

  it.each([
    "POI_RANDOM_PLACEHOLDER",
    "POI_TEST",
    "POI_CRASHSITE_AREA",
    "POI_MECHANICSTATION_MEDIUM",
    "POI_MEADOW_GROWLAB_QUEST_LARGE",
    "POI_BURNTFOREST_FARMBOTSCRAPYARD_LARGE",
    "POI_SERVICE_ELEVATOR",
    "POI_EXCAVATION_BRIDGE",
    "POI_EXCAVATION",
    "POI_BURNTFOREST_RANDOM",
    "POI_AUTUMNFOREST_RANDOM",
    "POI_NOT_IN_1_0"
  ])("fails %s closed", (poiType) => {
    expect(classifyGeneratedPoi(poiType)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run src/map/location-type-catalog.test.ts`

Expected: FAIL because `location-type-catalog.ts` does not exist.

- [ ] **Step 3: Implement the reviewed classifier**

```ts
export type GeneratedLocationTypeId =
  | "generated:warehouse"
  | "generated:camps-ruins"
  | "generated:road"
  | "generated:resource-hazard"
  | "generated:major"
  | "generated:builder-quest";

export interface GeneratedLocationClassification {
  typeId: GeneratedLocationTypeId;
  typeName: string;
  label: string;
}

const excluded = new Set([
  "POI_RANDOM_PLACEHOLDER", "POI_TEST", "POI_CRASHSITE_AREA",
  "POI_WAREHOUSE4_QUEST_LARGE", "POI_MECHANICSTATION_MEDIUM",
  "POI_MECHANICSTATION_QUEST_MEDIUM", "POI_SERVICE_ELEVATOR",
  "POI_EXCAVATION_BRIDGE", "POI_EXCAVATION",
  "POI_BURNTFOREST_RANDOM", "POI_AUTUMNFOREST_RANDOM"
]);
```

Implement explicit exact-name maps for road, resource/hazard, and major generated locations. Apply reviewed prefix/suffix rules only to Warehouse, biome Camp/Ruin, and Builder Quest constants. Exclude any constant containing `_GROWLAB_` or `FARMBOTSCRAPYARD`. Return `undefined` for every unmatched value.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm.cmd test -- --run src/map/location-type-catalog.test.ts`

Expected: all catalog tests PASS.

- [ ] **Step 5: Commit the catalog**

```powershell
git add -- src/map/location-type-catalog.ts src/map/location-type-catalog.test.ts
git commit -m "feat: classify official generated locations"
```

---

### Task 2: Shared Location-Name Inventory

**Files:**
- Create: `src/map/location-name-inventory.ts`
- Create: `src/map/location-name-inventory.test.ts`
- Modify: `src/map/poi-instances.ts`
- Modify: `src/map/poi-instances.test.ts`

**Interfaces:**
- Consumes: `classifyGeneratedPoi` from Task 1 and `createPoiMapInstances(cells)`.
- Produces: `LocationNameInstance`, `LocationNameType`, `LocationNameGroup`, `LocationNameInventory`, `buildLocationNameInventory(world: WorldMap): LocationNameInventory`.
- Consumed by: Tasks 4, 5, and 6.

- [ ] **Step 1: Write failing inventory tests**

```ts
it("counts fixed names and grouped generated placements from one shared inventory", () => {
  const inventory = buildLocationNameInventory({
    ...world,
    locations: [mechanicStation],
    cells: [...warehouse(10, 20), ...warehouse(30, 40)]
  });

  expect(inventory.groups).toEqual([
    {
      id: "fixed-story",
      name: "Fixed & Story Locations",
      count: 1,
      types: [{ id: "fixed:mechanic-station", name: "Mechanic Station", count: 1 }]
    },
    {
      id: "generated",
      name: "Generated Locations",
      count: 2,
      types: [{ id: "generated:warehouse", name: "Warehouse", count: 2 }]
    }
  ]);
  expect(inventory.instances).toHaveLength(3);
});

it("omits zero-count and unsupported POI types", () => {
  const inventory = buildLocationNameInventory({
    ...world,
    locations: [],
    cells: [{ ...cell, poiType: "POI_TEST" }]
  });
  expect(inventory).toEqual({ groups: [], instances: [] });
});
```

Add a POI regression proving a rotated multi-cell Warehouse is one `PoiMapInstance`, not one instance per cell.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm.cmd test -- --run src/map/location-name-inventory.test.ts src/map/poi-instances.test.ts`

Expected: inventory module missing; new rotation/count assertion fails if grouping is wrong.

- [ ] **Step 3: Implement inventory types and builder**

```ts
export interface LocationNameInstance {
  id: string;
  source: "fixed-story" | "generated";
  typeId: string;
  label: string;
  position: { x: number; y: number };
}

export interface LocationNameType {
  id: string;
  name: string;
  count: number;
}

export interface LocationNameGroup {
  id: "fixed-story" | "generated";
  name: string;
  count: number;
  types: LocationNameType[];
}

export interface LocationNameInventory {
  groups: LocationNameGroup[];
  instances: LocationNameInstance[];
}
```

Build fixed IDs as `fixed:${slug(location.name)}` using lowercase ASCII, dash-separated public names. Merge identical names into one type count. Build generated instances from `createPoiMapInstances`, discard unclassified instances, and use the classifier's public type ID and label. Sort groups fixed-first, types by English name, and instances by Y, X, then ID.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm.cmd test -- --run src/map/location-name-inventory.test.ts src/map/poi-instances.test.ts`

Expected: all inventory and POI tests PASS.

- [ ] **Step 5: Commit the inventory**

```powershell
git add -- src/map/location-name-inventory.ts src/map/location-name-inventory.test.ts src/map/poi-instances.ts src/map/poi-instances.test.ts
git commit -m "feat: build location name inventory"
```

---

### Task 3: Privacy-Safe Location-Type URL State

**Files:**
- Modify: `src/domain/map-model.ts`
- Modify: `src/domain/ui-state.ts`
- Modify: `src/domain/ui-state.test.ts`

**Interfaces:**
- Produces: `MapUiState.locationTypeIds: string[]` and the URL parameter `locationTypes`.
- Consumed by: Task 6 controller integration.

- [ ] **Step 1: Write failing state tests**

```ts
it("defaults location names off and round-trips public type IDs in stable order", () => {
  expect(parseUiState("?").locationTypeIds).toEqual([]);
  const state = parseUiState("?locationTypes=generated%3Awarehouse,fixed%3Amechanic-station,generated%3Awarehouse");
  expect(state.locationTypeIds).toEqual([
    "fixed:mechanic-station",
    "generated:warehouse"
  ]);
  expect(serializeUiState(state)).toContain(
    "locationTypes=fixed%3Amechanic-station%2Cgenerated%3Awarehouse"
  );
});

it("drops unsafe, unknown-shape, and private-looking location type IDs", () => {
  expect(parseUiState("?locationTypes=POI_WAREHOUSE2_LARGE,C%3A%5Csave.db,generated%3Awarehouse").locationTypeIds)
    .toEqual(["generated:warehouse"]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run src/domain/ui-state.test.ts`

Expected: FAIL because `locationTypeIds` is absent.

- [ ] **Step 3: Implement state parsing and serialization**

Add `locationTypeIds: string[]` to `MapUiState` and `DEFAULT_UI_STATE`. Accept only `/^(fixed|generated):[a-z0-9]+(?:-[a-z0-9]+)*$/`, deduplicate, sort, and cap each ID at 100 characters. Serialize only a non-empty selection. Keep raw POI names and filesystem-like strings out.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm.cmd test -- --run src/domain/ui-state.test.ts`

Expected: all UI-state tests PASS.

- [ ] **Step 5: Commit URL state**

```powershell
git add -- src/domain/map-model.ts src/domain/ui-state.ts src/domain/ui-state.test.ts
git commit -m "feat: persist location name filters"
```

---

### Task 4: Accessible Hierarchical Map-Layer Tree

**Files:**
- Create: `src/components/map-layer-tree.ts`
- Create: `src/components/map-layer-tree.test.ts`

**Interfaces:**
- Consumes: `LocationNameInventory`, selected layer IDs, selected location type IDs, and disabled transition state.
- Produces: `createMapLayerTree(root, callbacks)` with `render(input)` and `destroy()`.

```ts
export interface MapLayerTreeRenderInput {
  layerIds: readonly string[];
  inventory: LocationNameInventory;
  selectedLocationTypeIds: readonly string[];
  disabled: boolean;
}

export interface MapLayerTreeCallbacks {
  onLayerChange(layerIds: string[]): void;
  onLocationTypeChange(typeIds: string[]): void;
}
```

- [ ] **Step 1: Write failing DOM behaviour tests**

Test the real component for:

```ts
expect(layerLabels()).toEqual([
  "Terrain", "Player Markers", "Coordinate Grid", "Location Names"
]);
expect(typeRows()).toEqual(["Mechanic Station (1)", "Warehouse (2)"]);
expect(locationNamesCheckbox.checked).toBe(false);
```

Then click the generated parent and expect only its available child IDs, verify the master and group checkboxes become indeterminate after clearing Warehouse, verify disclosure clicks change only `aria-expanded`, verify zero-count groups are absent, and verify `No location data` is disabled when inventory is empty.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run src/components/map-layer-tree.test.ts`

Expected: FAIL because the tree component does not exist.

- [ ] **Step 3: Implement the component**

Render native checkbox inputs and separate disclosure buttons. Set `.indeterminate` after insertion based on selected descendant counts. Emit stable sorted IDs. Keep `Terrain`, `Player Markers`, and `Coordinate Grid` as ordinary layer callbacks; treat `Location Names` as the master for location-type selection. Restore focus using `data-location-type-id` or `data-location-group-id` after rerender.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm.cmd test -- --run src/components/map-layer-tree.test.ts`

Expected: all tree tests PASS.

- [ ] **Step 5: Commit the component**

```powershell
git add -- src/components/map-layer-tree.ts src/components/map-layer-tree.test.ts
git commit -m "feat: add location name filter tree"
```

---

### Task 5: Render Labels from the Shared Inventory

**Files:**
- Modify: `src/map/poi-label-layer.ts`
- Modify: `src/map/poi-label-layer.test.ts`
- Modify: `src/map/map-view.ts`
- Modify: `src/map/map-view.test.ts`

**Interfaces:**
- Consumes: `LocationNameInventory.instances` and selected public type IDs.
- Produces: `MapView.setLocationNames(inventory: LocationNameInventory, selectedTypeIds: readonly string[]): void`.

- [ ] **Step 1: Write failing label-selection tests**

```ts
view.setLocationNames(inventory, ["generated:warehouse"]);
expect(labelTexts()).toEqual(["Warehouse", "Warehouse"]);

view.setLocationNames(inventory, ["fixed:mechanic-station"]);
expect(labelTexts()).toEqual(["Mechanic Station"]);

view.setLocationNames(inventory, []);
expect(labelTexts()).toEqual([]);
```

Also assert player-marker labels remain controlled only by the existing player-marker layer behaviour.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm.cmd test -- --run src/map/poi-label-layer.test.ts src/map/map-view.test.ts`

Expected: FAIL because `setLocationNames` does not exist and the layer still derives labels internally.

- [ ] **Step 3: Implement inventory-driven label rendering**

Change the label layer to accept `LocationNameInstance[]` and selected type IDs. Remove its independent POI/catalog derivation. Store the last committed inventory and selection in `map-view.ts`, reapply them after world commits, and clear stale labels during replacement. Do not change player-marker label code.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm.cmd test -- --run src/map/poi-label-layer.test.ts src/map/map-view.test.ts`

Expected: all label and map-view tests PASS.

- [ ] **Step 5: Commit label integration**

```powershell
git add -- src/map/poi-label-layer.ts src/map/poi-label-layer.test.ts src/map/map-view.ts src/map/map-view.test.ts
git commit -m "feat: filter map location labels by type"
```

---

### Task 6: Relocate Map Layers and Integrate World Transitions

**Files:**
- Modify: `src/app/app-shell.ts`
- Modify: `src/app/app-shell.test.ts`
- Modify: `src/components/location-browser.ts`
- Modify: `src/components/location-browser.test.ts`
- Modify: `src/app/app-controller.ts`
- Modify: `src/app/app-controller.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Tasks 2-5 inventory, state, tree, and map-view APIs.
- Produces: the complete left-panel feature and canonical transition behaviour.

- [ ] **Step 1: Write failing shell and controller tests**

Shell assertions:

```ts
expect(document.querySelector("#map [data-map-layer-controls]")).toBeNull();
expect(document.querySelector("#location-panel [data-map-layer-tree]")).not.toBeNull();
expect(search.compareDocumentPosition(layerTree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(layerTree.compareDocumentPosition(markerTypes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Controller assertions:

- default world commits with `locationTypeIds: []` and no location labels;
- selecting Warehouse writes `locationTypes=generated%3Awarehouse` and displays only Warehouses;
- changing to a world without Warehouse removes that selection;
- a failed save import retains the old inventory and selection;
- `layers=labels` with no `locationTypes` performs one legacy migration to all available types;
- transition-pending state disables the tree and a successful or failed completion enables it.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts src/components/location-browser.test.ts src/app/app-controller.test.ts`

Expected: FAIL because map layers remain over the map and controller has no inventory/type selection.

- [ ] **Step 3: Mount the tree in the left panel**

Add `<section data-map-layer-tree></section>` immediately after the search block and before Player Marker Types. Remove the map-overlay layer fieldset; keep only zoom/reset/add-marker controls over the map. Route layer and location-type callbacks through `AppShell` without reintroducing official category filters.

- [ ] **Step 4: Integrate controller state and transitions**

On every committed world:

```ts
const nextInventory = buildLocationNameInventory(world);
const available = new Set(nextInventory.groups.flatMap(group => group.types.map(type => type.id)));
const nextTypeIds = state.locationTypeIds.filter(id => available.has(id));
```

For a legacy URL with `labels` and no `locationTypes`, select all available IDs once. Otherwise keep the normalized intersection. Render the tree and call `map.setLocationNames(nextInventory, nextTypeIds)` only after commit succeeds. Retain the previous committed inventory on cancellation or failure.

- [ ] **Step 5: Update layout styles**

Remove the map-overlay layer grid rules. Add compact left-panel disclosure, indentation, count, indeterminate, disabled, focus-visible, and responsive rules. Keep the zoom controls readable over the map and avoid increasing the panel width.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts src/components/location-browser.test.ts src/app/app-controller.test.ts`

Expected: all integration tests PASS.

- [ ] **Step 7: Commit the integrated feature**

```powershell
git add -- src/app/app-shell.ts src/app/app-shell.test.ts src/components/location-browser.ts src/components/location-browser.test.ts src/app/app-controller.ts src/app/app-controller.test.ts src/styles.css
git commit -m "feat: move location filters into sidebar"
```

---

### Task 7: Regression, Build, and Browser Acceptance

**Files:**
- Modify if required by changed selectors: `tests/e2e/personal-map.spec.ts`
- Modify if required by changed selectors: `tests/e2e/save-errors.spec.ts`

**Interfaces:**
- Consumes: completed feature from Tasks 1-6.
- Produces: verified local delivery without merging or cleaning unrelated work.

- [ ] **Step 1: Update E2E selectors only where the relocated controls require it**

Keep assertions behavioural: find the left-panel tree by `data-map-layer-tree`, select public type IDs, and assert visible label text and privacy-safe URL state. Do not assert raw source text or internal POI constants.

- [ ] **Step 2: Run focused regression**

Run:

```powershell
npm.cmd test -- --run src/map/location-type-catalog.test.ts src/map/location-name-inventory.test.ts src/map/poi-instances.test.ts src/domain/ui-state.test.ts src/components/map-layer-tree.test.ts src/components/location-browser.test.ts src/app/app-shell.test.ts src/map/poi-label-layer.test.ts src/map/map-view.test.ts src/app/app-controller.test.ts
```

Expected: every listed test file PASS.

- [ ] **Step 3: Run production build and diff validation**

Run:

```powershell
npm.cmd run build
git diff --check
```

Expected: build exits 0; diff check reports no whitespace errors. Existing Vite browser-externalization warnings for `sql.js` may remain.

- [ ] **Step 4: Run the full suite and record baseline-only failures separately**

Run: `npm.cmd test -- --run`

Expected project baseline: the two existing `tools/authentic-map/default-surface-job.test.ts` failures may remain while the default surface capture inventory is empty. No new failure may be introduced.

- [ ] **Step 5: Verify in the local browser**

At `http://127.0.0.1:4173/`, verify:

- no map-layer fieldset overlays the map;
- left panel order is Search, Map Layers, Player Marker Types, Location List;
- Location Names starts off;
- fixed/generated rows show exact active-world counts;
- parent/child/indeterminate selection works;
- Warehouse count and labels change after committing a different save;
- URL includes only public `locationTypes` IDs;
- zoom remains bounded to `-3..0`;
- Player Markers remain independent.

- [ ] **Step 6: Commit any E2E-only selector updates**

```powershell
git add -- tests/e2e/personal-map.spec.ts tests/e2e/save-errors.spec.ts
git diff --cached --quiet || git commit -m "test: verify location name tree"
```

