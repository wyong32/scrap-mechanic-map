# Grow Lab 1 Authentic Static Map Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a complete, standard-resolution, seven-layer orthographic map of Grow Lab 1 from Scrap Mechanic 1.0 official resources and replace that region's temporary reference art with the verified authentic map.

**Architecture:** A build-time capture pipeline derives one deterministic capture job from `growlab_01.world` and `Minidungeon_Interior_01.tile`, validates seven official-editor captures, pads them into the 16×16 region canvas, and packs a 128-pixels-per-cell WebP pyramid with a self-hashed manifest. At runtime a focused authentic-map repository verifies the manifest and a Leaflet grid-layer group renders its independently switchable layers; all other regions keep their current path until the prototype is accepted.

**Tech Stack:** TypeScript 5.8, Node.js, Sharp, Scrap Mechanic 1.0.1.869 WorldBuilder/TileEditor, Leaflet 1.9, Vite 7, Vitest 3, Playwright 1.55, PowerShell/Windows UI automation for the one-time official-editor capture.

## Global Constraints

- Process only Grow Lab 1 in this plan.
- Read game data only from `G:\共享文件\Scrap Mechanic`; never modify files below that root.
- The authoritative inputs are `growlab_01.world`, `Minidungeon_Interior_01.tile`, and their official model/material/texture/effect dependencies.
- Render at exactly 128 pixels per game cell.
- The public world canvas is 16×16 cells and 2048×2048 pixels.
- Generate terrain, surfaces, structures, props, vegetation, shadows, and effects as seven aligned layers.
- All layers are enabled by default. Visibility controls may hide a layer but may not delete its data.
- Dynamic effects use a representative still frame and retain instance count/source identity in the manifest.
- Do not use `fixed-region-backdrop.svg`, legacy approximations, classification colors, hand-drawn content, or a generated fallback for Grow Lab 1.
- A missing or invalid authentic asset makes Grow Lab 1 explicitly unavailable; it never falls back to a reference image.
- Absolute game paths, Windows usernames, save paths, and private save data must not enter public output.
- Implement every behavior test-first and watch the focused test fail before production changes.

---

## File Structure

### Build-time capture and packing

- `html/tools/authentic-map/authentic-map-types.ts`: shared capture job, layer, receipt, and manifest types.
- `html/tools/authentic-map/grow-lab-job.ts`: derives the exact Grow Lab 1 capture job from verified generated world/catalog data.
- `html/tools/authentic-map/grow-lab-job.test.ts`: source identity, bounds, offset, and privacy tests.
- `html/tools/authentic-map/verify-capture.ts`: validates official-editor layer captures and source receipts.
- `html/tools/authentic-map/verify-capture.test.ts`: image, alignment, empty-layer, and tamper tests.
- `html/tools/authentic-map/pack-pyramid.ts`: pads the 10×10 source extent into the 16×16 world, creates WebP pyramid tiles, and writes the manifest.
- `html/tools/authentic-map/pack-pyramid.test.ts`: pixel placement, pyramid geometry, determinism, and manifest tests.
- `html/tools/authentic-map/cli.ts`: `probe`, `verify-capture`, and `pack` entry points.
- `html/package.json`: `data:authentic-map` script.

### Runtime

- `html/src/authentic-map/authentic-map-types.ts`: browser-safe manifest and layer IDs.
- `html/src/authentic-map/authentic-map-repository.ts`: fetches and verifies the Grow Lab 1 manifest.
- `html/src/authentic-map/authentic-map-repository.test.ts`: hash, schema, region, and retry tests.
- `html/src/authentic-map/authentic-fixed-layer.ts`: Leaflet grid layer for one authentic visual layer.
- `html/src/authentic-map/authentic-fixed-layer.test.ts`: tile URL, bounds, zoom, visibility, and teardown tests.
- `html/src/authentic-map/authentic-layer-group.ts`: owns seven ordered Leaflet layers and atomic activation.
- `html/src/authentic-map/authentic-layer-group.test.ts`: ordering, default visibility, failure, and switching tests.
- `html/src/domain/map-layers.ts`: adds authentic fixed-map visibility IDs.
- `html/src/map/map-view.ts`: accepts and mounts an optional authentic manifest; removes the placeholder for Grow Lab 1.
- `html/src/app/app-controller.ts`: loads authentic data with the selected fixed world.
- `html/src/app/app-shell.ts`: renders authentic controls only when an authentic map is active.
- Existing focused tests beside those files: controller, shell, map-view, and URL-state regressions.

