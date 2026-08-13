import type { MapLocation, MapUiState } from "../domain/map-model";
import {
  PLAYER_MARKER_TYPES,
  type PlayerMarker,
  type PlayerMarkerType
} from "../player-markers/player-marker";

const searchLabel = "Search Locations";
const markerFilterHeading = "Player Marker Types";
const resultsHeading = "Location List";
const emptyResults = "No matching locations";
const categoryNames: Record<string, string> = {
  boss: "Boss",
  guide: "Guide",
  poi: "Point of Interest",
  quest: "Quest",
  resource: "Resource"
};
const precisionNames: Record<MapLocation["precision"], string> = {
  exact: "Exact Location",
  "save-exact": "Exact Save Location",
  "area-reference": "Reference Area",
  unknown: "Unknown Location"
};
const playerMarkerTypeNames: Record<PlayerMarkerType, string> = {
  resource: "Resource",
  danger: "Danger",
  base: "Base",
  vehicle: "Vehicle",
  note: "Note"
};

export function getCategoryLabel(categoryId: string): string {
  return categoryNames[categoryId] ?? "Other";
}

export function getPrecisionLabel(precision: MapLocation["precision"]): string {
  return precisionNames[precision];
}

export interface LocationBrowserCallbacks {
  onQueryChange?(query: string): void;
  onSearchReset?(): void;
  onCategoryChange?(categoryIds: string[]): void;
  onPlayerMarkerTypeChange?(typeIds: PlayerMarkerType[]): void;
  onLocationSelect?(locationId: string): void;
  onPlayerMarkerSelect?(markerId: string): void;
}

export interface LocationBrowserRenderInput {
  locations: readonly MapLocation[];
  playerMarkers: readonly PlayerMarker[];
  selectedPlayerMarkerId?: string;
  state?: MapUiState;
}

export interface LocationBrowser {
  render(input: LocationBrowserRenderInput): void;
  destroy(): void;
}

