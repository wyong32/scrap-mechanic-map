import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  MapLocation,
  MapRepository,
  RegionDefinition,
  WorldMap
} from "../domain/map-model";
import type {
  AppController,
  StartAppOptions
} from "./app-controller";
import { startApp as startProductionApp } from "./app-controller";
import {
  createMapView as createProductionMapView,
  type PreparedMapWorld,
  type MapViewCallbacks
} from "../map/map-view";
import { AtlasLayer, type AtlasNetworkPolicy } from "../map/atlas-layer";
import type {
  DecodedSave,
  LuaValue,
  SaveStage
} from "../save/save-protocol";
import type { TileCatalog } from "../terrain/normalize-terrain";
import { SaveParseError } from "../save/save-errors";
import type {
  LegacyAssetBundle,
  LegacyAssetProvider
} from "../legacy/legacy-visual-types";
import { PlayerMarkerStore } from "../player-markers/player-marker-store";
import { isRegionAvailable } from "../domain/region-availability";
import type { SaveParser } from "./save-import-feature";

const regions: RegionDefinition[] = [
  {
    id: "surface",
    name: "\u5730\u8868\u4e16\u754c",
    group: "surface",
    source: "reference",
    bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 }
  },
  {
    id: "grow-lab-1",
    name: "Grow Lab 1",
    group: "grow-lab",
    source: "fixed-region",
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }
  },
  {
    id: "grow-lab-2",
    name: "Grow Lab 2",
    group: "grow-lab",
    source: "fixed-region",
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }
  }
];

function createTestContext(): CanvasRenderingContext2D {
  return {
    clearRect() {},
    fillRect() {},
    fillText() {},
    drawImage() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {}
  } as unknown as CanvasRenderingContext2D;
}

function createMapView(
  element: HTMLElement,
  callbacks: MapViewCallbacks
) {
  return createProductionMapView(element, callbacks, {
    createAtlasLayer(networkPolicy: AtlasNetworkPolicy) {
      return new AtlasLayer({
        networkPolicy,
        contextFactory: () => createTestContext()
      });
    }
  });
}

type TestStartAppOptions = StartAppOptions;

function startApp(
  root: HTMLElement,
  repository: MapRepository,
  options: TestStartAppOptions = {}
): Promise<AppController> {
  const idleSaveClient = {
    parseSave: async () => {
      throw new Error("Unexpected save parse in this test");
    },
    cancel() {},
    dispose() {}
  };
  const createSaveParser = options.createSaveParser
    ?? (async () => idleSaveClient);
  const saveImportEnabled = options.saveImportEnabled
    ?? true;
  return startProductionApp(root, repository, {
    ...options,
    isRegionAvailable: options.isRegionAvailable ?? (() => true),
    saveImportEnabled,
    createSaveParser,
    createMapView: options.createMapView ?? createMapView
  });
}

const locations: MapLocation[] = [
  {
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
  },
  {
    id: "surface-quest",
    regionId: "surface",
    name: "Surface Quest",
    category: "quest",
    precision: "exact",
    position: { x: 1, y: 1 },
    bounds: { minX: 2, minY: 2, maxX: 3, maxY: 3 },
    questIds: ["surface-quest"],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  },
  {
    id: "grow-lab-1",
    regionId: "grow-lab-1",
    name: "Grow Lab 1",
    category: "quest",
    precision: "exact",
    position: { x: 0, y: 0 },
    questIds: ["grow-lab-1"],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  },
  {
    id: "grow-lab-2",
    regionId: "grow-lab-2",
    name: "Grow Lab 2",
    category: "quest",
    precision: "exact",
    position: { x: 0, y: 0 },
    questIds: ["grow-lab-2"],
    resourceIds: [],
    enemyIds: [],
    relatedRegionIds: []
  }
];

class FixtureRepository implements MapRepository {
  loadRegions(): Promise<RegionDefinition[]> {
    return Promise.resolve(regions);
  }

  loadLocations(): Promise<MapLocation[]> {
    return Promise.resolve(locations);
  }

  loadWorld(regionId: string): Promise<WorldMap> {
    return Promise.resolve(createFixtureWorld(regionId));
  }
}

class DeferredRegionRepository extends FixtureRepository {
  private resolveGrowLab?: (world: WorldMap) => void;

  override loadWorld(regionId: string): Promise<WorldMap> {
    if (regionId !== "grow-lab-1") {
      return super.loadWorld(regionId);
    }

    return new Promise((resolve) => {
      this.resolveGrowLab = resolve;
    });
  }

  async releaseGrowLab(): Promise<void> {
    if (!this.resolveGrowLab) {
      throw new Error("Grow Lab load is not pending");
    }
    this.resolveGrowLab(createFixtureWorld("grow-lab-1"));
    await Promise.resolve();
  }
}

class FailingRegionRepository extends FixtureRepository {
  override loadWorld(regionId: string): Promise<WorldMap> {
    if (regionId === "grow-lab-2") return Promise.reject(new Error("generated fixed world integrity failed"));
    return super.loadWorld(regionId);
  }
}

class WarehouseRegionRepository extends FixtureRepository {
  override async loadWorld(regionId: string): Promise<WorldMap> {
    const world = await super.loadWorld(regionId);
    if (regionId !== "surface") return world;
    return {
      ...world,
      cells: [{
        x: 1,
        y: 1,
        uuid: "warehouse-fixture",
        rotation: 0,
        xOffset: 0,
        yOffset: 0,
        flags: 0,
        terrainType: "warehouse",
        poiType: "POI_WAREHOUSE2_LARGE"
      }]
    };
  }
}

class DeferredWarehouseRegionRepository extends WarehouseRegionRepository {
  private resolveGrowLab?: (world: WorldMap) => void;

  override loadWorld(regionId: string): Promise<WorldMap> {
    if (regionId !== "grow-lab-1") return super.loadWorld(regionId);
    return new Promise((resolve) => {
      this.resolveGrowLab = resolve;
    });
  }

  async releaseGrowLab(): Promise<void> {
    if (!this.resolveGrowLab) {
      throw new Error("Grow Lab load is not pending");
    }
    this.resolveGrowLab(await super.loadWorld("grow-lab-1"));
    await Promise.resolve();
  }
}

function createFixtureWorld(regionId: string): WorldMap {
  const region = regions.find((candidate) => candidate.id === regionId);
  if (!region) {
    throw new Error(`Unknown map region: ${regionId}`);
  }

  return {
    id: regionId,
    source: region.source === "reference" ? "reference" : "fixed-region",
    gameVersion: "1.0.0",
    bounds: region.bounds,
    cells: [],
    locations: locations.filter((location) => location.regionId === regionId),
    connections: []
  };
}

let controller: AppController | undefined;

const personalUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const personalCatalog: TileCatalog = {
  gameVersion: "1.0.0",
  tiles: { [personalUuid]: { terrainType: "meadow" } }
};

function fallbackCoverageFor(world: WorldMap): PreparedMapWorld["coverage"] {
  return {
    totalCells: world.cells.length,
    legacyImageCells: 0,
    oneDotZeroImageCells: 0,
    fallbackCells: world.cells.length,
    distinctFallbackUuids: new Set(world.cells.map((cell) => cell.uuid)).size
  };
}

function emptyLegacyBundle(): LegacyAssetBundle {
  return {
    assets: new Map(),
    bridgeByUuid: new Map(),
    poiRules: []
  };
}

function personalSave(fileName: string, seed: number): DecodedSave {
  return {
    metadata: { fileName, saveVersion: 28, seed },
    terrain: {
      gameVersion: "1.0.0",
      bounds: { minX: 1, minY: 1, maxX: 1, maxY: 1 },
      uuids: [personalUuid],
      terrainTypes: ["meadow"],
      poiTypes: [null],
      uuidIndexes: new Uint16Array([0]),
      xOffsets: new Int32Array([0]),
      yOffsets: new Int32Array([0]),
      rotations: new Uint8Array([0]),
      flags: new Int32Array([0])
    },
    connections: [],
    progressRecords: []
  };
}

class DeferredExitRepository extends FixtureRepository {
  private surfaceLoads = 0;
  private resolveExit?: (world: WorldMap) => void;
  private rejectExit?: (error: Error) => void;

