import * as L from "leaflet";
import { cellToMapPoint } from "./coordinate-system";
import type { LocationNameInstance } from "./location-name-inventory";

export interface PoiLabelLayer {
  setLocationNames(
    instances: readonly LocationNameInstance[],
    selectedTypeIds: readonly string[]
  ): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function createPoiLabelLayer(map: L.Map): PoiLabelLayer {
  const layer = L.layerGroup();
  let visible = false;
  let instances: readonly LocationNameInstance[] = [];
  let selectedTypeIds = new Set<string>();

  function render(): void {
    layer.clearLayers();
    const rendered = new Set<string>();

    for (const instance of instances) {
      if (!selectedTypeIds.has(instance.typeId)) continue;
      const point = cellToMapPoint(instance.position);
      const key = `${instance.label}\u0000${point.x}\u0000${point.y}`;
      if (rendered.has(key)) continue;
      rendered.add(key);
      L.marker([point.y, point.x], {
        icon: L.divIcon({
          className: "poi-place-label-icon",
          html: `<span class="poi-place-label"><span class="poi-place-marker" aria-hidden="true"></span>${escapeHtml(instance.label)}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        interactive: false,
        keyboard: false
      }).addTo(layer);
    }
  }

  return {
    setLocationNames(nextInstances, nextSelectedTypeIds) {
      instances = [...nextInstances];
      selectedTypeIds = new Set(nextSelectedTypeIds);
      render();
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      if (visible && !map.hasLayer(layer)) {
        layer.addTo(map);
      } else if (!visible && map.hasLayer(layer)) {
        layer.removeFrom(map);
      }
    },
    destroy() {
      if (map.hasLayer(layer)) {
        layer.removeFrom(map);
      }
      layer.clearLayers();
    }
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]!
  );
}
