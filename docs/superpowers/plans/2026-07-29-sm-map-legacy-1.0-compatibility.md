# Scrap Mechanic Legacy Map + 1.0 Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the original `the1killer/sm_overview` terrain and POI imagery inside the current application, then resolve Scrap Mechanic 1.0 UUID terrain through an official legacy-ID bridge with explicit fallbacks for new tiles.

**Architecture:** Build-time tools derive `legacyId → 1.0 UUID` only from shipped 1.0 Lua registrations and `.tile` headers, inventory the original images, and emit hash-verified public manifests. At runtime one preloader requests the complete fixed legacy asset set before any save layout is known; a hybrid resolver converts `TerrainCell[]` into old tile/POI visuals or 1.0 fallbacks, and the existing mounted Leaflet `AtlasLayer` draws those preloaded images without save-derived network requests.

**Tech Stack:** TypeScript, Vite, Leaflet 1.9, Canvas 2D, Sharp, Vitest, Playwright, Scrap Mechanic 1.0 Lua and `.tile` headers.

## Global Constraints

- The implementation remains based on `the1killer/sm_overview`; its 298 runtime-addressable numeric tile JPGs, POI images, coordinate exceptions, rotation, and size rules are source behavior. The source tree also contains the unreferenced backup `11504 - Copy.jpg` and editable source `1076814.pdn`; neither is assigned a guessed ID, published, or re-encoded.
- Never infer a UUID from a numeric image filename. Production mappings require official Lua registration plus the referenced `.tile` UUID.
- The original repository does not contain a complete public random surface layout. Without a save, keep the existing reference regions/search/filter/list/details and explain that terrain appears after selecting a v28 save; do not fabricate a player world.
- A selected v28 save continues to use its decoded UUID, x/y offset, rotation, flags, bounds, and seed. Never regenerate a personal map from seed alone.
- Save bytes, filename, seed, UUID layout, and progress remain in memory only and must not enter URL, logs, storage, analytics, generated files, or layout-dependent network requests.
- All legacy images are served locally by this application. The complete legacy request set begins before a save layout is known.
- Unknown 1.0 UUIDs render an explicit terrain-type fallback and are never silently mapped to a legacy image.
- Keep the existing 18 regions, fixed-region navigation, search, filters, list, details, atomic replacement, and recoverable-error behavior.
- The parked null-Canvas Leaflet constructor rollback is outside this plan and remains non-blocking by user decision.

---

### Task 1: Generate the official legacy-ID to 1.0 UUID bridge

**Files:**
- Create: `html/tools/game-data/legacy/legacy-bridge.ts`
- Create: `html/tools/game-data/legacy/legacy-bridge.test.ts`
- Modify: `html/tools/game-data/extract-catalog.ts`
- Modify: `html/tools/game-data/extract-catalog.test.ts`
- Modify: `html/tools/game-data/build-data.ts`
- Modify: `html/tools/game-data/build-data.test.ts`
- Modify: `html/src/terrain/tile-catalog.ts`
- Modify: `html/src/terrain/tile-catalog.test.ts`

**Interfaces:**
- Produces:

```ts
export type LegacyRegistrationStatus = "active" | "retired" | "remapped";

export interface LegacyBridgeEntry {
  legacyId: number;
  uuid: string;
  tilePath: string;
  status: LegacyRegistrationStatus;
  evidence: string;
}

export function readLegacyBridge(
  luaSources: Array<{ relativePath: string; text: string }>,
  tileUuidByPath: ReadonlyMap<string, string>
): LegacyBridgeEntry[];
```

- Extends generated `tile-catalog.json` with `legacyBridge: LegacyBridgeEntry[]`.
- `loadTileCatalog()` returns `legacyBridge` only after existing self-hash, build-info hash, version, and CRLF-portable byte checks pass.

- [ ] **Step 1: Write direct `AddTile` bridge tests**

