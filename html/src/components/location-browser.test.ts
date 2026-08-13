import { beforeEach, expect, it, vi } from "vitest";
import type { MapLocation, MapUiState } from "../domain/map-model";
import type { PlayerMarker } from "../player-markers/player-marker";
import { createLocationBrowser } from "./location-browser";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const state: MapUiState = {
  regionId: "surface",
  zoom: 0,
  center: { x: 0, y: 0 },
  query: "",
  categoryIds: [],
  locationTypeIds: [],
  layerIds: [],
  playerMarkerTypeIds: ["base", "danger", "note", "resource", "vehicle"]
};

const cottonMarker: PlayerMarker = {
  id: "marker-cotton",
  mapScopeId: "default",
  regionId: "surface",
  position: { x: 4, y: 6 },
  name: "Cotton field",
  type: "resource",
  notes: "Bring crates",
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:00:00.000Z"
};

const baseMarker: PlayerMarker = {
  ...cottonMarker,
  id: "marker-base",
  name: "Hill base",
  type: "base",
  notes: ""
};

const officialLocation: MapLocation = {
  id: "warehouse",
  regionId: "surface",
  name: "Warehouse",
  category: "quest",
  precision: "exact",
  position: { x: 1, y: 2 },
  questIds: [],
  resourceIds: [],
  enemyIds: [],
  relatedRegionIds: []
};

beforeEach(() => {
  document.body.innerHTML = '<aside data-testid="browser"></aside>';
});

it("submits a drafted search only from SEARCH or Enter and resets explicitly", () => {
  const onQueryChange = vi.fn();
  const onSearchReset = vi.fn();
  const browser = createLocationBrowser(root(), { onQueryChange, onSearchReset });
  browser.render({
    locations: [],
    playerMarkers: [cottonMarker, baseMarker],
    state
  });

  const search = document.querySelector<HTMLInputElement>("input[type='search']")!;
  const reset = document.querySelector<HTMLButtonElement>("[data-search-reset]")!;
  expect(document.querySelector(".location-browser__search > label")).toBeNull();
  expect(reset.hidden).toBe(true);
  search.value = "crates";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(onQueryChange).not.toHaveBeenCalled();
  expect(reset.hidden).toBe(false);

  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();
  expect(onQueryChange).toHaveBeenCalledWith("crates");

  onQueryChange.mockClear();
  search.value = "warehouse";
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(onQueryChange).toHaveBeenCalledWith("warehouse");

  search.value = "";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(onSearchReset).not.toHaveBeenCalled();
  reset.click();
  expect(search.value).toBe("");
  expect(reset.hidden).toBe(true);
  expect(onSearchReset).toHaveBeenCalledOnce();

  browser.render({
    locations: [],
    playerMarkers: [cottonMarker],
    state: { ...state, query: "crates", categoryIds: ["boss"] }
  });

  expect(playerMarkerCards()).toHaveLength(1);
  expect(playerMarkerCards()[0]?.textContent).toContain("Cotton field");
  expect(playerMarkerCards()[0]?.textContent).not.toContain("Bring crates");
});

it("uses one consistent border color across every search control", () => {
  const css = readFileSync(join(process.cwd(), "src", "styles", "app.css"), "utf8");
  expect(css).toMatch(/\.location-browser__search input[\s\S]*?border:\s*1px solid var\(--safety-orange\)/);
  expect(css).toMatch(/\.location-browser__search button[\s\S]*?border:\s*1px solid var\(--safety-orange\)/);
});

it("renders player marker types separately and reports their sorted selection", () => {
  const onPlayerMarkerTypeChange = vi.fn();
  const browser = createLocationBrowser(root(), { onPlayerMarkerTypeChange });
  browser.render({
    locations: [officialLocation],
    playerMarkers: [cottonMarker, baseMarker],
    state: { ...state, playerMarkerTypeIds: ["base", "resource"] }
  });

  expect(document.querySelector("#location-category-filters")).toBeNull();
  expect(fieldset("Player Marker Types")).not.toBeNull();
  expect(checkedValues("Player Marker Types")).toEqual(["resource", "base"]);

  const resource = checkbox("Player Marker Types", "resource");
  resource.checked = false;
  resource.dispatchEvent(new Event("change", { bubbles: true }));

  expect(onPlayerMarkerTypeChange).toHaveBeenCalledWith(["base"]);
});

