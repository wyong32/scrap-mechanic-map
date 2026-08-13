import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const saveImport = vi.hoisted(() => ({
  createSaveParser: vi.fn()
}));

const startup = vi.hoisted(() => ({
  constructor: vi.fn(),
  provider: {
    loadForCells: vi.fn(),
    destroy: vi.fn()
  },
  startApp: vi.fn(async () => ({ destroy: vi.fn() }))
}));

vi.mock("./legacy/legacy-asset-repository", () => ({
  LegacyAssetRepository: function (...args: string[]) {
    startup.constructor(...args);
    return startup.provider;
  }
}));

vi.mock("./app/app-controller", () => ({
  startApp: startup.startApp
}));

vi.mock("./app/save-import-feature", () => ({
  createSaveParser: saveImport.createSaveParser,
  isSaveImportEnabled: (value: unknown) => value === "true"
}));

vi.mock("./data/reference-repository", () => ({
  referenceMapRepository: { kind: "fixture" }
}));

vi.mock("./app/startup-error", () => ({
  renderStartupError: vi.fn()
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_ENABLE_SAVE_IMPORT", "false");
  document.body.innerHTML = '<div id="app"></div>';
  startup.constructor.mockClear();
  startup.startApp.mockClear();
  saveImport.createSaveParser.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("composes base-map-only startup options when save import is disabled", async () => {
  const { composeProductionStartOptions } = await import("./main");

  expect(composeProductionStartOptions(undefined)).toEqual({
    saveImportEnabled: false
  });
  expect(composeProductionStartOptions(false)).toEqual({
    saveImportEnabled: false
  });
});

it("composes the parser factory lazily only for the exact enabled flag", async () => {
  const { composeProductionStartOptions } = await import("./main");

  expect(composeProductionStartOptions("true")).toEqual({
    saveImportEnabled: true,
    createSaveParser: saveImport.createSaveParser
  });
  expect(saveImport.createSaveParser).not.toHaveBeenCalled();
});

it("passes the lazy parser factory to startApp for the enabled environment", async () => {
  vi.stubEnv("VITE_ENABLE_SAVE_IMPORT", "true");

  await import("./main");

  expect(startup.startApp).toHaveBeenCalledWith(
    document.querySelector("#app"),
    { kind: "fixture" },
    {
      legacyAssetProvider: startup.provider,
      saveImportEnabled: true,
      createSaveParser: saveImport.createSaveParser
    }
  );
  expect(saveImport.createSaveParser).not.toHaveBeenCalled();
});

it("constructs the lazy production provider with the official atlas manifest", async () => {
  await import("./main");
  const officialManifestUrl = "/atlas/official/official-tile-atlas.json";

  expect(startup.constructor).toHaveBeenCalledWith(
    undefined,
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    officialManifestUrl
  );
  expect(
    existsSync(resolve(process.cwd(), "public", officialManifestUrl.slice(1)))
  ).toBe(true);
  expect(startup.startApp).toHaveBeenCalledWith(
    document.querySelector("#app"),
    { kind: "fixture" },
    {
      legacyAssetProvider: startup.provider,
      saveImportEnabled: false
    }
  );
  expect(saveImport.createSaveParser).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