### Public output and browser verification

- `html/public/authentic/grow-lab-1/manifest.json`: self-hashed public manifest.
- `html/public/authentic/grow-lab-1/<layer>/<level>/<x>-<y>.webp`: generated pyramid tiles.
- `html/tests/e2e/authentic-grow-lab.spec.ts`: Chromium/Firefox public-UI journey.
- `html/tests/e2e/fixtures/authentic-grow-lab-fixture.ts`: deterministic tiny manifest/tiles for error branches.

---

### Task 1: Derive the Exact Grow Lab 1 Capture Job

**Files:**
- Create: `html/tools/authentic-map/authentic-map-types.ts`
- Create: `html/tools/authentic-map/grow-lab-job.ts`
- Create: `html/tools/authentic-map/grow-lab-job.test.ts`

**Interfaces:**
- Consumes: verified `WorldMap` from `public/data/generated/worlds/growlab_01.json` and tile records from `tile-catalog.json`.
- Produces:

```ts
export const AUTHENTIC_LAYER_IDS = [
  "terrain", "surfaces", "structures", "props",
  "vegetation", "shadows", "effects"
] as const;

export type AuthenticLayerId = (typeof AUTHENTIC_LAYER_IDS)[number];

export interface AuthenticCaptureJob {
  regionId: "grow-lab-1";
  worldId: "growlab_01";
  gameVersion: "1.0.0";
  sourceTile: {
    uuid: string;
    relativePath: string;
    widthCells: 10;
    heightCells: 10;
  };
  worldBounds: { minX: -8; minY: -8; maxX: 7; maxY: 7 };
  sourceOriginCells: { x: 3; y: 3 };
  pixelsPerCell: 128;
  outputPixels: { width: 2048; height: 2048 };
  layers: readonly AuthenticLayerId[];
}

export function buildGrowLabCaptureJob(
  world: WorldMap,
  tiles: readonly TileDefinition[]
): AuthenticCaptureJob;
```

- [ ] **Step 1: Write the failing literal job test**

```ts
it("derives the one official 10x10 tile inside the 16x16 Grow Lab 1 canvas", () => {
  const job = buildGrowLabCaptureJob(growLabWorld, tileCatalog);
  expect(job).toEqual({
    regionId: "grow-lab-1",
    worldId: "growlab_01",
    gameVersion: "1.0.0",
    sourceTile: {
      uuid: "d3d4d976-d2a6-4d21-95bd-fada26b6b371",
      relativePath:
        "Survival/DungeonTiles/Minidungeon/Minidungeon_Interior_01.tile",
      widthCells: 10,
      heightCells: 10
    },
    worldBounds: { minX: -8, minY: -8, maxX: 7, maxY: 7 },
    sourceOriginCells: { x: 3, y: 3 },
    pixelsPerCell: 128,
    outputPixels: { width: 2048, height: 2048 },
    layers: [
      "terrain", "surfaces", "structures", "props",
      "vegetation", "shadows", "effects"
    ]
  });
});
```

Also test that mixed UUIDs, a non-rectangular offset set, an absolute tile path, a non-zero rotation, or a mismatched 10×10 source extent throws without printing the game root.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
cd html
npm.cmd test -- tools/authentic-map/grow-lab-job.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict job derivation**

Iterate the 100 world cells and assert:

```ts
const key = `${cell.uuid}|${cell.rotation}`;
if (key !== `${expectedUuid}|0`) {
  throw new Error("Grow Lab 1 is not the reviewed official capture source.");
}
```

