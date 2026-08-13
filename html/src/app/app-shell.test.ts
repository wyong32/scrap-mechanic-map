import { afterEach, expect, it, vi } from "vitest";
import type { MapLocation, MapUiState, RegionDefinition } from "../domain/map-model";
import type {
  PlayerMarker,
  PlayerMarkerDraft
} from "../player-markers/player-marker";
import { createAppShell } from "./app-shell";

const locations: MapLocation[] = [
  {
    id: "lab",
    regionId: "surface",
    name: "Grow Lab \u5165\u53e3",
    category: "quest",
    precision: "exact",
    questIds: [],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  }
];

const regions: RegionDefinition[] = [
  {
    id: "surface",
    name: "\u5730\u8868\u4e16\u754c",
    group: "surface",
    source: "reference",
    bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 }
  }
];

const groupedRegions: RegionDefinition[] = [
  regions[0],
  {
    ...regions[0],
    id: "excavation-island",
    name: "\u6316\u6398\u5c9b",
    group: "story",
    source: "fixed-region"
  },
  {
    ...regions[0],
    id: "grow-lab-1",
    name: "Grow Lab 1",
    group: "grow-lab",
    source: "fixed-region"
  },
  {
    ...regions[0],
    id: "underground-station-1",
    name: "\u5730\u4e0b\u8f66\u7ad9 1",
    group: "underground",
    source: "fixed-region"
  },
  {
    ...regions[0],
    id: "final-boss-hall",
    name: "\u6700\u7ec8 Boss \u5927\u5385",
    group: "boss",
    source: "fixed-region"
  }
];

const uiState: MapUiState = {
  regionId: "surface",
  zoom: -2,
  center: { x: 0, y: 0 },
  query: "Grow",
  categoryIds: ["quest"],
  locationTypeIds: [],
  playerMarkerTypeIds: ["base", "danger", "note", "resource", "vehicle"],
  layerIds: []
};

const markerDraft: PlayerMarkerDraft = {
  mapScopeId: "default",
  regionId: "surface",
  position: { x: 4, y: 6 },
  name: "",
  type: "note",
  notes: ""
};

const playerMarker: PlayerMarker = {
  ...markerDraft,
  id: "marker-1",
  name: "Cotton field",
  type: "resource",
  notes: "Bring crates",
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:00:00.000Z"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it("omits all personal-save controls by default and fails closed to Base Map", () => {
  const shell = createAppShell(document.body, {});

  expect(document.querySelector("[data-save-entry]")).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(document.querySelector(".exit-save-button")).toBeNull();
  expect(document.querySelector("[data-mobile-exit-save]")).toBeNull();
  expect(document.body.textContent).not.toContain("Personal Map");

  shell.setMode("save", "test.db", { seed: 1, saveVersion: 28 });

  expect(document.querySelector("[data-mode-badge]")?.textContent).toBe("Base Map");
  expect(document.body.textContent).not.toContain("Personal Map");

  shell.setMode("personalized", "World.db", { seed: 42, saveVersion: 28 });

  expect(document.querySelector("[data-mode-badge]")?.textContent).toBe("Base Map");
  expect(document.body.textContent).not.toContain("Personal Map");
});

it("forwards explicit search submit and reset while opening details", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onLocationSelect = vi.fn();
  const onQueryChange = vi.fn();
  const onSearchReset = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onLocationSelect,
    onQueryChange,
    onSearchReset
  });

  shell.renderLocations(locations);
  const search = document.querySelector<HTMLInputElement>('[type="search"]')!;
  search.value = "Grow";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(onQueryChange).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();
  document.querySelector<HTMLButtonElement>("[data-search-reset]")!.click();
  document.querySelector<HTMLButtonElement>('[data-location-id="lab"]')!.click();

  expect(onQueryChange).toHaveBeenCalledWith("Grow");
  expect(onSearchReset).toHaveBeenCalledOnce();
  expect(onLocationSelect).toHaveBeenCalledWith("lab");
});

