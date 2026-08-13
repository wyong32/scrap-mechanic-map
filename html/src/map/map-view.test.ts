import { expect, it, vi } from "vitest";
import type { MapLocation, WorldMap } from "../domain/map-model";
import {
  createMapView as createRawMapView,
  type MapViewCallbacks,
  type MapViewOptions
} from "./map-view";
import { AtlasLayer, type AtlasNetworkPolicy } from "./atlas-layer";
import type { LegacyAssetBundle } from "../legacy/legacy-visual-types";
import type { PlayerMarker } from "../player-markers/player-marker";
import type { LocationNameInventory } from "./location-name-inventory";

interface LeafletContainer extends HTMLElement {
  _leaflet_events?: Record<string, unknown>;
  _leaflet_id?: number;
}

const world: WorldMap = {
  id: "reference-surface",
  source: "reference",
  gameVersion: "1.0.0",
  bounds: { minX: -1, minY: -1, maxX: 0, maxY: 0 },
  cells: [],
  locations: [],
  connections: []
};

const atlasWorld: WorldMap = {
  ...world,
  id: "fixed-atlas-test",
  source: "fixed-region"
};

const locations: MapLocation[] = [
  {
    id: "mechanic-station",
    regionId: "surface",
    name: "Mechanic Station",
    category: "poi",
    precision: "exact",
    position: { x: 2, y: 2 },
    questIds: [],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  },
  {
    id: "quest-area",
    regionId: "surface",
    name: "Quest Area",
    category: "quest",
    precision: "area-reference",
    bounds: { minX: -2, minY: -2, maxX: -1, maxY: -1 },
    questIds: ["first-quest"],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  },
  {
    id: "boss-hall",
    regionId: "surface",
    name: "Boss Hall",
    category: "boss",
    precision: "area-reference",
    position: { x: 3, y: 3 },
    questIds: [],
    resourceIds: [],
    enemyIds: ["boss"],
    relatedRegionIds: []
  }
];

const locationNameInventory: LocationNameInventory = {
  groups: [],
  instances: [
    {
      id: "generated:warehouse:0:0",
      source: "generated",
      typeId: "generated:warehouse",
      label: "Warehouse",
      position: { x: 0.5, y: 0.5 }
    },
    {
      id: "generated:warehouse:3:0",
      source: "generated",
      typeId: "generated:warehouse",
      label: "Warehouse",
      position: { x: 3.5, y: 0.5 }
    },
    {
      id: "fixed:mechanic-station",
      source: "fixed-story",
      typeId: "fixed:mechanic-station",
      label: "Mechanic Station",
      position: { x: 2, y: 2 }
    }
  ]
};

function createMapElement(): LeafletContainer {
  const element = document.createElement("div") as LeafletContainer;
  element.tabIndex = 0;
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 }
  });
  document.body.append(element);
  return element;
}

function createTestContext(): CanvasRenderingContext2D {
  return {
    clearRect() {},
    fillRect() {},
    fillText() {},
    drawImage() {}
  } as unknown as CanvasRenderingContext2D;
}

function fireLeafletClick(
  element: HTMLElement,
  coordinate: { lat: number; lng: number }
): void {
  element.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    clientX: element.clientWidth / 2 + coordinate.lng * 64,
    clientY: element.clientHeight / 2 + coordinate.lat * 64
  }));
}

type TestMapViewCallbacks = Pick<
  MapViewCallbacks,
  "onViewportChange" | "onLocationSelect"
> & Partial<Pick<
  MapViewCallbacks,
  "onPlayerMarkerSelect" | "onMarkerPlacement"
>>;

function createProductionMapView(
  element: HTMLElement,
  callbacks: TestMapViewCallbacks,
  options: MapViewOptions = {}
) {
  return createRawMapView(element, {
    onViewportChange: callbacks.onViewportChange,
    onLocationSelect: callbacks.onLocationSelect,
    onPlayerMarkerSelect: callbacks.onPlayerMarkerSelect ?? vi.fn(),
    onMarkerPlacement: callbacks.onMarkerPlacement ?? vi.fn()
  }, options);
}

function createMapView(
  element: HTMLElement,
  callbacks: TestMapViewCallbacks
) {
  return createProductionMapView(element, callbacks, {
    createAtlasLayer(networkPolicy: AtlasNetworkPolicy) {
      return new AtlasLayer({
        networkPolicy,
        contextFactory: () => createTestContext()
      });
    }
  });
}

it("reports one game-cell coordinate for a placement click and exits placement mode", () => {
  const element = createMapElement();
  const onMarkerPlacement = vi.fn();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn(),
    onMarkerPlacement
  });

  view.setMarkerPlacementMode(true);
  expect(element.dataset.markerPlacement).toBe("true");
  fireLeafletClick(element, { lat: -8, lng: 12 });

  expect(onMarkerPlacement).toHaveBeenCalledWith({ x: 12, y: 8 });
  expect(element.dataset.markerPlacement).toBe("false");
  fireLeafletClick(element, { lat: -4, lng: 6 });
  expect(onMarkerPlacement).toHaveBeenCalledOnce();
  view.destroy();
});