Derive the source origin from `min(cell.x) - world.bounds.minX` and
`min(cell.y) - world.bounds.minY`; compare the literal result with `{ x: 3, y: 3 }`.
Resolve the UUID through the catalog and require the exact relative path and 10×10 dimensions.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tools/authentic-map/grow-lab-job.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add html/tools/authentic-map
git commit -m "feat: derive Grow Lab authentic capture job"
```

---

### Task 2: Prove Official Editor Capture Capability and Validate Seven Captures

**Files:**
- Create: `html/tools/authentic-map/verify-capture.ts`
- Create: `html/tools/authentic-map/verify-capture.test.ts`
- Create: `html/tools/authentic-map/cli.ts`
- Modify: `html/package.json`
- External, not committed: `F:\Scrap Mechanical\authentic-captures\grow-lab-1\`

**Interfaces:**
- Consumes: `AuthenticCaptureJob`, seven 1280×1280 official-editor PNGs, and `capture-receipt.json`.
- Produces:

```ts
export interface OfficialCaptureReceipt {
  editor: "TileEditor";
  editorVersion: "1.0.1.869";
  sourceTileUuid: "d3d4d976-d2a6-4d21-95bd-fada26b6b371";
  sourceTileRelativePath: string;
  camera: {
    projection: "orthographic";
    direction: "north-up";
    pixelsPerCell: 128;
    width: 1280;
    height: 1280;
  };
  layers: Record<AuthenticLayerId, {
    file: string;
    officialInstanceCount: number;
    transparentAllowed: boolean;
  }>;
}

export interface VerifiedCaptureSet {
  job: AuthenticCaptureJob;
  receipt: OfficialCaptureReceipt;
  files: ReadonlyMap<AuthenticLayerId, {
    absolutePath: string;
    sha256: string;
    width: 1280;
    height: 1280;
  }>;
}

export async function verifyOfficialCapture(
  job: AuthenticCaptureJob,
  captureDirectory: string
): Promise<VerifiedCaptureSet>;
```

- [ ] **Step 1: Write capture verification RED tests**

Generate seven 1280×1280 PNG fixtures with Sharp. Assert:

```ts
await expect(verifyOfficialCapture(job, fixtureDirectory)).resolves.toMatchObject({
  receipt: {
    editor: "TileEditor",
    editorVersion: "1.0.1.869"
  }
});
```

Test these failures independently:

- one missing layer;
- dimensions other than 1280×1280;
- non-PNG bytes;
- wrong editor version or tile UUID;
- a fully transparent layer whose receipt has `officialInstanceCount > 0`;
- an absolute source path in the receipt;
- a receipt with an unknown eighth layer.

- [ ] **Step 2: Run the verifier test and verify RED**

Run:

```powershell
npm.cmd test -- tools/authentic-map/verify-capture.test.ts
```

Expected: FAIL because `verifyOfficialCapture` does not exist.

- [ ] **Step 3: Implement capture validation and CLI wiring**

Add:

```json
"data:authentic-map": "tsx tools/authentic-map/cli.ts"
```

Support:

```powershell
npm.cmd run data:authentic-map -- verify-capture `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --capture-directory "F:\Scrap Mechanical\authentic-captures\grow-lab-1"
```

The CLI reads the verified generated world/catalog, builds the reviewed job, checks
`TileEditor.exe` file version `1.0.1.869`, and then verifies the external captures.
It prints aggregate hashes and dimensions only, never the absolute game root.