Use a literal Lua source and tile map:

```ts
const source = {
  relativePath: "Survival/Scripts/terrain/overworld/type_meadow.lua",
  text: `AddTile( 1000001, "$SURVIVAL_DATA/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile", 1 )`
};
const paths = new Map([
  ["Survival/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile", "11111111-2222-4333-8444-555555555555"]
]);
expect(readLegacyBridge([source], paths)).toEqual([{
  legacyId: 1000001,
  uuid: "11111111-2222-4333-8444-555555555555",
  tilePath: "Survival/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile",
  status: "active",
  evidence: "Survival/Scripts/terrain/overworld/type_meadow.lua:AddTile"
}]);
```

- [ ] **Step 2: Write POI legacy-wrapper tests**

Test:

```lua
POI_CRASHSITE_AREA = 101
addPoiTileLegacy(POI_CRASHSITE_AREA, 1, "$SURVIVAL_DATA/Terrain/Tiles/start_area/SurvivalStartArea_CrashedShip_01.tile")
addPoiTileRetired(POI_CRASHSITE_AREA, 8, "$SURVIVAL_DATA/Terrain/Tiles/start_area/Retired.tile")
```

Assert IDs `10101` and `10108`, statuses `active` and `retired`, and the exact UUIDs read from the supplied tile map.

- [ ] **Step 3: Write remap, conflict, and fail-closed tests**

Cover:

- `AddLegacyUpgrade(1000001, uuid)` or an official remap path becomes `remapped`;
- duplicate identical registrations collapse deterministically;
- one legacy ID resolving to two UUIDs throws;
- unknown POI constant throws;
- missing `.tile` path throws;
- `nil`, dynamic arithmetic other than `poiType * 100 + index`, and filename-only input produce no mapping.

- [ ] **Step 4: Run the bridge tests and verify RED**

Run:

```powershell
npm.cmd test -- tools/game-data/legacy/legacy-bridge.test.ts tools/game-data/extract-catalog.test.ts
```

Expected: FAIL because `readLegacyBridge` and `legacyBridge` do not exist.

- [ ] **Step 5: Implement the strict parser**

Implement path normalization:

```ts
const contentPath = (value: string) =>
  value.replace(/^\$SURVIVAL_DATA\//, "Survival/");
```

Parse numeric POI constants with:

```ts
const constantPattern = /^\s*(POI_[A-Z0-9_]+)\s*=\s*(\d+)\b/gm;
```

Parse only literal direct/wrapper calls. Resolve the normalized path through the provided case-folded tile map. Sort by `legacyId`, then `status`, then `tilePath`. Reject conflicting UUIDs before returning.

- [ ] **Step 6: Integrate bridge extraction into generated data**

Add `legacyBridge` to `GeneratedCatalog` and `TileCatalogPayload`. Feed `extractCatalog()` named Lua sources instead of anonymous strings:

```ts
const overworldLua = await Promise.all(
  inventory.luaFiles
    .filter((file) => file.relativePath.startsWith("Survival/Scripts/terrain/overworld/"))
    .map(async (file) => ({
      relativePath: file.relativePath,
      text: await readFile(sourcePath(paths.gameRoot, file), "utf8")
    }))
);
```

Use all extracted tile headers as the authoritative `tileUuidByPath`.

- [ ] **Step 7: Add browser catalog validation**

Reject duplicate legacy IDs, invalid UUIDs, absolute paths, unknown statuses, and unsorted/non-canonical entries in `loadTileCatalog()`. Add a CRLF fixture proving the new field remains hash-verified.

- [ ] **Step 8: Verify against the installed 1.0 data**

Run:

```powershell
npm.cmd run data:build -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd test -- tools/game-data/legacy tools/game-data/extract-catalog.test.ts src/terrain/tile-catalog.test.ts
```

Assert the generated bridge contains an official entry for legacy ID `1000001`, points to `Meadow_64(1111)_01.tile`, and never prints an absolute game path.