it("clears placement mode when the world is replaced or the map is destroyed", () => {
  const element = createMapElement();
  const onMarkerPlacement = vi.fn();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn(),
    onMarkerPlacement
  });

  view.setMarkerPlacementMode(true);
  view.setWorld(world);
  expect(element.dataset.markerPlacement).toBe("false");
  fireLeafletClick(element, { lat: -2, lng: 3 });
  expect(onMarkerPlacement).not.toHaveBeenCalled();

  view.setMarkerPlacementMode(true);
  view.destroy();
  expect(element.dataset.markerPlacement).toBe("false");
  fireLeafletClick(element, { lat: -2, lng: 3 });
  expect(onMarkerPlacement).not.toHaveBeenCalled();
});

it("routes player marker icons, labels, selection, and visibility", () => {
  const element = createMapElement();
  const onPlayerMarkerSelect = vi.fn();
  const marker: PlayerMarker = {
    id: "marker-1",
    mapScopeId: "save:surface:42",
    regionId: "surface",
    position: { x: 2, y: 3 },
    name: "Cotton field",
    type: "resource",
    notes: "",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z"
  };
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn(),
    onPlayerMarkerSelect
  });

  view.setPlayerMarkers([marker]);
  view.setLayerVisibility("player-markers", true);
  const markerButton = element.querySelector<HTMLButtonElement>(
    '[data-player-marker-id="marker-1"]'
  )!;
  expect(markerButton).not.toBeNull();
  expect(element.querySelector(".player-marker__name")).toBeNull();

  view.setLayerVisibility("labels", true);
  expect(element.querySelector(".player-marker__name")?.textContent).toBe(
    "Cotton field"
  );
  element.querySelector<HTMLButtonElement>(
    '[data-player-marker-id="marker-1"]'
  )!.click();
  expect(onPlayerMarkerSelect).toHaveBeenCalledWith("marker-1");

  view.selectPlayerMarker("marker-1");
  expect(
    element.querySelector('[data-player-marker-id="marker-1"]')
      ?.getAttribute("aria-pressed")
  ).toBe("true");
  view.setLayerVisibility("labels", false);
  expect(element.querySelector(".player-marker__name")).toBeNull();
  expect(element.querySelector("[data-player-marker-id]")).not.toBeNull();
  view.setLayerVisibility("player-markers", false);
  expect(element.querySelector("[data-player-marker-id]")).toBeNull();
  view.destroy();
});

it("removes Leaflet listeners and releases the map container on destroy", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });

  expect(element._leaflet_id).toEqual(expect.any(Number));
  expect(Object.keys(element._leaflet_events ?? {})).not.toHaveLength(0);

  view.destroy();

  expect(element._leaflet_id).toBeUndefined();
  expect(element._leaflet_events).toBeUndefined();
});

it("preserves unrelated native container listeners on destroy", () => {
  const element = createMapElement();
  const handleClick = vi.fn();
  element.addEventListener("click", handleClick);
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });

  view.destroy();
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(handleClick).toHaveBeenCalledOnce();
});

it("fits normalized world bounds and reports the viewport in game cell coordinates", () => {
  const onViewportChange = vi.fn();
  const view = createMapView(createMapElement(), {
    onViewportChange,
    onLocationSelect: vi.fn()
  });

  view.setWorld(world);

  expect(view.getViewport()).toMatchObject({ center: { x: 0, y: 0 } });
  expect(onViewportChange).toHaveBeenCalledWith(view.getViewport());
  view.destroy();
});

it("starts and commits every world no farther out than -3", async () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  const fullSurface: WorldMap = {
    ...world,
    bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 }
  };

  view.setWorld(fullSurface);
  expect(view.getViewport().zoom).toBe(-3);

  view.setWorld({ ...fullSurface, id: "personal", source: "save" });
  expect(view.getViewport().zoom).toBe(-3);

  view.setWorld({ ...fullSurface, id: "fixed", source: "fixed-region" });
  expect(view.getViewport().zoom).toBe(-3);

  const restoredViewport = { center: { x: 12, y: -8 }, zoom: -2 };
  view.setViewport(restoredViewport);
  const legacyBundle: LegacyAssetBundle = {
    assets: new Map(),
    bridgeByUuid: new Map(),
    poiRules: []
  };
  const preparedReference = await view.prepareWorld(
    fullSurface,
    undefined,
    legacyBundle
  );
  await view.commitPreparedWorld(preparedReference);
  expect(view.getViewport()).toEqual(restoredViewport);
  expect(
    element.querySelector<HTMLImageElement>(".reference-surface-backdrop")
      ?.getAttribute("src")
  ).toContain("/assets/reference-surface-1.0.webp");
  expect(element.querySelector<HTMLCanvasElement>("canvas")?.hidden).toBe(true);

  const preparedSave = await view.prepareWorld({
    ...fullSurface,
    id: "prepared-save",
    source: "save"
  });
  await view.commitPreparedWorld(preparedSave);
  expect(view.getViewport().zoom).toBe(-3);

  view.setViewport(restoredViewport);
  const preparedFixed = await view.prepareWorld({
    ...fullSurface,
    id: "prepared-fixed",
    source: "fixed-region"
  });
  await view.commitPreparedWorld(preparedFixed);
  expect(view.getViewport().zoom).toBe(-3);
  view.destroy();
});

