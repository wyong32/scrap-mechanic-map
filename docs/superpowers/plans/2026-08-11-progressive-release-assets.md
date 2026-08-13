# Progressive Release Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the complete local Scrap Mechanic capture workflow while reducing the default-map cold load to 25 MB or less by loading legacy terrain images and official atlas pages only after a save requires them.

**Architecture:** Replace the eager `LegacyAssetRepository.preload()` startup path with a metadata-first `loadForCells(cells)` provider. The provider plans the minimum legacy files and official atlas pages for the selected terrain cells, verifies and memoizes those resources, and returns the same immutable `LegacyAssetBundle` consumed by the existing resolver. A separate release audit enforces repository boundaries and deployment budgets without deleting local capture data.

**Tech Stack:** TypeScript 5.8, Vite 7, Vitest 3, Leaflet 1.9, Playwright, Vercel static hosting.

## Global Constraints

- Preserve the authentic default 1.0 map, save import, personalized terrain, location filtering, and player markers.
- Keep the approximately 27 GB local TileEditor, capture, and generation workspace intact and outside GitHub/Vercel.
- Do not move terrain assets to an external CDN or object store in this phase.
- Do not change UUID mapping, terrain rotation, POI classification, or legacy-first image priority.
- Default-map cold-load transfer must be 25 MB or less.
- JavaScript and CSS must remain below 1 MB compressed, excluding SQL WebAssembly and imagery.
- Optional terrain bytes must be hash-verified before rendering.
- Vercel project root is `html`, build command is `npm run build`, and output directory is `dist`.
- Do not push to the current upstream remote; confirm the user's GitHub destination first.

---

### Task 1: Plan the minimum terrain asset set

**Files:**
- Create: `html/src/legacy/terrain-asset-plan.ts`
- Create: `html/src/legacy/terrain-asset-plan.test.ts`
- Read: `html/src/legacy/hybrid-terrain-resolver.ts`
- Read: `html/tools/game-data/legacy/original-poi-rules.ts`

**Interfaces:**
- Consumes: `readonly TerrainCell[]`, legacy manifest records, `ReadonlyMap<string, LegacyBridgeEntry>`, POI rules, and official atlas entries.
- Produces:

```ts
export interface TerrainAssetPlan {
  legacyKeys: readonly string[];
  officialPages: readonly string[];
  officialUuids: readonly string[];
}

export function planTerrainAssets(input: {
  cells: readonly TerrainCell[];
  legacyRecords: readonly LegacyAssetRecord[];
  bridgeByUuid: ReadonlyMap<string, LegacyBridgeEntry>;
  poiByUuid: ReadonlyMap<string, string>;
  poiRules: readonly LegacyPoiRule[];
  officialEntries: ReadonlyMap<string, OfficialTileAtlasEntry>;
}): TerrainAssetPlan;
```

- [ ] **Step 1: Write failing selection tests**

Cover duplicate UUID deduplication, `tile:<legacyId>` selection, matching POI image keys, coordinate overrides, official fallback for a UUID without a legacy asset, and one official page shared by several UUIDs.

```ts
expect(planTerrainAssets(input)).toEqual({
  legacyKeys: ["poi:warehouse", "tile:10105"],
  officialPages: ["orthographic-2.webp"],
  officialUuids: ["official-only-uuid"]
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm.cmd test -- --run src/legacy/terrain-asset-plan.test.ts`

Expected: FAIL because `terrain-asset-plan.ts` does not exist.

- [ ] **Step 3: Implement deterministic planning**

