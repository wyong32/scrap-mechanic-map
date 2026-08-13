// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { resolveReleaseMode } from "./release-mode";

describe("Vite release mode", () => {
  it("uses the mode env as one source for the runtime flag and release policy", () => {
    const envLoader = vi.fn(() => ({ VITE_ENABLE_SAVE_IMPORT: "true" }));

    const releaseMode = resolveReleaseMode("production", "env-fixture", {}, envLoader);

    expect(envLoader).toHaveBeenCalledWith("production", "env-fixture", "");
    expect(releaseMode).toMatchObject({
      saveImportEnabled: true,
      clientFlag: "true",
      assets: {
        includePersonalMapAssets: true,
        outDir: "dist-save-import"
      }
    });
  });

  it("gives an explicit process value priority and preserves exact-true parsing", () => {
    const releaseMode = resolveReleaseMode(
      "save-import",
      "env-fixture",
      { VITE_ENABLE_SAVE_IMPORT: "TRUE" },
      () => ({ VITE_ENABLE_SAVE_IMPORT: "true" })
    );

    expect(releaseMode).toMatchObject({
      saveImportEnabled: false,
      clientFlag: "TRUE",
      assets: {
        includePersonalMapAssets: false,
        outDir: "dist"
      }
    });
  });
});