it("shows only the reference WebP backdrop while keeping fixed-region atlas terrain", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });

  view.setWorld(world);
  const referenceBackdrop = element.querySelector<HTMLImageElement>(".reference-surface-backdrop");
  expect(referenceBackdrop?.getAttribute("src"))
    .toContain("/assets/reference-surface-1.0.webp");
  expect(element.querySelector<HTMLCanvasElement>("canvas")?.hidden).toBe(true);

  view.setWorld({
    ...world,
    id: "grow-lab-2",
    source: "fixed-region"
  });
  expect(element.querySelector(".reference-surface-backdrop")).toBeNull();
  expect(element.querySelector(".fixed-region-backdrop")).not.toBeNull();
  expect(element.querySelector<HTMLCanvasElement>("canvas")?.hidden).toBe(false);
  expect(element.querySelector<HTMLElement>(".leaflet-fixedRegion-pane")?.style.zIndex).toBe("150");

  view.setWorld(world);
  expect(element.querySelector(".reference-surface-backdrop")).not.toBeNull();
  expect(element.querySelector(".fixed-region-backdrop")).toBeNull();
  expect(element.querySelector<HTMLCanvasElement>("canvas")?.hidden).toBe(true);
  view.destroy();
});

it("applies a normalized game-cell viewport through the map adapter", () => {
  const view = createMapView(createMapElement(), {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });

  view.setViewport({ center: { x: 12, y: -8 }, zoom: -2 });

  expect(view.getViewport()).toEqual({
    center: { x: 12, y: -8 },
    zoom: -2
  });
  view.destroy();
});

it("exposes the configured zoom range without Leaflet's default zoom control", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });

  view.setViewport({ center: { x: 0, y: 0 }, zoom: -6 });
  expect(view.getViewport().zoom).toBe(-3);
  view.setViewport({ center: { x: 0, y: 0 }, zoom: 1 });
  expect(view.getViewport().zoom).toBe(0);
  expect(element.querySelector(".leaflet-control-zoom")).toBeNull();
  expect(element.querySelector(".leaflet-control-attribution")).not.toBeNull();

  view.destroy();
});

it("gives marker buttons an English accessible name without exposing category IDs", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setLocations([locations[0]]);

  const marker = element.querySelector<HTMLButtonElement>(
    "[data-map-location-id='mechanic-station']"
  )!;
  const accessibleName = marker.getAttribute("aria-label");

  expect(accessibleName).toBe(
    "Map location: Mechanic Station"
  );
  expect(accessibleName ?? "").not.toContain("poi");
  view.destroy();
});

it("links category layers, marker selection, and bounded list selection", () => {
  const onLocationSelect = vi.fn();
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect
  });
  view.setLocations(locations);

  const stationButton = element.querySelector<HTMLButtonElement>(
    "[data-map-location-id='mechanic-station']"
  )!;
  expect(stationButton.querySelector(".visually-hidden")?.textContent).toBe(
    "Map location: Mechanic Station"
  );
  expect(
    element.querySelector("[data-map-location-id='quest-area']")
  ).not.toBeNull();

  view.setLayerVisibility("quest", false);
  expect(element.querySelector("[data-map-location-id='quest-area']")).toBeNull();
  view.setLayerVisibility("quest", true);

  stationButton.click();
  expect(onLocationSelect).toHaveBeenCalledWith("mechanic-station");
  expect(stationButton.getAttribute("aria-pressed")).toBe("true");

  view.selectLocation("quest-area");
  expect(onLocationSelect).toHaveBeenCalledTimes(1);
  expect(
    element
      .querySelector("[data-map-location-id='quest-area']")
      ?.getAttribute("aria-pressed")
  ).toBe("true");
  expect(view.getViewport()).toMatchObject({ center: { x: -1, y: -1 } });

  view.destroy();
});

it("applies overlay semantics independently of marker category IDs", () => {
  const element = createMapElement();
  const coordinateGrid = document.createElement("div");
  coordinateGrid.dataset.coordinateGrid = "";
  element.append(coordinateGrid);
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setLocations(locations);

  view.setLayerVisibility("danger", false);
  expect(element.querySelector("[data-map-location-id='boss-hall']")).toBeNull();
  expect(
    element.querySelector("[data-map-location-id='mechanic-station']")
  ).not.toBeNull();

  view.setLayerVisibility("grid", false);
  expect(coordinateGrid.hidden).toBe(true);

  view.setLayerVisibility("terrain", false);
  expect(
    element.querySelector("[data-map-location-id='mechanic-station']")
  ).not.toBeNull();

  view.destroy();
});

it("renders location names from the selected shared-inventory types", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setLocationNames(locationNameInventory, ["generated:warehouse"]);
  expect(
    Array.from(element.querySelectorAll(".poi-place-label"), (label) =>
      label.textContent
    )
  ).toEqual(["Warehouse", "Warehouse"]);
  view.setLocationNames(locationNameInventory, ["fixed:mechanic-station"]);
  expect(
    Array.from(element.querySelectorAll(".poi-place-label"), (label) =>
      label.textContent
    )
  ).toEqual(["Mechanic Station"]);
  view.setLocationNames(locationNameInventory, []);
  expect(element.querySelectorAll(".poi-place-label")).toHaveLength(0);
  view.destroy();
});

it("leaves player-marker labels under the player-marker layer's existing control", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setPlayerMarkers([{
    id: "player-marker-1",
    type: "base",
    name: "Home",
    position: { x: 1, y: 1 },
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    mapScopeId: "reference-surface",
    regionId: "surface",
    notes: ""
  }]);
  view.setLayerVisibility("player-markers", true);

  view.setLocationNames(locationNameInventory, ["generated:warehouse"]);
  expect(element.querySelector(".player-marker__name")).toBeNull();

  view.setLayerVisibility("labels", true);
  expect(element.querySelector(".player-marker__name")?.textContent).toBe("Home");
  view.destroy();
});