it("reserves a map-layer tree mount between search and Player Marker Types", () => {
  createLocationBrowser(root(), {});

  const search = document.querySelector<HTMLInputElement>("#location-search")!;
  const tree = document.querySelector<HTMLElement>("[data-map-layer-tree]")!;
  const markerTypes = document.querySelector<HTMLElement>(
    "#player-marker-type-filters"
  )!;

  expect(tree).not.toBeNull();
  expect(search.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  expect(tree.compareDocumentPosition(markerTypes) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
});

it("selects player marker cards independently from official locations", () => {
  const onLocationSelect = vi.fn();
  const onPlayerMarkerSelect = vi.fn();
  const browser = createLocationBrowser(root(), {
    onLocationSelect,
    onPlayerMarkerSelect
  });
  browser.render({
    locations: [officialLocation],
    playerMarkers: [cottonMarker],
    state
  });

  playerMarkerCards()[0]!.click();

  expect(onPlayerMarkerSelect).toHaveBeenCalledWith("marker-cotton");
  expect(onLocationSelect).not.toHaveBeenCalled();
  expect(document.querySelector("[data-testid='result-count']")?.textContent)
    .toBe("2 results");
});

it("exposes the selected player marker card independently from URL state", () => {
  const browser = createLocationBrowser(root(), {});
  browser.render({
    locations: [officialLocation],
    playerMarkers: [cottonMarker, baseMarker],
    selectedPlayerMarkerId: "marker-cotton",
    state
  });

  expect(playerMarkerCard("marker-cotton").getAttribute("aria-current"))
    .toBe("true");
  expect(playerMarkerCard("marker-base").hasAttribute("aria-current"))
    .toBe(false);

  browser.render({
    locations: [officialLocation],
    playerMarkers: [cottonMarker, baseMarker],
    selectedPlayerMarkerId: "marker-base",
    state
  });

  expect(playerMarkerCard("marker-cotton").hasAttribute("aria-current"))
    .toBe(false);
  expect(playerMarkerCard("marker-base").getAttribute("aria-current"))
    .toBe("true");
});

it("restores focus to a surviving player marker type after rerender", () => {
  let currentState = state;
  let browser: ReturnType<typeof createLocationBrowser>;
  browser = createLocationBrowser(root(), {
    onPlayerMarkerTypeChange(playerMarkerTypeIds) {
      currentState = { ...currentState, playerMarkerTypeIds };
      browser.render({
        locations: [],
        playerMarkers: [cottonMarker],
        state: currentState
      });
    }
  });
  browser.render({
    locations: [],
    playerMarkers: [cottonMarker],
    state: currentState
  });
  const resource = checkbox("Player Marker Types", "resource");
  resource.focus();
  resource.click();

  expect(document.activeElement).toBe(
    checkbox("Player Marker Types", "resource")
  );
});

function root(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-testid='browser']")!;
}

function playerMarkerCards(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-player-marker-id]")
  );
}

function playerMarkerCard(id: string): HTMLButtonElement {
  return playerMarkerCards().find((card) => card.dataset.playerMarkerId === id)!;
}

function fieldset(legend: string): HTMLFieldSetElement | undefined {
  return Array.from(document.querySelectorAll<HTMLFieldSetElement>("fieldset"))
    .find((candidate) => candidate.querySelector("legend")?.textContent === legend);
}

function checkbox(legend: string, value: string): HTMLInputElement {
  return fieldset(legend)!.querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${value}"]`
  )!;
}

function checkedValues(legend: string): string[] {
  return Array.from(
    fieldset(legend)!.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:checked'
    )
  ).map((input) => input.value);
}
