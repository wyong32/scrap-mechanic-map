import * as L from "leaflet";
import type {
  PlayerMarker,
  PlayerMarkerType
} from "../player-markers/player-marker";
import { cellToMapPoint } from "./coordinate-system";

export interface PlayerMarkerLayer {
  setMarkers(markers: readonly PlayerMarker[]): void;
  setVisible(visible: boolean): void;
  setLabelsVisible(visible: boolean): void;
  selectMarker(markerId?: string): void;
  destroy(): void;
}

const markerGlyphs: Record<PlayerMarkerType, string> = {
  resource: "◆",
  danger: "!",
  base: "⌂",
  vehicle: "▰",
  note: "●"
};

export function createPlayerMarkerLayer(
  map: L.Map,
  onMarkerSelect: (markerId: string) => void
): PlayerMarkerLayer {
  const layer = L.layerGroup();
  let markers: readonly PlayerMarker[] = [];
  let visible = false;
  let labelsVisible = false;
  let selectedMarkerId: string | undefined;

  const updateSelection = () => {
    for (const button of map
      .getContainer()
      .querySelectorAll<HTMLButtonElement>("[data-player-marker-id]")) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playerMarkerId === selectedMarkerId)
      );
    }
  };

  const selectMarker = (markerId?: string) => {
    selectedMarkerId = markerId;
    updateSelection();
  };

  const render = () => {
    layer.clearLayers();
    for (const playerMarker of markers) {
      const point = cellToMapPoint(playerMarker.position);
      const marker = L.marker([point.y, point.x], {
        icon: L.divIcon({
          className: "player-marker-icon",
          html: markerButtonMarkup(
            playerMarker,
            labelsVisible,
            playerMarker.id === selectedMarkerId
          ),
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        }),
        keyboard: false,
        title: playerMarker.name
      });
      marker.on("click", () => {
        selectMarker(playerMarker.id);
        onMarkerSelect(playerMarker.id);
      });
      marker.addTo(layer);
    }
  };

  return {
    setMarkers(nextMarkers) {
      markers = [...nextMarkers];
      render();
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      if (visible && !map.hasLayer(layer)) {
        layer.addTo(map);
        updateSelection();
      } else if (!visible && map.hasLayer(layer)) {
        layer.removeFrom(map);
      }
    },
    setLabelsVisible(nextVisible) {
      if (labelsVisible === nextVisible) return;
      labelsVisible = nextVisible;
      render();
    },
    selectMarker,
    destroy() {
      if (map.hasLayer(layer)) {
        layer.removeFrom(map);
      }
      layer.clearLayers();
      markers = [];
      selectedMarkerId = undefined;
    }
  };
}

function markerButtonMarkup(
  marker: PlayerMarker,
  labelsVisible: boolean,
  selected: boolean
): string {
  const markerId = escapeHtml(marker.id);
  const markerType = escapeHtml(marker.type);
  const name = escapeHtml(marker.name);
  const label = `Player marker: ${name}`;
  const markerName = labelsVisible
    ? `<span class="player-marker__name">${name}</span>`
    : "";

  return `<button class="player-marker" type="button"
    data-player-marker-id="${markerId}" data-marker-type="${markerType}"
    aria-label="${label}" aria-pressed="${String(selected)}">
    <span class="player-marker__icon" aria-hidden="true">${markerGlyphs[marker.type]}</span>
    ${markerName}
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