it("does not derive location labels from map locations outside the shared inventory", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });

  view.setWorld(world);
  view.setLocations(locations);
  view.setLayerVisibility("labels", true);
  expect(element.querySelector(".poi-place-label")).toBeNull();

  view.destroy();
});

it("clears labels when a new world replaces the current world", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setWorld({
    ...world,
    id: "personal-surface",
    source: "save",
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    cells: [{
      x: 0,
      y: 0,
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee03",
      xOffset: 0,
      yOffset: 0,
      rotation: 0,
      flags: 0,
      terrainType: "meadow",
      poiType: "POI_HIDEOUT_XL"
    }]
  });
  view.setLocationNames({
    groups: [],
    instances: [{
      id: "generated:hideout:0:0",
      source: "generated",
      typeId: "generated:hideout",
      label: "Hideout",
      position: { x: 0.5, y: 0.5 }
    }]
  }, ["generated:hideout"]);
  expect(element.querySelector(".poi-place-label")?.textContent).toBe("Hideout");

  view.setWorld(world);
  expect(element.querySelector(".poi-place-label")).toBeNull();
  view.destroy();
});

it("reapplies the last committed location-name selection after a prepared world commits", async () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setWorld({
    ...world,
    cells: [{
      x: 0,
      y: 0,
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee04",
      xOffset: 0,
      yOffset: 0,
      rotation: 0,
      flags: 0,
      terrainType: "meadow",
      poiType: "POI_ROAD_KIOSK"
    }]
  });
  view.setLocationNames({
    groups: [],
    instances: [{
      id: "generated:kiosk:0:0",
      source: "generated",
      typeId: "generated:kiosk",
      label: "Kiosk",
      position: { x: 0.5, y: 0.5 }
    }]
  }, ["generated:kiosk"]);
  expect(element.querySelector(".poi-place-label")?.textContent).toBe("Kiosk");
  const personal: WorldMap = {
    ...world,
    id: "personal-surface",
    source: "save",
    bounds: { minX: 5, minY: 5, maxX: 5, maxY: 5 },
    cells: [{
      x: 5,
      y: 5,
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee05",
      xOffset: 0,
      yOffset: 0,
      rotation: 0,
      flags: 0,
      terrainType: "meadow",
      poiType: "POI_RUINCITY_XL"
    }]
  };

  const prepared = await view.prepareWorld(personal);
  expect(element.querySelector(".poi-place-label")).toBeNull();
  await view.commitPreparedWorld(prepared);
  expect(element.querySelector(".poi-place-label")?.textContent).toBe(
    "Kiosk"
  );
  view.destroy();
});

it("hides POI markers and atlas icons without hiding terrain", () => {
  const element = createMapElement();
  const iconVisibility: boolean[] = [];
  const view = createProductionMapView(
    element,
    {
      onViewportChange: vi.fn(),
      onLocationSelect: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy) {
        const layer = new AtlasLayer({
          networkPolicy,
          contextFactory: () => createTestContext()
        });
        vi.spyOn(layer, "setPoiIconsVisible").mockImplementation(
          async (visible) => {
            iconVisibility.push(visible);
          }
        );
        return layer;
      }
    }
  );
  view.setWorld(atlasWorld);
  view.setLocations([locations[0]]);

  view.setLayerVisibility("poi", false);

  expect(iconVisibility).toEqual([false]);
  expect(
    element.querySelector("[data-map-location-id='mechanic-station']")
  ).toBeNull();
  const terrain = element.querySelector<HTMLCanvasElement>(
    ".terrain-atlas-layer"
  );
  expect(terrain).not.toBeNull();
  expect(terrain!.hidden).toBe(false);
  view.destroy();
});

it("retains category visibility before first encounter and after repopulation", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });

  view.setLayerVisibility("quest", false);
  view.setLocations([locations[1]]);
  expect(element.querySelector("[data-map-location-id='quest-area']")).toBeNull();

  view.setLocations([locations[0]]);
  view.setLocations([locations[1]]);
  expect(element.querySelector("[data-map-location-id='quest-area']")).toBeNull();

  view.setLayerVisibility("quest", true);
  expect(element.querySelector("[data-map-location-id='quest-area']")).not.toBeNull();
  view.destroy();
});

it("restores focused map markers across rebuilds and falls back to the map", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setLocations(locations);
  element
    .querySelector<HTMLButtonElement>(
      "[data-map-location-id='mechanic-station']"
    )!
    .focus();

  view.setLocations(locations);
  expect(document.activeElement).toBe(
    element.querySelector("[data-map-location-id='mechanic-station']")
  );

  view.setLocations([locations[1]]);
  expect(document.activeElement).toBe(element);
  view.destroy();
});

