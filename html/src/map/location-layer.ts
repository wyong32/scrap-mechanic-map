import * as L from "leaflet";
import type { MapLocation } from "../domain/map-model";
import {
  cellBoundsToMapPointBounds,
  cellToMapPoint,
  type MapPoint
} from "./coordinate-system";

interface LocationMarker {
  location: MapLocation;
  marker: L.Marker;
}

const mapLocationLabel = "Map location";

export interface LocationLayer {
  setLocations(locations: MapLocation[]): void;
  selectLocation(
    locationId?: string,
    options?: LocationSelectionOptions
  ): void;
  setCategoryVisibility(categoryId: string, visible: boolean): void;
  destroy(): void;
}

export interface LocationSelectionOptions {
  focus?: boolean;
}

export function createLocationLayer(
  map: L.Map,
  onLocationSelect: (locationId: string) => void
): LocationLayer {
  const categoryLayers = new Map<string, L.LayerGroup>();
  const categoryVisibility = new Map<string, boolean>();
  const markers = new Map<string, LocationMarker>();
  let selectedLocationId: string | undefined;

  const ensureCategoryLayer = (categoryId: string): L.LayerGroup => {
    const existing = categoryLayers.get(categoryId);
    if (existing) {
      return existing;
    }

    const layer = L.layerGroup();
    categoryLayers.set(categoryId, layer);
    if (categoryVisibility.get(categoryId) !== false) {
      layer.addTo(map);
    }
    return layer;
  };

  const updateMarkerSelection = () => {
    for (const [locationId, { marker }] of markers) {
      marker
        .getElement()
        ?.querySelector("button")
        ?.setAttribute("aria-pressed", String(locationId === selectedLocationId));
    }
  };

  const fitLocationBounds = (location: MapLocation) => {
    if (!location.bounds) {
      return;
    }

    map.fitBounds(toLeafletBounds(location.bounds), { animate: false });
  };

  const selectLocation = (
    locationId?: string,
    options: LocationSelectionOptions = {}
  ) => {
    selectedLocationId = locationId;
    updateMarkerSelection();
    const location = locationId ? markers.get(locationId)?.location : undefined;
    if (location && options.focus !== false) {
      fitLocationBounds(location);
    }
  };

  return {
    setLocations(locations) {
      const activeElement = map.getContainer().ownerDocument.activeElement;
      const focusedMarkerId =
        activeElement instanceof HTMLElement
          ? activeElement.closest<HTMLElement>("[data-map-location-id]")?.dataset
              .mapLocationId
          : undefined;

      for (const layer of categoryLayers.values()) {
        layer.clearLayers();
      }
      markers.clear();

      for (const location of locations) {
        const anchor = getLocationAnchor(location);
        if (!anchor) {
          continue;
        }

        const marker = L.marker(toLeafletPoint(anchor), {
          icon: L.divIcon({
            className: "map-location-icon",
            html: markerButtonMarkup(location),
            iconSize: [40, 40],
            iconAnchor: [20, 20]
          }),
          keyboard: false,
          title: location.name
        });
        marker.on("click", () => {
          selectLocation(location.id);
          onLocationSelect(location.id);
        });
        marker.addTo(ensureCategoryLayer(location.category));
        markers.set(location.id, { location, marker });
      }

      selectLocation(selectedLocationId, { focus: false });
      if (focusedMarkerId) {
        const nextMarker = Array.from(
          map
            .getContainer()
            .querySelectorAll<HTMLElement>("[data-map-location-id]")
        ).find(
          (markerElement) =>
            markerElement.dataset.mapLocationId === focusedMarkerId
        );
        if (nextMarker) {
          nextMarker.focus({ preventScroll: true });
        } else {
          map.getContainer().focus({ preventScroll: true });
        }
      }
    },
    selectLocation,
    setCategoryVisibility(categoryId, visible) {
      categoryVisibility.set(categoryId, visible);
      const layer = categoryLayers.get(categoryId);
      if (!layer) {
        return;
      }

      if (visible && !map.hasLayer(layer)) {
        layer.addTo(map);
        updateMarkerSelection();
      } else if (!visible && map.hasLayer(layer)) {
        layer.removeFrom(map);
      }
    },
    destroy() {
      for (const layer of categoryLayers.values()) {
        layer.removeFrom(map);
        layer.clearLayers();
      }
      categoryLayers.clear();
      markers.clear();
    }
  };
}

function getLocationAnchor(location: MapLocation): MapPoint | undefined {
  if (location.position) {
    return cellToMapPoint(location.position);
  }
  if (!location.bounds) {
    return undefined;
  }

  const bounds = cellBoundsToMapPointBounds(location.bounds);
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2
  };
}

function toLeafletPoint(point: MapPoint): L.LatLngTuple {
  return [point.y, point.x];
}

function toLeafletBounds(
  bounds: NonNullable<MapLocation["bounds"]>
): L.LatLngBoundsExpression {
  const points = cellBoundsToMapPointBounds(bounds);
  return [toLeafletPoint(points.min), toLeafletPoint(points.max)];
}

function markerButtonMarkup(location: MapLocation): string {
  const name = escapeHtml(location.name);
  const category = escapeHtml(location.category);
  const locationId = escapeHtml(location.id);

  return `<button class="map-location-marker" type="button"
    data-map-location-id="${locationId}" aria-pressed="false"
    aria-label="${mapLocationLabel}: ${name}">
    <span class="map-location-marker__icon" aria-hidden="true">&#8982;</span>
    <span class="location-card__marker" data-category="${category}"
      aria-hidden="true"></span>
    <span class="visually-hidden">${mapLocationLabel}: ${name}</span>
  </button>`;
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