it("renders region controls without empty official category filters", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onRegionChange = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onRegionChange
  });

  shell.renderRegions(regions, uiState.regionId);
  shell.renderLocations(locations, uiState);
  document.querySelector<HTMLButtonElement>('[data-region-id="surface"]')!.click();

  expect(onRegionChange).toHaveBeenCalledWith("surface");
  expect(document.querySelector("#location-category-filters")).toBeNull();
  expect(document.querySelector('[data-testid="result-count"]')?.textContent).toBe(
    "1 location"
  );
});

it("groups region navigation by the declared catalog group", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});

  shell.renderRegions(groupedRegions, "surface");

  const groups = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-region-selector] [data-region-group]"
    )
  );
  expect(groups.map((group) => group.dataset.regionGroup)).toEqual([
    "surface",
    "story",
    "grow-lab",
    "underground",
    "boss"
  ]);
  expect(
    document.querySelector(
      '[data-region-group="grow-lab"] [data-region-id="grow-lab-1"]'
    )?.textContent
  ).toBe("Grow Lab 1");
});

it("moves map layers into the location panel before Player Marker Types", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const callbacks = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetView: vi.fn()
  };
  const shell = createAppShell(document.querySelector("#app")!, callbacks);

  shell.renderMapControls({
    ...uiState,
    center: { x: 12.25, y: -8.5 },
    zoom: -2,
    layerIds: ["grid"]
  });

  const map = document.querySelector<HTMLElement>("#map")!;
  const search = document.querySelector<HTMLInputElement>("#location-search")!;
  const layerTree = document.querySelector<HTMLElement>(
    "#location-panel [data-map-layer-tree]"
  )!;
  const markerTypes = document.querySelector<HTMLElement>(
    "#player-marker-type-filters"
  )!;

  expect(document.querySelector("#map [data-map-layer-controls]")).toBeNull();
  expect(layerTree).not.toBeNull();
  expect(search.compareDocumentPosition(layerTree) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  expect(layerTree.compareDocumentPosition(markerTypes) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();

  document.querySelector<HTMLButtonElement>("[data-map-zoom-in]")!.click();
  document.querySelector<HTMLButtonElement>("[data-map-zoom-out]")!.click();
  document.querySelector<HTMLButtonElement>("[data-map-reset]")!.click();

  expect(map.querySelector("[data-map-layer-tree]")).toBeNull();
  expect(callbacks.onZoomIn).toHaveBeenCalledOnce();
  expect(callbacks.onZoomOut).toHaveBeenCalledOnce();
  expect(callbacks.onResetView).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-map-readout]")?.textContent).toBe(
    "X 12.25 \u00b7 Y -8.5 \u00b7 Zoom -2"
  );
});

it("keeps viewport controls readable without the removed map-layer overlay", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});

  shell.renderMapControls(uiState);
  expect(document.querySelector("#map [data-map-layer-controls]")).toBeNull();
  expect(document.querySelector("#map [data-map-zoom-in]")).not.toBeNull();
  expect(document.querySelector("#map [data-map-zoom-out]")).not.toBeNull();
  expect(document.querySelector("#map [data-map-reset]")).not.toBeNull();
  expect(document.querySelector("#map [data-marker-add]")).not.toBeNull();
});

it("bridges player marker browser filters and selection", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onPlayerMarkerTypeChange = vi.fn();
  const onPlayerMarkerSelect = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onPlayerMarkerTypeChange,
    onPlayerMarkerSelect
  });

  shell.renderLocations({
    locations,
    playerMarkers: [playerMarker],
    state: uiState
  });
  document.querySelector<HTMLButtonElement>(
    '[data-player-marker-id="marker-1"]'
  )!.click();
  const resource = document.querySelector<HTMLInputElement>(
    '#player-marker-type-filters [value="resource"]'
  )!;
  resource.checked = false;
  resource.dispatchEvent(new Event("change", { bubbles: true }));

  expect(onPlayerMarkerSelect).toHaveBeenCalledWith("marker-1");
  expect(onPlayerMarkerTypeChange).toHaveBeenCalledWith([
    "base",
    "danger",
    "note",
    "vehicle"
  ]);
});