it("zooms and resets to the active world's bounds", () => {
  const view = createMapView(createMapElement(), {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  const offsetWorld: WorldMap = {
    ...world,
    bounds: { minX: 10, minY: 20, maxX: 13, maxY: 23 }
  };
  view.setWorld(offsetWorld);
  view.setViewport({ center: { x: 0, y: 0 }, zoom: -2 });

  view.zoomIn();
  expect(view.getViewport().zoom).toBe(-1);
  view.zoomOut();
  expect(view.getViewport().zoom).toBe(-2);
  view.resetView();
  expect(view.getViewport()).toMatchObject({
    center: { x: 12, y: 22 }
  });

  view.destroy();
});

it("updates bounded selection styling without focusing when requested", () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setLocations(locations);
  view.setViewport({ center: { x: 12, y: -8 }, zoom: -2 });

  view.selectLocation("quest-area", { focus: false });

  expect(
    element
      .querySelector("[data-map-location-id='quest-area']")
      ?.getAttribute("aria-pressed")
  ).toBe("true");
  expect(view.getViewport()).toEqual({
    center: { x: 12, y: -8 },
    zoom: -2
  });
  view.destroy();
});

it("surfaces atlas failures in English and clears them after a successful retry event", () => {
  const host = document.createElement("div"); const element = createMapElement(); host.append(element); document.body.append(host);
  const view = createMapView(element, { onViewportChange: vi.fn(), onLocationSelect: vi.fn() });
  element.dispatchEvent(new CustomEvent("atlas-error", { detail: "404" }));
  expect(host.querySelector("[data-atlas-error]")?.textContent).toContain("Terrain atlas unavailable");
  expect(element.dataset.atlasStatus).toBeUndefined();
  element.dataset.atlasStatus = "error"; element.dispatchEvent(new CustomEvent("atlas-ready"));
  expect(host.querySelector("[data-atlas-error]")).toBeNull(); expect(element.dataset.atlasStatus).toBeUndefined(); view.destroy();
});

it("keeps the committed visible terrain frame until a mounted replacement frame is prepared", async () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  view.setWorld(world);
  const committed = element.querySelector("[data-terrain-frame='committed']");

  const replacement: WorldMap = {
    ...world,
    id: "personal-surface",
    source: "save",
    seed: 42,
    cells: [{
      x: -1, y: -1,
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
      xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "meadow"
    }]
  };
  const prepared = await view.prepareWorld(replacement);

  expect(element.querySelector("[data-terrain-frame='committed']")).toBe(committed);
  expect(element.querySelector("[data-terrain-frame='prepared']")).not.toBeNull();
  expect(element.querySelector<HTMLElement>("[data-terrain-frame='prepared']")?.hidden).toBe(true);

  await view.commitPreparedWorld(prepared);
  expect(element.querySelector("[data-terrain-frame='prepared']")).toBeNull();
  expect(element.querySelectorAll("[data-terrain-frame='committed']")).toHaveLength(1);
  view.destroy();
});

it("replaces the personal offline layer with an atlas-backed base layer on Exit", async () => {
  const element = createMapElement();
  const policies: AtlasNetworkPolicy[] = [];
  const view = createProductionMapView(
    element,
    {
      onViewportChange: vi.fn(),
      onLocationSelect: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy) {
        policies.push(networkPolicy);
        return new AtlasLayer({
          networkPolicy,
          contextFactory: () => createTestContext()
        });
      }
    }
  );
  const personal: WorldMap = {
    ...world,
    id: "personal-surface",
    source: "save",
    seed: 42
  };
  const prepared = await view.prepareWorld(personal);
  await view.commitPreparedWorld(prepared);

  view.setWorld(world, "atlas");

  expect(policies).toEqual(["atlas", "offline-overview", "atlas"]);
  expect(element.querySelectorAll(".terrain-atlas-layer")).toHaveLength(1);
  view.destroy();
});

it("cancels an older mounted preparation when a replacement starts", async () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  const twoRows: WorldMap = {
    ...world,
    cells: [
      { x: 0, y: 0, uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "one" },
      { x: 0, y: 1, uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "two" }
    ]
  };

  const older = view.prepareWorld(twoRows);
  const newer = view.prepareWorld({ ...twoRows, seed: 84 });

  await expect(older).rejects.toMatchObject({ name: "AbortError" });
  const prepared = await newer;
  expect(element.querySelectorAll("[data-terrain-frame='prepared']")).toHaveLength(1);
  await view.commitPreparedWorld(prepared);
  expect(element.querySelectorAll("[data-terrain-frame='committed']")).toHaveLength(1);
  view.destroy();
});

