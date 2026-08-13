import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { MapLocation, WorldMap } from "../domain/map-model";
import { AtlasLayer, type AtlasNetworkPolicy } from "../map/atlas-layer";
import { createMapView } from "../map/map-view";
import { renderStartupError } from "./startup-error";

afterEach(() => {
  document.body.replaceChildren();
});

it("declares English document metadata", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

  expect(html).toContain('<html lang="en">');
  expect(html).toContain("<title>Scrap Mechanic Map</title>");
  expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});

it("renders an English startup failure", () => {
  const root = document.createElement("div");
  document.body.append(root);

  renderStartupError(root, undefined);

  expect(root.textContent).toBe(
    "The map could not start. Please try again in a browser that supports Canvas 2D."
  );
  expect(root.textContent).not.toMatch(/[\u3400-\u9fff]/u);
});

it("renders English map marker, alternative, and failure copy", () => {
  const host = document.createElement("section");
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 }
  });
  host.append(element);
  document.body.append(host);
  const view = createMapView(
    element,
    {
      onViewportChange: vi.fn(),
      onLocationSelect: vi.fn(),
      onPlayerMarkerSelect: vi.fn(),
      onMarkerPlacement: vi.fn()
    },
    {
      createAtlasLayer(networkPolicy: AtlasNetworkPolicy) {
        return new AtlasLayer({
          networkPolicy,
          contextFactory: () => ({
            clearRect() {},
            fillRect() {},
            fillText() {},
            drawImage() {}
          } as unknown as CanvasRenderingContext2D)
        });
      }
    }
  );
  view.setWorld(referenceWorld);
  view.setLocations([mechanicStation]);
  element.dispatchEvent(new CustomEvent("atlas-error", { detail: "404" }));

  const marker = element.querySelector<HTMLElement>("[data-map-location-id]")!;
  const renderedCopy = [
    marker.getAttribute("aria-label"),
    marker.querySelector(".visually-hidden")?.textContent,
    element.querySelector<HTMLImageElement>(".reference-surface-backdrop")
      ?.getAttribute("alt"),
    host.querySelector("[data-atlas-error]")?.textContent
  ];
  expect(renderedCopy).toEqual([
    "Map location: Mechanic Station",
    "Map location: Mechanic Station",
    "Authentic default Scrap Mechanic 1.0 surface map; select a save to display its personal layout",
    "Terrain atlas unavailable: 404. Check the atlas files and try again."
  ]);
  expect(renderedCopy.join(" ")).not.toMatch(/[\u3400-\u9fff]/u);

  view.destroy();
});

const referenceWorld: WorldMap = {
  id: "reference-surface",
  source: "reference",
  gameVersion: "1.0.0",
  bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
  cells: [],
  locations: [],
  connections: []
};

const mechanicStation: MapLocation = {
  id: "mechanic-station",
  regionId: "surface",
  name: "Mechanic Station",
  category: "poi",
  precision: "exact",
  position: { x: 0, y: 0 },
  questIds: [],
  resourceIds: [],
  enemyIds: [],
  relatedRegionIds: []
};
