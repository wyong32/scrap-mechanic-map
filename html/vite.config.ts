import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import {
  releasePublicAssetsPlugin
} from "./tools/release/release-assets";
import { resolveReleaseMode } from "./tools/release/release-mode";

export default defineConfig(({ command, mode }) => {
  const releaseMode = resolveReleaseMode(mode, process.cwd());
  const releaseAssets = releaseMode.assets;
  return {
    define: {
      "import.meta.env.VITE_ENABLE_SAVE_IMPORT": JSON.stringify(releaseMode.clientFlag)
    },
    publicDir: command === "build" ? false : "public",
    plugins: command === "build"
      ? [releasePublicAssetsPlugin(
          resolve("public"),
          resolve("local-assets"),
          resolve("local-assets", "default-save.db"),
          releaseAssets
        )]
      : [],
    build: {
      outDir: releaseAssets.outDir
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      exclude: [...configDefaults.exclude, "tests/e2e/**"]
    }
  };
});