it("toggles Add Marker and Cancel Adding without affecting zoom controls", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onAddMarker = vi.fn();
  const onCancelMarker = vi.fn();
  const onZoomIn = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onAddMarker,
    onCancelMarker,
    onZoomIn
  });

  clickButton("Add Marker");
  expect(onAddMarker).toHaveBeenCalledOnce();
  shell.setMarkerPlacementMode(true);
  expect(findButton("Cancel Adding")).not.toBeNull();
  document.querySelector<HTMLButtonElement>("[data-map-zoom-in]")!.click();
  clickButton("Cancel Adding");

  expect(onZoomIn).toHaveBeenCalledOnce();
  expect(onCancelMarker).toHaveBeenCalledOnce();
});

it("keeps map control clicks out of the map placement surface", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onLayerChange = vi.fn();
  const onZoomIn = vi.fn();
  const onResetView = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onLayerChange,
    onZoomIn,
    onResetView
  });
  const map = document.querySelector<HTMLElement>("#map")!;
  const onMapClick = vi.fn();
  map.addEventListener("click", onMapClick);
  shell.renderMapLayerTree({
    layerIds: ["terrain", "player-markers"],
    inventory: { groups: [], instances: [] },
    selectedLocationTypeIds: [],
    disabled: false
  });

  shell.setMarkerPlacementMode(true);
  document.querySelector<HTMLButtonElement>("[data-map-zoom-in]")!.click();
  document.querySelector<HTMLButtonElement>("[data-map-reset]")!.click();
  document.querySelector<HTMLInputElement>(
    "[data-map-layer-tree] [data-layer-id='player-markers']"
  )!.click();

  expect(onZoomIn).toHaveBeenCalledOnce();
  expect(onResetView).toHaveBeenCalledOnce();
  expect(onLayerChange).toHaveBeenCalledOnce();
  expect(onMapClick).not.toHaveBeenCalled();
  expect(findButton("Cancel Adding")).not.toBeNull();

  map.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onMapClick).toHaveBeenCalledOnce();
});

it("disables Add Marker while a map transition is pending", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onAddMarker = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onAddMarker
  });
  const addMarker = document.querySelector<HTMLButtonElement>("[data-marker-add]")!;

  shell.setPlayerMarkerActionsDisabled(true);
  addMarker.click();
  expect(addMarker.disabled).toBe(true);
  expect(onAddMarker).not.toHaveBeenCalled();

  shell.setPlayerMarkerActionsDisabled(false);
  addMarker.click();
  expect(addMarker.disabled).toBe(false);
  expect(onAddMarker).toHaveBeenCalledOnce();
});

it("renders player details while explicitly restoring sidebar-card focus", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});
  shell.renderLocations({
    locations: [],
    playerMarkers: [playerMarker],
    state: uiState
  });
  const card = document.querySelector<HTMLButtonElement>(
    "[data-location-list] [data-player-marker-id='marker-1']"
  )!;
  card.focus();

  shell.renderPlayerMarker(playerMarker, { focus: "sidebar" });

  expect(document.activeElement).toBe(card);
});