- [ ] **Step 9: Commit**

```powershell
git add html/tools/game-data/legacy html/tools/game-data/extract-catalog.ts html/tools/game-data/extract-catalog.test.ts html/tools/game-data/build-data.ts html/tools/game-data/build-data.test.ts html/src/terrain/tile-catalog.ts html/src/terrain/tile-catalog.test.ts html/public/data/generated
git commit -m "feat: derive official legacy tile bridge"
```

---

### Task 2: Publish and verify the original map images

**Files:**
- Move: `html/assets/img/tiles/*.jpg` → `html/public/legacy/img/tiles/*.jpg`
- Move: original POI/map images under `html/assets/img/` → `html/public/legacy/img/`
- Keep: `html/assets/img/favicon.png` or update its explicit import separately
- Create: `html/tools/game-data/legacy/legacy-assets.ts`
- Create: `html/tools/game-data/legacy/legacy-assets.test.ts`
- Create: `html/tools/game-data/legacy/original-poi-rules.ts`
- Create: `html/tools/game-data/legacy/original-poi-rules.test.ts`
- Modify: `html/tools/game-data/build-data.ts`
- Modify: `html/tools/game-data/verify-generated.ts`
- Modify: `html/tools/game-data/cli.ts`

**Interfaces:**
- Produces `public/data/generated/legacy-assets.json`:

```ts
export interface LegacyAssetRecord {
  key: `tile:${number}` | `poi:${string}`;
  url: string;
  width: number;
  height: number;
  sha256: string;
  source: "the1killer/sm_overview";
}

export interface LegacyPoiRule {
  poiType: string;
  legacyIds?: number[];
  imageKey: `poi:${string}`;
  sizeCells: 2 | 4 | 8;
  coordinate?: { x: number; y: number };
}
```

- [ ] **Step 1: Write the original asset inventory RED tests**

Assert:

- exactly 298 strictly numeric JPGs are present;
- `1000001.jpg` is `500×500`;
- duplicate numeric IDs fail;
- unreadable/zero-sized images fail;
- every record has a SHA-256 and `/legacy/img/...` URL;
- no absolute source path enters the manifest.

- [ ] **Step 2: Write POI-rule regression tests**

Port and test the original behavior for:

- mechanic station, packing stations, hideout, ruin city, silo district;
- 2×2, 4×4, and 8×8 sizes;
- crash-site coordinate exceptions `(-38,-42)`, `(-37,-39)`, `(-37,-40)`, `(-36,-40)`, `(-36,-41)`;
- legacy-ID-specific ruin, forest ruin, underwater lake, and warehouse images.

Use explicit table data; do not execute or import `sm_overview_map.js` at runtime.

- [ ] **Step 3: Run asset tests and verify RED**

Run:

```powershell
npm.cmd test -- tools/game-data/legacy/legacy-assets.test.ts tools/game-data/legacy/original-poi-rules.test.ts
```

Expected: FAIL because the inventory and rule modules do not exist.

- [ ] **Step 4: Move images into Vite public assets**

Use `git mv`, preserving every image byte. Update any favicon reference separately. Do not re-encode original images.

- [ ] **Step 5: Implement manifest generation**

Use Sharp metadata for dimensions and Node crypto for hashes. Emit canonical key order and include the manifest in `build-info.json` so runtime verification has the same self-hash/cross-file-hash/portable-byte contract as other generated data.

- [ ] **Step 6: Add tamper verification**

Test missing tile, altered hash, wrong dimensions, duplicate key, CRLF manifest, and a POI rule referencing an absent image.

- [ ] **Step 7: Build and verify**

Move the CLI gate split forward from Task 5: `data:verify` verifies generated/legacy integrity and must not require the optional 2,877-image native atlas; `data:atlas` remains the explicit complete-atlas gate.

Run:

```powershell
npm.cmd run data:build -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd test -- tools/game-data/legacy
```

Expected: 298 runtime-addressable tile images and all referenced POI images verified; no demand for 2,877 new PNGs is part of the legacy gate.

- [ ] **Step 8: Commit**

```powershell
git add html/public/legacy html/public/data/generated html/tools/game-data/legacy html/tools/game-data/build-data.ts html/tools/game-data/verify-generated.ts html/assets/img
git commit -m "feat: publish original map imagery"
```

---

### Task 3: Preload assets and resolve hybrid terrain visuals

**Files:**
- Create: `html/src/legacy/legacy-asset-repository.ts`
- Create: `html/src/legacy/legacy-asset-repository.test.ts`
- Create: `html/src/legacy/hybrid-terrain-resolver.ts`
- Create: `html/src/legacy/hybrid-terrain-resolver.test.ts`
- Create: `html/src/legacy/legacy-visual-types.ts`
- Modify: `html/src/main.ts`
- Modify: `html/src/app/app-controller.ts`
- Modify: `html/src/app/app-controller.test.ts`

**Interfaces:**

```ts
export interface PreloadedLegacyAsset {
  record: LegacyAssetRecord;
  image: HTMLImageElement;
}

export interface LegacyAssetBundle {
  assets: ReadonlyMap<string, PreloadedLegacyAsset>;
  bridgeByUuid: ReadonlyMap<string, LegacyBridgeEntry>;
  poiRules: readonly LegacyPoiRule[];
}

export interface ResolvedTerrainVisual {
  origin: { x: number; y: number };
  span: { width: number; height: number };
  rotation: 0 | 1 | 2 | 3;
  source: "legacy-tile" | "legacy-poi" | "one-dot-zero-fallback";
  asset?: PreloadedLegacyAsset;
  terrainType: string;
  coveredCells: readonly string[];
}

export function resolveTerrainVisuals(
  cells: readonly TerrainCell[],
  bundle: LegacyAssetBundle
): ResolvedTerrainVisual[];
```

- [ ] **Step 1: Write repository integrity and preload tests**

Test that the repository:

- validates `legacy-assets.json` through build-info;
- starts requests in manifest order without receiving any terrain layout;
- waits for `decode()` for every image;
- returns one immutable bundle;
- rejects a missing or hash-mismatched asset without partially labelling it ready;
- clears `src` on failed/stale image objects.

- [ ] **Step 2: Write hybrid resolver tests**

Use four cells:

1. UUID officially mapped to `1000001` → `legacy-tile`;
2. mapped mechanic-station UUID with POI rule → `legacy-poi`, 2×2 span;
3. official 1.0 UUID with no legacy asset → `one-dot-zero-fallback`;
4. arbitrary unknown UUID → fallback, never a numeric filename guess.

Assert exact rotation and that covered POI cells are emitted once, not drawn again as ordinary tiles.

- [ ] **Step 3: Write original coordinate-exception tests**

Assert the crash-site coordinate rules select the original special images only at the exact coordinates. A neighboring cell must use the ordinary tile/fallback path.

- [ ] **Step 4: Run and verify RED**

```powershell
npm.cmd test -- src/legacy
```

Expected: FAIL because repository and resolver modules do not exist.

- [ ] **Step 5: Implement the repository**

The repository constructor receives only fixed public URLs:

```ts
new LegacyAssetRepository(
  "/data/generated/legacy-assets.json",
  "/data/generated/tile-catalog.json",
  "/data/generated/build-info.json"
);
```

`preload()` begins before `startApp()` accepts a save. It loads the complete manifest asset set in canonical order. It does not accept `WorldMap`, `TerrainCell`, UUID, or save metadata.

- [ ] **Step 6: Implement resolver grouping**