it("explicitly discards a mounted hidden preparation", async () => {
  const element = createMapElement();
  const view = createMapView(element, {
    onViewportChange: vi.fn(),
    onLocationSelect: vi.fn()
  });
  const prepared = await view.prepareWorld({
    ...world,
    cells: [{ x: 0, y: 0, uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", xOffset: 0, yOffset: 0, rotation: 0, flags: 0, terrainType: "meadow" }]
  });
  expect(element.querySelector("[data-terrain-frame='prepared']")).not.toBeNull();
  view.discardPreparedWorld(prepared);
  expect(element.querySelector("[data-terrain-frame='prepared']")).toBeNull();
  expect(element.querySelectorAll("[data-terrain-frame='committed']")).toHaveLength(1);
  view.destroy();
});

it("resolves and commits preloaded original terrain for a personal world", async () => {
  const element = createMapElement();
  const policies: AtlasNetworkPolicy[] = [];
  const image = document.createElement("img");
  const imageDraws: unknown[][] = [];
  const view = createProductionMapView(
    element,
    {
      onViewportChange: vi.fn(),
      onLocationSelect: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy) {
        policies.push(networkPolicy);
        return new AtlasLayer({
          networkPolicy,
          contextFactory: () => ({
            clearRect() {},
            fillRect() {},
            fillText() {},
            save() {},
            restore() {},
            translate() {},
            rotate() {},
            drawImage(...args: unknown[]) {
              imageDraws.push(args);
            }
          } as unknown as CanvasRenderingContext2D)
        });
      }
    }
  );
  const cell = {
    x: 0, y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0, yOffset: 0, rotation: 3 as const, flags: 0,
    terrainType: "meadow"
  };
  const personal: WorldMap = {
    ...world,
    id: "personal-surface",
    source: "save",
    seed: 42,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    cells: [cell]
  };
  const bundle: LegacyAssetBundle = {
    assets: new Map([[
      "tile:101",
      {
        record: {
          key: "tile:101",
          url: "/legacy/img/tile.png",
          width: 64,
          height: 64,
          sha256: "a".repeat(64),
          source: "the1killer/sm_overview"
        },
        image
      }
    ]]),
    bridgeByUuid: new Map([[
      cell.uuid,
      {
        legacyId: 101,
        uuid: cell.uuid,
        tilePath: "$CONTENT_DATA/Terrain/Tiles/tile_101.tile",
        status: "active",
        evidence: "fixture"
      }
    ]]),
    poiRules: []
  };
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;

  const prepared = await view.prepareWorld(
    personal,
    { bitmap, width: 1, height: 1 },
    bundle
  );
  expect(prepared.coverage).toEqual({
    totalCells: 1,
    legacyImageCells: 1,
    oneDotZeroImageCells: 0,
    fallbackCells: 0,
    distinctFallbackUuids: 0
  });
  await view.commitPreparedWorld(prepared);

  expect(policies).toEqual(["atlas", "legacy-preloaded"]);
  expect(imageDraws.some(([source]) => source === image)).toBe(true);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(element.querySelectorAll("[data-terrain-frame='committed']")).toHaveLength(1);
  view.destroy();
});

it("keeps legacy preparation alive when POI visibility changes", async () => {
  const element = createMapElement();
  const terrainImage = document.createElement("img");
  const iconImage = document.createElement("img");
  const contextDraws: unknown[][] = [];
  let releaseFirstYield: (() => void) | undefined;
  let firstYield = true;
  vi.stubGlobal("scheduler", {
    yield: vi.fn(() => {
      if (!firstYield) return Promise.resolve();
      firstYield = false;
      return new Promise<void>((resolve) => {
        releaseFirstYield = resolve;
      });
    })
  });
  const view = createProductionMapView(
    element,
    {
      onViewportChange: vi.fn(),
      onLocationSelect: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy) {
        return new AtlasLayer({
          networkPolicy,
          yieldTask: async () => undefined,
          contextFactory: () => {
            const draws: unknown[] = [];
            contextDraws.push(draws);
            return {
              clearRect() {},
              fillRect() {},
              fillText() {},
              save() {},
              restore() {},
              translate() {},
              rotate() {},
              drawImage(source: unknown) {
                draws.push(source);
              },
              globalCompositeOperation: "source-over"
            } as unknown as CanvasRenderingContext2D;
          }
        });
      }
    }
  );
  const officialUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee06";
  const fallbackUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee07";
  const cells = Array.from({ length: 8 }, (_, y) => ({
    x: 0,
    y,
    uuid: y === 0 ? officialUuid : fallbackUuid,
    xOffset: 0,
    yOffset: 0,
    rotation: 0 as const,
    flags: 0,
    terrainType: "meadow",
    ...(y === 0 ? { poiType: "POI_WAREHOUSE2_LARGE" } : {})
  }));
  const personal: WorldMap = {
    ...world,
    id: "personal-surface",
    source: "save",
    seed: 42,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 7 },
    cells
  };
  const bundle: LegacyAssetBundle = {
    assets: new Map(),
    bridgeByUuid: new Map(),
    poiRules: [],
    officialByUuid: new Map([[
      officialUuid,
      {
        entry: {
          uuid: officialUuid,
          page: "official-0.webp",
          x: 0,
          y: 0,
          width: 64,
          height: 64,
          spanWidth: 1,
          spanHeight: 1,
          renderMode: "isometric-thumbnail",
          icon: {
            page: "official-icons-0.webp",
            x: 0,
            y: 0,
            width: 64,
            height: 64
          }
        },
        image: terrainImage,
        iconImage
      }
    ]])
  };

  try {
    const preparation = view.prepareWorld(personal, undefined, bundle);
    await vi.waitFor(() =>
      expect(releaseFirstYield).toBeTypeOf("function")
    );

    view.setLayerVisibility("poi", false);
    releaseFirstYield!();

    const prepared = await preparation;
    await view.commitPreparedWorld(prepared);

    expect(
      contextDraws.some((draws) => draws.includes(iconImage))
    ).toBe(true);
    expect(contextDraws.at(-1)).not.toContain(iconImage);
    expect(
      element.querySelectorAll("[data-terrain-frame='committed']")
    ).toHaveLength(1);
  } finally {
    view.destroy();
    vi.unstubAllGlobals();
  }
});

