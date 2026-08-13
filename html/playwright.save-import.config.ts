import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "save-import-enabled.spec.ts",
  outputDir: join(tmpdir(), "sm-map-save-import-playwright-output"),
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:4176"
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } }
  ],
  webServer: {
    command: "npm run build -- --mode save-import && npm run preview -- --outDir dist-save-import --host 127.0.0.1 --port 4176 --strictPort",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false
  }
});
