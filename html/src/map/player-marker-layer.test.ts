import * as L from "leaflet";
import { afterEach, expect, it, vi } from "vitest";
import type { PlayerMarker } from "../player-markers/player-marker";
import { createPlayerMarkerLayer } from "./player-marker-layer";

interface LeafletContainer extends HTMLElement {
  _leaflet_id?: number;
}

const resourceMarker: PlayerMarker = {
  id: "marker-1",
  mapScopeId: "save:surface:42",
  regionId: "surface",
  position: { x: 2, y: -3 },
  name: "Cotton field",
  type: "resource",
  notes: "Return after the next harvest.",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z"
};

const mountedMaps: Array<{ container: LeafletContainer; map: L.Map }> = [];

function createMap(): { container: LeafletContainer; map: L.Map } {
  const container = document.createElement("div") as LeafletContainer;
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 }
  });
  document.body.append(container);
  const map = L.map(container, {
    crs: L.CRS.Simple,
    zoomControl: false,
    attributionControl: false
  });
  map.setView([0, 0], 0);
  mountedMaps.push({ container, map });
  return { container, map };
}

afterEach(() => {
  for (const { container, map } of mountedMaps.splice(0)) {
    map.remove();
    container.remove();
  }
});

it("renders typed player icons and toggles names independently", () => {
  const { container, map } = createMap();
  const layer = createPlayerMarkerLayer(map, vi.fn());
  layer.setMarkers([resourceMarker]);
  layer.setVisible(true);

  const button = container.querySelector<HTMLButtonElement>(
    '[data-player-marker-id="marker-1"]'
  );
  expect(button).not.toBeNull();
  expect(button?.dataset.markerType).toBe("resource");
  expect(button?.type).toBe("button");
  expect(button?.getAttribute("aria-label")).toBe(
    "Player marker: Cotton field"
  );
  expect(container.querySelector(".player-marker__name")).toBeNull();

  const markerElement = button?.closest<HTMLElement>(".leaflet-marker-icon");
  const expectedPoint = map.latLngToLayerPoint([-3 * 64, 2 * 64]);
  expect(markerElement?.getAttribute("style")).toContain(
    `left: ${expectedPoint.x}px`
  );
  expect(markerElement?.getAttribute("style")).toContain(
    `top: ${expectedPoint.y}px`
  );

  layer.setLabelsVisible(true);
  expect(container.querySelector(".player-marker__name")?.textContent).toBe(
    "Cotton field"
  );
});

it("escapes marker names and reports selection from the accessible button", () => {
  const { container, map } = createMap();
  const onSelect = vi.fn();
  const layer = createPlayerMarkerLayer(map, onSelect);
  const unsafeName = '<img src=x onerror="alert(1)">';
  layer.setMarkers([{ ...resourceMarker, name: unsafeName }]);
  layer.setLabelsVisible(true);
  layer.setVisible(true);

  const button = container.querySelector<HTMLButtonElement>(
    '[data-player-marker-id="marker-1"]'
  )!;
  expect(button.textContent).toContain(unsafeName);
  expect(button.querySelector("img")).toBeNull();
  expect(button.getAttribute("aria-pressed")).toBe("false");

  button.click();
  expect(onSelect).toHaveBeenCalledWith("marker-1");

  layer.selectMarker("marker-1");
  expect(
    container.querySelector('[data-player-marker-id="marker-1"]')
      ?.getAttribute("aria-pressed")
  ).toBe("true");
});

it("remembers label and selection state while marker icons are hidden", () => {
  const { container, map } = createMap();
  const layer = createPlayerMarkerLayer(map, vi.fn());
  layer.setMarkers([resourceMarker]);
  layer.setLabelsVisible(true);
  layer.selectMarker("marker-1");

  expect(container.querySelector("[data-player-marker-id]")).toBeNull();

  layer.setVisible(true);
  expect(container.querySelector(".player-marker__name")?.textContent).toBe(
    "Cotton field"
  );
  expect(
    container.querySelector('[data-player-marker-id="marker-1"]')
      ?.getAttribute("aria-pressed")
  ).toBe("true");

  layer.destroy();
  expect(container.querySelector("[data-player-marker-id]")).toBeNull();
});