it("delegates Player Marker details and forms without mixing official details", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onSaveMarker = vi.fn();
  const onCancelMarker = vi.fn();
  const onEditMarker = vi.fn();
  const onDeleteMarker = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onSaveMarker,
    onCancelMarker,
    onEditMarker,
    onDeleteMarker
  });

  shell.renderDetails(locations[0]);
  shell.renderPlayerMarker(playerMarker);
  const details = document.querySelector<HTMLElement>(".detail-panel")!;
  expect(details.textContent).toContain("Cotton field");
  expect(details.textContent).not.toContain("Grow Lab");
  clickButton("Edit");
  expect(onEditMarker).toHaveBeenCalledWith(playerMarker);

  shell.renderPlayerMarkerEdit(playerMarker);
  const name = details.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
  name.value = "Cotton reserve";
  clickButton("Save Changes");
  expect(onSaveMarker).toHaveBeenCalledWith({
    ...playerMarker,
    name: "Cotton reserve"
  });

  shell.renderPlayerMarker(playerMarker);
  clickButton("Delete");
  clickButton("Delete Marker");
  expect(onDeleteMarker).toHaveBeenCalledWith(playerMarker);

  shell.renderPlayerMarkerDraft(markerDraft);
  expect(document.activeElement).toBe(
    details.querySelector<HTMLInputElement>('[aria-label="Name"]')
  );
  clickButton("Cancel");
  expect(onCancelMarker).toHaveBeenCalledOnce();
});

it("gives Escape priority to Player Marker placement and editing", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onCancelMarker = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onCancelMarker
  });
  const filterToggle = document.querySelector<HTMLButtonElement>(
    ".filter-toggle"
  )!;
  const panel = document.querySelector<HTMLElement>("#location-panel")!;

  filterToggle.click();
  shell.setMarkerPlacementMode(true);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(onCancelMarker).toHaveBeenCalledOnce();
  expect(findButton("Add Marker")).not.toBeNull();
  expect(panel.dataset.open).toBe("true");

  shell.renderPlayerMarkerEdit(playerMarker);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(onCancelMarker).toHaveBeenCalledTimes(2);
  expect(panel.dataset.open).toBe("true");

  shell.renderPlayerMarker(playerMarker);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(panel.dataset.open).toBe("false");
});

it("keeps Player Marker form values while showing controller errors", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});
  shell.renderPlayerMarkerDraft(markerDraft);
  const name = document.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
  name.value = "Cotton";

  shell.setMarkerEditorError("Player marker could not be saved.");

  expect(name.value).toBe("Cotton");
  expect(document.querySelector("[role='alert']")?.textContent).toBe(
    "Player marker could not be saved."
  );
});

it("returns focus to the selected Player Marker or Add Marker after completion", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});
  const map = document.querySelector<HTMLElement>("#map")!;
  const markerButton = document.createElement("button");
  markerButton.dataset.playerMarkerId = playerMarker.id;
  map.append(markerButton);

  shell.renderPlayerMarkerEdit(playerMarker);
  shell.renderPlayerMarker(playerMarker);
  expect(document.activeElement).toBe(markerButton);

  shell.renderPlayerMarkerEdit(playerMarker);
  markerButton.remove();
  shell.renderPlayerMarker();
  expect(document.activeElement).toBe(findButton("Add Marker"));
});

it("keeps player marker filters while omitting official category controls", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});
  shell.renderLocations(locations);

  expect(document.querySelector("#location-category-filters")).toBeNull();
  expect(document.querySelector("#player-marker-type-filters")).not.toBeNull();
});

it("restores a focused surviving location control after rerender", () => {
  document.body.innerHTML = '<div id="app"></div>';
  let state: MapUiState = { ...uiState, query: "", categoryIds: [] };
  let shell: ReturnType<typeof createAppShell>;
  shell = createAppShell(document.querySelector("#app")!, {
    onLocationSelect(locationId) {
      state = { ...state, selectedLocationId: locationId };
      shell.renderLocations(locations, state);
    }
  });
  shell.renderLocations(locations, state);

  const location = document.querySelector<HTMLButtonElement>(
    '[data-location-id="lab"]'
  )!;
  location.focus();
  location.click();
  expect(document.activeElement).toBe(
    document.querySelector<HTMLButtonElement>('[data-location-id="lab"]')
  );
});

