import type {
  MapLocation,
  MapRepository,
  MapUiState,
  RegionDefinition
} from "../domain/map-model";
import {
  MAP_LAYER_DEFINITIONS,
  normalizeMapLayerIds,
  resolveVisibleMapLayerIds
} from "../domain/map-layers";
import { parseUiState, serializeUiState } from "../domain/ui-state";
import { isRegionAvailable as defaultRegionAvailable } from "../domain/region-availability";
import {
  createMapView,
  type MapView,
  type PreparedMapWorld,
  type MapViewport
} from "../map/map-view";
import {
  buildLocationNameInventory,
  type LocationNameInventory
} from "../map/location-name-inventory";
import { createAppShell, type AppShell } from "./app-shell";
import {
  createSaveParser as createDefaultSaveParser,
  type SaveParser
} from "./save-import-feature";
import type { DecodedSave, SaveStage } from "../save/save-protocol";
import {
  materializeTerrainTransferAsync,
  type TileCatalog
} from "../terrain/normalize-terrain";
import { loadTileCatalog } from "../terrain/tile-catalog";
import type {
  LegacyAssetBundle,
  LegacyAssetProvider
} from "../legacy/legacy-visual-types";
import type {
  PlayerMarker,
  PlayerMarkerDraft
} from "../player-markers/player-marker";
import { createPlayerMarkerScopeId } from "../player-markers/player-marker-scope";
import { PlayerMarkerStore } from "../player-markers/player-marker-store";

const stageMessages: Record<SaveStage, string> = {
  reading: "Reading the local save…",
  sqlite: "Checking Survival data…",
  decompressing: "Decompressing terrain data…",
  decoding: "Decoding terrain…",
  normalizing: "Validating the personal map…",
  rendering: "Preparing the first map frame…"
};

const DEFAULT_LOCATION_TYPE_IDS = ["fixed:mechanic-station"] as const;

function availableLocationTypeIds(inventory: LocationNameInventory): Set<string> {
  return new Set(
    inventory.groups.flatMap((group) => group.types.map((type) => type.id))
  );
}

function normalizeLocationTypeIds(
  typeIds: readonly string[],
  inventory: LocationNameInventory
): string[] {
  const available = availableLocationTypeIds(inventory);
  return [...new Set(typeIds.filter((id) => available.has(id)))].sort((left, right) =>
    left.localeCompare(right, "en")
  );
}

export interface AppController {
  destroy(): void;
}

export interface StartAppOptions {
  saveImportEnabled?: boolean;
  createSaveParser?: () => Promise<SaveParser>;
  loadTileCatalog?: () => Promise<TileCatalog>;
  loadDefaultSave?: () => Promise<File | undefined>;
  createMapView?: typeof createMapView;
  legacyAssetProvider?: LegacyAssetProvider;
  playerMarkerStore?: PlayerMarkerStore;
  isRegionAvailable?: (regionId: string) => boolean;
}