  override loadWorld(regionId: string): Promise<WorldMap> {
    if (regionId !== "surface") {
      return super.loadWorld(regionId);
    }
    this.surfaceLoads += 1;
    if (this.surfaceLoads === 1 || this.surfaceLoads > 2) {
      return super.loadWorld(regionId);
    }
    return new Promise((resolve, reject) => {
      this.resolveExit = resolve;
      this.rejectExit = reject;
    });
  }

  async releaseExit(): Promise<void> {
    if (!this.resolveExit) {
      throw new Error("Exit restore is not pending");
    }
    this.resolveExit(createFixtureWorld("surface"));
    await Promise.resolve();
  }

  async failExit(message = "base restore failed"): Promise<void> {
    if (!this.rejectExit) {
      throw new Error("Exit restore is not pending");
    }
    this.rejectExit(new Error(message));
    await Promise.resolve();
  }
}

class FakeSaveClient {
  disposed = false;
  cancelCount = 0;
  cancel() { this.cancelCount += 1; }
  constructor(
    private readonly parse: (
      file: File,
      onProgress: (stage: SaveStage) => void
    ) => Promise<DecodedSave>
  ) {}
  parseSave(file: File, onProgress: (stage: SaveStage) => void) {
    return this.parse(file, onProgress);
  }
  dispose() {
    this.disposed = true;
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(
    null,
    "",
    "/?layers=terrain,poi,quest,resource,danger,grid"
  );
});

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.restoreAllMocks();
});

it("keeps the save runtime and save UI absent by default", async () => {
  const parser = new FakeSaveClient(async (file) => personalSave(file.name, 42));
  const createSaveParser = vi.fn(async () => parser);
  const loadDefaultSave = vi.fn(async () =>
    new File(["SQLite format 3"], "bundled.db")
  );

  controller = await startProductionApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      createSaveParser,
      loadDefaultSave,
      createMapView
    }
  );
  await Promise.resolve();

  expect(createSaveParser).not.toHaveBeenCalled();
  expect(loadDefaultSave).not.toHaveBeenCalled();
  expect(document.querySelector("[data-save-entry]")).toBeNull();

  controller.destroy();
  controller = undefined;
  expect(parser.disposed).toBe(false);
});

it("does not create a save parser when Canvas map startup fails", async () => {
  const saveClient = new FakeSaveClient(async () =>
    personalSave("unused.db", 42)
  );
  const createSaveParser = vi.fn(async () => saveClient);
  const root = document.querySelector<HTMLElement>("#app")!;

  await expect(
    startApp(root, new FixtureRepository(), {
      saveImportEnabled: true,
      createSaveParser,
      createMapView() {
        throw new SaveParseError("UNSUPPORTED_BROWSER", {
          message: "Canvas 2D is unavailable."
        });
      }
    })
  ).rejects.toMatchObject({ code: "UNSUPPORTED_BROWSER" });

  expect(createSaveParser).not.toHaveBeenCalled();
  expect(saveClient.disposed).toBe(false);
  expect(root.childElementCount).toBe(0);
});

it("searches the global catalog but switches the region before selecting its map marker", async () => {
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  expect(document.querySelector("[data-testid='result-count']")?.textContent).toBe(
    "2 locations"
  );
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(2);

  const search = document.querySelector<HTMLInputElement>('[type="search"]')!;
  search.value = "Grow Lab";
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();

  expect(document.querySelector("[data-testid='result-count']")?.textContent).toBe(
    "2 locations"
  );
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(0);

  document
    .querySelector<HTMLButtonElement>('[data-location-id="grow-lab-1"]')!
    .click();

  await vi.waitFor(() => {
    expect(document.querySelector(".detail-panel")?.textContent).toContain(
      "Grow Lab 1"
    );
  });
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(1);
  expect(
    document
      .querySelector('[data-map-location-id="grow-lab-1"]')
      ?.getAttribute("aria-pressed")
  ).toBe("true");
  expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-1");
  expect(new URL(window.location.href).searchParams.get("selected")).toBe(
    "grow-lab-1"
  );
});

it("restores the allowlisted viewport after the initial world fit", async () => {
  window.history.replaceState(
    null,
    "",
    "/?region=surface&z=-2&x=12&y=-8"
  );

  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  const params = new URL(window.location.href).searchParams;
  expect(params.get("z")).toBe("-2");
  expect(params.get("x")).toBe("12");
  expect(params.get("y")).toBe("-8");
});

it("canonicalizes an initial selected location to its owning region", async () => {
  window.history.replaceState(
    null,
    "",
    "/?region=surface&selected=grow-lab-1&layers=terrain,quest"
  );

  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  const params = new URL(window.location.href).searchParams;
  expect(params.get("region")).toBe("grow-lab-1");
  expect(params.get("selected")).toBe("grow-lab-1");
  expect(document.querySelector(".detail-panel")?.textContent).toContain(
    "Grow Lab 1"
  );
  expect(
    document.querySelector('[data-map-location-id="grow-lab-1"]')
  ).not.toBeNull();
});

it("drops an unknown initial selected location", async () => {
  window.history.replaceState(
    null,
    "",
    "/?region=surface&selected=missing-location"
  );

  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  const params = new URL(window.location.href).searchParams;
  expect(params.get("region")).toBe("surface");
  expect(params.has("selected")).toBe(false);
  expect(document.querySelector(".detail-panel")?.textContent).not.toContain(
    "missing-location"
  );
});

it("synchronizes the viewport after selecting a bounded location", async () => {
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  document
    .querySelector<HTMLButtonElement>('[data-location-id="surface-quest"]')!
    .click();

  const params = new URL(window.location.href).searchParams;
  expect(params.get("selected")).toBe("surface-quest");
  expect(params.get("x")).toBe("3");
  expect(params.get("y")).toBe("3");
});

it("preserves a panned viewport through passive query renders", async () => {
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());
  document
    .querySelector<HTMLButtonElement>('[data-location-id="surface-quest"]')!
    .click();
  const map = document.querySelector<HTMLElement>("#map")!;
  map.focus();
  map.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowRight",
      code: "ArrowRight",
      keyCode: 39
    })
  );

  await vi.waitFor(() => {
    expect(new URL(window.location.href).searchParams.get("x")).not.toBe("3");
  });
  const pannedUrl = new URL(window.location.href);
  const pannedViewport = ["z", "x", "y"].map((key) =>
    pannedUrl.searchParams.get(key)
  );
  const search = document.querySelector<HTMLInputElement>('[type="search"]')!;
  search.value = "Surface";
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();

  expect(document.querySelector("[data-testid='result-count']")?.textContent).toBe(
    "1 location"
  );
  expect(
    ["z", "x", "y"].map((key) =>
      new URL(window.location.href).searchParams.get(key)
    )
  ).toEqual(pannedViewport);

});

it("keeps a newer active-region selection when an older region load resolves", async () => {
  const repository = new DeferredRegionRepository();
  controller = await startApp(document.querySelector("#app")!, repository);
  const search = document.querySelector<HTMLInputElement>('[type="search"]')!;

  search.value = "Grow Lab 1";
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();
  document
    .querySelector<HTMLButtonElement>('[data-location-id="grow-lab-1"]')!
    .click();

  search.value = "";
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();
  document
    .querySelector<HTMLButtonElement>('[data-location-id="surface-quest"]')!
    .click();
  await repository.releaseGrowLab();

  const params = new URL(window.location.href).searchParams;
  expect(params.get("region")).toBe("surface");
  expect(params.get("selected")).toBe("surface-quest");
  expect(document.querySelector(".detail-panel")?.textContent).toContain(
    "Surface Quest"
  );
});

it("keeps the current world and URL state when a selected region fails to load", async () => {
  controller = await startApp(document.querySelector("#app")!, new FailingRegionRepository());
  document.querySelector<HTMLButtonElement>('[data-region-id="grow-lab-2"]')!.click();
  await vi.waitFor(() => expect(document.querySelector("[data-status]")?.textContent).toContain("generated fixed world integrity failed"));
  expect(new URL(window.location.href).searchParams.get("region")).toBe("surface");
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(2);
});

