import { afterEach, expect, it } from "vitest";
import type { MapRepository, RegionDefinition, WorldMap } from "../domain/map-model";
import type { MapView, MapViewport } from "../map/map-view";
import { startApp, type AppController } from "./app-controller";

const region: RegionDefinition = {
  id: "surface",
  name: "Surface",
  group: "surface",
  source: "reference",
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }
};

class WarehouseRepository implements MapRepository {
  async loadRegions(): Promise<RegionDefinition[]> {
    return [region];
  }

  async loadLocations() {
    return [];
  }

  async loadWorld(): Promise<WorldMap> {
    return {
      id: "surface",
      source: "reference",
      gameVersion: "1.0.0",
      bounds: region.bounds,
      cells: [{
        x: 0,
        y: 0,
        uuid: "warehouse-fixture",
        rotation: 0,
        xOffset: 0,
        yOffset: 0,
        flags: 0,
        terrainType: "warehouse",
        poiType: "POI_WAREHOUSE2_LARGE"
      }],
      locations: [],
      connections: []
    };
  }
}

let controller: AppController | undefined;

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

it("preserves Player Marker Names while migrating legacy labels to location types", async () => {
  window.history.replaceState(null, "", "/?layers=labels");
  document.body.innerHTML = '<div id="app"></div>';
  controller = await startApp(document.querySelector("#app")!, new WarehouseRepository(), {
    createMapView: createNoopMapView,
    createSaveParser: async () => idleSaveClient
  });

  expect(layer("labels").checked).toBe(true);
  expect(locationType().checked).toBe(true);
  expect(new URL(window.location.href).searchParams.get("layers")).toBe("labels");
  expect(new URL(window.location.href).searchParams.get("locationTypes"))
    .toBe("generated:warehouse");

  locationType().click();

  expect(layer("labels").checked).toBe(true);
  expect(new URL(window.location.href).searchParams.get("layers")).toBe("labels");
  expect(new URL(window.location.href).searchParams.has("locationTypes")).toBe(false);
});

it("round-trips Player Marker Names without changing selected location types", async () => {
  window.history.replaceState(
    null,
    "",
    "/?layers=labels&locationTypes=generated%3Awarehouse"
  );
  document.body.innerHTML = '<div id="app"></div>';
  controller = await startApp(document.querySelector("#app")!, new WarehouseRepository(), {
    createMapView: createNoopMapView,
    createSaveParser: async () => idleSaveClient
  });

  layer("labels").click();
  expect(locationType().checked).toBe(true);
  expect(new URL(window.location.href).searchParams.has("layers")).toBe(false);
  expect(new URL(window.location.href).searchParams.get("locationTypes"))
    .toBe("generated:warehouse");

  layer("labels").click();
  expect(locationType().checked).toBe(true);
  expect(new URL(window.location.href).searchParams.get("layers")).toBe("labels");
  expect(new URL(window.location.href).searchParams.get("locationTypes"))
    .toBe("generated:warehouse");
});

function createNoopMapView(): MapView {
  const viewport: MapViewport = { center: { x: 0, y: 0 }, zoom: 0 };
  return {
    setWorld() {},
    async prepareWorld(world) {
      return {
        world,
        generation: 0,
        coverage: {
          totalCells: 0,
          legacyImageCells: 0,
          oneDotZeroImageCells: 0,
          fallbackCells: 0,
          distinctFallbackUuids: 0
        }
      };
    },
    async commitPreparedWorld() {},
    discardPreparedWorld() {},
    setViewport(nextViewport) {
      viewport.center = { ...nextViewport.center };
      viewport.zoom = nextViewport.zoom;
    },
    setLocations() {},
    setLocationNames() {},
    selectLocation() {},
    setPlayerMarkers() {},
    selectPlayerMarker() {},
    setMarkerPlacementMode() {},
    setLayerVisibility() {},
    zoomIn() {},
    zoomOut() {},
    resetView() {},
    getViewport() {
      return { center: { ...viewport.center }, zoom: viewport.zoom };
    },
    destroy() {}
  };
}

const idleSaveClient = {
  async parseSave() {
    throw new Error("Unexpected save parse");
  },
  cancel() {},
  dispose() {}
};

function layer(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`input[data-layer-id="${id}"]`)!;
}

function locationType(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(
    "input[data-location-type-id='generated:warehouse']"
  )!;
}