it("emits selected database files from the picker and drop zone without reading them", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onSaveSelect = vi.fn();
  createAppShell(
    document.querySelector("#app")!,
    { onSaveSelect },
    { saveImportEnabled: true }
  );
  const file = new File(["SQLite format 3"], "Survival.db", {
    type: "application/x-sqlite3"
  });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(document.querySelector("[data-save-entry]")).not.toBeNull();
  expect(document.querySelector("[data-save-drop-zone]")).not.toBeNull();
  expect(document.querySelector("[data-save-path-hint]")?.textContent).toContain(
    "Find your Survival save here:"
  );
  let inputClickCount = 0;
  input.addEventListener("click", () => {
    inputClickCount += 1;
  });
  document.querySelector<HTMLButtonElement>(".save-entry__button")!.click();
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const dropZone = document.querySelector<HTMLElement>("[data-save-drop-zone]")!;
  const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, "dataTransfer", {
    value: { files: [file] }
  });
  dropZone.dispatchEvent(dropEvent);

  expect(inputClickCount).toBe(1);
  expect(onSaveSelect).toHaveBeenNthCalledWith(1, file);
  expect(onSaveSelect).toHaveBeenNthCalledWith(2, file);
});

it("keeps machine IDs out of visible location details", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});
  const relatedRegion: RegionDefinition = {
    ...regions[0],
    id: "mining-hub",
    name: "\u91c7\u77ff\u4e2d\u5fc3",
    group: "underground",
    source: "fixed-region"
  };
  const location: MapLocation = {
    ...locations[0],
    category: "quest",
    precision: "area-reference",
    relatedRegionIds: ["mining-hub", "unlisted-region"]
  };

  shell.renderRegions([regions[0], relatedRegion], "surface");
  shell.renderLocations([location]);
  shell.renderDetails(location);

  const details = document.querySelector<HTMLElement>(".detail-panel")!;
  const locationCard = document.querySelector<HTMLElement>("[data-location-id='lab']")!;
  expect(details.textContent).toContain("Quest");
  expect(details.textContent).toContain("Reference Area");
  expect(details.textContent).toContain("\u91c7\u77ff\u4e2d\u5fc3");
  expect(details.textContent).toContain("Unknown Region");
  expect(details.textContent).not.toContain("area-reference");
  expect(details.textContent).not.toContain("mining-hub");
  expect(details.textContent).not.toContain("unlisted-region");
  expect(locationCard.textContent).not.toContain("area-reference");
  expect(details.querySelector("[data-region-id='mining-hub']")).not.toBeNull();
});

it("renders existing quest, resource, and enemy IDs with English labels", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});
  const location: MapLocation = {
    ...locations[0],
    questIds: ["quest-alpha"],
    resourceIds: ["component-kit"],
    enemyIds: ["farmbot"]
  };

  shell.renderDetails(location);

  const details = document.querySelector<HTMLElement>(".detail-panel")!;
  expect(details.textContent).toContain("Quests");
  expect(details.textContent).toContain("quest-alpha");
  expect(details.textContent).toContain("Resources");
  expect(details.textContent).toContain("component-kit");
  expect(details.textContent).toContain("Enemies");
  expect(details.textContent).toContain("farmbot");
});

it("keeps a closed mobile drawer inert and restores it for open or desktop layouts", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const viewport = stubViewport(true);
  const shell = createAppShell(document.querySelector("#app")!, {});
  const panel = document.querySelector<HTMLElement>("#location-panel")!;
  const toggle = document.querySelector<HTMLButtonElement>(".filter-toggle")!;

  expect(panel.inert).toBe(true);
  expect(panel.getAttribute("aria-hidden")).toBe("true");

  toggle.click();
  expect(panel.inert).toBe(false);
  expect(panel.hasAttribute("aria-hidden")).toBe(false);

  toggle.click();
  viewport.setMatches(false);
  expect(panel.inert).toBe(false);
  expect(panel.hasAttribute("aria-hidden")).toBe(false);

  shell.destroy();
  expect(viewport.listenerCount()).toBe(0);
});