it("applies URL category and layer filters without serializing save metadata", async () => {
  window.history.replaceState(
    null,
    "",
    "/?region=surface&cat=quest&layers=quest&save=secret&seed=123#save=Survival-Secret.db&seed=123"
  );
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  expect(document.querySelector("[data-testid='result-count']")?.textContent).toBe(
    "1 location"
  );
  expect(
    document.querySelector('[data-map-location-id="surface-quest"]')
  ).not.toBeNull();
  expect(
    document.querySelector('[data-map-location-id="mechanic-station"]')
  ).toBeNull();

  const file = new File(["SQLite format 3"], "Survival-Secret.db");
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));

  expect(document.querySelector("[data-status]")?.textContent).toBe(
    "Reading the local save…"
  );
  const url = decodeURIComponent(window.location.href);
  expect(url).not.toContain("save=");
  expect(url).not.toContain("seed=");
  expect(url).not.toContain("Survival-Secret.db");
  expect(window.location.hash).toBe("");
});

it("retains an available terrain-only layer selection without accepting unknown IDs", async () => {
  window.history.replaceState(
    null,
    "",
    "/?region=surface&layers=terrain,not-a-map-layer"
  );

  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(0);
  expect(new URL(window.location.href).searchParams.get("layers")).toBe("terrain");
});

it("synchronizes user-operated zoom and reset controls to the URL readout", async () => {
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());
  const zoomIn = document.querySelector<HTMLButtonElement>("[data-map-zoom-in]")!;
  const reset = document.querySelector<HTMLButtonElement>("[data-map-reset]")!;

  zoomIn.click();
  expect(new URL(window.location.href).searchParams.get("z")).toBe("-2");
  expect(document.querySelector("[data-map-readout]")?.textContent).toContain(
    "Zoom -2"
  );

  const map = document.querySelector<HTMLElement>("#map")!;
  map.focus();
  map.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowRight",
      code: "ArrowRight",
      keyCode: 39
    })
  );
  await vi.waitFor(() => {
    expect(new URL(window.location.href).searchParams.get("x")).not.toBe("0");
  });

  reset.click();
  const params = new URL(window.location.href).searchParams;
  expect(params.get("x")).toBe("0.5");
  expect(params.get("y")).toBe("0.5");
  expect(document.querySelector("[data-map-readout]")?.textContent).toContain(
    "X 0.5 \u00b7 Y 0.5"
  );
});

it("switches only after a decoded personal overview is ready and keeps base interactions", async () => {
  const saveClient = new FakeSaveClient(async (file, onProgress) => {
    onProgress("sqlite");
    onProgress("normalizing");
    return personalSave(file.name, 42);
  });
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      createSaveParser: async () => saveClient,
      loadTileCatalog: async () => personalCatalog
    }
  );

  const file = new File(["SQLite format 3"], "My World.db");
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await vi.waitFor(() => {
    expect(document.querySelector("[data-mode-badge]")?.textContent).toContain("Personal Map");
  });
  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("My World.db");
  expect(document.querySelector("[data-mode-meta]")?.textContent).toContain("Seed 42");
  expect(document.querySelector("[data-mode-meta]")?.textContent).toContain("Save Version 28");
  expect(document.querySelector(".save-entry__button")?.textContent).toContain("Replace Save");
  expect(document.querySelector("[data-terrain-coverage]")?.textContent).toContain(
    "Missing images 1 cell"
  );
  expect(document.querySelectorAll("[data-region-id]")).toHaveLength(6);
  expect(document.querySelector("[data-testid='result-count']")?.textContent).toBe(
    "2 locations"
  );
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(2);
  expect(decodeURIComponent(window.location.href)).not.toContain("My World.db");
  expect(window.location.href).not.toContain("42");
});

it("shares async parser creation and lets only the newest selection parse", async () => {
  let releaseParser!: (parser: SaveParser) => void;
  const parserPromise = new Promise<SaveParser>((resolve) => {
    releaseParser = resolve;
  });
  const saveClient = new FakeSaveClient(async (file) => personalSave(file.name, 42));
  const createSaveParser = vi.fn(() => parserPromise);
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    createSaveParser,
    loadTileCatalog: async () => personalCatalog
  });

  await selectSave("Older Factory.db");
  await selectSave("Newer Factory.db");
  expect(createSaveParser).toHaveBeenCalledOnce();
  releaseParser(saveClient);

  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent)
      .toBe("Newer Factory.db")
  );
  expect(createSaveParser).toHaveBeenCalledOnce();
});

it("does not parse a selection superseded while parser creation is pending", async () => {
  let releaseParser!: (parser: SaveParser) => void;
  const parserPromise = new Promise<SaveParser>((resolve) => {
    releaseParser = resolve;
  });
  const saveClient = new FakeSaveClient(async (file) => personalSave(file.name, 42));
  const parseSave = vi.spyOn(saveClient, "parseSave");
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    createSaveParser: () => parserPromise,
    loadTileCatalog: async () => personalCatalog
  });

  await selectSave("Superseded Factory.db");
  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-2")
  );
  releaseParser(saveClient);
  await Promise.resolve();
  await Promise.resolve();

  expect(parseSave).not.toHaveBeenCalled();
  expect(document.querySelector("[data-mode-badge]")?.textContent).toContain("Base Map");
});

it("disposes a parser that resolves after destroy", async () => {
  let releaseParser!: (parser: SaveParser) => void;
  const parserPromise = new Promise<SaveParser>((resolve) => {
    releaseParser = resolve;
  });
  const saveClient = new FakeSaveClient(async (file) => personalSave(file.name, 42));
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    createSaveParser: () => parserPromise,
    loadTileCatalog: async () => personalCatalog
  });

  await selectSave("Late Parser.db");
  controller.destroy();
  controller = undefined;
  releaseParser(saveClient);
  await Promise.resolve();
  await Promise.resolve();

  expect(saveClient.disposed).toBe(true);
});

it("keeps Base Map usable and reports async parser factory rejection", async () => {
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    createSaveParser: async () => {
      throw new Error("parser factory unavailable");
    },
    loadTileCatalog: async () => personalCatalog
  });

  await selectSave("Factory Failure.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-status]")?.textContent)
      .toContain("parser factory unavailable")
  );

  expect(document.querySelector("[data-mode-badge]")?.textContent).toContain("Base Map");
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(2);
  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-1']")!.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-1")
  );
});

it("loads a configured bundled save automatically on startup", async () => {
  const saveClient = new FakeSaveClient(async (file, onProgress) => {
    onProgress("sqlite");
    return personalSave(file.name, 360160198);
  });
  const bundledSave = new File(["SQLite format 3"], "bilige.db");

  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      createSaveParser: async () => saveClient,
      loadTileCatalog: async () => personalCatalog,
      loadDefaultSave: async () => bundledSave
    }
  );

  await vi.waitFor(() => {
    expect(document.querySelector("[data-mode-badge]")?.textContent).toContain(
      "Personal Map"
    );
  });
  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("bilige.db");
  expect(document.querySelector("[data-mode-meta]")?.textContent).toContain(
    "Seed 360160198"
  );
});

it("keeps zoom controls and URL state saturated at the supported bounds", async () => {
  window.history.replaceState(null, "", "/?z=-5");
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  const zoomOut = document.querySelector<HTMLButtonElement>("[data-map-zoom-out]")!;
  expect(zoomOut.disabled).toBe(true);
  zoomOut.click();
  expect(new URL(window.location.href).searchParams.get("z")).toBe("-3");
  expect(document.querySelector("[data-map-readout]")?.textContent).toContain("Zoom -3");

  controller.destroy();
  controller = undefined;
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, "", "/?z=0");
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository());

  const zoomIn = document.querySelector<HTMLButtonElement>("[data-map-zoom-in]")!;
  expect(zoomIn.disabled).toBe(true);
  zoomIn.click();
  expect(new URL(window.location.href).searchParams.get("z")).toBe("0");
  expect(document.querySelector("[data-map-readout]")?.textContent).toContain("Zoom 0");
});