- [ ] **Step 4: Run the verifier tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tools/authentic-map/verify-capture.test.ts
```

Expected: PASS.

- [ ] **Step 5: Perform the official-editor capability gate**

Use the Windows app-control surface to open:

```text
G:\共享文件\Scrap Mechanic\Release\TileEditor.exe
```

Open only:

```text
G:\共享文件\Scrap Mechanic\Survival\DungeonTiles\Minidungeon\Minidungeon_Interior_01.tile
```

Verify all of the following before capturing:

1. The editor displays the complete 10×10 source tile.
2. A north-up orthographic camera can frame the exact tile bounds.
3. Terrain/surfaces, structures, props, vegetation, shadows, and effects can be
   isolated through editor visibility controls or official render-category controls.
4. UI chrome can be excluded from the 1280×1280 render target.
5. The game installation remains byte-identical after the session.

If any item fails, stop this plan with the exact failed capability. Do not proceed
with a composite screenshot, classification fill, recreated material, or placeholder.

- [ ] **Step 6: Capture the seven official layers**

Create the external directory with PowerShell `New-Item -ItemType Directory`.
Capture the exact files:

```text
terrain.png
surfaces.png
structures.png
props.png
vegetation.png
shadows.png
effects.png
capture-receipt.json
```

For each pass, keep camera position, orthographic scale, direction, render target,
time-of-day, effect sample time, and transparent background unchanged. Record the
official instance count for each category. A zero-instance layer is allowed to be
transparent only when the editor inventory also reports zero.

- [ ] **Step 7: Verify the real capture set**

Run the `verify-capture` command above.

Expected: PASS with seven files, 1280×1280 each, and no absolute path in output.

- [ ] **Step 8: Commit the verifier, not private capture inputs**

```powershell
git add html/tools/authentic-map html/package.json html/package-lock.json
git commit -m "feat: verify official Grow Lab layer captures"
```

---

### Task 3: Pack the Standard-Resolution WebP Pyramid

**Files:**
- Create: `html/tools/authentic-map/pack-pyramid.ts`
- Create: `html/tools/authentic-map/pack-pyramid.test.ts`
- Modify: `html/tools/authentic-map/cli.ts`
- Generate: `html/public/authentic/grow-lab-1/**`

**Interfaces:**
- Consumes: `VerifiedCaptureSet`.
- Produces:

```ts
export interface AuthenticFixedMapManifest {
  schemaVersion: 1;
  gameVersion: "1.0.0";
  regionId: "grow-lab-1";
  worldId: "growlab_01";
  pixelsPerCell: 128;
  tileSize: 512;
  bounds: { minX: -8; minY: -8; maxX: 7; maxY: 7 };
  nativeZoom: 1;
  levels: readonly [-1, 0, 1];
  layers: ReadonlyArray<{
    id: AuthenticLayerId;
    order: number;
    officialInstanceCount: number;
    template: string;
    tiles: readonly {
      z: -1 | 0 | 1;
      x: number;
      y: number;
      width: number;
      height: number;
      sha256: string;
      bytes: number;
    }[];
  }>;
  contentHash: string;
}

export async function packAuthenticPyramid(
  capture: VerifiedCaptureSet,
  outputDirectory: string
): Promise<AuthenticFixedMapManifest>;
```

- [ ] **Step 1: Write pixel-placement and pyramid RED tests**

Use a 1280×1280 fixture with colored corner pixels. Assert the native 2048×2048
canvas places it at `3 * 128 = 384` pixels from the left and top, leaving the
remaining world margin transparent.

Assert per layer:

- zoom `-1`: 512×512, one tile;
- zoom `0`: 1024×1024, four 512 tiles;
- zoom `1`: 2048×2048, sixteen 512 tiles;
- all seven layers: 147 WebP files;
- paths are `/authentic/grow-lab-1/<layer>/<level>/<x>-<y>.webp`;
- rerunning from identical inputs produces byte-identical manifest JSON;
- one changed source pixel changes the affected tile hash and manifest hash.

- [ ] **Step 2: Run packer tests and verify RED**

Run:

```powershell
npm.cmd test -- tools/authentic-map/pack-pyramid.test.ts
```

Expected: FAIL because the packer does not exist.

- [ ] **Step 3: Implement padding, resizing, tiling, and hashing**

For each layer:

```ts
const native = await sharp(source)
  .extend({
    top: 384,
    left: 384,
    right: 384,
    bottom: 384,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png()
  .toBuffer();
```

Create the two lower levels with Lanczos3. Extract 512×512 tiles and encode:

```ts
await sharp(levelBuffer)
  .extract({ left: x * 512, top: y * 512, width: 512, height: 512 })
  .webp({ lossless: true, effort: 6 })
  .toBuffer();
```

Write files in canonical layer/level/y/x order. Build the self-hash from canonical
JSON without `contentHash`.

- [ ] **Step 4: Run packer tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tools/authentic-map/pack-pyramid.test.ts
```

Expected: PASS.

- [ ] **Step 5: Pack the real Grow Lab 1 captures**

Run:

```powershell
npm.cmd run data:authentic-map -- pack `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --capture-directory "F:\Scrap Mechanical\authentic-captures\grow-lab-1" `
  --output-directory "F:\Scrap Mechanical\sm_overview-main\.worktrees\phase-3-save-map\html\public\authentic\grow-lab-1"
```

Expected: `manifest.json`, 147 WebP files, reported total size between 1 byte and
80 MB, and no absolute path in any public JSON.

- [ ] **Step 6: Commit**

```powershell
git add html/tools/authentic-map html/public/authentic/grow-lab-1
git commit -m "feat: pack authentic Grow Lab map pyramid"
```

---

### Task 4: Verify the Authentic Manifest in the Browser

**Files:**
- Create: `html/src/authentic-map/authentic-map-types.ts`
- Create: `html/src/authentic-map/authentic-map-repository.ts`
- Create: `html/src/authentic-map/authentic-map-repository.test.ts`

**Interfaces:**
- Consumes: `/authentic/grow-lab-1/manifest.json`.
- Produces:

```ts
export interface AuthenticFixedMapRepository {
  load(regionId: string): Promise<AuthenticFixedMapManifest | undefined>;
}

export class HttpAuthenticFixedMapRepository
  implements AuthenticFixedMapRepository {
  constructor(
    private readonly basePath = "/authentic"
  ) {}
  load(regionId: string): Promise<AuthenticFixedMapManifest | undefined>;
}
```

- [ ] **Step 1: Write repository RED tests**

Assert:

- `load("grow-lab-1")` fetches and returns the verified manifest;
- all seven exact layer IDs and orders `0..6` are required;
- self-hash, schema, game version, region, world, dimensions, bounds, zoom levels,
  tile coordinates, relative templates, SHA-256 format, and byte counts validate;
- unknown regions return `undefined` without a request;
- a rejected request is removed from cache so retry can succeed;
- absolute URLs, traversal, duplicate tiles, missing tiles, and an 81 MB aggregate
  manifest are rejected.

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```powershell
npm.cmd test -- src/authentic-map/authentic-map-repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement strict parsing and retryable caching**

Use `crypto.subtle.digest` for the manifest self-hash. Validate every field before
returning the typed object. Cache only the in-flight/success promise for
`grow-lab-1`; clear it on failure.

- [ ] **Step 4: Run repository tests and verify GREEN**

Run:

```powershell
npm.cmd test -- src/authentic-map/authentic-map-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add html/src/authentic-map
git commit -m "feat: verify authentic fixed-map manifests"
```

---

### Task 5: Render Seven Authentic Layers in Leaflet

**Files:**
- Create: `html/src/authentic-map/authentic-fixed-layer.ts`
- Create: `html/src/authentic-map/authentic-fixed-layer.test.ts`
- Create: `html/src/authentic-map/authentic-layer-group.ts`
- Create: `html/src/authentic-map/authentic-layer-group.test.ts`
- Modify: `html/src/map/map-view.ts`
- Modify: `html/src/map/map-view.test.ts`

**Interfaces:**
- Consumes: verified `AuthenticFixedMapManifest`.
- Produces:

```ts
export interface AuthenticLayerGroup {
  prepare(manifest: AuthenticFixedMapManifest): Promise<void>;
  commit(): void;
  discard(): void;
  setVisible(layerId: AuthenticLayerId, visible: boolean): void;
  remove(): void;
}

export function createAuthenticLayerGroup(
  map: L.Map,
  requestTile: (url: string, sha256: string, bytes: number) => Promise<string>
): AuthenticLayerGroup;
```

Extend:

```ts
MapView.setWorld(
  world: WorldMap,
  networkPolicy?: AtlasNetworkPolicy,
  authenticMap?: AuthenticFixedMapManifest
): void;
```

- [ ] **Step 1: Write grid-layer URL and bounds RED tests**

For zoom `1`, assert tile `(0,0)` resolves to:

```text
/authentic/grow-lab-1/terrain/1/0-0.webp
```

Assert tile coordinates outside `0..3` return an empty transparent tile and never
request a URL. Assert levels `-1`, `0`, and `1` map to the exact manifest entries.

- [ ] **Step 2: Write group lifecycle RED tests**

Assert:

- seven panes mount in exact layer order;
- all seven are visible after commit;
- hiding `vegetation` affects only that layer;
- a failed tile/hash check keeps the previously committed map frame;
- `discard()` removes only the prepared group;
- `remove()` releases object URLs, Leaflet listeners, and panes;
- Grow Lab 1 with an authentic manifest has no `.fixed-region-backdrop`;
- Grow Lab 1 without a manifest has neither placeholder nor classification terrain
  and exposes a `data-authentic-map-error` status.

- [ ] **Step 3: Run layer tests and verify RED**

Run:

```powershell
npm.cmd test -- src/authentic-map/authentic-fixed-layer.test.ts `
  src/authentic-map/authentic-layer-group.test.ts `
  src/map/map-view.test.ts
```

Expected: FAIL because authentic layers are not implemented.

- [ ] **Step 4: Implement authenticated tile loading**

`requestTile` fetches a tile, requires `Content-Length === bytes` when present,
hashes the body, creates an object URL only after the hash matches, and returns it.
The Leaflet tile releases the URL on unload.

- [ ] **Step 5: Implement atomic group activation**

Create seven panes above the ordinary atlas canvas and below markers. Prepare all
currently visible tiles off-screen, then commit the group and hide/remove the old
fixed canvas/backdrop in one synchronous step.

- [ ] **Step 6: Modify MapView**

When `authenticMap?.regionId === "grow-lab-1"`:

- do not call `syncBaseBackdrop` for the fixed placeholder;
- prevent the atlas fallback canvas from becoming the visible terrain source;
- prepare/commit the authentic group;
- keep locations and marker panes unchanged.

When the manifest is absent or invalid, show the explicit authentic-map error and
leave the terrain area empty.

- [ ] **Step 7: Run layer tests and verify GREEN**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add html/src/authentic-map html/src/map
git commit -m "feat: render authentic Grow Lab layers"
```

---

### Task 6: Load the Prototype and Expose Layer Controls

**Files:**
- Modify: `html/src/domain/map-layers.ts`
- Modify: `html/src/domain/map-layers.test.ts`
- Modify: `html/src/app/app-controller.ts`
- Modify: `html/src/app/app-controller.test.ts`
- Modify: `html/src/app/app-shell.ts`
- Modify: `html/src/app/app-shell.test.ts`
- Modify: `html/src/main.ts`
- Modify: `html/src/styles/app.css`

**Interfaces:**
- Adds fixed-map layer IDs:

```ts
type AuthenticMapControlId =
  | "structures"
  | "props"
  | "vegetation"
  | "shadows"
  | "effects";
```

`terrain` remains the terrain control, and the existing `roads` control maps to the
authentic manifest's `surfaces` layer only while an authentic fixed map is active.
The five new IDs map one-to-one to their manifest layers.

- [ ] **Step 1: Write controller transaction RED tests**

Assert:

- navigating to Grow Lab 1 loads the world and authentic manifest concurrently;
- the region commits only after the manifest verifies;
- a manifest failure leaves the previous region visible and reports the authentic
  error;
- stale Grow Lab navigation cannot overwrite a newer surface navigation;
- uploaded personal-surface state remains in memory while visiting Grow Lab 1;
- returning to surface restores the personal world;
- other fixed regions do not request an authentic manifest in this prototype.

- [ ] **Step 2: Write shell/control RED tests**

Assert that Grow Lab 1 shows labels:

```text
地形
道路 / 特殊表面
建筑
道具
植被
阴影
动态效果
```

All seven are checked by default. Surface and other fixed regions do not show the
six authentic-only controls. Toggling a control updates URL state through the
allowlisted IDs and calls `map.setLayerVisibility`.

- [ ] **Step 3: Run app/domain tests and verify RED**

Run:

```powershell
npm.cmd test -- src/domain/map-layers.test.ts `
  src/app/app-controller.test.ts src/app/app-shell.test.ts
```

Expected: FAIL because the authentic region mode and controls do not exist.

- [ ] **Step 4: Implement controller loading**

Construct `HttpAuthenticFixedMapRepository` in `main.ts` and pass it through
`AppControllerOptions`. In `changeRegion`, pair:

```ts
const [candidateWorld, authenticMap] = await Promise.all([
  repository.loadWorld(regionId),
  authenticRepository.load(regionId)
]);
```

Commit `candidateWorld` and `authenticMap` under the existing generation guard.

- [ ] **Step 5: Implement context-sensitive controls**

Add an `authenticMapActive` argument to `renderMapControls`. While true, keep
`terrain`, enable `roads`, and render the five new authentic-only controls.
Preserve keyboard focus across rerenders using the existing focused-control
restoration pattern.

In `MapView.setLayerVisibility`, translate UI control IDs before forwarding them
to the authentic group:

```ts
const authenticId =
  layerId === "roads" ? "surfaces"
  : layerId === "terrain"
    || layerId === "structures"
    || layerId === "props"
    || layerId === "vegetation"
    || layerId === "shadows"
    || layerId === "effects"
      ? layerId
      : undefined;
```

Marker category controls (`poi`, `quest`, `resource`, `danger`) remain routed to
the existing location layer and are not authentic visual layers.

- [ ] **Step 6: Run app/domain tests and verify GREEN**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add html/src/domain html/src/app html/src/main.ts html/src/styles/app.css
git commit -m "feat: expose authentic Grow Lab controls"
```

---

### Task 7: Browser Verification and Visual Acceptance

**Files:**
- Create: `html/tests/e2e/authentic-grow-lab.spec.ts`
- Create: `html/tests/e2e/fixtures/authentic-grow-lab-fixture.ts`
- Modify: `html/tests/e2e/base-map.spec.ts`
- Modify: `html/README.md`

**Interfaces:**
- Consumes only the public app and committed authentic assets.
- Produces the release evidence for the one-region prototype.

- [ ] **Step 1: Write the public-journey RED test**

In Chromium and Firefox:

1. open `/`;
2. navigate to Grow Lab 1;
3. assert `.fixed-region-backdrop` count is zero;
4. assert seven authentic layer panes and at least one verified WebP tile per
   non-empty layer;
5. assert the aggregate map bounds fit the 16×16 region;
6. toggle vegetation, props, shadows, and effects independently;
7. zoom, pan, reset, select the Grow Lab marker, search, and open details;
8. navigate to surface and back; verify layers restore;
9. assert no request contains `G:`, `AppData`, a Windows username, or a save path.

- [ ] **Step 2: Write failure-journey RED tests**

Route the manifest to malformed JSON, wrong self-hash, and a corrupt WebP tile.
Each must keep the previous visible map, display “真实底图加载失败”, and show no
reference SVG or classification canvas for Grow Lab 1.

- [ ] **Step 3: Run authentic E2E and verify RED**

Run:

```powershell
npx.cmd playwright test tests/e2e/authentic-grow-lab.spec.ts `
  --project=chromium --project=firefox
```

Expected: FAIL before the runtime integration is complete.

- [ ] **Step 4: Complete only fixes required by the browser journey**

Fix selector, lifecycle, loading, or responsive-layout defects revealed by the
journey. Do not add another region, default-save generation, or a fallback image.

- [ ] **Step 5: Run focused and full verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
npx.cmd playwright test tests/e2e/authentic-grow-lab.spec.ts `
  --project=chromium --project=firefox
npx.cmd playwright test tests/e2e/base-map.spec.ts `
  --project=chromium --project=firefox
git diff --check
```

Expected: all pass. Existing Vite `fs/path/crypto externalized` warnings may remain;
there must be no new errors or warnings from authentic-map code.

- [ ] **Step 6: Inspect the real local page**

Build, restart the preview at `http://127.0.0.1:4173/`, open Grow Lab 1, and verify:

- official structures and textures match the TileEditor capture;
- all source content is present;
- layers align with no seams or flips;
- all seven default on;
- no reference text, theme border, classification fill, or placeholder is visible;
- standard-resolution zoom remains legible.

Record the actual public asset byte total and compare it with the 20–80 MB estimate.

- [ ] **Step 7: Update documentation**

Document:

- the official source world/tile relative identities;
- how to rerun `data:authentic-map`;
- why capture inputs stay outside the repository;
- layer definitions and representative effect-frame rule;
- the hard no-fallback behavior;
- that only Grow Lab 1 is authentic in this prototype.

- [ ] **Step 8: Commit**

```powershell
git add html/tests/e2e html/README.md
git commit -m "test: verify authentic Grow Lab prototype"
```

---

## Final Prototype Gate

The prototype is complete only when all of these are true:

- Grow Lab 1 displays official Scrap Mechanic 1.0 content at 128 pixels per cell.
- Seven verified layers exist, align, default on, and toggle independently.
- The browser requests only committed relative static assets.
- The temporary fixed-region SVG and classification fallback are impossible for
  Grow Lab 1.
- Missing authentic data fails visibly instead of substituting content.
- Chromium, Firefox, all unit tests, and the production build pass.
- The user visually accepts the Grow Lab 1 result before work expands to any other
  region or to the authorized default `bilige.db` surface.