Normalize UUIDs to lowercase, use sets for deduplication, include only manifest-backed legacy keys, and sort every returned array with the existing canonical ordering convention. Official entries are selected only when the cell has no usable legacy tile; POI and coordinate-override keys are added when their existing resolver conditions can apply.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm.cmd test -- --run src/legacy/terrain-asset-plan.test.ts src/legacy/hybrid-terrain-resolver.test.ts`

Expected: both files pass.

- [ ] **Step 5: Commit the planner**

```powershell
git add -- html/src/legacy/terrain-asset-plan.ts html/src/legacy/terrain-asset-plan.test.ts
git commit -m "feat: plan terrain assets per save"
```

### Task 2: Convert the terrain repository to metadata-first loading

**Files:**
- Modify: `html/src/legacy/legacy-asset-repository.ts`
- Modify: `html/src/legacy/legacy-asset-repository.test.ts`
- Modify: `html/src/legacy/legacy-visual-types.ts`
- Use: `html/src/legacy/terrain-asset-plan.ts`

**Interfaces:**
- Consumes: `planTerrainAssets(...)` from Task 1.
- Produces:

```ts
export interface LegacyAssetProvider {
  loadForCells(cells: readonly TerrainCell[]): Promise<LegacyAssetBundle>;
  destroy(): void;
}

export class LegacyAssetRepository implements LegacyAssetProvider {
  loadForCells(cells: readonly TerrainCell[]): Promise<LegacyAssetBundle>;
  destroy(): void;
}
```

- [ ] **Step 1: Replace eager-preload expectations with failing on-demand tests**

Add tests proving that construction performs zero fetches, metadata loading does not fetch any image, `loadForCells` requests only planned legacy URLs/pages, shared requests are memoized, corrupt bytes fail hash verification, a failed request can be retried, and `destroy()` revokes created object URLs.

```ts
const repository = new LegacyAssetRepository(manifestUrl, catalogUrl, buildUrl);
expect(fetchMock).not.toHaveBeenCalled();
await repository.loadForCells([legacyCell, officialCell, duplicateOfficialCell]);
expect(imageUrls(fetchMock)).toEqual([
  "/legacy/img/tiles/10105.jpg",
  "/atlas/official/orthographic-2.webp"
]);
```

- [ ] **Step 2: Run repository tests and verify RED**

Run: `npm.cmd test -- --run src/legacy/legacy-asset-repository.test.ts`

Expected: FAIL because `loadForCells` and `destroy` are not implemented.

- [ ] **Step 3: Split metadata and binary caches**

Keep one promise for verified manifests/catalog metadata and separate URL-keyed promises for verified bytes and decoded images. Build each returned `LegacyAssetBundle` from only the planned assets and official entries. On rejection, remove that URL from the cache so a later save can retry.

```ts
private readonly imageLoads = new Map<string, Promise<HTMLImageElement>>();