it("does not request optional terrain assets for the base map", async () => {
  const provider: LegacyAssetProvider = {
    loadForCells: vi.fn(async () => emptyLegacyBundle()),
    destroy: vi.fn()
  };

  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    { legacyAssetProvider: provider }
  );

  expect(provider.loadForCells).not.toHaveBeenCalled();
});

it("loads optional terrain for materialized save cells before map preparation", async () => {
  const bundle = emptyLegacyBundle();
  const loadForCells = vi.fn(async (
    _cells: WorldMap["cells"],
    _policy?: "legacy-fallback" | "official-1.0-only"
  ) => bundle);
  const provider: LegacyAssetProvider = {
    loadForCells,
    destroy: vi.fn()
  };
  const prepareWorld = vi.fn(
    async (
      world: WorldMap,
      _overview?: DecodedSave["overview"],
      _bundle?: LegacyAssetBundle
    ): Promise<PreparedMapWorld> => ({
      world,
      generation: 1,
      coverage: fallbackCoverageFor(world)
    })
  );
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      legacyAssetProvider: provider,
      createSaveParser: async () => new FakeSaveClient(async (file) => personalSave(file.name, 42)),
      loadTileCatalog: async () => personalCatalog,
      createMapView(element, callbacks) {
        const real = createMapView(element, callbacks);
        return {
          ...real,
          prepareWorld,
          async commitPreparedWorld() {}
        };
      }
    }
  );

  await selectSave("Private Layout.db");
  await vi.waitFor(() => expect(prepareWorld).toHaveBeenCalledOnce());

  const candidateWorld = prepareWorld.mock.calls[0]![0];
  expect(loadForCells).toHaveBeenCalledOnce();
  expect(loadForCells.mock.calls[0]![0]).toBe(candidateWorld.cells);
  expect(loadForCells.mock.calls[0]![1]).toBe("official-1.0-only");
  expect(candidateWorld.cells).toEqual([
    expect.objectContaining({ uuid: personalUuid, x: 1, y: 1 })
  ]);
  expect(loadForCells.mock.invocationCallOrder[0]).toBeLessThan(
    prepareWorld.mock.invocationCallOrder[0]!
  );
  expect(prepareWorld.mock.calls[0]![2]).toBe(bundle);
});

it("keeps the decoded save overview when optional terrain loading fails", async () => {
  const failure = new Error("optional terrain integrity failed");
  const provider: LegacyAssetProvider = {
    loadForCells: vi.fn(async () => Promise.reject(failure)),
    destroy: vi.fn()
  };
  const overview = {
    bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    width: 1,
    height: 1
  };
  const prepareWorld = vi.fn(
    async (
      world: WorldMap,
      receivedOverview?: DecodedSave["overview"],
      bundle?: LegacyAssetBundle
    ): Promise<PreparedMapWorld> => {
      receivedOverview?.bitmap.close();
      expect(receivedOverview).toBe(overview);
      expect(bundle).toBeUndefined();
      return {
        world,
        generation: 1,
        coverage: fallbackCoverageFor(world)
      };
    }
  );
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      legacyAssetProvider: provider,
      createSaveParser: async () => new FakeSaveClient(async (file) => ({
        ...personalSave(file.name, 42),
        overview
      })),
      loadTileCatalog: async () => personalCatalog,
      createMapView(element, callbacks) {
        const real = createMapView(element, callbacks);
        return {
          ...real,
          prepareWorld,
          async commitPreparedWorld() {}
        };
      }
    }
  );

  await selectSave("Overview Fallback.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent).toBe(
      "Overview Fallback.db"
    )
  );

  expect(prepareWorld).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-status]")?.textContent).toContain(
    "optional terrain integrity failed"
  );
  expect(document.querySelector("[data-status]")?.textContent).toContain(
    "overview"
  );
});

it("does not let a replaced save commit a late optional terrain bundle", async () => {
  let releaseOlder!: (bundle: LegacyAssetBundle) => void;
  const olderBundle = emptyLegacyBundle();
  const newerBundle = emptyLegacyBundle();
  const closeOlderOverview = vi.fn();
  let loadCount = 0;
  const loadForCells = vi.fn((_cells: WorldMap["cells"]) => {
    loadCount += 1;
    return loadCount === 1
      ? new Promise<LegacyAssetBundle>((resolve) => (releaseOlder = resolve))
      : Promise.resolve(newerBundle);
  });
  const provider: LegacyAssetProvider = {
    loadForCells,
    destroy: vi.fn()
  };
  const prepareWorld = vi.fn(
    async (
      world: WorldMap,
      _overview?: DecodedSave["overview"],
      _bundle?: LegacyAssetBundle
    ): Promise<PreparedMapWorld> => ({
      world,
      generation: 1,
      coverage: fallbackCoverageFor(world)
    })
  );
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      legacyAssetProvider: provider,
      createSaveParser: async () => new FakeSaveClient(async (file) => ({
        ...personalSave(file.name, 42),
        ...(file.name === "Older.db"
          ? {
              overview: {
                bitmap: { close: closeOlderOverview } as unknown as ImageBitmap,
                width: 1,
                height: 1
              }
            }
          : {})
      })),
      loadTileCatalog: async () => personalCatalog,
      createMapView(element, callbacks) {
        const real = createMapView(element, callbacks);
        return {
          ...real,
          prepareWorld,
          async commitPreparedWorld() {}
        };
      }
    }
  );

  await selectSave("Older.db");
  await vi.waitFor(() => expect(loadForCells).toHaveBeenCalledOnce());
  await selectSave("Newer.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent).toBe(
      "Newer.db"
    )
  );
  expect(closeOlderOverview).not.toHaveBeenCalled();

  releaseOlder(olderBundle);
  await Promise.resolve();
  await Promise.resolve();

  expect(closeOlderOverview).toHaveBeenCalledOnce();
  expect(prepareWorld.mock.calls).toHaveLength(1);
  expect(prepareWorld.mock.calls[0]![2]).toBe(newerBundle);
  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Newer.db");
});

it("destroys the optional terrain provider exactly once", async () => {
  const provider: LegacyAssetProvider = {
    loadForCells: vi.fn(async () => emptyLegacyBundle()),
    destroy: vi.fn()
  };
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    { legacyAssetProvider: provider }
  );

  controller.destroy();
  controller.destroy();

  expect(provider.destroy).toHaveBeenCalledOnce();
});

it("keeps the visible personal map when a replacement fails", async () => {
  let attempt = 0;
  const saveClient = new FakeSaveClient(async (file) => {
    attempt += 1;
    if (attempt === 2) {
      throw new SaveParseError("DECODE_FAILED", { message: "Terrain data is damaged." });
    }
    return personalSave(file.name, 42);
  });
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog
  });

  await selectSave("First.db");
  await vi.waitFor(() => expect(document.querySelector("[data-mode-file]")?.textContent).toBe("First.db"));
  const committedCoverage = document.querySelector("[data-terrain-coverage]")?.textContent;
  await selectSave("Broken.db");
  await vi.waitFor(() => expect(document.querySelector("[data-status]")?.textContent).toContain("Terrain data is damaged."));

  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("First.db");
  expect(document.querySelector("[data-mode-meta]")?.textContent).toContain("Seed 42");
  expect(document.querySelector("[data-terrain-coverage]")?.textContent).toBe(
    committedCoverage
  );
});

it("ignores an older save completion and exits to the unchanged base world", async () => {
  let releaseOlder!: (save: DecodedSave) => void;
  const older = new Promise<DecodedSave>((resolve) => { releaseOlder = resolve; });
  const saveClient = new FakeSaveClient((file) =>
    file.name === "Older.db" ? older : Promise.resolve(personalSave(file.name, 84))
  );
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog
  });

  await selectSave("Older.db");
  await selectSave("Newer.db");
  await vi.waitFor(() => expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Newer.db"));
  releaseOlder(personalSave("Older.db", 42));
  await Promise.resolve();
  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Newer.db");

  document.querySelector<HTMLButtonElement>(".exit-save-button")!.click();
  await vi.waitFor(() => expect(document.querySelector("[data-mode-badge]")?.textContent).toContain("Base Map"));
  expect(document.querySelector("[data-mode-file]")?.hasAttribute("hidden")).toBe(true);
  expect(document.querySelector("[data-terrain-coverage]")?.textContent).toContain(
    "Select a Scrap Mechanic 1.0 Survival save"
  );
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(2);
});

