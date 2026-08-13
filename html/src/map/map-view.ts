import * as L from "leaflet";
import { getMapLayerDefinition } from "../domain/map-layers";
import {
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  type MapLocation,
  type MapUiState,
  type WorldMap
} from "../domain/map-model";
import type { SaveOverviewArtifact } from "../save/save-protocol";
import type { LegacyAssetBundle } from "../legacy/legacy-visual-types";
import { resolveTerrainVisuals } from "../legacy/hybrid-terrain-resolver";
import {
  cellBoundsToMapPointBounds,
  cellToMapPoint,
  mapPointToCell
} from "./coordinate-system";
import {
  createLocationLayer,
  type LocationSelectionOptions
} from "./location-layer";
import type { LocationNameInventory } from "./location-name-inventory";
import { createPoiLabelLayer } from "./poi-label-layer";
import {
  AtlasLayer,
  type AtlasNetworkPolicy
} from "./atlas-layer";
import { createLegacyTerrainFrame } from "./legacy-terrain-renderer";
import type { LegacyTerrainFrame } from "./legacy-terrain-renderer";
import type { TerrainCoverageSummary } from "../components/terrain-coverage";
import type {
  PlayerMarker,
  PlayerMarkerPosition
} from "../player-markers/player-marker";
import { createPlayerMarkerLayer } from "./player-marker-layer";

export type MapViewport = Pick<MapUiState, "center" | "zoom">;

export interface MapViewCallbacks {
  onViewportChange(viewport: {
    center: { x: number; y: number };
    zoom: number;
  }): void;
  onLocationSelect(locationId: string): void;
  onPlayerMarkerSelect(markerId: string): void;
  onMarkerPlacement(position: PlayerMarkerPosition): void;
}

