import * as L from "leaflet";
import { expect, it } from "vitest";
import type { LocationNameInstance } from "./location-name-inventory";
import { createPoiLabelLayer } from "./poi-label-layer";

interface LeafletContainer extends HTMLElement {
  _leaflet_id?: number;
}

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
  return { container, map };
}

function instance(
  id: string,
  typeId: string,
  label: string,
  position: { x: number; y: number }
): LocationNameInstance {
  return {
    id,
    source: typeId.startsWith("fixed:") ? "fixed-story" : "generated",
    typeId,
    label,
    position
  };
}

it("renders only the selected public location types", () => {
  const { container, map } = createMap();
  const layer = createPoiLabelLayer(map);
  const instances = [
    instance("warehouse-a", "generated:warehouse", "Warehouse", { x: 1, y: 2 }),
    instance("warehouse-b", "generated:warehouse", "Warehouse", { x: 4, y: 5 }),
    instance(
      "mechanic-station",
      "fixed:mechanic-station",
      "Mechanic Station",
      { x: 8, y: 9 }
    )
  ];
  layer.setLocationNames(instances, ["generated:warehouse"]);

  expect(container.querySelector(".poi-place-label")).toBeNull();
  layer.setVisible(true);
  expect(
    Array.from(container.querySelectorAll(".poi-place-label"), (label) =>
      label.textContent
    )
  ).toEqual(["Warehouse", "Warehouse"]);

  layer.setLocationNames(instances, ["fixed:mechanic-station"]);
  expect(
    Array.from(container.querySelectorAll(".poi-place-label"), (label) =>
      label.textContent
    )
  ).toEqual(["Mechanic Station"]);

  layer.setLocationNames(instances, []);
  expect(container.querySelectorAll(".poi-place-label")).toHaveLength(0);

  layer.destroy();
  map.remove();
  container.remove();
});

it("creates centered non-interactive labels from selected instances", () => {
  const { container, map } = createMap();
  const layer = createPoiLabelLayer(map);
  layer.setLocationNames([
    instance("warehouse-a", "generated:warehouse", "Warehouse", { x: 1, y: 2 })
  ], ["generated:warehouse"]);

  expect(container.querySelector(".poi-place-label")).toBeNull();

  layer.setVisible(true);
  const labels = container.querySelectorAll(".poi-place-label");
  expect(labels).toHaveLength(1);
  expect(labels[0]?.textContent).toBe("Warehouse");
  expect(labels[0]?.querySelector(".poi-place-marker")).not.toBeNull();
  const marker = labels[0]?.closest(".leaflet-marker-icon");
  expect(marker?.classList.contains("leaflet-interactive")).toBe(false);
  expect(marker?.getAttribute("tabindex")).toBeNull();

  const markerPoint = map.latLngToLayerPoint([2 * 64, 1 * 64]);
  expect(marker?.getAttribute("style")).toContain(`left: ${markerPoint.x}px`);
  expect(marker?.getAttribute("style")).toContain(`top: ${markerPoint.y}px`);

  layer.destroy();
  map.remove();
  container.remove();
});

it("escapes label text before inserting it into marker HTML", () => {
  const { container, map } = createMap();
  const layer = createPoiLabelLayer(map);
  const unsafeName = "<img src=x onerror=alert(1)>";
  layer.setLocationNames([
    instance("unsafe", "generated:warehouse", unsafeName, { x: 0, y: 0 })
  ], ["generated:warehouse"]);
  layer.setVisible(true);

  expect(container.querySelector(".poi-place-label")?.textContent).toBe(
    unsafeName
  );
  expect(container.querySelector(".poi-place-label img")).toBeNull();

  layer.destroy();
  map.remove();
  container.remove();
});

it("keeps duplicate selected names unnumbered and restores them after hiding", () => {
  const { container, map } = createMap();
  const layer = createPoiLabelLayer(map);
  layer.setLocationNames([
    instance("warehouse-a", "generated:warehouse", "Warehouse", { x: 0, y: 0 }),
    instance("warehouse-b", "generated:warehouse", "Warehouse", { x: 3, y: 3 })
  ], ["generated:warehouse"]);
  layer.setVisible(true);

  expect(
    Array.from(container.querySelectorAll(".poi-place-label"), (label) =>
      label.textContent
    )
  ).toEqual(["Warehouse", "Warehouse"]);
  expect(container.textContent).not.toContain("#");

  layer.setVisible(false);
  expect(container.querySelector(".poi-place-label")).toBeNull();
  layer.setVisible(true);
  expect(container.querySelectorAll(".poi-place-label")).toHaveLength(2);

  layer.destroy();
  map.remove();
  container.remove();
});