it("aborts prepared legacy staging when terrain is hidden and redraws the current frame when shown", async () => {
  vi.useFakeTimers();
  const element = createMapElement();
  const view = createProductionMapView(
    element,
    {
      onViewportChange: vi.fn(),
      onLocationSelect: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy) {
        return new AtlasLayer({
          networkPolicy,
          yieldTask: async () => undefined,
          contextFactory: () => ({
            clearRect() {},
            fillRect() {},
            fillText() {},
            drawImage() {},
            save() {},
            restore() {},
            translate() {},
            rotate() {}
          } as unknown as CanvasRenderingContext2D)
        });
      }
    }
  );
  view.setWorld(atlasWorld);
  const cells = Array.from({ length: 5_000 }, (_, x) => ({
    x,
    y: 0,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    xOffset: 0,
    yOffset: 0,
    rotation: 0 as const,
    flags: 0,
    terrainType: "meadow"
  }));
  const pending = view.prepareWorld({
    ...world,
    id: "large-personal",
    source: "save",
    seed: 7,
    bounds: { minX: 0, minY: 0, maxX: 4_999, maxY: 0 },
    cells
  }, undefined, {
    assets: new Map(),
    bridgeByUuid: new Map(),
    poiRules: []
  });
  const rejection = expect(pending).rejects.toMatchObject({
    name: "AbortError"
  });
  await Promise.resolve();
  await Promise.resolve();

  view.setLayerVisibility("terrain", false);
  await vi.runAllTimersAsync();
  await rejection;

  expect(element.querySelector("[data-terrain-frame='prepared']")).toBeNull();
  const committed = element.querySelector<HTMLCanvasElement>(
    "[data-terrain-frame='committed']"
  )!;
  expect(committed.hidden).toBe(true);
  view.setLayerVisibility("terrain", true);
  await vi.runAllTimersAsync();
  expect(committed.hidden).toBe(false);
  view.destroy();
  vi.useRealTimers();
});

it("draws the target-bounds legacy frame before its first visible swap", async () => {
  const element = createMapElement();
  const translations: Array<[number, number]> = [];
  const image = document.createElement("img");
  const view = createProductionMapView(
    element,
    {
      onViewportChange: vi.fn(),
      onLocationSelect: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy) {
        return new AtlasLayer({
          networkPolicy,
          contextFactory: () => ({
            clearRect() {},
            fillRect() {},
            fillText() {},
            drawImage() {},
            save() {},
            restore() {},
            translate(x: number, y: number) {
              translations.push([x, y]);
            },
            rotate() {}
          } as unknown as CanvasRenderingContext2D)
        });
      }
    }
  );
  view.setWorld(world);
  const targetUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee88";
  const target: WorldMap = {
    ...world,
    id: "distant-personal",
    source: "save",
    seed: 88,
    bounds: { minX: 100, minY: 100, maxX: 100, maxY: 100 },
    cells: [{
      x: 100,
      y: 100,
      uuid: targetUuid,
      xOffset: 0,
      yOffset: 0,
      rotation: 0,
      flags: 0,
      terrainType: "meadow"
    }]
  };
  const prepared = await view.prepareWorld(target, undefined, {
    assets: new Map([[
      "tile:888",
      {
        record: {
          key: "tile:888",
          url: "/legacy/img/tile-888.jpg",
          width: 64,
          height: 64,
          sha256: "8".repeat(64),
          source: "the1killer/sm_overview"
        },
        image
      }
    ]]),
    bridgeByUuid: new Map([[
      targetUuid,
      {
        legacyId: 888,
        uuid: targetUuid,
        tilePath: "tile-888.tile",
        status: "active",
        evidence: "fixture"
      }
    ]]),
    poiRules: []
  });
  const preparedCanvas = element.querySelector<HTMLCanvasElement>(
    "[data-terrain-frame='prepared']"
  )!;
  let hidden = true;
  let translationsAtFirstUnhide = -1;
  Object.defineProperty(preparedCanvas, "hidden", {
    configurable: true,
    get: () => hidden,
    set(value: boolean) {
      if (hidden && !value && translationsAtFirstUnhide < 0) {
        translationsAtFirstUnhide = translations.length;
      }
      hidden = value;
    }
  });

  await view.commitPreparedWorld(prepared);

  expect(translationsAtFirstUnhide).toBeGreaterThan(0);
  expect(view.getViewport().center).toEqual({ x: 100.5, y: 100.5 });
  view.destroy();
});

it.each(["error", "stale"] as const)(
  "keeps the old viewport, URL, layer, and frame after a prepared commit becomes %s",
  async (outcome) => {
    const element = createMapElement();
    let releaseRestage: (() => void) | undefined;
    let offlineLayers = 0;
    const onViewportChange = vi.fn((viewport) => {
      window.history.replaceState(
        null,
        "",
        `/?center=${viewport.center.x},${viewport.center.y}&zoom=${viewport.zoom}`
      );
    });
    const view = createProductionMapView(
      element,
      {
        onViewportChange,
        onLocationSelect: vi.fn()
      },
      {
        createAtlasLayer(networkPolicy) {
          const layer = new AtlasLayer({
            networkPolicy,
            contextFactory: () => createTestContext()
          });
          if (networkPolicy === "offline-overview") {
            offlineLayers += 1;
            if (offlineLayers === 2) {
              vi.spyOn(layer, "restagePrepared").mockImplementation(async () => {
                if (outcome === "error") {
                  throw new Error("target restage failed");
                }
                await new Promise<void>((resolve) => {
                  releaseRestage = resolve;
                });
              });
            }
          }
          return layer;
        }
      }
    );
    view.setWorld(atlasWorld, "offline-overview");
    await vi.waitFor(() =>
      expect(
        element.querySelector("[data-terrain-frame='committed']")
      ).not.toBeNull()
    );
    view.setViewport({ center: { x: 3, y: -2 }, zoom: -2 });
    const oldViewport = view.getViewport();
    const oldUrl = window.location.href;
    const viewportCallsBeforeCommit = onViewportChange.mock.calls.length;
    const oldFrame = element.querySelector(
      "[data-terrain-frame='committed']"
    );
    const target: WorldMap = {
      ...world,
      id: "distant-candidate",
      source: "save",
      bounds: { minX: 100, minY: 100, maxX: 101, maxY: 101 },
      cells: [{
        x: 100,
        y: 100,
        uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee99",
        xOffset: 0,
        yOffset: 0,
        rotation: 0,
        flags: 0,
        terrainType: "meadow"
      }]
    };
    const prepared = await view.prepareWorld(target);
    const pendingCommit = view.commitPreparedWorld(prepared);
    if (outcome === "stale") {
      await vi.waitFor(() => expect(releaseRestage).toBeTypeOf("function"));
      view.discardPreparedWorld(prepared);
      releaseRestage!();
    }

    await expect(pendingCommit).rejects.toMatchObject(
      outcome === "stale"
        ? { name: "AbortError" }
        : { message: "target restage failed" }
    );
    expect(view.getViewport()).toEqual(oldViewport);
    expect(window.location.href).toBe(oldUrl);
    expect(onViewportChange).toHaveBeenCalledTimes(
      viewportCallsBeforeCommit
    );
    expect(
      element.querySelector("[data-terrain-frame='committed']")
    ).toBe(oldFrame);
    expect(element.querySelectorAll("[data-terrain-frame='committed']")).toHaveLength(1);
    expect(element.querySelector("[data-terrain-frame='prepared']")).toBeNull();
    view.destroy();
  }
);

