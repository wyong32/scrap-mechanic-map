import {
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  type MapLocation,
  type MapUiState,
  type RegionDefinition
} from "../domain/map-model";
import {
  createLocationBrowser,
  type LocationBrowser,
  type LocationBrowserRenderInput
} from "../components/location-browser";
import {
  createMapLayerTree,
  type MapLayerTree,
  type MapLayerTreeRenderInput
} from "../components/map-layer-tree";
import {
  createLocationDetails,
  type LocationDetails
} from "../components/location-details";
import {
  createPlayerMarkerEditor,
  type PlayerMarkerEditor
} from "../components/player-marker-editor";
import {
  createRegionSelector,
  type RegionSelector
} from "../components/region-selector";
import { createSaveEntry, type SaveEntry } from "../components/save-entry";
import type { TerrainCoverageSummary } from "../components/terrain-coverage";
import type {
  PlayerMarker,
  PlayerMarkerDraft,
  PlayerMarkerType
} from "../player-markers/player-marker";

const atlasHeading = "Scrap Mechanic Map";
const atlasKicker = "SCRAP MECHANIC 1.0";
const baseMap = "Base Map";
const saveMap = "Personal Map";
const regionNavigation = "Region Selection";
const locationBrowserLabel = "Location Browser";
const interactiveMap = "Interactive Map";
const locationDetailsLabel = "Location Details";
const openFilters = "Open Location Filters";
const closeFilters = "Close Location Filters";
const exitSaveMode = "Exit Personal Map";
const mapPlaceholder = "Map Canvas";
const mapViewport = "Map View Controls";
const zoomIn = "Zoom In";
const zoomOut = "Zoom Out";
const resetView = "Reset View";
const developmentHeading = "Under Development";
const developmentMessage = "This region map is not available yet.";
export interface AppCallbacks {
  onRegionChange?(regionId: string): void;
  onQueryChange?(query: string): void;
  onSearchReset?(): void;
  onCategoryChange?(categoryIds: string[]): void;
  onPlayerMarkerTypeChange?(typeIds: PlayerMarkerType[]): void;
  onLayerChange?(layerIds: string[]): void;
  onLocationTypeChange?(typeIds: string[]): void;
  onLocationSelect?(locationId: string): void;
  onPlayerMarkerSelect?(markerId: string): void;
  onZoomIn?(): void;
  onZoomOut?(): void;
  onResetView?(): void;
  onAddMarker?(): void;
  onCancelMarker?(): void;
  onSaveMarker?(value: PlayerMarkerDraft | PlayerMarker): void;
  onEditMarker?(marker: PlayerMarker): void;
  onDeleteMarker?(marker: PlayerMarker): void;
  onSaveSelect?(file: File): void;
  onExitSaveMode?(): void;
}

export type AppMode = "base" | "reference" | "save" | "personalized";
export interface PersonalModeSummary {
  seed: number;
  saveVersion: number;
  coverage?: TerrainCoverageSummary;
}

export interface AppShell {
  renderRegions(
    regions: RegionDefinition[],
    selectedRegionId?: string,
    options?: { focusSelected?: boolean }
  ): void;
  renderLocations(
    input: MapLocation[] | LocationBrowserRenderInput,
    state?: MapUiState
  ): void;
  renderDetails(location?: MapLocation): void;
  renderPlayerMarkerDraft(draft: PlayerMarkerDraft): void;
  renderPlayerMarker(
    marker?: PlayerMarker,
    options?: { focus?: boolean | "sidebar" }
  ): void;
  renderPlayerMarkerEdit(marker: PlayerMarker): void;
  renderMapLayerTree(input: MapLayerTreeRenderInput): void;
  renderMapControls(state: MapUiState): void;
  setRegionContentMode(mode: "map" | "under-development"): void;
  setMarkerPlacementMode(enabled: boolean): void;
  setPlayerMarkerActionsDisabled(disabled: boolean): void;
  setMarkerEditorError(message: string): void;
  setMode(mode: AppMode, fileName?: string, summary?: PersonalModeSummary): void;
  setStatus(message: string): void;
  destroy(): void;
}

