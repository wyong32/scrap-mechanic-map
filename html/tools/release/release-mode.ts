import { loadEnv } from "vite";
import { isSaveImportEnabled } from "../../src/app/save-import-mode";
import {
  createReleaseAssetPolicy,
  type ReleaseAssetPolicy
} from "./release-assets";

export interface ReleaseMode {
  saveImportEnabled: boolean;
  clientFlag: string;
  assets: ReleaseAssetPolicy;
}

export function resolveReleaseMode(
  mode: string,
  envDir: string,
  processEnvironment: Record<string, string | undefined> = process.env,
  envLoader: typeof loadEnv = loadEnv
): ReleaseMode {
  const modeEnvironment = envLoader(mode, envDir, "");
  const clientFlag = processEnvironment.VITE_ENABLE_SAVE_IMPORT
    ?? modeEnvironment.VITE_ENABLE_SAVE_IMPORT
    ?? "";
  const saveImportEnabled = isSaveImportEnabled(clientFlag);
  return {
    saveImportEnabled,
    clientFlag,
    assets: createReleaseAssetPolicy(saveImportEnabled)
  };
}
