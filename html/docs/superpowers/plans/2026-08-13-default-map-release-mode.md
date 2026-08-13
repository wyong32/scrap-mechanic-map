# Default Map Release Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the verified default map the only public experience by default, while retaining DB save import behind an explicit local compile-time flag.

**Architecture:** Parse `VITE_ENABLE_SAVE_IMPORT` in a focused config module and pass the capability through `main.ts` into the controller and shell. Disabled mode must omit save UI and avoid constructing or loading the save parser path; enabled mode preserves the existing workflow through a lazy factory. Production browser tests and release audit verify that the default build does not request save/SQL assets.

**Tech Stack:** TypeScript 5.8, Vite 7, Vitest 3, Playwright, existing DOM component/controller architecture.

## Global Constraints

- Save import is disabled unless `VITE_ENABLE_SAVE_IMPORT` is the exact string `true`.
- Ordinary local development, preview, CI, Vercel, and production builds use disabled mode by default.
- Do not delete save parsing, worker, normalization, protocol, test fixtures, or local capture/generation tooling.
- Do not publish the failed reference-surface UUID extraction output.
- Disabled mode shows no upload placeholder or coming-soon message.
- Do not push or deploy as part of this plan.

---

## File Structure

- Create `html/src/app/save-import-feature.ts`: parse the environment flag and lazily create the existing save parser only when enabled.
- Create `html/src/app/save-import-feature.test.ts`: exact flag parsing and lazy-construction tests.
- Modify `html/src/main.ts` and `html/src/main.test.ts`: production composition passes the default-disabled capability and never performs startup fetches.
- Modify `html/src/app/app-shell.ts` and `html/src/app/app-shell.test.ts`: conditionally omit all save UI while keeping enabled behavior.
- Modify `html/src/app/app-controller.ts` and `html/src/app/app-controller.test.ts`: optional parser lifecycle, callback wiring, and default-save suppression.
- Create `html/tests/e2e/default-map-release.spec.ts`: production verification for the default-disabled build.
- Create `html/playwright.save-import.config.ts`: explicit enabled-build browser check without altering the public config.
- Modify `html/package.json`: focused enabled-mode verification command.
- Modify `html/src/vite-env.d.ts`: document the exact environment variable type.

### Task 1: Feature Flag and Lazy Save Parser Boundary

**Files:**
- Create: `html/src/app/save-import-feature.ts`
- Create: `html/src/app/save-import-feature.test.ts`
- Modify: `html/src/vite-env.d.ts`

**Interfaces:**
- Produces: `isSaveImportEnabled(value: unknown): boolean`
- Produces: `createSaveParser(): Promise<SaveParser>` behind a dynamic `import("../save/save-client")`
- Produces: exported `SaveParser` interface shared by controller and feature module

- [ ] **Step 1: Write failing exact-flag tests**

```ts
import { expect, it } from "vitest";
import { isSaveImportEnabled } from "./save-import-feature";

it("keeps save import disabled unless the value is exactly true", () => {
  for (const value of [undefined, "", "TRUE", "1", true, false]) {
    expect(isSaveImportEnabled(value)).toBe(false);
  }
  expect(isSaveImportEnabled("true")).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run src/app/save-import-feature.test.ts`

Expected: FAIL because `save-import-feature` does not exist.

- [ ] **Step 3: Implement exact flag parsing and the lazy factory**

```ts
export function isSaveImportEnabled(value: unknown): boolean {
  return value === "true";
}

export async function createSaveParser(): Promise<SaveParser> {
  const { SaveClient } = await import("../save/save-client");
  return new SaveClient();
}
```

Move the structural `SaveParser` interface from `app-controller.ts` into this module and import only its type in the controller. Add `VITE_ENABLE_SAVE_IMPORT?: string` to `ImportMetaEnv`.

- [ ] **Step 4: Add and run a lazy-loading test**

Use `vi.mock("../save/save-client")`, call no factory, and assert its constructor has not run; call the factory and assert it runs once. Run the focused test and expect all cases to PASS.

- [ ] **Step 5: Commit**

```powershell
git add html/src/app/save-import-feature.ts html/src/app/save-import-feature.test.ts html/src/vite-env.d.ts
git commit -m "feat: add default-off save import flag"
```

### Task 2: Shell Capability Removes Save UI

**Files:**
- Modify: `html/src/app/app-shell.ts`
- Modify: `html/src/app/app-shell.test.ts`

**Interfaces:**
- Consumes: `saveImportEnabled: boolean`
- Changes: `createAppShell(root, callbacks, options?: { saveImportEnabled?: boolean })`
- Default: `saveImportEnabled` is `false`

- [ ] **Step 1: Write a failing disabled-shell test**

```ts
it("omits every save-import control by default", () => {
  const shell = createAppShell(document.body, {});
  expect(document.querySelector("[data-save-entry]")).toBeNull();
  expect(document.querySelector('[aria-label="Select a Scrap Mechanic .db save file"]')).toBeNull();
  expect(document.querySelector(".exit-save-button")).toBeNull();
  expect(document.querySelector("[data-mobile-exit-save]")).toBeNull();
  expect(document.body.textContent).not.toContain("Personal Map");
  shell.destroy();
});
```