it("does not let a duplicate stale commit hide the layer committed by its sibling", async () => {
  const element = createMapElement();
  const onViewportChange = vi.fn();
  const restageReleases: Array<() => void> = [];
  let offlineLayers = 0;
  let targetCanvas: HTMLCanvasElement | undefined;
  const view = createProductionMapView(
    element,
    {
      onViewportChange,
      onLocationSelect: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy) {
        const layer = new AtlasLayer({
          networkPolicy,
          contextFactory: () => createTestContext()
        });
        if (networkPolicy === "offline-overview") {
          offlineLayers += 1;
          if (offlineLayers === 2) {
            targetCanvas = (
              layer as unknown as { canvas: HTMLCanvasElement }
            ).canvas;
            vi.spyOn(layer, "restagePrepared").mockImplementation(
              () => new Promise<void>((resolve) => {
                restageReleases.push(resolve);
              })
            );
          }
        }
        return layer;
      }
    }
  );
  view.setWorld(atlasWorld, "offline-overview");
  await vi.waitFor(() =>
    expect(
      element.querySelector("[data-terrain-frame='committed']")
    ).not.toBeNull()
  );
  const callsBeforeCommit = onViewportChange.mock.calls.length;
  const target: WorldMap = {
    ...world,
    id: "duplicate-commit-candidate",
    source: "save",
    bounds: { minX: 20, minY: 20, maxX: 20, maxY: 20 },
    cells: [{
      x: 20,
      y: 20,
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee77",
      xOffset: 0,
      yOffset: 0,
      rotation: 0,
      flags: 0,
      terrainType: "meadow"
    }]
  };
  const prepared = await view.prepareWorld(target);

  const first = view.commitPreparedWorld(prepared);
  const second = view.commitPreparedWorld(prepared);
  await vi.waitFor(() => expect(restageReleases).toHaveLength(2));
  restageReleases[0]!();
  await expect(first).resolves.toBeUndefined();
  restageReleases[1]!();
  await expect(second).rejects.toMatchObject({ name: "AbortError" });

  expect(targetCanvas).toBeDefined();
  expect(targetCanvas!.hidden).toBe(false);
  expect(targetCanvas!.dataset.terrainFrame).toBe("committed");
  expect(
    element.querySelectorAll("[data-terrain-frame='committed']")
  ).toHaveLength(1);
  expect(
    element.querySelector("[data-terrain-frame='committed']")
  ).toBe(targetCanvas);
  expect(element.querySelector("[data-terrain-frame='prepared']")).toBeNull();
  expect(onViewportChange).toHaveBeenCalledTimes(callsBeforeCommit + 1);
  view.destroy();
});

it.each(["addTo", "resolver"] as const)(
  "closes the overview once when legacy %s throws before bitmap handoff",
  async (failure) => {
    const element = createMapElement();
    let layerCount = 0;
    const view = createProductionMapView(
      element,
      {
        onViewportChange: vi.fn(),
        onLocationSelect: vi.fn()
      },
      {
        createAtlasLayer(networkPolicy) {
          layerCount += 1;
          const layer = new AtlasLayer({
            networkPolicy,
            contextFactory: () => createTestContext()
          });
          if (failure === "addTo" && layerCount === 2) {
            layer.addTo = (() => {
              throw new Error("mount failed");
            }) as typeof layer.addTo;
          }
          return layer;
        }
      }
    );
    const close = vi.fn();
    const bridgeByUuid = failure === "resolver"
      ? {
          [Symbol.iterator]() {
            throw new Error("resolver failed");
          }
        } as unknown as LegacyAssetBundle["bridgeByUuid"]
      : new Map();
    const bundle: LegacyAssetBundle = {
      assets: new Map(),
      bridgeByUuid,
      poiRules: []
    };

    await expect(view.prepareWorld(
      {
        ...world,
        id: "candidate",
        source: "save",
        seed: 1
      },
      {
        bitmap: { close } as unknown as ImageBitmap,
        width: 1,
        height: 1
      },
      bundle
    )).rejects.toThrow(failure === "addTo" ? "mount failed" : "resolver failed");

    expect(close).toHaveBeenCalledOnce();
    expect(
      element.querySelectorAll("[data-terrain-frame='committed']")
    ).toHaveLength(1);
    view.destroy();
  }
);