export async function startApp(
  root: HTMLElement,
  repository: MapRepository,
  options: StartAppOptions = {}
): Promise<AppController> {
  const legacyAssetProvider = options.legacyAssetProvider;
  const saveImportEnabled = options.saveImportEnabled === true;
  const [regions, catalog] = await Promise.all([
    repository.loadRegions(),
    repository.loadLocations()
  ]);
  const parsedState = parseUiState(window.location.search);
  const initialParams = new URLSearchParams(window.location.search);
  const migrateLegacyLocationLabels =
    parsedState.layerIds.includes("labels") && !initialParams.has("locationTypes");
  const hasInitialViewport =
    initialParams.has("z")
    || initialParams.has("x")
    || initialParams.has("y");
  const initialSelection = parsedState.selectedLocationId
    ? catalog.find(
        (location) =>
          location.id === parsedState.selectedLocationId &&
          regions.some((region) => region.id === location.regionId)
      )
    : undefined;
  const initialRegionId = resolveRegionId(
    regions,
    initialSelection?.regionId ?? parsedState.regionId
  );
  const isRegionAvailable =
    options.isRegionAvailable ?? defaultRegionAvailable;
  const initialRegionAvailable = isRegionAvailable(initialRegionId);
  let state: MapUiState = {
    ...parsedState,
    regionId: initialRegionId,
    selectedLocationId: initialRegionAvailable ? initialSelection?.id : undefined
  };
  let world = await repository.loadWorld(
    initialRegionAvailable ? initialRegionId : "surface"
  );
  let locationNameInventory = buildLocationNameInventory(world);
  state = {
    ...state,
    locationTypeIds: migrateLegacyLocationLabels
      ? normalizeLocationTypeIds(
          [...availableLocationTypeIds(locationNameInventory)],
          locationNameInventory
        )
      : normalizeLocationTypeIds(
          initialParams.has("locationTypes")
            ? state.locationTypeIds
            : DEFAULT_LOCATION_TYPE_IDS,
          locationNameInventory
        )
  };
  const playerMarkerStore = options.playerMarkerStore
    ?? createBrowserPlayerMarkerStore();
  const initialPlayerMarkerLoad = playerMarkerStore.load();
  let activeMapScopeId = await createPlayerMarkerScopeId(world);
  let destroyed = false;
  let loadGeneration = 0;
  let rendering = false;
  let shell: AppShell;
  let map: MapView;
  let saveClient: SaveParser | undefined;
  let saveClientPromise: Promise<SaveParser | undefined> | undefined;
  let pendingSaveCancelCount = 0;
  const makeSaveParser = options.createSaveParser ?? createDefaultSaveParser;
  const getTileCatalog = options.loadTileCatalog ?? loadTileCatalog;
  const makeMapView = options.createMapView ?? createMapView;
  let saveGeneration = 0;
  let personalWorld: typeof world | undefined;
  let activeSaveSelection: object | undefined;
  let visiblePlayerMarkers: PlayerMarker[] = [];
  let selectedPlayerMarkerId: string | undefined;
  let playerMarkerDraft: PlayerMarkerDraft | undefined;
  let markerEditorMode: "empty" | "draft" | "view" | "edit" = "empty";
  let placingPlayerMarker = false;
  let placementStatusActive = false;
  let markerTransitionGeneration = 0;
  let activeMarkerTransitionGeneration: number | undefined;

  const getSaveClient = (): Promise<SaveParser | undefined> => {
    if (saveClient) {
      return Promise.resolve(saveClient);
    }
    if (saveClientPromise) {
      return saveClientPromise;
    }
    const creation = makeSaveParser();
    saveClientPromise = creation
      .then((created) => {
        if (destroyed) {
          created.dispose();
          return undefined;
        }
        saveClient = created;
        while (pendingSaveCancelCount > 0) {
          created.cancel();
          pendingSaveCancelCount -= 1;
        }
        return created;
      })
      .catch((error: unknown) => {
        pendingSaveCancelCount = 0;
        throw error;
      })
      .finally(() => {
        saveClientPromise = undefined;
      });
    return saveClientPromise;
  };
  const cancelSaveParsing = (): void => {
    if (!saveImportEnabled) {
      return;
    }
    if (saveClient) {
      saveClient.cancel();
    } else {
      pendingSaveCancelCount += 1;
    }
  };

  const commitWorld = (nextWorld: typeof world): void => {
    const nextInventory = buildLocationNameInventory(nextWorld);
    world = nextWorld;
    locationNameInventory = nextInventory;
    state = {
      ...state,
      locationTypeIds: normalizeLocationTypeIds(
        state.locationTypeIds,
        nextInventory
      )
    };
  };

  const matchesQuery = (location: MapLocation): boolean => {
    const query = state.query.trim().toLocaleLowerCase();
    return query.length === 0 || location.name.toLocaleLowerCase().includes(query);
  };
  const matchesCategories = (location: MapLocation): boolean =>
    state.categoryIds.length === 0 || state.categoryIds.includes(location.category);
  const getSidebarLocations = (): MapLocation[] => {
    const source = state.query.trim().length > 0 ? catalog : world.locations;
    return source.filter(
      (location) => matchesQuery(location) && matchesCategories(location)
    );
  };
  const getMapLocations = (): MapLocation[] =>
    world.locations.filter(
      (location) => matchesQuery(location) && matchesCategories(location)
    );
  const getSelectedLocation = (): MapLocation | undefined =>
    state.selectedLocationId
      ? catalog.find((location) => location.id === state.selectedLocationId)
      : undefined;
  const matchesPlayerMarkerQuery = (marker: PlayerMarker): boolean => {
    const query = state.query.trim().toLocaleLowerCase();
    return query.length === 0
      || marker.name.toLocaleLowerCase().includes(query)
      || marker.notes.toLocaleLowerCase().includes(query);
  };
  const refreshVisiblePlayerMarkers = (): void => {
    visiblePlayerMarkers = playerMarkerStore
      .list(activeMapScopeId, state.regionId)
      .filter(
        (marker) =>
          state.playerMarkerTypeIds.includes(marker.type)
          && matchesPlayerMarkerQuery(marker)
      );
  };
  const getSelectedPlayerMarker = (): PlayerMarker | undefined =>
    selectedPlayerMarkerId
      ? playerMarkerStore
          .list(activeMapScopeId, state.regionId)
          .find((marker) => marker.id === selectedPlayerMarkerId)
      : undefined;
  const renderSelectionDetails = (
    playerMarkerFocus: boolean | "sidebar" = true
  ): void => {
    if (playerMarkerDraft && markerEditorMode === "draft") {
      shell.renderPlayerMarkerDraft(playerMarkerDraft);
      return;
    }
    const selectedPlayerMarker = getSelectedPlayerMarker();
    if (selectedPlayerMarker) {
      if (markerEditorMode === "edit") {
        shell.renderPlayerMarkerEdit(selectedPlayerMarker);
      } else {
        markerEditorMode = "view";
        shell.renderPlayerMarker(selectedPlayerMarker, {
          focus: playerMarkerFocus
        });
      }
      return;
    }
    selectedPlayerMarkerId = undefined;
    markerEditorMode = "empty";
    shell.renderDetails(getSelectedLocation());
  };
  const clearPlayerMarkerWork = (clearSelection = true): void => {
    placingPlayerMarker = false;
    playerMarkerDraft = undefined;
    map.setMarkerPlacementMode(false);
    shell.setMarkerPlacementMode(false);
    if (placementStatusActive) {
      placementStatusActive = false;
      shell.setStatus("");
    }
    if (clearSelection) {
      selectedPlayerMarkerId = undefined;
      markerEditorMode = "empty";
      map.selectPlayerMarker(undefined);
    } else {
      markerEditorMode = selectedPlayerMarkerId ? "view" : "empty";
    }
  };
  const playerMarkerActionsAvailable = (): boolean =>
    !destroyed && activeMarkerTransitionGeneration === undefined;
  const renderMapLayerTree = (): void => {
    shell.renderMapLayerTree({
      layerIds: [...resolveVisibleMapLayerIds(state.layerIds)],
      inventory: locationNameInventory,
      selectedLocationTypeIds: state.locationTypeIds,
      disabled: !playerMarkerActionsAvailable()
    });
  };
  const beginMarkerTransition = (): number => {
    const generation = ++markerTransitionGeneration;
    activeMarkerTransitionGeneration = generation;
    clearPlayerMarkerWork();
    renderSelectionDetails();
    renderMapLayerTree();
    shell.setPlayerMarkerActionsDisabled(true);
    return generation;
  };
  const finishMarkerTransition = (
    generation: number,
    cancelMarkerWork = false
  ): boolean => {
    if (activeMarkerTransitionGeneration !== generation) {
      return false;
    }
    if (cancelMarkerWork) {
      clearPlayerMarkerWork();
      renderSelectionDetails();
    }
    activeMarkerTransitionGeneration = undefined;
    if (!destroyed) {
      renderMapLayerTree();
      shell.setPlayerMarkerActionsDisabled(false);
    }
    return true;
  };
  const syncUrl = () => {
    const nextUrl = `${window.location.pathname}${serializeUiState(state)}`;
    window.history.replaceState(null, "", nextUrl);
  };
  const syncUnavailableRegionUrl = (regionId: string) => {
    const params = new URLSearchParams({ region: regionId });
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params.toString()}`
    );
  };
  const applyLayerVisibility = () => {
    const visibleLayers = resolveVisibleMapLayerIds(state.layerIds);
    for (const layer of MAP_LAYER_DEFINITIONS) {
      map.setLayerVisibility(layer.id, visibleLayers.has(layer.id));
    }
  };
  const syncViewportFromMap = () => {
    state = { ...state, ...map.getViewport() };
    shell.renderMapControls(state);
    syncUrl();
  };
  const render = (
    worldChanged = false,
    restoredViewport?: MapViewport,
    focusSelection = false,
    refreshSelectionDetails = true
  ) => {
    if (destroyed) {
      return;
    }

    rendering = true;
    refreshVisiblePlayerMarkers();
    shell.renderRegions(regions, state.regionId);
    shell.renderLocations({
      locations: getSidebarLocations(),
      playerMarkers: visiblePlayerMarkers,
      selectedPlayerMarkerId,
      state
    });
    renderMapLayerTree();
    if (worldChanged) {
      const networkPolicy =
        world.source === "reference"
        || world.source === "save"
          ? "offline-overview"
          : "atlas";
      map.setWorld(
        world,
        networkPolicy
      );
      if (restoredViewport) {
        map.setViewport(restoredViewport);
      }
    }
    map.setLocations(getMapLocations());
    map.setPlayerMarkers(visiblePlayerMarkers);
    applyLayerVisibility();
    map.setLocationNames(locationNameInventory, state.locationTypeIds);
    map.selectLocation(
      getSelectedLocation()?.regionId === state.regionId
        ? state.selectedLocationId
        : undefined,
      { focus: focusSelection }
    );
    map.selectPlayerMarker(selectedPlayerMarkerId);
    if (refreshSelectionDetails) {
      renderSelectionDetails();
    }
    state = { ...state, ...map.getViewport() };
    shell.renderMapControls(state);
    rendering = false;
    syncUrl();
  };
  const changeRegion = async (
    regionId: string,
    selectedLocationId?: string
  ): Promise<void> => {
    if (destroyed || !regions.some((region) => region.id === regionId)) {
      return;
    }

    const markerTransition = beginMarkerTransition();
    saveGeneration += 1;
    activeSaveSelection = undefined;
    cancelSaveParsing();
    map.discardPreparedWorld();
    const generation = ++loadGeneration;
    if (!isRegionAvailable(regionId)) {
      if (!finishMarkerTransition(markerTransition, true)) {
        return;
      }
      state = {
        ...state,
        regionId,
        selectedLocationId: undefined
      };
      shell.renderRegions(regions, regionId, { focusSelected: true });
      shell.setRegionContentMode("under-development");
      shell.setStatus("");
      syncUnavailableRegionUrl(regionId);
      return;
    }
    let nextWorld;
    try {
      nextWorld =
        regionId === "surface" && personalWorld
          ? personalWorld
          : await repository.loadWorld(regionId);
    } catch (error) {
      if (!destroyed && generation === loadGeneration) {
        finishMarkerTransition(markerTransition);
        map.setLocationNames(locationNameInventory, state.locationTypeIds);
        shell.setStatus(error instanceof Error ? error.message : "This region could not be loaded. Please try again.");
      }
      return;
    }
    if (destroyed || generation !== loadGeneration) {
      finishMarkerTransition(markerTransition);
      return;
    }
    if (!finishMarkerTransition(markerTransition, true)) {
      return;
    }

    commitWorld(nextWorld);
    state = {
      ...state,
      regionId,
      ...(selectedLocationId
        ? { selectedLocationId }
        : { selectedLocationId: undefined })
    };
    shell.setRegionContentMode("map");
    render(true, undefined, selectedLocationId !== undefined);
  };
  const selectLocation = async (locationId: string): Promise<void> => {
    const location = catalog.find((candidate) => candidate.id === locationId);
    if (!location) {
      return;
    }

    clearPlayerMarkerWork();
    saveGeneration += 1;
    activeSaveSelection = undefined;
    cancelSaveParsing();
    map.discardPreparedWorld();
    loadGeneration += 1;
    if (location.regionId !== state.regionId) {
      await changeRegion(location.regionId, location.id);
      return;
    }

    state = { ...state, selectedLocationId: location.id };
    render(false, undefined, true);
  };
  const selectPlayerMarker = (
    markerId: string,
    playerMarkerFocus: boolean | "sidebar" = true
  ): void => {
    if (!playerMarkerActionsAvailable()) {
      return;
    }
    const marker = playerMarkerStore
      .list(activeMapScopeId, state.regionId)
      .find((candidate) => candidate.id === markerId);
    if (!marker) {
      return;
    }

    clearPlayerMarkerWork(false);
    selectedPlayerMarkerId = marker.id;
    markerEditorMode = "view";
    state = { ...state, selectedLocationId: undefined };
    map.selectLocation(undefined, { focus: false });
    render(false, undefined, false, false);
    renderSelectionDetails(playerMarkerFocus);
  };
  const beginPlayerMarkerPlacement = (): void => {
    if (!playerMarkerActionsAvailable()) {
      return;
    }
    placingPlayerMarker = true;
    playerMarkerDraft = undefined;
    selectedPlayerMarkerId = undefined;
    markerEditorMode = "empty";
    state = { ...state, selectedLocationId: undefined };
    map.selectLocation(undefined, { focus: false });
    map.selectPlayerMarker(undefined);
    map.setMarkerPlacementMode(true);
    shell.setMarkerPlacementMode(true);
    shell.renderPlayerMarker();
    placementStatusActive = true;
    shell.setStatus("Select a map position for the new marker.");
    syncUrl();
  };
  const placePlayerMarker = (position: PlayerMarkerDraft["position"]): void => {
    if (!playerMarkerActionsAvailable() || !placingPlayerMarker) {
      return;
    }
    placingPlayerMarker = false;
    map.setMarkerPlacementMode(false);
    shell.setMarkerPlacementMode(false);
    playerMarkerDraft = {
      mapScopeId: activeMapScopeId,
      regionId: state.regionId,
      position: { ...position },
      name: "",
      type: "note",
      notes: ""
    };
    markerEditorMode = "draft";
    placementStatusActive = false;
    shell.setStatus("");
    renderSelectionDetails();
  };
  const cancelPlayerMarkerWork = (): void => {
    if (!playerMarkerActionsAvailable()) {
      return;
    }
    const wasEditing = markerEditorMode === "edit";
    clearPlayerMarkerWork(false);
    shell.setStatus("");
    if (wasEditing && getSelectedPlayerMarker()) {
      markerEditorMode = "view";
      renderSelectionDetails();
      return;
    }
    selectedPlayerMarkerId = undefined;
    markerEditorMode = "empty";
    map.selectPlayerMarker(undefined);
    renderSelectionDetails();
  };
  const savePlayerMarker = (value: PlayerMarkerDraft | PlayerMarker): void => {
    if (!playerMarkerActionsAvailable()) {
      return;
    }
    if (
      "id" in value
        ? getSelectedPlayerMarker()?.id !== value.id
        : value.mapScopeId !== activeMapScopeId || value.regionId !== state.regionId
    ) {
      return;
    }
    try {
      const saved = "id" in value
        ? playerMarkerStore.update(value.id, {
            name: value.name,
            type: value.type,
            notes: value.notes
          })
        : playerMarkerStore.create({
            ...value,
            mapScopeId: activeMapScopeId,
            regionId: state.regionId
          });
      playerMarkerDraft = undefined;
      placingPlayerMarker = false;
      selectedPlayerMarkerId = saved.id;
      markerEditorMode = "view";
      state = { ...state, selectedLocationId: undefined };
      map.setMarkerPlacementMode(false);
      shell.setMarkerPlacementMode(false);
      shell.setStatus("");
      render();
    } catch (error) {
      shell.setMarkerEditorError(
        error instanceof Error ? error.message : "Player marker could not be saved."
      );
    }
  };
  const editPlayerMarker = (marker: PlayerMarker): void => {
    if (!playerMarkerActionsAvailable()) {
      return;
    }
    const selected = getSelectedPlayerMarker();
    if (!selected || selected.id !== marker.id) {
      return;
    }
    markerEditorMode = "edit";
    shell.renderPlayerMarkerEdit(selected);
  };
  const deletePlayerMarker = (marker: PlayerMarker): void => {
    if (!playerMarkerActionsAvailable()) {
      return;
    }
    const selected = getSelectedPlayerMarker();
    if (!selected || selected.id !== marker.id) {
      return;
    }
    try {
      playerMarkerStore.delete(marker.id);
      selectedPlayerMarkerId = undefined;
      markerEditorMode = "empty";
      map.selectPlayerMarker(undefined);
      render(false, undefined, false, false);
      shell.renderPlayerMarker();
    } catch (error) {
      shell.setMarkerEditorError(
        error instanceof Error ? error.message : "Player marker could not be saved."
      );
    }
  };
  const selectSave = async (file: File): Promise<void> => {
    if (!saveImportEnabled || destroyed) {
      return;
    }
    const markerTransition = beginMarkerTransition();
    const generation = ++saveGeneration;
    const selection = {};
    activeSaveSelection = selection;
    cancelSaveParsing();
    map.discardPreparedWorld();
    shell.setStatus(stageMessages.reading);
    let prepared: PreparedMapWorld | undefined;
    let unconsumedOverview: DecodedSave["overview"];
    let preparedLegacyBundle: LegacyAssetBundle | undefined;
    let optionalTerrainWarning: string | undefined;
    try {
      const client = await getSaveClient();
      if (!client || destroyed || generation !== saveGeneration) return;
      const tileCatalog = await getTileCatalog();
      if (destroyed || generation !== saveGeneration) return;
      const save = await client.parseSave(file, (stage) => {
          if (!destroyed && generation === saveGeneration) {
            shell.setStatus(stageMessages[stage]);
          }
        }, tileCatalog);
      unconsumedOverview = save.overview;
      if (destroyed || generation !== saveGeneration) {
        unconsumedOverview?.bitmap.close();
        unconsumedOverview = undefined;
        return;
      }
      const candidateWorld = await materializeTerrainTransferAsync(
        save.terrain,
        save.metadata,
        () => !destroyed && generation === saveGeneration
      );
      if (destroyed || generation !== saveGeneration) {
        unconsumedOverview?.bitmap.close();
        unconsumedOverview = undefined;
        return;
      }
      candidateWorld.connections = save.connections;
      candidateWorld.locations = catalog.filter(
        (location) => location.regionId === "surface"
      );
      const candidateMapScopeId = await createPlayerMarkerScopeId(candidateWorld);
      if (destroyed || generation !== saveGeneration) {
        return;
      }
      if (legacyAssetProvider) {
        try {
          preparedLegacyBundle = await legacyAssetProvider.loadForCells(
            candidateWorld.cells,
            "official-1.0-only"
          );
        } catch (error) {
          if (destroyed || generation !== saveGeneration) return;
          optionalTerrainWarning = `${
            error instanceof Error
              ? error.message
              : "Optional terrain images could not be loaded."
          } The decoded save overview is still available.`;
        }
        if (destroyed || generation !== saveGeneration) return;
      }
      shell.setStatus(stageMessages.rendering);
      const overviewForMap = unconsumedOverview;
      unconsumedOverview = undefined;
      prepared = await map.prepareWorld(
        candidateWorld,
        overviewForMap,
        preparedLegacyBundle
      );
      if (destroyed || generation !== saveGeneration) {
        map.discardPreparedWorld(prepared);
        return;
      }

      await map.commitPreparedWorld(prepared);
      if (
        destroyed
        || generation !== saveGeneration
        || activeSaveSelection !== selection
      ) {
        return;
      }
      if (!finishMarkerTransition(markerTransition, true)) {
        return;
      }
      loadGeneration += 1;
      personalWorld = candidateWorld;
      commitWorld(candidateWorld);
      activeMapScopeId = candidateMapScopeId;
      state = {
        ...state,
        regionId: "surface",
        selectedLocationId: undefined
      };
      shell.setMode("personalized", save.metadata.fileName, {
        seed: save.metadata.seed,
        saveVersion: save.metadata.saveVersion,
        coverage: prepared.coverage
      });
      render(false);
      shell.setStatus(
        optionalTerrainWarning
          ?? "Your personal map is ready. The save's actual layout is rendered from verified official 1.0 terrain assets; unavailable tiles are reported as missing."
      );
    } catch (error) {
      map.discardPreparedWorld(prepared);
      if (!destroyed && generation === saveGeneration) {
        map.setLocationNames(locationNameInventory, state.locationTypeIds);
        shell.setStatus(
          `${error instanceof Error ? error.message : "The save could not be read."} Please select another Scrap Mechanic 1.0 Survival .db save.`
        );
      }
    } finally {
      unconsumedOverview?.bitmap.close();
      unconsumedOverview = undefined;
      finishMarkerTransition(markerTransition);
      if (activeSaveSelection === selection) {
        activeSaveSelection = undefined;
      }
    }
  };
  const exitSaveMode = async (): Promise<void> => {
    const exitingPersonalWorld = personalWorld;
    if (!exitingPersonalWorld) {
      return;
    }
    const markerTransition = beginMarkerTransition();
    const targetRegionId = state.regionId;
    const exitSaveGeneration = ++saveGeneration;
    const exitLoadGeneration = ++loadGeneration;
    cancelSaveParsing();
    map.discardPreparedWorld();
    try {
      const baseWorld = await repository.loadWorld(targetRegionId);
      if (
        destroyed
        || exitSaveGeneration !== saveGeneration
        || exitLoadGeneration !== loadGeneration
        || state.regionId !== targetRegionId
        || personalWorld !== exitingPersonalWorld
      ) {
        finishMarkerTransition(markerTransition);
        return;
      }
      if (!finishMarkerTransition(markerTransition, true)) {
        return;
      }
      commitWorld(baseWorld);
      personalWorld = undefined;
      activeMapScopeId = "default";
      shell.setMode("base");
      shell.setStatus("");
      render(true);
    } catch (error) {
      if (
        !destroyed
        && exitSaveGeneration === saveGeneration
        && exitLoadGeneration === loadGeneration
        && state.regionId === targetRegionId
        && personalWorld === exitingPersonalWorld
      ) {
        finishMarkerTransition(markerTransition);
        shell.setStatus(error instanceof Error ? error.message : "The base map could not be restored.");
      }
    }
  };

  shell = createAppShell(root, {
    onRegionChange(regionId) {
      void changeRegion(regionId);
    },
    onQueryChange(query) {
      state = { ...state, query };
      render(false, undefined, false, false);
    },
    onSearchReset() {
      state = {
        ...state,
        query: "",
        locationTypeIds: normalizeLocationTypeIds(
          DEFAULT_LOCATION_TYPE_IDS,
          locationNameInventory
        )
      };
      map.setLocationNames(locationNameInventory, state.locationTypeIds);
      render(false, undefined, false, false);
    },
    onCategoryChange(categoryIds) {
      state = { ...state, categoryIds };
      render(false, undefined, false, false);
    },
    onPlayerMarkerTypeChange(playerMarkerTypeIds) {
      state = { ...state, playerMarkerTypeIds: [...playerMarkerTypeIds].sort() };
      render(false, undefined, false, false);
    },
    onLayerChange(layerIds) {
      state = { ...state, layerIds: normalizeMapLayerIds(layerIds) };
      applyLayerVisibility();
      map.setLocationNames(locationNameInventory, state.locationTypeIds);
      shell.renderMapControls(state);
      syncUrl();
    },
    onLocationTypeChange(locationTypeIds) {
      state = {
        ...state,
        locationTypeIds: normalizeLocationTypeIds(
          locationTypeIds,
          locationNameInventory
        )
      };
      map.setLocationNames(locationNameInventory, state.locationTypeIds);
      syncUrl();
    },
    onLocationSelect(locationId) {
      void selectLocation(locationId);
    },
    onPlayerMarkerSelect(markerId) {
      selectPlayerMarker(markerId, "sidebar");
    },
    onZoomIn() {
      map.zoomIn();
      syncViewportFromMap();
    },
    onZoomOut() {
      map.zoomOut();
      syncViewportFromMap();
    },
    onResetView() {
      map.resetView();
      syncViewportFromMap();
    },
    onAddMarker() {
      beginPlayerMarkerPlacement();
    },
    onCancelMarker() {
      cancelPlayerMarkerWork();
    },
    onSaveMarker(value) {
      savePlayerMarker(value);
    },
    onEditMarker(marker) {
      editPlayerMarker(marker);
    },
    onDeleteMarker(marker) {
      deletePlayerMarker(marker);
    },
    ...(saveImportEnabled
      ? {
          onSaveSelect(file: File) {
            void selectSave(file);
          },
          onExitSaveMode() {
            void exitSaveMode();
          }
        }
      : {})
  }, { saveImportEnabled });
  try {
    map = makeMapView(root.querySelector<HTMLElement>("#map")!, {
      onViewportChange(viewport) {
        if (rendering || destroyed) {
          return;
        }
        state = { ...state, ...viewport };
        shell.renderMapControls(state);
        syncUrl();
      },
      onLocationSelect(locationId) {
        void selectLocation(locationId);
      },
      onPlayerMarkerSelect(markerId) {
        selectPlayerMarker(markerId);
      },
      onMarkerPlacement(position) {
        placePlayerMarker(position);
      }
    });
  } catch (error) {
    saveClient?.dispose();
    shell.destroy();
    throw error;
  }
  shell.setMode("base");
  if (initialRegionAvailable) {
    shell.setRegionContentMode("map");
    render(
      true,
      hasInitialViewport
        ? {
            center: state.center,
            zoom: state.zoom
          }
        : undefined,
      Boolean(initialSelection)
    );
  } else {
    shell.renderRegions(regions, state.regionId);
    shell.setRegionContentMode("under-development");
    syncUnavailableRegionUrl(state.regionId);
  }
  if (initialPlayerMarkerLoad.warning) {
    shell.setStatus(initialPlayerMarkerLoad.warning);
  }
  if (saveImportEnabled && options.loadDefaultSave) {
    const defaultSaveGeneration = saveGeneration;
    void options.loadDefaultSave()
      .then((file) => {
        if (
          file
          && !destroyed
          && saveGeneration === defaultSaveGeneration
          && isRegionAvailable(state.regionId)
        ) {
          void selectSave(file);
        }
      })
      .catch((error: unknown) => {
        if (!destroyed && saveGeneration === defaultSaveGeneration) {
          shell.setStatus(
            `${error instanceof Error ? error.message : "The default save could not be loaded."} The base map is still available.`
          );
        }
      });
  }

  return {
    destroy() {
      if (destroyed) {
        return;
      }
      clearPlayerMarkerWork();
      destroyed = true;
      activeSaveSelection = undefined;
      loadGeneration += 1;
      saveGeneration += 1;
      saveClient?.dispose();
      legacyAssetProvider?.destroy();
      map.destroy();
      shell.destroy();
    }
  };
}

function resolveRegionId(
  regions: RegionDefinition[],
  requestedRegionId: string
): string {
  if (regions.some((region) => region.id === requestedRegionId)) {
    return requestedRegionId;
  }
  if (regions.some((region) => region.id === "surface")) {
    return "surface";
  }
  const firstRegion = regions[0];
  if (!firstRegion) {
    throw new Error("Map catalog does not declare any regions");
  }
  return firstRegion.id;
}

function createBrowserPlayerMarkerStore(): PlayerMarkerStore {
  try {
    return new PlayerMarkerStore(window.localStorage);
  } catch {
    return new PlayerMarkerStore({
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        throw new Error("Storage access denied");
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new Error("Storage access denied");
      }
    });
  }
}