private loadImage(url: string, sha256: string): Promise<HTMLImageElement> {
  const existing = this.imageLoads.get(url);
  if (existing) return existing;
  const pending = this.fetchVerifiedImage(url, sha256).catch((error) => {
    this.imageLoads.delete(url);
    throw error;
  });
  this.imageLoads.set(url, pending);
  return pending;
}
```

- [ ] **Step 4: Keep eager APIs temporarily compatible**

Retain `ObservedLegacyAssetPreload`, `observeLegacyAssetPreload`, `whenRequestsStarted`, and `preload()` only as temporary compatibility wrappers so the existing controller compiles until Task 3. Mark their removal in the Task 3 file change; do not add new callers.

- [ ] **Step 5: Run repository and resolver tests**

Run: `npm.cmd test -- --run src/legacy/legacy-asset-repository.test.ts src/legacy/hybrid-terrain-resolver.test.ts`

Expected: PASS with no image fetch before `loadForCells`.

- [ ] **Step 6: Commit the on-demand repository**

```powershell
git add -- html/src/legacy/legacy-asset-repository.ts html/src/legacy/legacy-asset-repository.test.ts html/src/legacy/legacy-visual-types.ts
git commit -m "feat: load terrain assets on demand"
```

### Task 3: Remove optional terrain downloads from application startup

**Files:**
- Modify: `html/src/main.ts`
- Modify: `html/src/app/app-controller.ts`
- Modify: `html/src/app/app-controller.test.ts`
- Modify: `html/src/legacy/legacy-asset-repository.ts`
- Modify: `html/src/legacy/legacy-asset-repository.test.ts`

**Interfaces:**
- Consumes: `LegacyAssetProvider` from Task 2.
- Changes `StartAppOptions` from eager promises to:

```ts
export interface StartAppOptions {
  legacyAssetProvider?: LegacyAssetProvider;
  loadDefaultSave?: () => Promise<File | undefined>;
}
```

- [ ] **Step 1: Write failing controller tests**

Prove the base map does not call `loadForCells`, importing a save calls it only after terrain materialization, provider failure falls back to the decoded save overview with a warning, replacement imports cannot commit stale bundles, and `destroy()` calls the provider's `destroy()` once.

```ts
expect(provider.loadForCells).not.toHaveBeenCalled();
await selectSave(saveFile);
expect(provider.loadForCells).toHaveBeenCalledWith(candidateWorld.cells);
```

- [ ] **Step 2: Run controller tests and verify RED**

Run: `npm.cmd test -- --run src/app/app-controller.test.ts`

Expected: FAIL because the controller still consumes eager `legacyAssets`.

- [ ] **Step 3: Integrate the provider after save parsing**

Remove `prepareReferenceLegacy`, `resolvedLegacyBundle`, request-start waits, and the startup `.then(...)` preparation. Delete the temporary `ObservedLegacyAssetPreload`, `observeLegacyAssetPreload`, `whenRequestsStarted`, request-start barrier, and `preload()` compatibility APIs from the repository and migrate their tests. In `selectSave`, call `legacyAssetProvider.loadForCells(candidateWorld.cells)` after materialization and before `map.prepareWorld`. If optional loading fails, preserve the decoded overview, render through `prepareWorld(..., overview, undefined)`, and show the warning without discarding the valid save.

- [ ] **Step 4: Make `main.ts` construction lazy**

```ts
const legacyAssetProvider = new LegacyAssetRepository(
  "/data/generated/legacy-assets.json",
  "/data/generated/tile-catalog.json",
  "/data/generated/build-info.json"
);
void startApp(root, referenceMapRepository, { legacyAssetProvider }).catch(
  (error: unknown) => renderStartupError(root, error)
);
```

- [ ] **Step 5: Run controller, startup, and map tests**

Run: `npm.cmd test -- --run src/app/app-controller.test.ts src/legacy/legacy-asset-repository.test.ts src/map/map-view.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit startup integration**

```powershell
git add -- html/src/main.ts html/src/app/app-controller.ts html/src/app/app-controller.test.ts html/src/legacy/legacy-asset-repository.ts html/src/legacy/legacy-asset-repository.test.ts
git commit -m "perf: defer personalized terrain downloads"
```

### Task 4: Enforce the local-only workspace boundary

**Files:**
- Modify: `.gitignore`
- Remove from Git index only: `html/assets/img/*.pdn`, `html/assets/img/tiles/*.pdn`
- Move source data: `html/public/data/reference-world.json` to `html/tools/game-data/source/reference-world.json`
- Remove unused runtime duplicates: `html/public/data/locations.json`, `html/public/data/regions.json`
- Modify: `html/tools/game-data/cli.ts`
- Modify: `html/tools/game-data/build-data.ts`
- Modify: `html/tools/game-data/build-data.test.ts`
- Test: `html/tools/release/repository-boundary.test.ts`

**Interfaces:**
- Produces a repository boundary test with exported constants:

```ts
export const forbiddenTrackedSegments = [
  "runtime-captures/",
  "tileeditor-working-copy",
  "offline-render-work/",
  "runtime-user-data/",
  "/dist/",
  "/node_modules/"
] as const;
```

- [ ] **Step 1: Write a failing tracked-file boundary test**