Build `cellByCoordinate`, `covered`, and `bridgeByUuid` maps. Visit cells row-major. Apply POI origin rules first, mark their exact rectangular coverage, then resolve remaining cells by bridge legacy ID. Unknown and uncovered 1.0 cells receive the terrain-type fallback.

- [ ] **Step 7: Wire preload without blocking reference interactions**

In `main.ts`, start the preload before `startApp`:

```ts
const legacyAssets = legacyAssetRepository.preload();
void startApp(root, referenceMapRepository, { legacyAssets }).catch(...);
```

Reference regions/search/filter/list/details render immediately. Save selection may parse concurrently, but its visual preparation awaits the already-started fixed preload promise.

- [ ] **Step 8: Verify request independence**

Use two different `WorldMap` layouts after one preload. Assert no additional asset URL is requested by the repository or resolver.

- [ ] **Step 9: Commit**

```powershell
git add html/src/legacy html/src/main.ts html/src/app/app-controller.ts html/src/app/app-controller.test.ts
git commit -m "feat: resolve 1.0 terrain through original assets"
```

---

### Task 4: Render original tiles and POIs in the mounted Leaflet layer

**Files:**
- Create: `html/src/map/legacy-terrain-renderer.ts`
- Create: `html/src/map/legacy-terrain-renderer.test.ts`
- Modify: `html/src/map/atlas-layer.ts`
- Modify: `html/src/map/atlas-layer.test.ts`
- Modify: `html/src/map/map-view.ts`
- Modify: `html/src/map/map-view.test.ts`
- Modify: `html/src/app/app-controller.ts`
- Modify: `html/src/app/app-controller.test.ts`

**Interfaces:**

```ts
export interface LegacyTerrainFrame {
  visuals: readonly ResolvedTerrainVisual[];
  coverage: {
    totalCells: number;
    legacyTileCells: number;
    legacyPoiCells: number;
    fallbackCells: number;
  };
}

export async function drawLegacyTerrainFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: LegacyTerrainFrame,
  viewport: LegacyViewport,
  signal: AbortSignal
): Promise<void>;
```

- Adds `AtlasNetworkPolicy = "atlas" | "offline-overview" | "legacy-preloaded"`.
- `MapView.prepareWorld(world, overview, legacyBundle)` stages a legacy frame after the exact worker overview and atomically commits it only while current.

- [ ] **Step 1: Write pixel/draw-record RED tests**

Test a 2×2 world with four distinct legacy images. Assert four source images, four destination cells, rotations `0/1/2/3`, no generic overview fill over those cells, and a non-empty committed canvas.

- [ ] **Step 2: Write POI span tests**

Test 2×2, 4×4, and 8×8 POIs. Assert one image draw per POI, correct rotated bounds, and no duplicate constituent-cell draws. Port the original rotation corrections:

```ts
const degrees = [0, 270, 180, 90] as const;
```

The renderer must save/translate/rotate/draw/restore rather than mutate the source image.

- [ ] **Step 3: Write atomic and fallback tests**

Cover:

- one image decode/draw failure keeps the committed worker overview;
- an unmapped 1.0 tile draws `overviewColor(terrainType)`;
- hidden/stale/replaced generations abort and never swap;
- turning terrain off/on redraws the same legacy frame;
- `ImageBitmap` from the save Worker is closed exactly once after legacy staging.

- [ ] **Step 4: Write privacy differential RED test**

Preload the fixed asset set, then render two layouts with disjoint legacy IDs. Capture requests beginning at each file selection. Assert both post-selection sequences are identical and contain zero `/legacy/` requests.

- [ ] **Step 5: Run and verify RED**

```powershell
npm.cmd test -- src/map/legacy-terrain-renderer.test.ts src/map/atlas-layer.test.ts src/map/map-view.test.ts
```

Expected: FAIL because the renderer and `legacy-preloaded` policy do not exist.

- [ ] **Step 6: Implement task-yielding canvas rendering**