- [ ] **Step 2: Run the shell test and verify RED**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts`

Expected: FAIL because save UI is currently unconditional.

- [ ] **Step 3: Conditionally render and initialize save UI**

Build save-specific markup only when `options.saveImportEnabled === true`. Make `SaveEntry`, exit buttons, mode file/meta nodes, and save event handlers optional. Keep base mode readout and all non-save UI unchanged. Guard `setMode` so disabled mode always renders Base Map even if a caller passes a save mode.

- [ ] **Step 4: Preserve enabled behavior with a regression test**

```ts
const shell = createAppShell(document.body, { onSaveSelect }, { saveImportEnabled: true });
expect(screenSaveInput()).toBeTruthy();
shell.setMode("personalized", "test.db", { seed: 1, saveVersion: 28 });
expect(document.body.textContent).toContain("Personal Map");
```

Run: `npm.cmd test -- --run src/app/app-shell.test.ts`

Expected: disabled and enabled tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add html/src/app/app-shell.ts html/src/app/app-shell.test.ts
git commit -m "feat: omit save controls in default mode"
```

### Task 3: Controller Does Not Construct Save Runtime When Disabled

**Files:**
- Modify: `html/src/app/app-controller.ts`
- Modify: `html/src/app/app-controller.test.ts`

**Interfaces:**
- Add to `StartAppOptions`: `saveImportEnabled?: boolean`
- Add to `StartAppOptions`: `createSaveParser?: () => Promise<SaveParser>`
- Remove eager `SaveClient` import and construction
- Default: disabled

- [ ] **Step 1: Write failing disabled-controller tests**

Add tests proving that default startup:

```ts
expect(createSaveParser).not.toHaveBeenCalled();
expect(loadDefaultSave).not.toHaveBeenCalled();
expect(document.querySelector("[data-save-entry]")).toBeNull();
```

Also destroy the controller and prove no parser lifecycle method was required.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `npm.cmd test -- --run src/app/app-controller.test.ts`

Expected: FAIL because the controller eagerly constructs `SaveClient` and invokes default-save loading when supplied.

- [ ] **Step 3: Implement optional lazy parser lifecycle**

Keep `let saveClient: SaveParser | undefined`. Resolve it only inside enabled save selection:

```ts
const getSaveClient = async (): Promise<SaveParser> => {
  if (!saveImportEnabled) throw new Error("Save import is disabled.");
  return saveClient ??= await createSaveParser();
};
```

Wire `onSaveSelect` and `onExitSaveMode` only in enabled mode. Replace unconditional `cancel`/`dispose` calls with optional calls. Invoke `loadDefaultSave` only when enabled. Pass the capability to `createAppShell`.

- [ ] **Step 4: Add enabled-mode preservation tests**

Start with `{ saveImportEnabled: true, createSaveParser }`, select the fixture DB, and retain the existing assertions for Personal Map mode, cancellation, replacement failure, and disposal. Update only setup needed for the lazy asynchronous parser.

- [ ] **Step 5: Run focused controller and shell tests**

Run: `npm.cmd test -- --run src/app/app-controller.test.ts src/app/app-shell.test.ts src/app/save-import-feature.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add html/src/app/app-controller.ts html/src/app/app-controller.test.ts
git commit -m "feat: isolate save runtime behind capability"
```

### Task 4: Production Composition Defaults to Base Map

**Files:**
- Modify: `html/src/main.ts`
- Modify: `html/src/main.test.ts`

**Interfaces:**
- Consumes: `isSaveImportEnabled(import.meta.env.VITE_ENABLE_SAVE_IMPORT)`
- Passes: `saveImportEnabled` and, only when true, `createSaveParser`

- [ ] **Step 1: Write failing composition tests**

Default test:

```ts
expect(startup.startApp).toHaveBeenCalledWith(root, repository, {
  legacyAssetProvider: provider,
  saveImportEnabled: false
});
expect(saveFeature.createSaveParser).not.toHaveBeenCalled();
```

Add an enabled-env module-isolation test that stubs `import.meta.env.VITE_ENABLE_SAVE_IMPORT` through a small exported composition helper rather than mutating Vite internals, and expects the lazy factory to be passed without being invoked during startup.

- [ ] **Step 2: Run main tests and verify RED**

Run: `npm.cmd test -- --run src/main.test.ts`

Expected: FAIL because `main.ts` does not pass the capability.

- [ ] **Step 3: Implement minimal composition**

Read the flag once, pass `saveImportEnabled`, and provide the lazy factory only for enabled mode. Do not load a bundled default DB.

- [ ] **Step 4: Run main and startup tests**

Run: `npm.cmd test -- --run src/main.test.ts src/app/app-controller.test.ts`