it("returns focus when closing the mobile drawer and moves it to selected details", () => {
  document.body.innerHTML = '<div id="app"></div>';
  stubViewport(true);
  const shell = createAppShell(document.querySelector("#app")!, {});
  shell.renderLocations(locations, {
    ...uiState,
    query: "",
    categoryIds: []
  });
  const panel = document.querySelector<HTMLElement>("#location-panel")!;
  const toggle = document.querySelector<HTMLButtonElement>(".filter-toggle")!;

  toggle.click();
  document.querySelector<HTMLButtonElement>(".drawer-close")!.click();
  expect(document.activeElement).toBe(toggle);

  toggle.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.activeElement).toBe(toggle);

  toggle.click();
  const location = document.querySelector<HTMLButtonElement>(
    '[data-location-id="lab"]'
  )!;
  location.focus();
  location.click();
  expect(panel.dataset.open).toBe("false");
  expect(document.activeElement).toBe(
    document.querySelector<HTMLElement>(".detail-panel")
  );
});

it("keeps region navigation and exit-save mode operable in the mobile drawer", () => {
  document.body.innerHTML = '<div id="app"></div>';
  stubViewport(true);
  const onRegionChange = vi.fn();
  const onExitSaveMode = vi.fn();
  const shell = createAppShell(document.querySelector("#app")!, {
    onRegionChange,
    onExitSaveMode
  }, { saveImportEnabled: true });

  shell.renderRegions(regions, "surface");
  shell.setMode("save", "Survival.db");
  document.querySelector<HTMLButtonElement>(".filter-toggle")!.click();
  document
    .querySelector<HTMLButtonElement>(
      "[data-mobile-region-selector] [data-region-id='surface']"
    )!
    .click();
  document.querySelector<HTMLButtonElement>("[data-mobile-exit-save]")!.click();

  expect(onRegionChange).toHaveBeenCalledWith("surface");
  expect(onExitSaveMode).toHaveBeenCalledOnce();
});

it("updates mode, live status, details, and removes listeners on destroy", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onQueryChange = vi.fn();
  const shell = createAppShell(
    document.querySelector("#app")!,
    { onQueryChange },
    { saveImportEnabled: true }
  );

  shell.setMode("save", "Survival.db");
  shell.setStatus("\u6b63\u5728\u89e3\u6790\u5b58\u6863");
  shell.renderDetails(locations[0]);

  expect(document.querySelector("[data-mode-badge]")?.textContent).toContain(
    "Personal Map"
  );
  expect(document.querySelector("[data-status][aria-live='polite']")?.textContent).toBe(
    "\u6b63\u5728\u89e3\u6790\u5b58\u6863"
  );
  expect(document.querySelector(".detail-panel")?.textContent).toContain("Grow Lab");

  const search = document.querySelector<HTMLInputElement>('[type="search"]')!;
  shell.destroy();
  search.value = "Lab";
  search.dispatchEvent(new Event("input", { bubbles: true }));

  expect(onQueryChange).not.toHaveBeenCalled();
  expect(document.querySelector("#map")).toBeNull();
});

it("disables zoom controls at the supported map bounds", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(
    document.querySelector("#app")!,
    {},
    { saveImportEnabled: true }
  );

  shell.renderMapControls({ ...uiState, zoom: -3 });
  expect(
    document.querySelector<HTMLButtonElement>("[data-map-zoom-out]")?.disabled
  ).toBe(true);

  shell.renderMapControls({ ...uiState, zoom: 0 });
  expect(
    document.querySelector<HTMLButtonElement>("[data-map-zoom-in]")?.disabled
  ).toBe(true);
});