it("does not let a stale Exit completion overwrite newer fixed-region navigation", async () => {
  const repository = new DeferredExitRepository();
  const saveClient = new FakeSaveClient((file) =>
    Promise.resolve(personalSave(file.name, 42))
  );
  const renderedWorldIds: string[] = [];
  controller = await startApp(document.querySelector("#app")!, repository, {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog,
    createMapView(element, callbacks) {
      const real = createMapView(element, callbacks);
      return {
        ...real,
        setWorld(nextWorld) {
          renderedWorldIds.push(nextWorld.id);
          real.setWorld(nextWorld);
        }
      };
    }
  });
  await selectSave("Personal.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Personal.db")
  );

  document.querySelector<HTMLButtonElement>(".exit-save-button")!.click();
  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-2")
  );
  await repository.releaseExit();

  expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-2");
  expect(renderedWorldIds.at(-1)).toBe("grow-lab-2");
  expect(document.querySelector("[data-map-location-id='grow-lab-2']")).not.toBeNull();
  expect(document.querySelector("[data-map-location-id='mechanic-station']")).toBeNull();
});

it("retains the complete personal transaction when Exit restoration fails", async () => {
  const repository = new DeferredExitRepository();
  const saveClient = new FakeSaveClient((file) =>
    Promise.resolve(personalSave(file.name, 42))
  );
  const renderedWorldIds: string[] = [];
  controller = await startApp(document.querySelector("#app")!, repository, {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog,
    createMapView(element, callbacks) {
      const real = createMapView(element, callbacks);
      return {
        ...real,
        setWorld(nextWorld) {
          renderedWorldIds.push(nextWorld.id);
          real.setWorld(nextWorld);
        }
      };
    }
  });
  await selectSave("Personal.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Personal.db")
  );
  const committed = document.querySelector("canvas[data-terrain-frame='committed']");

  document.querySelector<HTMLButtonElement>(".exit-save-button")!.click();
  await repository.failExit();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-status]")?.textContent).toContain("base restore failed")
  );

  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Personal.db");
  expect(document.querySelector("[data-mode-meta]")?.textContent).toContain("Seed 42");
  expect(document.querySelector("canvas[data-terrain-frame='committed']")).toBe(committed);

  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-2")
  );
  document.querySelector<HTMLButtonElement>("[data-region-id='surface']")!.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region")).toBe("surface")
  );

  expect(renderedWorldIds.at(-1)).toBe("personal-surface");
  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Personal.db");
});

it("prevents an older fixed-region load from overwriting a committed personal map", async () => {
  const repository = new DeferredRegionRepository();
  const saveClient = new FakeSaveClient((file) =>
    Promise.resolve(personalSave(file.name, 42))
  );
  controller = await startApp(document.querySelector("#app")!, repository, {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog
  });

  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-1']")!.click();
  await selectSave("Personal.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Personal.db")
  );
  await repository.releaseGrowLab();

  expect(document.querySelector("[data-mode-file]")?.textContent).toBe("Personal.db");
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(2);
});

it("rolls back a prepared save when visible map commit throws", async () => {
  const saveClient = new FakeSaveClient((file) =>
    Promise.resolve(personalSave(file.name, 42))
  );
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog,
    createMapView(element, callbacks) {
      const real = createMapView(element, callbacks);
      return {
        ...real,
        async commitPreparedWorld() {
          throw new Error("commit failed");
        }
      };
    }
  });

  await selectSave("Candidate.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-status]")?.textContent).toContain("commit failed")
  );
  expect(document.querySelector("[data-mode-badge]")?.textContent).toContain("Base Map");
  expect(document.querySelector("[data-mode-file]")?.hasAttribute("hidden")).toBe(true);
  expect(
    document.querySelector<HTMLElement>("[data-terrain-coverage]")?.dataset.personal
  ).toBe("false");
  expect(document.querySelectorAll("[data-terrain-frame='prepared']")).toHaveLength(0);
  expect(document.querySelectorAll("[data-map-location-id]")).toHaveLength(2);
});

it("lets newer region navigation cancel an older save completion", async () => {
  let release!: (save: DecodedSave) => void;
  const pending = new Promise<DecodedSave>((resolve) => { release = resolve; });
  const saveClient = new FakeSaveClient(() => pending);
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog
  });
  await selectSave("Older.db");
  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-2")
  );
  release(personalSave("Older.db", 42));
  await Promise.resolve();
  expect(new URL(window.location.href).searchParams.get("region")).toBe("grow-lab-2");
  expect(document.querySelector("[data-mode-badge]")?.textContent).toContain("Base Map");
  expect(
    document.querySelector<HTMLElement>("[data-terrain-coverage]")?.dataset.personal
  ).toBe("false");
  expect(saveClient.cancelCount).toBeGreaterThanOrEqual(2);
});

it("does not publish an older save after its deferred map commit is superseded", async () => {
  let releaseCommit!: () => void;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const commitPreparedWorld = vi.fn(() => commitGate);
  const saveClient = new FakeSaveClient((file) =>
    Promise.resolve(personalSave(file.name, 42))
  );
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      createSaveParser: async () => saveClient,
      loadTileCatalog: async () => personalCatalog,
      createMapView(element, callbacks) {
        const real = createMapView(element, callbacks);
        return {
          ...real,
          commitPreparedWorld
        };
      }
    }
  );

  await selectSave("Deferred Commit.db");
  await vi.waitFor(() => expect(commitPreparedWorld).toHaveBeenCalledOnce());
  document
    .querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!
    .click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region")).toBe(
      "grow-lab-2"
    )
  );

  releaseCommit();
  await Promise.resolve();
  await Promise.resolve();

  expect(new URL(window.location.href).searchParams.get("region")).toBe(
    "grow-lab-2"
  );
  expect(document.querySelector("[data-mode-badge]")?.textContent)
    .toContain("Base Map");
  expect(document.querySelector("[data-mode-file]")?.hasAttribute("hidden"))
    .toBe(true);
  expect(
    document.querySelector<HTMLElement>("[data-terrain-coverage]")?.dataset
      .personal
  ).toBe("false");
});

it("cancels the active save before awaiting a replacement catalog", async () => {
  const never = new Promise<DecodedSave>(() => undefined);
  const saveClient = new FakeSaveClient(() => never);
  let catalogCalls = 0;
  let releaseCatalog!: () => void;
  const delayedCatalog = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
      createSaveParser: async () => saveClient,
    async loadTileCatalog() {
      catalogCalls += 1;
      if (catalogCalls === 2) await delayedCatalog;
      return personalCatalog;
    }
  });
  await selectSave("First.db");
  const before = saveClient.cancelCount;
  void selectSave("Replacement.db");
  expect(saveClient.cancelCount).toBe(before + 1);
  releaseCatalog();
});

it("player marker workflow creates, restores, edits, and deletes in the default scope", async () => {
  window.history.replaceState(
    null,
    "",
    "/?layers=terrain,player-markers"
  );
  const storage = new MemoryStorage();
  const store = deterministicPlayerMarkerStore(storage);
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      playerMarkerStore: store,
      createMapView(element, callbacks) {
        mapCallbacks = callbacks;
        return createMapView(element, callbacks);
      }
    }
  );

  clickNamedButton("Add Marker");
  expect(document.querySelector("[data-status]")?.textContent).toContain(
    "Select a map position"
  );
  mapCallbacks.onMarkerPlacement({ x: 8, y: -3 });
  submitMarker({ name: "Oil pond", type: "resource", notes: "Pump later" });

  expect(store.list("default", "surface")).toHaveLength(1);
  expect(playerMarkerCards()).toHaveLength(1);
  expect(playerMarkerCards()[0]?.getAttribute("aria-current")).toBe("true");
  expect(document.activeElement).toMatchObject({
    dataset: expect.objectContaining({ playerMarkerId: "marker-1" })
  });
  mapCallbacks.onPlayerMarkerSelect("marker-1");
  expect(playerMarkerCards()[0]?.getAttribute("aria-current")).toBe("true");
  expect(document.querySelector(".detail-panel")?.textContent).toContain("Oil pond");
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.focus();
  search.value = "oil";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.activeElement).toBe(search);
  clickNamedButton("Edit");
  submitMarker({ name: "Oil source" }, "Save Changes");
  expect(store.list("default", "surface")[0]?.name).toBe("Oil source");

  clickNamedButton("Delete");
  clickNamedButton("Delete Marker");
  expect(store.list("default", "surface")).toEqual([]);
  expect(playerMarkerCards()).toHaveLength(0);
});