Run `git ls-files -z` from the test and assert that no tracked path contains a forbidden segment or ends in `.pdn`. Assert that the three non-generated public JSON copies are absent, the source reference world exists under `tools/game-data/source`, and all canonical `public/data/generated/*` files exist.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run tools/release/repository-boundary.test.ts`

Expected: FAIL on currently tracked PDN sources and public source/duplicate JSON files.

- [ ] **Step 3: Extend ignore rules without deleting local data**

Add explicit patterns for dependencies, build/test results, TileEditor copies, runtime capture folders, offline-render work, browser data, probe output, logs, caches, raw capture formats, and PDN sources. Do not run filesystem deletion commands.

- [ ] **Step 4: Stop tracking release-excluded files**

Use `git rm --cached --ignore-unmatch` for the PDN sources so they remain on disk. Move `reference-world.json` into `tools/game-data/source`, update both CLI reads and the `generatedFrom` provenance string, and remove only the unused public `locations.json` and `regions.json` copies. The generator and verifier must still rebuild from the moved source and publish canonical files under `/data/generated`.

- [ ] **Step 5: Run boundary, data, and build tests**

Run: `npm.cmd test -- --run tools/release/repository-boundary.test.ts tools/game-data/build-data.test.ts src/data/reference-repository.test.ts`

Run: `npm.cmd run build`

Expected: all commands pass and local PDN files still exist.

- [ ] **Step 6: Commit the release boundary**

```powershell
git add -- .gitignore html/tools/release/repository-boundary.test.ts html/public/data html/tools/game-data
git add -u -- html/assets/img
git commit -m "chore: keep capture sources out of releases"
```

### Task 5: Add deterministic release-size auditing

**Files:**
- Create: `html/tools/release/release-audit.ts`
- Create: `html/tools/release/release-audit.test.ts`
- Create: `html/release-budget.json`
- Modify: `html/package.json`

**Interfaces:**
- Produces:

```ts
export interface ReleaseAuditResult {
  trackedBytes: number;
  outputBytes: number;
  outputFiles: number;
  largestFiles: readonly { path: string; bytes: number }[];
  initialAssetBytes: number;
  violations: readonly string[];
}