Compute viewport bounds iteratively. Draw at most 4,096 ordinary cells or eight rows before yielding a real browser task and checking `AbortSignal`. Draw into a staging canvas and swap only after the complete current frame succeeds.

- [ ] **Step 7: Integrate with AtlasLayer**

`legacy-preloaded` must never call `fetch()` or set a new image `src`. It consumes only `PreloadedLegacyAsset.image`. Existing future `atlas` support remains for non-personal fixed resources, while personal and save surface rendering uses `legacy-preloaded`.

- [ ] **Step 8: Integrate with MapView and AppController**

Await the preload promise during personal visual preparation, resolve visuals, draw the mounted staging layer, then commit. Fixed regions use the same resolver when their UUIDs have legacy mappings. Exit restores the reference/fixed layer policy without retaining personal visuals.

- [ ] **Step 9: Verify**

```powershell
npm.cmd test -- src/legacy src/map src/app/app-controller.test.ts
npm.cmd run build
```

Expected: all pass; build contains legacy public images and no absolute game/save paths.

- [ ] **Step 10: Commit**

```powershell
git add html/src/map html/src/app/app-controller.ts html/src/app/app-controller.test.ts
git commit -m "feat: render original terrain in personal maps"
```

---

### Task 5: Restore original-map presentation and 1.0 coverage reporting

**Files:**
- Modify: `html/src/components/save-entry.ts`
- Modify: `html/src/components/app-shell.ts`
- Modify: `html/src/styles/app.css`
- Create: `html/src/components/terrain-coverage.ts`
- Create: `html/src/components/terrain-coverage.test.ts`
- Modify: `html/tools/game-data/atlas/verify-atlas.ts`
- Modify: `html/tools/game-data/atlas/verify-atlas.test.ts`
- Modify: `html/tools/game-data/cli.ts`
- Modify: `html/package.json`

**Interfaces:**

```ts
export interface TerrainCoverageSummary {
  totalCells: number;
  legacyImageCells: number;
  oneDotZeroImageCells: number;
  fallbackCells: number;
  distinctFallbackUuids: number;
}
```

- [ ] **Step 1: Write UI RED tests**

Without a save, assert the page says:

```text
选择 1.0 Survival 存档后，将按真实地形布局拼接原版底图。
```

After a save, assert the coverage status displays legacy/fallback counts without filename, seed, UUID list, or path.

- [ ] **Step 2: Write verification-report RED tests**

Given worlds and manifests, assert the CLI reports:

```json
{
  "legacyAssetIds": 298,
  "officialLegacyMappings": 406,
  "legacyCoveredUuids": 298,
  "oneDotZeroRenderedUuids": 0,
  "fallbackUuids": 442
}
```

Use fixture values in the test; production values come from the generated catalog and real aggregate verifier. Report UUID counts only, never personal UUID values.

- [ ] **Step 3: Run and verify RED**

```powershell
npm.cmd test -- src/components/terrain-coverage.test.ts tools/game-data/atlas/verify-atlas.test.ts
```

- [ ] **Step 4: Implement coverage UI**

Add a compact status below the save metadata. It must distinguish:

- “原版底图” for legacy image cells;
- “1.0 分类底色” for fallbacks;
- “1.0 新底图” for future incremental renders.

Do not label fallback cells as exact imagery; the layout remains exact, the visual source does not.

- [ ] **Step 5: Update CLI commands**

Add:

```json
"data:legacy": "tsx tools/game-data/cli.ts legacy"
```

`legacy` rebuilds/verifies the bridge and image manifest. The `verify`/`data:atlas` gate split was moved to Task 2; keep that behavior and do not reimplement it here. Verification fails only for broken official mappings, missing original assets, corrupt manifests, or a requested 1.0 render that is missing.

- [ ] **Step 6: Verify local presentation**

Run:

```powershell
npm.cmd run data:legacy -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`, verify reference interactions without a save, then upload the private save through the UI and record only aggregate coverage counts.