it("keeps list, map, and details selection synchronized for both origins", async () => {
  window.history.replaceState(null, "", "/?layers=terrain,player-markers");
  const store = deterministicPlayerMarkerStore(new MemoryStorage());
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 2, y: 3 },
    name: "Cotton field",
    type: "resource",
    notes: "Bring crates"
  });
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 5, y: 6 },
    name: "Hill base",
    type: "base",
    notes: ""
  });
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      playerMarkerStore: store,
      createMapView(element, callbacks) {
        mapCallbacks = callbacks;
        return createMapView(element, callbacks);
      }
    }
  );

  clickNamedButton("Add Marker");
  expect(document.querySelector("[data-status]")?.textContent).toContain(
    "Select a map position"
  );
  mapCallbacks.onPlayerMarkerSelect("marker-1");

  expect(playerMarkerCard("marker-1").getAttribute("aria-current")).toBe("true");
  expect(playerMarkerCard("marker-2").hasAttribute("aria-current")).toBe(false);
  expect(mapPlayerMarker("marker-1").getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector(".detail-panel")?.textContent)
    .toContain("Cotton field");
  expect(document.querySelector("[data-status]")?.textContent).toBe("");
  expect(document.querySelector<HTMLElement>("#map")?.dataset.markerPlacement)
    .toBe("false");

  playerMarkerCard("marker-2").click();

  expect(playerMarkerCard("marker-1").hasAttribute("aria-current")).toBe(false);
  expect(playerMarkerCard("marker-2").getAttribute("aria-current")).toBe("true");
  expect(mapPlayerMarker("marker-1").getAttribute("aria-pressed")).toBe("false");
  expect(mapPlayerMarker("marker-2").getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector(".detail-panel")?.textContent)
    .toContain("Hill base");
});

it("player marker search includes notes and type filters stay separate in URL state", async () => {
  const store = deterministicPlayerMarkerStore(new MemoryStorage());
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 2, y: 3 },
    name: "Cotton field",
    type: "resource",
    notes: "Bring crates"
  });
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 5, y: 7 },
    name: "Hill camp",
    type: "base",
    notes: ""
  });

  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    playerMarkerStore: store
  });
  expect(playerMarkerCards()).toHaveLength(2);

  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = "crates";
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();
  expect(playerMarkerCards()).toHaveLength(1);
  expect(playerMarkerCards()[0]?.textContent).toContain("Cotton field");

  search.value = "";
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();
  const baseType = document.querySelector<HTMLInputElement>(
    '#player-marker-type-filters [value="base"]'
  )!;
  baseType.checked = false;
  baseType.dispatchEvent(new Event("change", { bubbles: true }));

  expect(playerMarkerCards()).toHaveLength(1);
  expect(playerMarkerCards()[0]?.textContent).toContain("Cotton field");
  const params = new URL(window.location.href).searchParams;
  expect(params.get("markers")).toBe("danger,note,resource,vehicle");
  expect(params.has("cat")).toBe(false);
});

it("player marker scopes restore the same imported layout without exposing another", async () => {
  const store = deterministicPlayerMarkerStore(new MemoryStorage());
  const saveClient = new FakeSaveClient(async (file) =>
    personalSave(file.name, file.name.startsWith("World B") ? 84 : 42)
  );
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      playerMarkerStore: store,
      createSaveParser: async () => saveClient,
      loadTileCatalog: async () => personalCatalog,
      createMapView(element, callbacks) {
        mapCallbacks = callbacks;
        return createMapView(element, callbacks);
      }
    }
  );

  await importPlayerSave("World A.db");
  clickNamedButton("Add Marker");
  mapCallbacks.onMarkerPlacement({ x: 1, y: 1 });
  submitMarker({ name: "Save A base", type: "base", notes: "" });
  expect(playerMarkerCards()).toHaveLength(1);

  await exitPlayerSave();
  await importPlayerSave("World B.db");
  expect(playerMarkerCards()).toHaveLength(0);

  await exitPlayerSave();
  await importPlayerSave("World A Renamed.db");
  expect(playerMarkerCards()).toHaveLength(1);
  expect(playerMarkerCards()[0]?.textContent).toContain("Save A base");
});

it("player marker write failures keep the entered editor values open", async () => {
  const store = deterministicPlayerMarkerStore(new MemoryStorage(undefined, true));
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    {
      playerMarkerStore: store,
      createMapView(element, callbacks) {
        mapCallbacks = callbacks;
        return createMapView(element, callbacks);
      }
    }
  );

  clickNamedButton("Add Marker");
  mapCallbacks.onMarkerPlacement({ x: 3, y: 4 });
  submitMarker({ name: "Keep this", type: "note", notes: "Unsaved" });

  expect(document.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value)
    .toBe("Keep this");
  expect(document.querySelector("[data-player-marker-error]")?.textContent)
    .toBe("Player marker could not be saved.");
  expect(playerMarkerCards()).toHaveLength(0);
});

it("player marker load warnings are surfaced and drafts cancel on region changes", async () => {
  const store = deterministicPlayerMarkerStore(new MemoryStorage("{"));
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(
    document.querySelector("#app")!,
    new FailingRegionRepository(),
    {
      playerMarkerStore: store,
      createMapView(element, callbacks) {
        mapCallbacks = callbacks;
        return createMapView(element, callbacks);
      }
    }
  );
  expect(document.querySelector("[data-status]")?.textContent).toBe(
    "Saved player markers could not be read."
  );

  clickNamedButton("Add Marker");
  mapCallbacks.onMarkerPlacement({ x: 3, y: 4 });
  expect(document.querySelector('[data-marker-editor-mode="create"]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-status]")?.textContent)
      .toContain("generated fixed world integrity failed")
  );

  expect(document.querySelector('[data-marker-editor-mode="create"]')).toBeNull();
  expect(document.querySelector<HTMLElement>("#map")?.dataset.markerPlacement)
    .toBe("false");
});

it("clears the placement announcement after a successful region change", async () => {
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository(),
    { playerMarkerStore: deterministicPlayerMarkerStore(new MemoryStorage()) }
  );

  clickNamedButton("Add Marker");
  expect(document.querySelector("[data-status]")?.textContent).toContain(
    "Select a map position"
  );
  document.querySelector<HTMLButtonElement>(
    "[data-region-id='grow-lab-1']"
  )!.click();

  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region"))
      .toBe("grow-lab-1")
  );
  expect(document.querySelector("[data-status]")?.textContent).toBe("");
  expect(document.querySelector<HTMLElement>("#map")?.dataset.markerPlacement)
    .toBe("false");
});

it("starts with an empty warning state when browser storage is unavailable", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Storage access denied", "SecurityError");
  });

  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository()
  );

  expect(document.querySelector("[data-status]")?.textContent).toBe(
    "Saved player markers could not be read."
  );
});

it("does not carry marker work started during a pending region change into the new region", async () => {
  const repository = new DeferredRegionRepository();
  const store = deterministicPlayerMarkerStore(new MemoryStorage());
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(document.querySelector("#app")!, repository, {
    playerMarkerStore: store,
    createMapView(element, callbacks) {
      mapCallbacks = callbacks;
      return createMapView(element, callbacks);
    }
  });

  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-1']")!.click();
  clickNamedButton("Add Marker");
  mapCallbacks.onMarkerPlacement({ x: 11, y: 12 });
  await repository.releaseGrowLab();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region"))
      .toBe("grow-lab-1")
  );

  expect(document.querySelector('[data-marker-editor-mode="create"]')).toBeNull();
  expect(document.querySelector<HTMLElement>("#map")?.dataset.markerPlacement)
    .toBe("false");
  expect(document.querySelector<HTMLButtonElement>("[data-marker-add]")?.disabled)
    .toBe(false);
  expect(store.list("default", "grow-lab-1")).toEqual([]);
});