export function auditRelease(input: {
  repositoryRoot: string;
  outputRoot: string;
  budget: ReleaseBudget;
}): Promise<ReleaseAuditResult>;
```

- [ ] **Step 1: Write failing audit tests**

Use temporary fixtures to prove detection of forbidden paths, files above 25 MB, output above 200 MB, initial assets above 25 MB, and a passing fixture. Verify stable sorted JSON/text output.

- [ ] **Step 2: Run the audit tests and verify RED**

Run: `npm.cmd test -- --run tools/release/release-audit.test.ts`

Expected: FAIL because the audit module does not exist.

- [ ] **Step 3: Implement budgets and CLI output**

Use this checked-in configuration:

```json
{
  "maxTrackedBytes": 157286400,
  "maxOutputBytes": 209715200,
  "maxOutputFiles": 1000,
  "maxSingleFileBytes": 26214400,
  "maxInitialAssetBytes": 26214400,
  "maxCompressedCodeBytes": 1048576,
  "initialPublicAssets": ["assets/reference-surface-1.0.webp"]
}
```

The CLI exits nonzero for violations and prints tracked/output totals, initial bytes, file count, and the 20 largest output files.

- [ ] **Step 4: Add package scripts**

```json
"release:audit": "tsx tools/release/release-audit.ts",
"release:check": "npm run build && npm run release:audit"
```

- [ ] **Step 5: Run tests and the real audit**

Run: `npm.cmd test -- --run tools/release/release-audit.test.ts tools/release/repository-boundary.test.ts`

Run: `npm.cmd run release:check`

Expected: tests pass and the real report stays within every configured budget.

- [ ] **Step 6: Commit the release audit**

```powershell
git add -- html/tools/release html/release-budget.json html/package.json
git commit -m "build: audit release size budgets"
```

### Task 6: Configure Vercel and verify cold-load behavior

**Files:**
- Create: `html/vercel.json`
- Create: `html/tests/e2e/progressive-assets.spec.ts`
- Create: `html/tools/release/vercel-config.test.ts`
- Modify: `html/playwright.config.ts` only if the existing preview server cannot run the production build.

**Interfaces:**
- Vercel consumes the static Vite build from `dist`.
- Playwright records request URLs and response body sizes for the default-map cold load and save-import flow.

- [ ] **Step 1: Write the failing configuration test and network regression test**

The configuration test reads `vercel.json` and requires Vite, `npm run build`, `dist`, and the optional-library cache rule. The cold-load test opens `/?region=surface&z=-3&x=0&y=0`, records same-origin responses, and asserts that no URL begins with `/legacy/img/` or `/atlas/official/`. It sums response bodies for the app entry, generated metadata, SQL assets requested during startup, and the reference map, then asserts the total is at most 25 MB.

The save-import test supplies the existing test fixture and asserts that requested optional URLs equal the distinct planned resources for that fixture rather than all 334 legacy images and 19 atlas pages.

- [ ] **Step 2: Run the network test and verify RED**

Run: `npm.cmd test -- --run tools/release/vercel-config.test.ts`

Expected: FAIL because `vercel.json` is absent.

- [ ] **Step 3: Add Vercel configuration**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(legacy/img|atlas/official)/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Run production browser verification**

Run: `npm.cmd test -- --run tools/release/vercel-config.test.ts`

Run: `npm.cmd exec playwright test tests/e2e/progressive-assets.spec.ts`

Expected: PASS for cold load, selected save assets, deduplication, and fallback behavior.

- [ ] **Step 5: Commit Vercel readiness**

```powershell
git add -- html/vercel.json html/tests/e2e/progressive-assets.spec.ts html/tools/release/vercel-config.test.ts html/playwright.config.ts
git commit -m "test: verify progressive asset delivery"
```

### Task 7: Complete release validation and pre-launch assessment

**Files:**
- Create: `html/docs/release-readiness.md`
- Modify only if verification finds an in-scope defect: files from Tasks 1-6.

**Interfaces:**
- Consumes all earlier tasks.
- Produces a checked release report with actual values for Git bytes, Vercel output bytes, initial bytes, largest files, tests, browser flows, and known blockers.

- [ ] **Step 1: Run formatting and static verification**

Run: `git diff --check`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

Expected: exit code 0 for all commands.

- [ ] **Step 2: Run focused and full tests**

Run: `npm.cmd test -- --run src/legacy/terrain-asset-plan.test.ts src/legacy/legacy-asset-repository.test.ts src/app/app-controller.test.ts tools/release/release-audit.test.ts tools/release/repository-boundary.test.ts`

Run: `npm.cmd test -- --run`

Expected: focused tests pass. Record the full-suite result exactly; do not classify the known empty default-surface capture-inventory failures as caused by this feature unless their output changes.

- [ ] **Step 3: Run release and browser checks**

Run: `npm.cmd run release:check`

Run: `npm.cmd exec playwright test tests/e2e/progressive-assets.spec.ts`

Expected: release budgets and progressive network behavior pass.

- [ ] **Step 4: Verify core user flows manually in the local production preview**

Check default surface map, location-name filters, sidebar collapse persistence, marker create/edit/delete, one valid save import, invalid-save handling, and an under-development region page. Capture the Network summary for cold load and imported-save load.

- [ ] **Step 5: Write the readiness report**

Record actual measured values, commands and exit codes, remaining warnings, Vercel Pro limit comparison, required dashboard settings, and the unresolved GitHub destination. State `ready`, `ready with known non-release blockers`, or `not ready`; never mark ready when a release audit or core browser flow fails.

- [ ] **Step 6: Commit the report**

```powershell
git add -- html/docs/release-readiness.md
git commit -m "docs: assess release readiness"
```
