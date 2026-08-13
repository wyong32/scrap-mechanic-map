import "leaflet/dist/leaflet.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { startApp } from "./app/app-controller";
import {
  createSaveParser,
  isSaveImportEnabled
} from "./app/save-import-feature";
import type { StartAppOptions } from "./app/app-controller";
import { renderStartupError } from "./app/startup-error";
import { referenceMapRepository } from "./data/reference-repository";
import { LegacyAssetRepository } from "./legacy/legacy-asset-repository";

export function composeProductionStartOptions(
  saveImportFlag: unknown
): Pick<StartAppOptions, "saveImportEnabled" | "createSaveParser"> {
  if (!isSaveImportEnabled(saveImportFlag)) {
    return { saveImportEnabled: false };
  }
  return {
    saveImportEnabled: true,
    createSaveParser
  };
}

const root = document.querySelector<HTMLDivElement>("#app")!;
const legacyAssetRepository = new LegacyAssetRepository(
  undefined,
  "/data/generated/tile-catalog.json",
  "/data/generated/build-info.json",
  "/atlas/official/official-tile-atlas.json"
);
void startApp(root, referenceMapRepository, {
  legacyAssetProvider: legacyAssetRepository,
  ...composeProductionStartOptions(import.meta.env.VITE_ENABLE_SAVE_IMPORT)
}).catch((error: unknown) => {
  renderStartupError(root, error);
});