it("does not carry marker work started during a pending save import into its scope", async () => {
  let releaseSave!: (save: DecodedSave) => void;
  let parseStarted = false;
  const pendingSave = new Promise<DecodedSave>((resolve) => {
    releaseSave = resolve;
  });
  const saveClient = new FakeSaveClient(() => {
    parseStarted = true;
    return pendingSave;
  });
  const store = deterministicPlayerMarkerStore(new MemoryStorage());
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    playerMarkerStore: store,
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog,
    createMapView(element, callbacks) {
      mapCallbacks = callbacks;
      return createMapView(element, callbacks);
    }
  });

  await selectSave("Pending.db");
  await vi.waitFor(() => expect(parseStarted).toBe(true));
  clickNamedButton("Add Marker");
  mapCallbacks.onMarkerPlacement({ x: 21, y: 22 });
  releaseSave(personalSave("Pending.db", 42));
  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent)
      .toBe("Pending.db")
  );

  expect(document.querySelector('[data-marker-editor-mode="create"]')).toBeNull();
  expect(document.querySelector<HTMLElement>("#map")?.dataset.markerPlacement)
    .toBe("false");
  expect(document.querySelector<HTMLButtonElement>("[data-marker-add]")?.disabled)
    .toBe(false);
  expect(playerMarkerCards()).toEqual([]);
});

it("does not carry marker work started during pending personal-map exit into base mode", async () => {
  const repository = new DeferredExitRepository();
  const saveClient = new FakeSaveClient(async (file) => personalSave(file.name, 42));
  let mapCallbacks!: MapViewCallbacks;
  controller = await startApp(document.querySelector("#app")!, repository, {
      createSaveParser: async () => saveClient,
    loadTileCatalog: async () => personalCatalog,
    createMapView(element, callbacks) {
      mapCallbacks = callbacks;
      return createMapView(element, callbacks);
    }
  });
  await importPlayerSave("Personal.db");

  document.querySelector<HTMLButtonElement>(".exit-save-button")!.click();
  clickNamedButton("Add Marker");
  mapCallbacks.onMarkerPlacement({ x: 31, y: 32 });
  await repository.releaseExit();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>(".app-shell")?.dataset.appMode)
      .toBe("base")
  );

  expect(document.querySelector('[data-marker-editor-mode="create"]')).toBeNull();
  expect(document.querySelector<HTMLElement>("#map")?.dataset.markerPlacement)
    .toBe("false");
  expect(document.querySelector<HTMLButtonElement>("[data-marker-add]")?.disabled)
    .toBe(false);
});

it("keeps the selected marker and announces a failed delete", async () => {
  const storage = new MemoryStorage();
  const store = deterministicPlayerMarkerStore(storage);
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 4, y: 5 },
    name: "Keep marker",
    type: "note",
    notes: ""
  });
  storage.setFailWrites(true);
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    playerMarkerStore: store
  });

  playerMarkerCards()[0]!.click();
  clickNamedButton("Delete");
  clickNamedButton("Delete Marker");

  expect(store.list("default", "surface")).toHaveLength(1);
  expect(document.querySelector("[role='alert']")?.textContent).toBe(
    "Player marker could not be saved."
  );
  expect(document.querySelector("[aria-label='Delete Keep marker']")).not.toBeNull();
  expect(document.querySelector("[data-marker-editor-mode='view']")).not.toBeNull();
});

it("preserves a focused sidebar marker card when selection originates there", async () => {
  const store = deterministicPlayerMarkerStore(new MemoryStorage());
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 6, y: 7 },
    name: "Keyboard marker",
    type: "base",
    notes: ""
  });
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    playerMarkerStore: store
  });
  const card = playerMarkerCards()[0]!;
  card.focus();

  card.click();

  expect((document.activeElement as HTMLElement | null)?.closest("[data-location-list]"))
    .not.toBeNull();
  expect((document.activeElement as HTMLElement | null)?.dataset.playerMarkerId)
    .toBe("marker-1");
});

it("moves focus to Add Marker after a successful delete", async () => {
  const store = deterministicPlayerMarkerStore(new MemoryStorage());
  store.create({
    mapScopeId: "default",
    regionId: "surface",
    position: { x: 8, y: 9 },
    name: "Delete marker",
    type: "danger",
    notes: ""
  });
  controller = await startApp(document.querySelector("#app")!, new FixtureRepository(), {
    playerMarkerStore: store
  });

  playerMarkerCards()[0]!.click();
  clickNamedButton("Delete");
  clickNamedButton("Delete Marker");

  expect(document.activeElement).toBe(
    document.querySelector<HTMLButtonElement>("[data-marker-add]")
  );
});

it("starts with only Mechanic Station selected and reset restores that state", async () => {
  controller = await startApp(
    document.querySelector("#app")!,
    new FixtureRepository()
  );

  expect(locationType("fixed:mechanic-station").checked).toBe(true);
  expect(new URL(window.location.href).searchParams.get("locationTypes"))
    .toBe("fixed:mechanic-station");
  expect(Array.from(document.querySelectorAll(".poi-place-label"), (label) =>
    label.textContent
  )).toEqual(["Mechanic Station"]);

  const search = document.querySelector<HTMLInputElement>("#location-search")!;
  search.value = "Surface Quest";
  document.querySelector<HTMLButtonElement>("[data-search-submit]")!.click();
  locationType("fixed:mechanic-station").click();
  expect(locationType("fixed:mechanic-station").checked).toBe(false);

  document.querySelector<HTMLButtonElement>("[data-search-reset]")!.click();
  expect(search.value).toBe("");
  expect(locationType("fixed:mechanic-station").checked).toBe(true);
  expect(new URL(window.location.href).searchParams.get("q")).toBe("");
  expect(new URL(window.location.href).searchParams.get("locationTypes"))
    .toBe("fixed:mechanic-station");
});

it("shows only selected Warehouses and persists their public type ID", async () => {
  controller = await startApp(
    document.querySelector("#app")!,
    new WarehouseRegionRepository()
  );

  locationType("generated:warehouse").click();

  expect(new URL(window.location.href).searchParams.get("locationTypes"))
    .toBe("fixed:mechanic-station,generated:warehouse");
  expect(Array.from(document.querySelectorAll(".poi-place-label"), (label) =>
    label.textContent
  )).toEqual(["Mechanic Station", "Warehouse"]);
});

it("drops selected types that are not available in a newly committed world", async () => {
  controller = await startApp(
    document.querySelector("#app")!,
    new WarehouseRegionRepository()
  );
  locationType("generated:warehouse").click();

  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-1']")!.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region"))
      .toBe("grow-lab-1")
  );

  expect(document.querySelector("[data-location-type-id='generated:warehouse']"))
    .toBeNull();
  expect(new URL(window.location.href).searchParams.has("locationTypes")).toBe(false);
  expect(document.querySelectorAll(".poi-place-label")).toHaveLength(0);
});

it("retains the committed inventory and selection when a save import fails", async () => {
  const saveClient = new FakeSaveClient(async (file) => personalSave(file.name, 42));
  controller = await startApp(
    document.querySelector("#app")!,
    new WarehouseRegionRepository(),
    {
      createSaveParser: async () => saveClient,
      loadTileCatalog: async () => personalCatalog,
      createMapView(element, callbacks) {
        const real = createMapView(element, callbacks);
        return {
          ...real,
          async commitPreparedWorld() {
            throw new Error("location inventory commit failed");
          }
        };
      }
    }
  );
  locationType("generated:warehouse").click();

  await selectSave("Broken Inventory.db");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-status]")?.textContent)
      .toContain("location inventory commit failed")
  );

  expect(locationType("generated:warehouse").checked).toBe(true);
  expect(Array.from(document.querySelectorAll(".poi-place-label"), (label) =>
    label.textContent
  )).toEqual(["Mechanic Station", "Warehouse"]);
});