Expected: PASS and `fetch` remains untouched during composition.

- [ ] **Step 5: Commit**

```powershell
git add html/src/main.ts html/src/main.test.ts
git commit -m "feat: default production to base map only"
```

### Task 5: Production Browser and Release Verification

**Files:**
- Create: `html/tests/e2e/default-map-release.spec.ts`
- Create: `html/playwright.save-import.config.ts`
- Modify: `html/package.json`
- Modify if required by evidence: `html/tools/release/release-audit.ts`
- Test if audit changes: `html/tools/release/release-audit.test.ts`

**Interfaces:**
- Produces script: `test:e2e:save-import`
- Public Playwright config runs without the feature flag
- Enabled config sets `VITE_ENABLE_SAVE_IMPORT=true` only for its build command

- [ ] **Step 1: Write the default-build E2E test**

Record same-origin requests from navigation until the map is ready. Assert:

```ts
await expect(page.getByRole("region", { name: "Interactive Map" })).toBeVisible();
await expect(page.getByLabel("Select a Scrap Mechanic .db save file")).toHaveCount(0);
await expect(page.getByText("Personal Map", { exact: true })).toHaveCount(0);
expect(paths.some((path) => /save-worker|sql-wasm|default-save\.db/.test(path))).toBe(false);
```

Also assert Location Names, Search, Add Marker, and Surface World remain visible/usable.

- [ ] **Step 2: Run the default E2E and verify RED**

Run: `npm.cmd exec playwright test tests/e2e/default-map-release.spec.ts --project=chromium`

Expected: FAIL because the current default build renders Select Save.

- [ ] **Step 3: Add the enabled-build smoke configuration**

Create a Playwright config whose web server command is:

```text
set VITE_ENABLE_SAVE_IMPORT=true&& npm run build && npm run preview -- --host 127.0.0.1 --port 4176 --strictPort
```

Use a single smoke test or project setup that asserts the save input is visible. Add `test:e2e:save-import` to `package.json`.

- [ ] **Step 4: Run browser verification in both modes**

Run:

```powershell
npm.cmd exec playwright test tests/e2e/default-map-release.spec.ts --project=chromium --project=firefox
npm.cmd run test:e2e:save-import
```

Expected: default mode passes in Chromium and Firefox; enabled smoke test passes.

- [ ] **Step 5: Audit the actual default output**

Run `npm.cmd run release:check`. Inspect `dist/assets` and the browser request ledger. If save-worker/SQL chunks are emitted but never requested, record the measured bytes. If they violate the existing release budget or the design requirement, write a failing release-audit test first, then add the smallest budget/forbidden-initial-path rule. Do not delete the source feature.

- [ ] **Step 6: Run the final focused matrix**

```powershell
npm.cmd test -- --run src/app/save-import-feature.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts src/main.test.ts tools/release/release-audit.test.ts
npm.cmd run lint
npm.cmd run release:check
npm.cmd exec playwright test tests/e2e/default-map-release.spec.ts --project=chromium --project=firefox
npm.cmd run test:e2e:save-import
git diff --check
```

Expected: every command exits 0. Existing unrelated full-suite failures, if any, must be reported separately and cannot be described as passing.

- [ ] **Step 7: Commit**

```powershell
git add html/tests/e2e/default-map-release.spec.ts html/playwright.save-import.config.ts html/package.json html/tools/release/release-audit.ts html/tools/release/release-audit.test.ts
git commit -m "test: verify lightweight default map release"
```

### Task 6: Independent Review and Handoff

**Files:**
- Review: all commits since `98d028a`
- Update only if review finds a scoped defect

**Interfaces:**
- No new runtime interface
- Deliverable: reviewed default-disabled public build with explicit local recovery path

- [ ] **Step 1: Request specification and code-quality review**

Review against `html/docs/superpowers/specs/2026-08-13-default-map-release-mode-design.md`, with special attention to static imports, Worker construction, disabled UI remnants, enabled-mode preservation, and request-ledger completeness.

- [ ] **Step 2: Address findings with TDD**

For each Critical or Important finding, add a focused failing test, verify RED, implement the minimal fix, and rerun the affected matrix. Repeat review until no Critical or Important findings remain.

- [ ] **Step 3: Produce final evidence**

Report exact commit SHA, enabled/disabled commands, focused test counts, browser counts, release bytes, emitted/requested save assets, and any unrelated known failures. Do not push or deploy.

---

## Plan Self-Review

- Spec coverage: every product, configuration, architecture, error, testing, rollback, and non-goal requirement maps to Tasks 1–6.
- Placeholder scan: no TBD/TODO/implement-later placeholders remain; conditional audit work is evidence-driven and includes its required RED-first path.
- Type consistency: `saveImportEnabled`, `SaveParser`, `createSaveParser`, and the `createAppShell` options shape are consistent across tasks.
- Scope: one coherent release-mode capability; no map-quality, extraction, deployment, or unrelated refactor work is included.