- [ ] **Step 7: Commit**

```powershell
git add html/src/components html/src/styles/app.css html/tools/game-data html/package.json html/package-lock.json
git commit -m "feat: report legacy and 1.0 terrain coverage"
```

---

### Task 6: Browser journeys, compatibility proof, and release gate

**Files:**
- Modify: `html/tests/e2e/personal-map.spec.ts`
- Modify: `html/tests/e2e/save-errors.spec.ts`
- Create: `html/tests/e2e/legacy-map.spec.ts`
- Create: `html/tests/e2e/fixtures/legacy-map-fixture.ts`
- Modify: `html/tests/e2e/base-map.spec.ts`
- Modify: `html/tools/game-data/atlas/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes only public UI, generated public manifests, and synthetic v28 saves.
- Produces the final Chromium/Firefox and data-verification gate.

- [ ] **Step 1: Write the legacy rendering journey**

Generate a synthetic v28 save whose four UUIDs officially bridge to four distinct original images. Through the public file input, assert:

- progress stages remain ordered;
- personal badge and metadata commit;
- four distinct legacy draw records/pixels appear;
- rotation changes the expected quadrants;
- coverage reports four legacy cells and zero fallback cells.

- [ ] **Step 2: Write mixed 1.0 journey**

Use two mapped UUIDs and two valid 1.0 unmapped UUIDs. Assert:

- mapped cells use original imagery;
- unmapped cells use two explicit terrain-type colors;
- the layout and four cell boundaries remain exact;
- coverage reports two legacy and two fallback cells.

- [ ] **Step 3: Write original POI journey**

Use a mapped 2×2 mechanic station plus ordinary cells. Assert one POI image draw spans exactly 2×2 cells, constituent cells are not double-drawn, its map marker/list/detail remain usable, and zoom/reset/layer toggles preserve it.

- [ ] **Step 4: Write no-save reference journey**

Assert no fabricated terrain is labelled as a player map. Region switching, search, filters, list, details, upload entry, and reference marker remain available.

- [ ] **Step 5: Strengthen privacy journey**

For two disjoint mapped layouts, capture URL, request URLs/bodies, console, localStorage, IndexedDB, Cache, and generated artifacts. Assert:

- all legacy asset requests began before file selection;
- post-selection `/legacy/` requests are zero for both layouts;
- post-selection sequences are identical;
- no file/seed/bytes/UUID-layout sentinel appears.

- [ ] **Step 6: Run exact browser gates**

```powershell
npm.cmd run test:e2e -- tests/e2e/legacy-map.spec.ts tests/e2e/personal-map.spec.ts tests/e2e/save-errors.spec.ts --project=chromium --project=firefox
npm.cmd run test:e2e
```

- [ ] **Step 7: Run complete verification**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd run data:build -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd run data:legacy -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"
git diff --check
git status --short
```

Run the ignored aggregate-only validator against the known private save. Confirm v28, world 1, 128×96, 12,288 cells, and 442 distinct UUIDs; print no path, filename, Steam ID, raw bytes, UUID list, or decoded personal record.

- [ ] **Step 8: Inspect local UI**

At `http://127.0.0.1:4173/`, visually confirm:

- the reference experience remains useful before upload;
- after upload, real original terrain images cover mapped cells;
- fallback cells are visibly distinct and honestly labelled;
- 18 regions and all sidebar interactions still work.

- [ ] **Step 9: Update documentation**

Document:

- original project attribution and CC BY-NC-SA 4.0 status;
- Axolot Games ownership disclaimer;
- official mapping derivation;
- local `data:legacy` command;
- how to add a reviewed 1.0 render without changing legacy mappings;
- why no complete public random surface is shown before a save.

- [ ] **Step 10: Commit**

```powershell
git add html/tests html/tools/game-data/atlas/README.md README.md
git commit -m "test: verify original map and 1.0 compatibility"
```