export interface MapView {
  setWorld(
    world: WorldMap,
    networkPolicy?: AtlasNetworkPolicy
  ): void;
  prepareWorld(
    world: WorldMap,
    overview?: SaveOverviewArtifact,
    legacyBundle?: LegacyAssetBundle
  ): Promise<PreparedMapWorld>;
  commitPreparedWorld(prepared: PreparedMapWorld): Promise<void>;
  discardPreparedWorld(prepared?: PreparedMapWorld): void;
  setViewport(viewport: MapViewport): void;
  setLocations(locations: MapLocation[]): void;
  setLocationNames(
    inventory: LocationNameInventory,
    selectedTypeIds: readonly string[]
  ): void;
  selectLocation(
    locationId?: string,
    options?: LocationSelectionOptions
  ): void;
  setPlayerMarkers(markers: readonly PlayerMarker[]): void;
  selectPlayerMarker(markerId?: string): void;
  setMarkerPlacementMode(enabled: boolean): void;
  setLayerVisibility(layerId: string, visible: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  getViewport(): MapViewport;
  destroy(): void;
}

export interface PreparedMapWorld {
  readonly world: WorldMap;
  readonly generation: number;
  readonly coverage: TerrainCoverageSummary;
}

export interface MapViewOptions {
  createAtlasLayer?: (networkPolicy: AtlasNetworkPolicy) => AtlasLayer;
}

function fallbackCoverage(world: WorldMap): TerrainCoverageSummary {
  return {
    totalCells: world.cells.length,
    legacyImageCells: 0,
    oneDotZeroImageCells: 0,
    fallbackCells: world.cells.length,
    distinctFallbackUuids: new Set(
      world.cells.map((cell) => cell.uuid.toLowerCase())
    ).size
  };
}

function legacyCoverage(
  world: WorldMap,
  frame: LegacyTerrainFrame
): TerrainCoverageSummary {
  const cellsByCoordinate = new Map(
    world.cells.map((cell) => [`${cell.x},${cell.y}`, cell])
  );
  const fallbackUuids = new Set<string>();
  for (const visual of frame.visuals) {
    if (visual.source !== "one-dot-zero-fallback" && visual.asset) continue;
    for (const coordinate of visual.coveredCells) {
      const cell = cellsByCoordinate.get(coordinate);
      if (cell) fallbackUuids.add(cell.uuid.toLowerCase());
    }
  }
  return {
    totalCells: frame.coverage.totalCells,
    legacyImageCells:
      frame.coverage.legacyTileCells + frame.coverage.legacyPoiCells,
    oneDotZeroImageCells: frame.coverage.oneDotZeroTileCells ?? 0,
    fallbackCells: frame.coverage.fallbackCells,
    distinctFallbackUuids: fallbackUuids.size
  };
}

export function createMapView(
  element: HTMLElement,
  callbacks: MapViewCallbacks,
  options: MapViewOptions = {}
): MapView {
  const map = L.map(element, {
    crs: L.CRS.Simple,
    minZoom: MIN_MAP_ZOOM,
    maxZoom: MAX_MAP_ZOOM,
    zoomControl: false,
    attributionControl: true
  });
  map.setView([0, 0], 0);
  const referenceSurfacePane = map.createPane("referenceSurfacePane");
  referenceSurfacePane.style.zIndex = "450";
  referenceSurfacePane.style.pointerEvents = "none";
  const fixedRegionPane = map.createPane("fixedRegionPane");
  fixedRegionPane.style.zIndex = "150";
  fixedRegionPane.style.pointerEvents = "none";
  const coordinateGrid = element.querySelector<HTMLElement>(
    "[data-coordinate-grid]"
  );
  const locationLayer = createLocationLayer(map, callbacks.onLocationSelect);
  const poiLabelLayer = createPoiLabelLayer(map);
  let locationNameInventory: LocationNameInventory = {
    groups: [],
    instances: []
  };
  let selectedLocationTypeIds: readonly string[] = [];
  const applyLocationNames = () => {
    poiLabelLayer.setLocationNames(
      locationNameInventory.instances,
      selectedLocationTypeIds
    );
    poiLabelLayer.setVisible(selectedLocationTypeIds.length > 0);
  };
  const clearLocationNames = () => {
    poiLabelLayer.setLocationNames([], []);
    poiLabelLayer.setVisible(false);
  };
  const playerMarkerLayer = createPlayerMarkerLayer(
    map,
    callbacks.onPlayerMarkerSelect
  );
  const createAtlasLayer =
    options.createAtlasLayer
    ?? ((networkPolicy: AtlasNetworkPolicy) => new AtlasLayer({ networkPolicy }));
  let atlasLayer = createAtlasLayer("atlas");
  let atlasNetworkPolicy: AtlasNetworkPolicy = "atlas";
  let terrainVisible = true;
  let referenceBackdropOnly = false;
  let poiIconsVisible = true;
  const poiIconVisibilityTargets = new WeakMap<AtlasLayer, boolean>();
  const poiIconVisibilityOperations = new WeakMap<
    AtlasLayer,
    Promise<void>
  >();
  const applyPoiIconVisibility = (
    layer: AtlasLayer,
    visible: boolean
  ): Promise<void> => {
    poiIconVisibilityTargets.set(layer, visible);
    const running = poiIconVisibilityOperations.get(layer);
    if (running) return running;

    let operation: Promise<void>;
    operation = (async () => {
      while (true) {
        const target = poiIconVisibilityTargets.get(layer);
        if (target === undefined) return;
        await layer.setPoiIconsVisible(target);
        if (poiIconVisibilityTargets.get(layer) === target) return;
      }
    })().finally(() => {
      if (poiIconVisibilityOperations.get(layer) === operation) {
        poiIconVisibilityOperations.delete(layer);
        poiIconVisibilityTargets.delete(layer);
      }
    });
    poiIconVisibilityOperations.set(layer, operation);
    return operation;
  };
  atlasLayer.addTo(map);
  let preparedLayer:
    | {
        generation: number;
        world: WorldMap;
        layer: AtlasLayer;
        networkPolicy: AtlasNetworkPolicy;
        coverage: TerrainCoverageSummary;
      }
    | undefined;
  let preparationGeneration = 0;
  let visibleWorldGeneration = 0;
  let suppressViewportNotifications = false;
  let markerPlacementMode = false;
  const setMarkerPlacementMode = (enabled: boolean) => {
    markerPlacementMode = enabled;
    element.dataset.markerPlacement = String(enabled);
  };
  const handleMapClick = (event: L.LeafletMouseEvent) => {
    if (!markerPlacementMode) return;
    const position = mapPointToCell({
      x: event.latlng.lng,
      y: event.latlng.lat
    });
    setMarkerPlacementMode(false);
    callbacks.onMarkerPlacement(position);
  };
  setMarkerPlacementMode(false);
  map.on("click", handleMapClick);
  const atlasError = (event: Event) => { const message = (event as CustomEvent<string>).detail; let notice = element.parentElement?.querySelector<HTMLElement>("[data-atlas-error]"); if (!notice) { notice = document.createElement("p"); notice.dataset.atlasError = ""; notice.setAttribute("role", "status"); element.parentElement?.append(notice); } notice.textContent = `Terrain atlas unavailable: ${message}. Check the atlas files and try again.`; };
  const atlasReady = () => { element.parentElement?.querySelector("[data-atlas-error]")?.remove(); delete element.dataset.atlasStatus; };
  element.addEventListener("atlas-error", atlasError);
  element.addEventListener("atlas-ready", atlasReady);
  let worldBounds: L.LatLngBoundsExpression | undefined;
  let baseBackdrop: L.ImageOverlay | undefined;
  let baseBackdropOpacity = 1;
  const clearBaseBackdrop = () => {
    baseBackdrop?.remove();
    baseBackdrop = undefined;
  };
  const syncBaseBackdrop = (world: WorldMap) => {
    clearBaseBackdrop();
    if (world.source === "save") {
      return;
    }
    const bounds = cellBoundsToMapPointBounds(world.bounds);
    const isReference = world.source === "reference";
    baseBackdropOpacity = isReference ? 1 : 0.92;
    baseBackdrop = L.imageOverlay(
      isReference
        ? "/assets/reference-surface-1.0.webp"
        : "/assets/fixed-region-backdrop.svg",
      [
        [bounds.min.y, bounds.min.x],
        [bounds.max.y, bounds.max.x]
      ],
      {
        pane: isReference ? "referenceSurfacePane" : "fixedRegionPane",
        className: isReference
          ? "reference-surface-backdrop"
          : "fixed-region-backdrop",
        interactive: false,
        opacity: terrainVisible ? baseBackdropOpacity : 0,
        alt: "Authentic default Scrap Mechanic 1.0 surface map; select a save to display its personal layout"
      }
    ).addTo(map);
  };
  const getViewport = (): MapViewport => {
    const center = map.getCenter();
    return {
      center: mapPointToCell({ x: center.lng, y: center.lat }),
      zoom: map.getZoom()
    };
  };
  const handleViewportChange = () => {
    if (!suppressViewportNotifications) {
      callbacks.onViewportChange(getViewport());
    }
  };
  map.on("moveend zoomend", handleViewportChange);

  return {
    setWorld(world, networkPolicy = "atlas") {
      setMarkerPlacementMode(false);
      referenceBackdropOnly = world.source === "reference";
      visibleWorldGeneration += 1;
      preparationGeneration += 1;
      if (preparedLayer) {
        preparedLayer.layer.remove();
        preparedLayer = undefined;
      }
      if (networkPolicy !== atlasNetworkPolicy) {
        const replacement = createAtlasLayer(networkPolicy);
        void applyPoiIconVisibility(replacement, poiIconsVisible).catch(
          () => undefined
        );
        replacement.addTo(map);
        atlasLayer.remove();
        atlasLayer = replacement;
        atlasNetworkPolicy = networkPolicy;
      }
      clearLocationNames();
      syncBaseBackdrop(world);
      const bounds = cellBoundsToMapPointBounds(world.bounds);
      worldBounds = [
        [bounds.min.y, bounds.min.x],
        [bounds.max.y, bounds.max.x]
      ];
      map.fitBounds(worldBounds, {
        animate: false,
        ...(world.source === "reference" ? { maxZoom: MIN_MAP_ZOOM } : {})
      });
      void atlasLayer.setCells(world.cells).catch(() => undefined);
      void atlasLayer
        .setVisible(terrainVisible && !referenceBackdropOnly)
        .catch(() => undefined);
    },
    async prepareWorld(world, overview, legacyBundle) {
      const generation = ++preparationGeneration;
      clearLocationNames();
      if (preparedLayer) preparedLayer.layer.remove();
      let layer: AtlasLayer | undefined;
      let unownedOverview = overview;
      const networkPolicy: AtlasNetworkPolicy = legacyBundle
        ? "legacy-preloaded"
        : "offline-overview";
      let coverage = fallbackCoverage(world);
      try {
        layer = createAtlasLayer(networkPolicy);
        void applyPoiIconVisibility(layer, poiIconsVisible).catch(
          () => undefined
        );
        layer.addTo(map);
        preparedLayer = { generation, world, layer, networkPolicy, coverage };
        if (legacyBundle) {
          const frame = createLegacyTerrainFrame(
            resolveTerrainVisuals(world.cells, legacyBundle)
          );
          coverage = legacyCoverage(world, frame);
          preparedLayer.coverage = coverage;
          const handedOverview = unownedOverview;
          unownedOverview = undefined;
          await layer.prepareLegacyFrame(
            world.cells,
            handedOverview,
            frame
          );
        } else {
          const handedOverview = unownedOverview;
          unownedOverview = undefined;
          await layer.prepareOverview(world.cells, handedOverview);
        }
      } catch (error) {
        unownedOverview?.bitmap.close();
        if (preparedLayer?.generation === generation) preparedLayer = undefined;
        layer?.remove();
        throw error;
      }
      if (generation !== preparationGeneration || preparedLayer?.layer !== layer) {
        layer.remove();
        throw new DOMException("Prepared map was replaced.", "AbortError");
      }
      return { world, generation, coverage };
    },
    async commitPreparedWorld(prepared) {
      const pending = preparedLayer;
      if (!pending || pending.generation !== prepared.generation || pending.world !== prepared.world) {
        throw new DOMException("Prepared map is stale.", "AbortError");
      }
      if (!terrainVisible) {
        throw new DOMException("Terrain is hidden.", "AbortError");
      }
      const bounds = cellBoundsToMapPointBounds(prepared.world.bounds);
      const nextBounds: L.LatLngBoundsExpression = [[bounds.min.y, bounds.min.x], [bounds.max.y, bounds.max.x]];
      const committedLayer = atlasLayer;
      const committedGeneration = visibleWorldGeneration;
      const committedCenter = map.getCenter();
      const committedZoom = map.getZoom();
      let didCommit = false;
      suppressViewportNotifications = true;
      try {
        if (pending.world.source !== "reference") {
          map.fitBounds(nextBounds, { animate: false });
        }
        await pending.layer.restagePrepared();
        while (true) {
          const targetVisibility = poiIconsVisible;
          await applyPoiIconVisibility(
            pending.layer,
            targetVisibility
          );
          if (targetVisibility === poiIconsVisible) break;
        }
        if (
          !terrainVisible
          || preparedLayer !== pending
          || pending.generation !== preparationGeneration
        ) {
          throw new DOMException("Prepared map is stale.", "AbortError");
        }
        pending.layer.commitOverview();
        preparedLayer = undefined;
        atlasLayer.remove();
        atlasLayer = pending.layer;
        atlasNetworkPolicy = pending.networkPolicy;
        referenceBackdropOnly = prepared.world.source === "reference";
        void atlasLayer
          .setVisible(terrainVisible && !referenceBackdropOnly)
          .catch(() => undefined);
        worldBounds = nextBounds;
        visibleWorldGeneration += 1;
        didCommit = true;
      } catch (error) {
        if (preparedLayer === pending) {
          pending.layer.hidePrepared();
          preparationGeneration += 1;
          preparedLayer = undefined;
          pending.layer.remove();
        }
        if (
          atlasLayer === committedLayer
          && visibleWorldGeneration === committedGeneration
        ) {
          try {
            map.setView(committedCenter, committedZoom, { animate: false });
            await committedLayer.refreshCommitted();
          } catch {
            // Rollback refresh is best effort; preserve the original failure.
          }
        }
        throw error;
      } finally {
        suppressViewportNotifications = false;
      }
      if (didCommit) {
        setMarkerPlacementMode(false);
        if (
          pending.networkPolicy === "legacy-preloaded"
          && prepared.world.source !== "reference"
        ) {
          clearBaseBackdrop();
        } else {
          syncBaseBackdrop(prepared.world);
        }
        applyLocationNames();
        callbacks.onViewportChange(getViewport());
        queueMicrotask(() => atlasLayer.refinePrepared());
      }
    },
    discardPreparedWorld(prepared) {
      const pending = preparedLayer;
      if (!pending || (prepared && pending.generation !== prepared.generation)) return;
      preparationGeneration += 1;
      preparedLayer = undefined;
      pending.layer.remove();
    },
    setViewport(viewport) {
      const center = cellToMapPoint(viewport.center);
      map.setView([center.y, center.x], viewport.zoom, { animate: false });
    },
    setLocations(locations) {
      locationLayer.setLocations(locations);
    },
    setLocationNames(inventory, nextSelectedTypeIds) {
      locationNameInventory = {
        groups: inventory.groups.map((group) => ({
          ...group,
          types: [...group.types]
        })),
        instances: [...inventory.instances]
      };
      selectedLocationTypeIds = [...nextSelectedTypeIds];
      applyLocationNames();
    },
    selectLocation(locationId, options) {
      locationLayer.selectLocation(locationId, options);
    },
    setPlayerMarkers(markers) {
      playerMarkerLayer.setMarkers(markers);
    },
    selectPlayerMarker(markerId) {
      playerMarkerLayer.selectMarker(markerId);
    },
    setMarkerPlacementMode,
    setLayerVisibility(layerId, visible) {
      const definition = getMapLayerDefinition(layerId);
      if (!definition?.available) {
        return;
      }
      if (definition.id === "grid") {
        if (coordinateGrid) {
          coordinateGrid.hidden = !visible;
        }
        return;
      }
      if (definition.id === "terrain") {
        terrainVisible = visible;
        baseBackdrop?.setOpacity(visible ? baseBackdropOpacity : 0);
        void atlasLayer
          .setVisible(visible && !referenceBackdropOnly)
          .catch(() => undefined);
        if (preparedLayer) {
          void preparedLayer.layer
            .setVisible(visible && preparedLayer.world.source !== "reference")
            .catch(() => undefined);
        }
        return;
      }
      if (definition.id === "labels") {
        playerMarkerLayer.setLabelsVisible(visible);
        return;
      }
      if (definition.id === "player-markers") {
        playerMarkerLayer.setVisible(visible);
        return;
      }
      if (definition.id === "poi") {
        poiIconsVisible = visible;
        void applyPoiIconVisibility(atlasLayer, visible).catch(
          () => undefined
        );
      }
      for (const categoryId of definition.categoryIds) {
        locationLayer.setCategoryVisibility(categoryId, visible);
      }
    },
    zoomIn() {
      map.zoomIn(1, { animate: false });
    },
    zoomOut() {
      map.zoomOut(1, { animate: false });
    },
    resetView() {
      if (worldBounds) {
        map.fitBounds(worldBounds, { animate: false });
      }
    },
    getViewport,
    destroy() {
      setMarkerPlacementMode(false);
      locationLayer.destroy();
      poiLabelLayer.destroy();
      playerMarkerLayer.destroy();
      clearBaseBackdrop();
      preparationGeneration += 1;
      preparedLayer?.layer.remove();
      atlasLayer.remove();
      map.off("moveend zoomend", handleViewportChange);
      map.off("click", handleMapClick);
      element.removeEventListener("atlas-error", atlasError);
      element.removeEventListener("atlas-ready", atlasReady);
      map.remove();
      L.DomEvent.off(element);
    }
  };
}