it("preserves the complete personal-save flow when explicitly enabled", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const onExitSaveMode = vi.fn();
  const shell = createAppShell(
    document.querySelector("#app")!,
    { onExitSaveMode },
    { saveImportEnabled: true }
  );

  shell.setMode("personalized", "World.db", { seed: 42, saveVersion: 28 });

  expect(document.querySelector("[data-mode-meta]")?.textContent).toBe(
    "Seed 42 · Save Version 28"
  );
  expect(document.body.textContent).toContain("Personal Map");
  expect(document.querySelector(".save-entry__button")?.textContent).toBe("Replace Save");
  expect(document.querySelector("[data-save-privacy]")?.textContent).toContain(
    "processed only in this browser's memory"
  );
  document.querySelector<HTMLButtonElement>(".exit-save-button")!.click();
  document.querySelector<HTMLButtonElement>("[data-mobile-exit-save]")!.click();
  expect(onExitSaveMode).toHaveBeenCalledTimes(2);
  shell.setMode("base");
  expect(document.querySelector("[data-mode-meta]")?.hasAttribute("hidden")).toBe(true);
  expect(document.querySelector(".save-entry__button")?.textContent).toBe("Select Save");
  shell.destroy();
  expect(document.querySelector("#map")).toBeNull();
});

it("shows committed aggregate terrain coverage in personal mode and clears it on exit", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(
    document.querySelector("#app")!,
    {},
    { saveImportEnabled: true }
  );

  shell.setMode("personalized", "Private.db", {
    seed: 42,
    saveVersion: 28,
    coverage: {
      totalCells: 9,
      legacyImageCells: 5,
      oneDotZeroImageCells: 0,
      fallbackCells: 4,
      distinctFallbackUuids: 2
    }
  });

  const coverage = document.querySelector("[data-terrain-coverage]");
  expect(coverage?.textContent).toContain("Legacy images 5 cells");
  expect(coverage?.textContent).toContain("Missing images 4 cells");
  expect(coverage?.textContent).not.toMatch(/Private\.db|Seed 42|UUID/i);

  shell.setMode("base");
  expect(coverage?.textContent).toContain(
    "Select a Scrap Mechanic 1.0 Survival save to build the map from its actual terrain layout."
  );
  expect(coverage?.textContent).not.toContain("Legacy images 5 cells");
});

it("shows a semantic development page and makes the map workspace inactive", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});

  shell.setRegionContentMode("under-development");

  expect(document.querySelector("[data-region-development] h2")?.textContent)
    .toBe("Under Development");
  expect(document.querySelector("[data-region-development] p")?.textContent)
    .toBe("This region map is not available yet.");
  expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#map")?.inert).toBe(true);
  expect(document.querySelector<HTMLElement>("#location-panel")?.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#location-panel")?.inert).toBe(true);
  expect(document.querySelector<HTMLElement>("[data-location-details]")?.hidden)
    .toBe(true);
  expect(document.querySelector<HTMLElement>("[data-location-details]")?.inert)
    .toBe(true);
  expect(document.querySelector<HTMLElement>("[data-region-development]")?.hidden)
    .toBe(false);
  expect(document.querySelector<HTMLButtonElement>(".filter-toggle")?.hidden)
    .toBe(true);
});

it("restores the complete interactive workspace after development mode", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createAppShell(document.querySelector("#app")!, {});

  shell.setRegionContentMode("under-development");
  shell.setRegionContentMode("map");

  for (const selector of ["#map", "#location-panel", "[data-location-details]"]) {
    const element = document.querySelector<HTMLElement>(selector);
    expect(element?.hidden).toBe(false);
    expect(element?.inert).toBe(false);
  }
  expect(document.querySelector<HTMLElement>("[data-region-development]")?.hidden)
    .toBe(true);
  expect(document.querySelector<HTMLButtonElement>(".filter-toggle")?.hidden)
    .toBe(false);
});

function stubViewport(initialMatches: boolean): {
  setMatches(matches: boolean): void;
  listenerCount(): number;
} {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(max-width: 759px)",
    onchange: null,
    addEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
      listeners.delete(listener);
    },
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return true;
    }
  } as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

  return {
    setMatches(nextMatches) {
      matches = nextMatches;
      const event = { matches, media: mediaQuery.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

function findButton(name: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) =>
        button.textContent?.trim() === name || button.getAttribute("aria-label") === name
    ) ?? null
  );
}

function clickButton(name: string): void {
  const button = findButton(name);
  expect(button, `Button \"${name}\" should exist.`).not.toBeNull();
  button!.click();
}