it("migrates the legacy labels layer once to all available public location types", async () => {
  window.history.replaceState(null, "", "/?layers=labels");
  controller = await startApp(
    document.querySelector("#app")!,
    new WarehouseRegionRepository()
  );

  expect(locationType("generated:warehouse").checked).toBe(true);
  expect(document.querySelector<HTMLInputElement>("[data-location-master]")?.checked)
    .toBe(true);
  expect(new URL(window.location.href).searchParams.get("locationTypes"))
    .toContain("generated:warehouse");
  expect(new URL(window.location.href).searchParams.get("layers")).toBe("labels");
});

it("disables location-name filters while a world transition is pending and restores them after success", async () => {
  const repository = new DeferredWarehouseRegionRepository();
  controller = await startApp(document.querySelector("#app")!, repository);

  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-1']")!.click();
  expect(locationType("generated:warehouse").disabled).toBe(true);

  await repository.releaseGrowLab();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region"))
      .toBe("grow-lab-1")
  );
  expect(document.querySelector<HTMLInputElement>("[data-location-master]")?.disabled)
    .toBe(false);
});

it("restores location-name filters after a failed world transition", async () => {
  class FailingWarehouseRegionRepository extends WarehouseRegionRepository {
    override loadWorld(regionId: string): Promise<WorldMap> {
      if (regionId === "grow-lab-2") {
        return Promise.reject(new Error("location inventory region failed"));
      }
      return super.loadWorld(regionId);
    }
  }

  controller = await startApp(
    document.querySelector("#app")!,
    new FailingWarehouseRegionRepository()
  );
  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!.click();

  await vi.waitFor(() =>
    expect(document.querySelector("[data-status]")?.textContent)
      .toContain("location inventory region failed")
  );
  expect(locationType("generated:warehouse").disabled).toBe(false);
});

it("restores committed location labels when a region load fails after cancelling a deferred save commit", async () => {
  class FailingWarehouseRegionRepository extends WarehouseRegionRepository {
    override loadWorld(regionId: string): Promise<WorldMap> {
      if (regionId === "grow-lab-2") {
        return Promise.reject(new Error("replacement region failed"));
      }
      return super.loadWorld(regionId);
    }
  }

  let releaseCommit!: () => void;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const commitPreparedWorld = vi.fn(() => commitGate);
  const saveClient = new FakeSaveClient((file) =>
    Promise.resolve(personalSave(file.name, 42))
  );
  controller = await startApp(
    document.querySelector("#app")!,
    new FailingWarehouseRegionRepository(),
    {
      createSaveParser: async () => saveClient,
      loadTileCatalog: async () => personalCatalog,
      createMapView(element, callbacks) {
        const real = createMapView(element, callbacks);
        return { ...real, commitPreparedWorld };
      }
    }
  );
  locationType("generated:warehouse").click();
  expect(Array.from(document.querySelectorAll(".poi-place-label"), (label) =>
    label.textContent
  )).toEqual(["Mechanic Station", "Warehouse"]);

  await selectSave("Deferred Inventory.db");
  await vi.waitFor(() => expect(commitPreparedWorld).toHaveBeenCalledOnce());
  document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-2']")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-status]")?.textContent)
      .toContain("replacement region failed")
  );
  releaseCommit();
  await Promise.resolve();
  await Promise.resolve();

  expect(locationType("generated:warehouse").checked).toBe(true);
  expect(Array.from(document.querySelectorAll(".poi-place-label"), (label) =>
    label.textContent
  )).toEqual(["Mechanic Station", "Warehouse"]);
});

it("opens an unavailable initial region without loading or rendering its world", async () => {
  window.history.replaceState({}, "", "/?region=grow-lab-1");
  const repository = new FixtureRepository();
  const loadWorld = vi.spyOn(repository, "loadWorld");

  controller = await startApp(document.querySelector("#app")!, repository, {
    isRegionAvailable
  });

  expect(loadWorld.mock.calls.map(([regionId]) => regionId)).toEqual(["surface"]);
  expect(document.querySelector<HTMLElement>("[data-region-development]")?.hidden)
    .toBe(false);
  expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(true);
  expect(new URL(window.location.href).searchParams.get("region"))
    .toBe("grow-lab-1");
  expect(
    document.querySelector<HTMLButtonElement>("[data-region-id='grow-lab-1']")
      ?.getAttribute("aria-current")
  ).toBe("true");
});

it("does not load a selected unavailable region and returns to Surface World", async () => {
  const repository = new FixtureRepository();
  const loadWorld = vi.spyOn(repository, "loadWorld");
  controller = await startApp(document.querySelector("#app")!, repository, {
    isRegionAvailable
  });

  const unavailableRegion = document.querySelector<HTMLButtonElement>(
    "[data-region-selector] [data-region-id='grow-lab-1']"
  )!;
  unavailableRegion.focus();
  unavailableRegion.click();
  await vi.waitFor(() =>
    expect(new URL(window.location.href).searchParams.get("region"))
      .toBe("grow-lab-1")
  );

  expect(loadWorld.mock.calls.map(([regionId]) => regionId)).toEqual(["surface"]);
  expect(document.querySelector<HTMLElement>("[data-region-development]")?.hidden)
    .toBe(false);
  expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(true);
  expect(document.activeElement).toBe(
    document.querySelector<HTMLButtonElement>(
      "[data-region-selector] [data-region-id='grow-lab-1']"
    )
  );

  document.querySelector<HTMLButtonElement>("[data-region-id='surface']")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(false)
  );
  expect(new URL(window.location.href).searchParams.get("region")).toBe("surface");
  expect(document.querySelector<HTMLElement>("[data-region-development]")?.hidden)
    .toBe(true);
});

async function selectSave(name: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["SQLite format 3"], name)]
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  constructor(initialValue?: string, private failWrites = false) {
    if (initialValue !== undefined) {
      this.values.set("sm-overview.player-markers", initialValue);
    }
  }

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }

  setFailWrites(failWrites: boolean): void {
    this.failWrites = failWrites;
  }
}

function deterministicPlayerMarkerStore(storage: Storage): PlayerMarkerStore {
  let sequence = 0;
  return new PlayerMarkerStore(storage, {
    createId: () => `marker-${++sequence}`,
    now: () => "2026-08-10T08:00:00.000Z"
  });
}

function clickNamedButton(name: string): void {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  expect(button, `Button \"${name}\" should exist.`).toBeDefined();
  button!.click();
}

function submitMarker(
  changes: { name: string; type?: string; notes?: string },
  submitLabel = "Save Marker"
): void {
  const name = document.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
  expect(name, "The marker Name field should exist.").not.toBeNull();
  name.value = changes.name;
  if (changes.type !== undefined) {
    document.querySelector<HTMLSelectElement>('[aria-label="Type"]')!.value =
      changes.type;
  }
  if (changes.notes !== undefined) {
    document.querySelector<HTMLTextAreaElement>('[aria-label="Notes"]')!.value =
      changes.notes;
  }
  clickNamedButton(submitLabel);
}

function playerMarkerCards(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      "[data-location-list] [data-player-marker-id]"
    )
  );
}

function playerMarkerCard(id: string): HTMLButtonElement {
  return playerMarkerCards().find((card) => card.dataset.playerMarkerId === id)!;
}

function locationType(id: string): HTMLInputElement {
  const checkbox = document.querySelector<HTMLInputElement>(
    `[data-location-type-id="${id}"]`
  );
  expect(checkbox, `Location type "${id}" should exist.`).not.toBeNull();
  return checkbox!;
}

function mapPlayerMarker(id: string): HTMLButtonElement {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      "#map [data-player-marker-id]"
    )
  ).find((marker) => marker.dataset.playerMarkerId === id)!;
}

async function importPlayerSave(name: string): Promise<void> {
  await selectSave(name);
  await vi.waitFor(() =>
    expect(document.querySelector("[data-mode-file]")?.textContent).toBe(name)
  );
}

async function exitPlayerSave(): Promise<void> {
  document.querySelector<HTMLButtonElement>(".exit-save-button")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>(".app-shell")?.dataset.appMode)
      .toBe("base")
  );
}