export function createAppShell(
  root: HTMLElement,
  callbacks: AppCallbacks,
  options?: { saveImportEnabled?: boolean }
): AppShell {
  const saveImportEnabled = options?.saveImportEnabled === true;
  const saveModeReadout = saveImportEnabled
    ? `
            <span class="mode-file" data-mode-file hidden></span>
            <span class="mode-meta" data-mode-meta hidden></span>`
    : "";
  const saveExitControl = saveImportEnabled
    ? `<button class="exit-save-button" type="button" hidden>${exitSaveMode}</button>`
    : "";
  const saveEntryControl = saveImportEnabled
    ? `<section class="save-entry" data-save-entry></section>
        <button class="mobile-exit-save-button" type="button"
          data-mobile-exit-save hidden>${exitSaveMode}</button>`
    : "";
  root.innerHTML = `
    <main class="app-shell" data-app-mode="base">
      <header class="topbar">
        <div class="brand-lockup">
          <span class="brand-lockup__kicker">${atlasKicker}</span>
          <h1>${atlasHeading}</h1>
        </div>
        <nav class="region-selector" aria-label="${regionNavigation}" data-region-selector></nav>
        <div class="topbar__actions">
          <button class="filter-toggle" type="button" aria-expanded="false"
            aria-controls="location-panel">${openFilters}</button>
          <div class="mode-readout">
            <span class="mode-badge" data-mode-badge>${baseMap}</span>
            ${saveModeReadout}
          </div>
          ${saveExitControl}
        </div>
      </header>
      <aside class="location-panel" id="location-panel" aria-label="${locationBrowserLabel}"
        data-open="false">
        <div class="panel-heading">
          <span aria-hidden="true">01</span>
          <strong>${locationBrowserLabel}</strong>
          <button class="drawer-close" type="button">${closeFilters}</button>
        </div>
        <nav class="mobile-region-selector" aria-label="${regionNavigation}"
          data-mobile-region-selector></nav>
        <div class="location-browser" data-location-browser></div>
        ${saveEntryControl}
      </aside>
      <section id="map" class="map-panel" role="region" aria-label="${interactiveMap}"
        tabindex="0">
        <div class="map-panel__grid" data-coordinate-grid aria-hidden="true"></div>
        <span class="map-panel__label">${mapPlaceholder}</span>
        <div class="map-controls" data-map-controls>
          <div class="map-viewport-controls" role="group" aria-label="${mapViewport}">
            <button type="button" data-map-zoom-in aria-label="${zoomIn}">+</button>
            <button type="button" data-map-zoom-out aria-label="${zoomOut}">\u2212</button>
            <button type="button" data-map-reset>${resetView}</button>
            <button type="button" data-marker-add>Add Marker</button>
            <output data-map-readout aria-live="polite"></output>
          </div>
        </div>
      </section>
      <aside class="detail-panel" aria-label="${locationDetailsLabel}"
        data-location-details tabindex="-1"></aside>
      <section class="region-development" data-region-development hidden>
        <div class="region-development__content">
          <span class="region-development__eyebrow">REGION MAP</span>
          <h2>${developmentHeading}</h2>
          <p>${developmentMessage}</p>
        </div>
      </section>
      <button class="drawer-backdrop" type="button" aria-label="${closeFilters}"
        tabindex="-1"></button>
      <div class="status-readout" aria-live="polite" aria-atomic="true"
        data-status></div>
    </main>
  `;

  const shell = root.querySelector<HTMLElement>(".app-shell")!;
  const regionRoot = root.querySelector<HTMLElement>("[data-region-selector]")!;
  const mobileRegionRoot = root.querySelector<HTMLElement>(
    "[data-mobile-region-selector]"
  )!;
  const browserRoot = root.querySelector<HTMLElement>("[data-location-browser]")!;
  const detailsRoot = root.querySelector<HTMLElement>("[data-location-details]")!;
  const locationPanel = root.querySelector<HTMLElement>("#location-panel")!;
  const filterToggle = root.querySelector<HTMLButtonElement>(".filter-toggle")!;
  const drawerClose = root.querySelector<HTMLButtonElement>(".drawer-close")!;
  const drawerBackdrop = root.querySelector<HTMLButtonElement>(".drawer-backdrop")!;
  const modeBadge = root.querySelector<HTMLElement>("[data-mode-badge]")!;
  const modeFile = root.querySelector<HTMLElement>("[data-mode-file]");
  const modeMeta = root.querySelector<HTMLElement>("[data-mode-meta]");
  const exitSaveButton = root.querySelector<HTMLButtonElement>(".exit-save-button");
  const mobileExitSaveButton = root.querySelector<HTMLButtonElement>(
    "[data-mobile-exit-save]"
  );
  const mapControls = root.querySelector<HTMLElement>("[data-map-controls]")!;
  const zoomInButton = root.querySelector<HTMLButtonElement>(
    "[data-map-zoom-in]"
  )!;
  const zoomOutButton = root.querySelector<HTMLButtonElement>(
    "[data-map-zoom-out]"
  )!;
  const resetViewButton = root.querySelector<HTMLButtonElement>(
    "[data-map-reset]"
  )!;
  const addMarkerButton = root.querySelector<HTMLButtonElement>(
    "[data-marker-add]"
  )!;
  const mapPanel = root.querySelector<HTMLElement>("#map")!;
  const mapReadout = root.querySelector<HTMLOutputElement>(
    "[data-map-readout]"
  )!;
  const status = root.querySelector<HTMLElement>("[data-status]")!;
  const regionDevelopment = root.querySelector<HTMLElement>(
    "[data-region-development]"
  )!;
  const mobileViewport = window.matchMedia?.("(max-width: 759px)");
  const regionNames = new Map<string, string>();
  let selectedLocation: MapLocation | undefined;
  let markerPlacementMode = false;
  let regionContentMode: "map" | "under-development" = "map";
  let markerEditorMode: "official" | "empty" | "draft" | "view" | "edit" =
    "official";

  const syncDrawerAccessibility = () => {
    const hiddenFromMobileAccess =
      regionContentMode === "under-development"
      || (Boolean(mobileViewport?.matches) && locationPanel.dataset.open !== "true");
    locationPanel.inert = hiddenFromMobileAccess;
    locationPanel.toggleAttribute("inert", hiddenFromMobileAccess);
    if (hiddenFromMobileAccess) {
      locationPanel.setAttribute("aria-hidden", "true");
    } else {
      locationPanel.removeAttribute("aria-hidden");
    }
  };
  const setDrawerOpen = (open: boolean) => {
    locationPanel.dataset.open = String(open);
    shell.dataset.drawerOpen = String(open);
    filterToggle.setAttribute("aria-expanded", String(open));
    syncDrawerAccessibility();
  };
  const handleLocationSelect = (locationId: string) => {
    callbacks.onLocationSelect?.(locationId);
    if (mobileViewport?.matches) {
      setDrawerOpen(false);
      detailsRoot.focus({ preventScroll: true });
    }
  };
  const handlePlayerMarkerSelect = (markerId: string) => {
    callbacks.onPlayerMarkerSelect?.(markerId);
    if (mobileViewport?.matches) {
      setDrawerOpen(false);
      detailsRoot.focus({ preventScroll: true });
    }
  };
  const regionSelector: RegionSelector = createRegionSelector(
    regionRoot,
    callbacks.onRegionChange
  );
  const mobileRegionSelector: RegionSelector = createRegionSelector(
    mobileRegionRoot,
    callbacks.onRegionChange
  );
  const locationBrowser: LocationBrowser = createLocationBrowser(browserRoot, {
    onQueryChange: callbacks.onQueryChange,
    onSearchReset: callbacks.onSearchReset,
    onCategoryChange: callbacks.onCategoryChange,
    onPlayerMarkerTypeChange: callbacks.onPlayerMarkerTypeChange,
    onLocationSelect: handleLocationSelect,
    onPlayerMarkerSelect: handlePlayerMarkerSelect
  });
  const mapLayerTreeRoot = root.querySelector<HTMLElement>("[data-map-layer-tree]")!;
  const mapLayerTree: MapLayerTree = createMapLayerTree(mapLayerTreeRoot, {
    onLayerChange: callbacks.onLayerChange,
    onLocationTypeChange: callbacks.onLocationTypeChange
  });
  const locationDetails: LocationDetails = createLocationDetails(detailsRoot);
  const playerMarkerEditor: PlayerMarkerEditor = createPlayerMarkerEditor(
    detailsRoot,
    {
      onSave: callbacks.onSaveMarker,
      onCancel: callbacks.onCancelMarker,
      onEdit: callbacks.onEditMarker,
      onDelete: callbacks.onDeleteMarker
    }
  );
  const saveEntry: SaveEntry | undefined = saveImportEnabled
    ? createSaveEntry(
        root.querySelector<HTMLElement>("[data-save-entry]")!,
        callbacks.onSaveSelect
      )
    : undefined;

  const handleToggle = () => setDrawerOpen(locationPanel.dataset.open !== "true");
  const handleClose = () => {
    setDrawerOpen(false);
    filterToggle.focus({ preventScroll: true });
  };
  const setMarkerPlacementMode = (enabled: boolean, restoreFocus = !enabled) => {
    markerPlacementMode = enabled;
    addMarkerButton.textContent = enabled ? "Cancel Adding" : "Add Marker";
    addMarkerButton.setAttribute("aria-pressed", String(enabled));
    mapPanel.dataset.markerPlacement = String(enabled);
    if (restoreFocus) {
      addMarkerButton.focus({ preventScroll: true });
    }
  };
  const handleMarkerControl = (event: MouseEvent) => {
    event.stopPropagation();
    if (markerPlacementMode) {
      setMarkerPlacementMode(false);
      callbacks.onCancelMarker?.();
      return;
    }
    callbacks.onAddMarker?.();
  };
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }
    if (markerPlacementMode) {
      event.preventDefault();
      setMarkerPlacementMode(false);
      callbacks.onCancelMarker?.();
      return;
    }
    if (markerEditorMode === "draft" || markerEditorMode === "edit") {
      event.preventDefault();
      callbacks.onCancelMarker?.();
      return;
    }
    if (locationPanel.dataset.open === "true") {
      handleClose();
    }
  };
  const handleExitSaveMode = () => callbacks.onExitSaveMode?.();
  const handleViewportChange = () => syncDrawerAccessibility();
  const handleMapControlClick = (event: MouseEvent) => event.stopPropagation();

  filterToggle.addEventListener("click", handleToggle);
  drawerClose.addEventListener("click", handleClose);
  drawerBackdrop.addEventListener("click", handleClose);
  exitSaveButton?.addEventListener("click", handleExitSaveMode);
  mobileExitSaveButton?.addEventListener("click", handleExitSaveMode);
  mapControls.addEventListener("click", handleMapControlClick);
  zoomInButton.addEventListener("click", callbacks.onZoomIn ?? noOp);
  zoomOutButton.addEventListener("click", callbacks.onZoomOut ?? noOp);
  resetViewButton.addEventListener("click", callbacks.onResetView ?? noOp);
  addMarkerButton.addEventListener("click", handleMarkerControl);
  document.addEventListener("keydown", handleEscape);
  mobileViewport?.addEventListener("change", handleViewportChange);

  locationBrowser.render({ locations: [], playerMarkers: [] });
  locationDetails.render(undefined, regionNames);
  setMarkerPlacementMode(false, false);
  syncDrawerAccessibility();

  return {
    renderRegions(regions, selectedRegionId, options) {
      const focusedRegion =
        document.activeElement instanceof HTMLButtonElement
        && document.activeElement.dataset.regionId
          ? {
              id: document.activeElement.dataset.regionId,
              mobile: mobileRegionRoot.contains(document.activeElement)
            }
          : undefined;
      regionNames.clear();
      for (const region of regions) {
        regionNames.set(region.id, region.name);
      }
      regionSelector.render(regions, selectedRegionId);
      mobileRegionSelector.render(regions, selectedRegionId);
      const focusId = options?.focusSelected
        ? selectedRegionId
        : focusedRegion?.id;
      if (focusId) {
        const focusRoot = focusedRegion?.mobile ? mobileRegionRoot : regionRoot;
        Array.from(
          focusRoot.querySelectorAll<HTMLButtonElement>("[data-region-id]")
        ).find((button) => button.dataset.regionId === focusId)
          ?.focus({ preventScroll: true });
      }
      if (selectedLocation) {
        locationDetails.render(selectedLocation, regionNames);
      }
    },
    renderLocations(input, state) {
      locationBrowser.render(
        Array.isArray(input)
          ? { locations: input, playerMarkers: [], state }
          : input
      );
    },
    renderDetails(location) {
      selectedLocation = location;
      markerEditorMode = "official";
      delete detailsRoot.dataset.markerEditorMode;
      locationDetails.render(location, regionNames);
    },
    renderPlayerMarkerDraft(draft) {
      selectedLocation = undefined;
      markerEditorMode = "draft";
      playerMarkerEditor.renderDraft(draft);
    },
    renderPlayerMarker(marker, options) {
      selectedLocation = undefined;
      markerEditorMode = marker ? "view" : "empty";
      if (marker) {
        playerMarkerEditor.renderMarker(marker);
      } else {
        playerMarkerEditor.renderEmpty();
      }
      if (marker && options?.focus === "sidebar") {
        const sidebarMarker = Array.from(
          browserRoot.querySelectorAll<HTMLButtonElement>("[data-player-marker-id]")
        ).find((button) => button.dataset.playerMarkerId === marker.id);
        sidebarMarker?.focus({ preventScroll: true });
      } else if (options?.focus !== false) {
        const selectedMarker = marker
          ? Array.from(
              mapPanel.querySelectorAll<HTMLButtonElement>("[data-player-marker-id]")
            ).find((button) => button.dataset.playerMarkerId === marker.id)
          : undefined;
        (selectedMarker ?? addMarkerButton).focus({ preventScroll: true });
      }
    },
    renderPlayerMarkerEdit(marker) {
      selectedLocation = undefined;
      markerEditorMode = "edit";
      playerMarkerEditor.renderEdit(marker);
    },
    renderMapLayerTree(input) {
      mapLayerTree.render(input);
    },
    renderMapControls(state) {
      zoomInButton.disabled = state.zoom >= MAX_MAP_ZOOM;
      zoomOutButton.disabled = state.zoom <= MIN_MAP_ZOOM;
      mapReadout.value = `${coordinatesReadout(state.center.x, state.center.y, state.zoom)}`;
      mapReadout.textContent = mapReadout.value;
    },
    setRegionContentMode(mode) {
      regionContentMode = mode;
      const underDevelopment = mode === "under-development";
      if (underDevelopment) {
        setDrawerOpen(false);
      }
      for (const element of [mapPanel, locationPanel, detailsRoot]) {
        element.hidden = underDevelopment;
        element.inert = underDevelopment;
        element.toggleAttribute("inert", underDevelopment);
      }
      regionDevelopment.hidden = !underDevelopment;
      regionDevelopment.inert = !underDevelopment;
      regionDevelopment.toggleAttribute("inert", !underDevelopment);
      filterToggle.hidden = underDevelopment;
      drawerBackdrop.hidden = underDevelopment;
      syncDrawerAccessibility();
    },
    setMarkerPlacementMode,
    setPlayerMarkerActionsDisabled(disabled) {
      addMarkerButton.disabled = disabled;
    },
    setMarkerEditorError(message) {
      playerMarkerEditor.setError(message);
    },
    setMode(mode, fileName, summary) {
      const isSaveMode =
        saveImportEnabled && (mode === "save" || mode === "personalized");
      shell.dataset.appMode = isSaveMode ? "save" : "base";
      modeBadge.textContent = isSaveMode ? saveMap : baseMap;
      if (saveImportEnabled) {
        modeFile!.textContent = fileName ?? "";
        modeFile!.hidden = !isSaveMode || !fileName;
        modeMeta!.textContent = summary
          ? `Seed ${summary.seed} \u00b7 Save Version ${summary.saveVersion}`
          : "";
        modeMeta!.hidden = !isSaveMode || !summary;
        saveEntry!.setPersonalized(mode === "personalized");
        saveEntry!.setTerrainCoverage(
          mode === "personalized" ? summary?.coverage : undefined
        );
        exitSaveButton!.hidden = !isSaveMode;
        mobileExitSaveButton!.hidden = !isSaveMode;
      }
    },
    setStatus(message) {
      status.textContent = message;
      status.hidden = message.length === 0;
    },
    destroy() {
      filterToggle.removeEventListener("click", handleToggle);
      drawerClose.removeEventListener("click", handleClose);
      drawerBackdrop.removeEventListener("click", handleClose);
      exitSaveButton?.removeEventListener("click", handleExitSaveMode);
      mobileExitSaveButton?.removeEventListener("click", handleExitSaveMode);
      mapControls.removeEventListener("click", handleMapControlClick);
      zoomInButton.removeEventListener("click", callbacks.onZoomIn ?? noOp);
      zoomOutButton.removeEventListener("click", callbacks.onZoomOut ?? noOp);
      resetViewButton.removeEventListener("click", callbacks.onResetView ?? noOp);
      addMarkerButton.removeEventListener("click", handleMarkerControl);
      document.removeEventListener("keydown", handleEscape);
      mobileViewport?.removeEventListener("change", handleViewportChange);
      regionSelector.destroy();
      mobileRegionSelector.destroy();
      locationBrowser.destroy();
      mapLayerTree.destroy();
      locationDetails.destroy();
      playerMarkerEditor.destroy();
      saveEntry?.destroy();
      root.replaceChildren();
    }
  };
}

function noOp(): void {}

function coordinatesReadout(x: number, y: number, zoom: number): string {
  return `X ${formatMapNumber(x)} \u00b7 Y ${formatMapNumber(y)} \u00b7 Zoom ${formatMapNumber(zoom)}`;
}

function formatMapNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