export function createLocationBrowser(
  root: HTMLElement,
  callbacks: LocationBrowserCallbacks
): LocationBrowser {
  const searchId = "location-search";
  const markerFilterId = "player-marker-type-filters";
  root.innerHTML = `
    <form class="location-browser__search" role="search">
      <input id="${searchId}" type="search" inputmode="search" autocomplete="off"
        aria-label="${searchLabel}" placeholder="Search..." />
      <button type="submit" data-search-submit>SEARCH</button>
      <button type="button" data-search-reset aria-label="Reset search" hidden>×</button>
    </form>
    <section class="location-browser__map-layers" data-map-layer-tree></section>
    <fieldset id="${markerFilterId}" class="category-filters player-marker-type-filters">
      <legend>${markerFilterHeading}</legend>
      <div data-player-marker-type-list></div>
    </fieldset>
    <div class="location-results__header">
      <h2>${resultsHeading}</h2>
      <output data-testid="result-count" aria-live="polite"></output>
    </div>
    <div class="location-results" data-location-list></div>
  `;

  const search = root.querySelector<HTMLInputElement>(`#${searchId}`)!;
  const searchForm = root.querySelector<HTMLFormElement>(".location-browser__search")!;
  const searchReset = root.querySelector<HTMLButtonElement>("[data-search-reset]")!;
  const playerMarkerTypeList = root.querySelector<HTMLElement>(
    "[data-player-marker-type-list]"
  )!;
  const resultCount = root.querySelector<HTMLOutputElement>(
    '[data-testid="result-count"]'
  )!;
  const locationList = root.querySelector<HTMLElement>("[data-location-list]")!;

  let committedQuery: string | undefined;
  const syncSearchResetVisibility = () => {
    searchReset.hidden = search.value.length === 0;
  };
  const submitSearch = () => callbacks.onQueryChange?.(search.value);
  const handleSearchSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submitSearch();
  };
  const handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitSearch();
  };
  const handleSearchReset = () => {
    search.value = "";
    syncSearchResetVisibility();
    callbacks.onSearchReset?.();
  };
  const handlePlayerMarkerTypeChange = (event: Event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== "checkbox") {
      return;
    }
    const selected = Array.from(
      playerMarkerTypeList.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]:checked'
      )
    ).map((input) => input.value).sort() as PlayerMarkerType[];
    callbacks.onPlayerMarkerTypeChange?.(selected);
  };
  const handleLocationClick = (event: Event) => {
    const playerMarkerButton = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-player-marker-id]"
    );
    if (playerMarkerButton?.dataset.playerMarkerId) {
      callbacks.onPlayerMarkerSelect?.(playerMarkerButton.dataset.playerMarkerId);
      return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-location-id]"
    );
    if (button?.dataset.locationId) {
      callbacks.onLocationSelect?.(button.dataset.locationId);
    }
  };

  searchForm.addEventListener("submit", handleSearchSubmit);
  search.addEventListener("input", syncSearchResetVisibility);
  search.addEventListener("keydown", handleSearchKeydown);
  searchReset.addEventListener("click", handleSearchReset);
  playerMarkerTypeList.addEventListener("change", handlePlayerMarkerTypeChange);
  locationList.addEventListener("click", handleLocationClick);

  return {
    render({ locations, playerMarkers, selectedPlayerMarkerId, state }) {
      const activeElement = root.ownerDocument.activeElement;
      const focusedPlayerMarkerTypeId =
        activeElement instanceof HTMLInputElement
        && playerMarkerTypeList.contains(activeElement)
          ? activeElement.value
          : undefined;
      const focusedLocationId =
        activeElement instanceof HTMLButtonElement &&
        locationList.contains(activeElement)
          ? activeElement.dataset.locationId
          : undefined;
      const focusedPlayerMarkerId =
        activeElement instanceof HTMLButtonElement && locationList.contains(activeElement)
          ? activeElement.dataset.playerMarkerId
          : undefined;

      if (state && state.query !== committedQuery) {
        search.value = state.query;
        committedQuery = state.query;
        syncSearchResetVisibility();
      }

      const selectedPlayerMarkerTypes = new Set(
        state?.playerMarkerTypeIds ?? PLAYER_MARKER_TYPES
      );
      const playerMarkerTypeFragment = document.createDocumentFragment();
      for (const typeId of PLAYER_MARKER_TYPES) {
        const label = document.createElement("label");
        label.className = "category-filter player-marker-type-filter";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = typeId;
        checkbox.checked = selectedPlayerMarkerTypes.has(typeId);
        const marker = document.createElement("span");
        marker.className = "category-filter__marker";
        marker.dataset.markerType = typeId;
        marker.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = playerMarkerTypeNames[typeId];
        label.append(checkbox, marker, text);
        playerMarkerTypeFragment.append(label);
      }
      playerMarkerTypeList.replaceChildren(playerMarkerTypeFragment);

      const locationFragment = document.createDocumentFragment();
      for (const location of locations) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "location-card";
        button.dataset.locationId = location.id;
        if (location.id === state?.selectedLocationId) {
          button.setAttribute("aria-current", "true");
        }

        const marker = document.createElement("span");
        marker.className = "location-card__marker";
        marker.dataset.category = location.category;
        marker.setAttribute("aria-hidden", "true");

        const copy = document.createElement("span");
        copy.className = "location-card__copy";
        const name = document.createElement("strong");
        name.textContent = location.name;
        const meta = document.createElement("span");
        meta.dataset.precision = location.precision;
        meta.textContent = `${getCategoryLabel(location.category)} \u00b7 ${getPrecisionLabel(location.precision)}`;
        copy.append(name, meta);
        button.append(marker, copy);
        locationFragment.append(button);
      }

      for (const playerMarker of playerMarkers) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "location-card player-marker-card";
        button.dataset.playerMarkerId = playerMarker.id;
        if (playerMarker.id === selectedPlayerMarkerId) {
          button.setAttribute("aria-current", "true");
        }

        const marker = document.createElement("span");
        marker.className = "location-card__marker";
        marker.dataset.markerType = playerMarker.type;
        marker.setAttribute("aria-hidden", "true");

        const copy = document.createElement("span");
        copy.className = "location-card__copy";
        const name = document.createElement("strong");
        name.textContent = playerMarker.name;
        const meta = document.createElement("span");
        meta.textContent = `${playerMarkerTypeNames[playerMarker.type]} \u00b7 Player Marker`;
        copy.append(name, meta);
        button.append(marker, copy);
        locationFragment.append(button);
      }

      const resultTotal = locations.length + playerMarkers.length;
      if (resultTotal === 0) {
        const empty = document.createElement("p");
        empty.className = "location-results__empty";
        empty.textContent = emptyResults;
        locationFragment.append(empty);
      }

      locationList.replaceChildren(locationFragment);
      resultCount.value = playerMarkers.length > 0
        ? `${resultTotal} ${resultTotal === 1 ? "result" : "results"}`
        : `${locations.length} ${locations.length === 1 ? "location" : "locations"}`;
      resultCount.textContent = resultCount.value;

      if (focusedPlayerMarkerTypeId) {
        const nextPlayerMarkerType = Array.from(
          playerMarkerTypeList.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]'
          )
        ).find((input) => input.value === focusedPlayerMarkerTypeId);
        nextPlayerMarkerType?.focus({ preventScroll: true });
      } else if (focusedLocationId) {
        const nextLocation = Array.from(
          locationList.querySelectorAll<HTMLButtonElement>(
            "button[data-location-id]"
          )
        ).find((button) => button.dataset.locationId === focusedLocationId);
        nextLocation?.focus({ preventScroll: true });
      } else if (focusedPlayerMarkerId) {
        const nextPlayerMarker = Array.from(
          locationList.querySelectorAll<HTMLButtonElement>(
            "button[data-player-marker-id]"
          )
        ).find(
          (button) => button.dataset.playerMarkerId === focusedPlayerMarkerId
        );
        nextPlayerMarker?.focus({ preventScroll: true });
      }
    },
    destroy() {
      searchForm.removeEventListener("submit", handleSearchSubmit);
      search.removeEventListener("input", syncSearchResetVisibility);
      search.removeEventListener("keydown", handleSearchKeydown);
      searchReset.removeEventListener("click", handleSearchReset);
      playerMarkerTypeList.removeEventListener("change", handlePlayerMarkerTypeChange);
      locationList.removeEventListener("click", handleLocationClick);
      root.replaceChildren();
    }
  };
}
