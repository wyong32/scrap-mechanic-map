# Compact Upright POI Previews and Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the real official ground for every POI while rendering a compact upright scene icon and optional, generic Chinese place names.

**Architecture:** The generated official atlas will store a terrain sprite for every tile and an additional transparent icon sprite for structure previews. Save cells will be grouped into one `PoiMapInstance` per placed POI; Canvas renders its terrain with the saved rotation and its capped icon without rotation, while a separate Leaflet label layer renders names when the new default-off `labels` map layer is enabled.

**Tech Stack:** TypeScript, Vite, Vitest, Leaflet, Canvas 2D, Sharp, sql.js.

## Global Constraints

- All Warehouse variants display exactly `仓库`; never append floors, variants, coordinates, or sequence numbers.
- Duplicate places keep the same generic name.
- POI icons remain 24–64 screen pixels and are never rotated with the saved tile.
- The `labels` layer is available but off by default and is restorable through the URL `layers` parameter.
- Unknown POI types do not receive invented names.
- Default DB and uploaded saves use the same instance and naming logic.
- Preserve unrelated dirty files in the worktree.

---

## File Structure

- `html/tools/game-data/atlas/official-tile-atlas.ts`: generate separate terrain and transparent icon sprites.
- `html/src/legacy/legacy-visual-types.ts`: describe optional official icon assets on resolved visuals.
- `html/src/legacy/legacy-asset-repository.ts`: preload and validate icon atlas pages.
- `html/src/legacy/hybrid-terrain-resolver.ts`: attach the icon asset to one resolved multi-cell POI visual.
- `html/src/map/legacy-terrain-renderer.ts`: draw rotated terrain and an unrotated capped icon.
- `html/src/map/poi-instances.ts`: group save cells and map safe generic Chinese names.
- `html/src/map/poi-label-layer.ts`: render one non-interactive Leaflet text label per named instance.
- `html/src/domain/map-layers.ts`: define the available, default-off `labels` layer.
- `html/src/app/app-shell.ts`: show the “地点名称” checkbox.
- `html/src/map/map-view.ts`: synchronize POI icon and label visibility.
- Matching `*.test.ts` files: define all new behavior before production changes.

---

### Task 1: Default-off labels map layer

**Files:**
- Modify: `html/src/domain/map-layers.ts`
- Modify: `html/src/domain/ui-state.test.ts`
- Modify: `html/src/app/app-shell.ts`
- Modify: `html/src/app/app-shell.test.ts`

**Interfaces:**
- Produces: `MapLayerId` includes `"labels"`.
- Produces: `MapLayerDefinition.defaultVisible: boolean`.
- Produces: `resolveVisibleMapLayerIds([])` excludes `"labels"`.

- [ ] **Step 1: Write failing layer-state tests**

Add assertions equivalent to:

```ts
expect(resolveVisibleMapLayerIds([]).has("labels")).toBe(false);
expect(normalizeMapLayerIds(["terrain", "labels"])).toEqual([
  "terrain",
  "labels"
]);
expect(parseUiState("?layers=terrain%2Clabels").layerIds).toEqual([
  "terrain",
  "labels"
]);
```

In `app-shell.test.ts`, render controls with no explicit layers and assert the `labels` checkbox exists with text `地点名称` and is unchecked; then render `layerIds: ["terrain", "labels"]` and assert it becomes checked.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/domain/ui-state.test.ts src/app/app-shell.test.ts --maxWorkers=1
```

Expected: FAIL because `labels` is rejected and no label checkbox exists.

- [ ] **Step 3: Implement the layer definition**

Extend the definitions:

```ts
export interface MapLayerDefinition {
  id: MapLayerId;
  available: boolean;
  defaultVisible: boolean;
  categoryIds: readonly string[];
}

{ id: "labels", available: true, defaultVisible: false, categoryIds: [] }
```

Set existing currently available layers to `defaultVisible: true`, unavailable layers to `false`, and derive defaults with:

```ts
MAP_LAYER_DEFINITIONS
  .filter((layer) => layer.available && layer.defaultVisible)
  .map((layer) => layer.id);
```

Add `labels: "地点名称"` to `layerNames`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 1 Vitest command and expect all tests to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- html/src/domain/map-layers.ts html/src/domain/ui-state.test.ts html/src/app/app-shell.ts html/src/app/app-shell.test.ts
git commit -m "feat: add optional place-name layer"
```

---

### Task 2: Safe generic POI instances and names

**Files:**
- Create: `html/src/map/poi-instances.ts`
- Create: `html/src/map/poi-instances.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PoiMapInstance {
  id: string;
  uuid: string;
  poiType: string;
  name?: string;
  origin: { x: number; y: number };
  span: { width: number; height: number };
  center: { x: number; y: number };
}

export function createPoiMapInstances(
  cells: readonly TerrainCell[]
): PoiMapInstance[];

export function genericPoiName(
  poiType: string,
  tilePath?: string
): string | undefined;
```

- [ ] **Step 1: Write failing grouping and naming tests**

Use real-shaped `TerrainCell` fixtures. Cover:

```ts
expect(genericPoiName("POI_WAREHOUSE2_LARGE")).toBe("仓库");
expect(genericPoiName("POI_WAREHOUSE4_LARGE")).toBe("仓库");
expect(genericPoiName("POI_RUINCITY_XL")).toBe("废墟城区");
expect(genericPoiName("POI_UNKNOWN")).toBeUndefined();
```

Build a 4×4 Warehouse instance with the same UUID and compatible offsets and assert `createPoiMapInstances` returns one item centered on the 4×4 bounds. Add a second disconnected warehouse and assert two instances are returned with different deterministic IDs but both named `仓库`.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/poi-instances.test.ts --maxWorkers=1
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal grouping and mapping**

Group orthogonally connected cells by UUID and `poiType`, calculate min/max bounds and center, and sort instances by origin Y then X for deterministic output. Use explicit mappings or anchored patterns:

```ts
if (/^POI_WAREHOUSE/.test(poiType)) return "仓库";
if (poiType === "POI_RUINCITY_XL") return "废墟城区";
if (poiType === "POI_HIDEOUT_XL") return "藏身处";
if (poiType === "POI_PACKINGSTATIONFRUIT_MEDIUM") return "水果包装站";
if (poiType === "POI_PACKINGSTATIONVEG_MEDIUM") return "蔬菜包装站";
if (poiType === "POI_ROAD_SCHEMATICSTATION") return "蓝图工作站";
if (poiType === "POI_ROAD_KIOSK") return "售货亭";
if (poiType === "POI_BUNK_BURIAL_QUEST_MEDIUM") return "调查掩体";
if (poiType === "POI_ROAD_CHEMPOOL") return "化学池设施";
if (poiType === "POI_FARMINGPATCH") return "农田";
return undefined;
```

- [ ] **Step 4: Run the new test and verify GREEN**

Run the Task 2 Vitest command and expect it to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- html/src/map/poi-instances.ts html/src/map/poi-instances.test.ts
git commit -m "feat: derive generic POI instances from saves"
```

---

### Task 3: Split official POI terrain and icon sprites

**Files:**
- Modify: `html/tools/game-data/atlas/official-tile-atlas.ts`
- Modify: `html/tools/game-data/atlas/official-tile-atlas.test.ts`
- Modify: `html/src/legacy/legacy-visual-types.ts`
- Modify: `html/src/legacy/legacy-asset-repository.ts`
- Modify: `html/src/legacy/legacy-asset-repository.test.ts`
- Modify: `html/src/legacy/hybrid-terrain-resolver.ts`
- Modify: `html/src/legacy/hybrid-terrain-resolver.test.ts`
- Regenerate: `html/public/atlas/official/official-tile-atlas.json`
- Regenerate: `html/public/atlas/official/official-*.webp`
- Create generated icon pages: `html/public/atlas/official/official-icons-*.webp`

**Interfaces:**
- `OfficialTileAtlasEntry` gains:

```ts
icon?: {
  page: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
```

- `PreloadedOfficialTile` gains `iconImage?: HTMLImageElement`.
- `ResolvedTerrainVisual` gains `overlayAsset?: PreloadedLegacyAsset`.
- Replace `prepareOfficialThumbnail` with:

```ts
export function prepareOfficialIcon(input: Buffer, size?: number): Promise<Buffer>;
```

- [ ] **Step 1: Write failing atlas tests**

Create a 220×150 synthetic preview with a uniform editor background and a colored structure. Assert:

```ts
const icon = await prepareOfficialIcon(input, 64);
const { data } = await sharp(icon).ensureAlpha().raw().toBuffer({
  resolveWithObject: true
});
expect(data[3]).toBe(0);
expect(Math.max(...alphaValues(data))).toBe(255);
```

Extend the atlas build test so a structure entry has a normal terrain source plus an `icon` source on `official-icons-0.webp`, and both page hashes exist in the manifest.

- [ ] **Step 2: Run atlas tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tools/game-data/atlas/official-tile-atlas.test.ts --maxWorkers=1
```

Expected: FAIL because `prepareOfficialIcon` and the manifest `icon` record do not exist.

- [ ] **Step 3: Implement terrain/icon generation**

For all entries, generate the base with `rectifyOfficialPreview` (or canonical water preparation). For `isometric-thumbnail`, additionally generate a transparent icon by background-keying the raw preview and resizing with `fit: "contain"` and transparent padding. Pack icons at the same slot coordinates into `official-icons-N.webp`; do not blur or composite them into the base sprite.

- [ ] **Step 4: Write failing preload/resolver tests**

Assert that:

- icon page geometry and paths are validated;
- the repository preloads both page images;
- a complete official structure instance resolves to a visual with `asset` set to terrain and `overlayAsset` set to the icon;
- a terrain-only entry has no `overlayAsset`.

- [ ] **Step 5: Run preload/resolver tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/legacy/legacy-asset-repository.test.ts src/legacy/hybrid-terrain-resolver.test.ts --maxWorkers=1
```

Expected: FAIL because icon records are ignored.

- [ ] **Step 6: Implement manifest validation, preload, and resolution**

Validate icon page membership and bounds with the same safety rules as terrain sprites. Attach:

```ts
overlayAsset: official.iconImage && official.entry.icon
  ? {
      record: officialRecord,
      image: official.iconImage,
      sourceRect: official.entry.icon
    }
  : undefined
```

Do not change legacy-only visual behavior.

- [ ] **Step 7: Run Task 3 tests and verify GREEN**

Run both Task 3 Vitest commands and expect all tests to pass.

- [ ] **Step 8: Regenerate the official atlas and build**

Run:

```powershell
.\node_modules\.bin\tsx.cmd tools/game-data/cli.ts official-atlas --game-root "G:\steam\steamapps\common\Scrap Mechanic"
npm.cmd run build
```

Expected: 992 atlas entries, terrain and icon pages written, TypeScript and Vite build pass.

- [ ] **Step 9: Commit**

Stage only the Task 3 source, tests, manifest, terrain pages, and icon pages:

```powershell
git commit -m "feat: split official POI terrain and icons"
```

---

### Task 4: Rotated ground and compact upright icon rendering

**Files:**
- Modify: `html/src/map/legacy-terrain-renderer.ts`
- Modify: `html/src/map/legacy-terrain-renderer.test.ts`
- Modify: `html/src/map/atlas-layer.ts`
- Modify: `html/src/map/atlas-layer.test.ts`

**Interfaces:**
- Produces:

```ts
export function poiIconScreenSize(
  footprintWidth: number,
  footprintHeight: number
): number;
```

- `drawLegacyTerrainFrame` accepts `options?: { showPoiIcons?: boolean }`.
- `AtlasLayer` gains `setPoiIconsVisible(visible: boolean): Promise<void>`.

- [ ] **Step 1: Write failing renderer tests**

Assert the pure size rule:

```ts
expect(poiIconScreenSize(8, 8)).toBe(24);
expect(poiIconScreenSize(128, 128)).toBe(48);
expect(poiIconScreenSize(512, 512)).toBe(64);
```

For a rotation-2 structure with terrain and overlay assets, assert operation order:

1. terrain draw occurs inside `rotate(Math.PI)`;
2. context restores;
3. icon draw occurs centered with no second `rotate`;
4. icon destination width/height equal `poiIconScreenSize`;
5. `showPoiIcons: false` omits only the icon draw.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/legacy-terrain-renderer.test.ts --maxWorkers=1
```

Expected: FAIL because the renderer has no overlay pass or capped size function.

- [ ] **Step 3: Implement two-pass rendering**

Keep the existing rotated terrain draw unchanged. After `context.restore()`, draw `visual.overlayAsset` around the footprint center with zero rotation:

```ts
const iconSize = poiIconScreenSize(width, height);
context.drawImage(
  icon.image,
  source.x,
  source.y,
  source.width,
  source.height,
  left + (width - iconSize) / 2,
  top + (height - iconSize) / 2,
  iconSize,
  iconSize
);
```

Calculate `Math.round(Math.min(footprintWidth, footprintHeight) * 0.375)`,
clamp the result to 24–64px, and skip the overlay when disabled or missing.

- [ ] **Step 4: Write failing AtlasLayer visibility test**

Prepare a legacy frame, call `setPoiIconsVisible(false)`, and assert restaging redraws terrain without overlay draws. Re-enable it and assert overlays return.

- [ ] **Step 5: Run AtlasLayer test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/atlas-layer.test.ts --maxWorkers=1
```

Expected: FAIL because icon visibility is not tracked.

- [ ] **Step 6: Implement AtlasLayer icon visibility**

Store `poiIconsVisible = true`, pass it to every legacy frame staging call, and restage the active/prepared frame when visibility changes.

- [ ] **Step 7: Run Task 4 tests and verify GREEN**

Run both Task 4 Vitest commands and expect all tests to pass.

- [ ] **Step 8: Commit**

```powershell
git add -- html/src/map/legacy-terrain-renderer.ts html/src/map/legacy-terrain-renderer.test.ts html/src/map/atlas-layer.ts html/src/map/atlas-layer.test.ts
git commit -m "fix: render compact upright POI icons"
```

---

### Task 5: Optional Leaflet place-name labels

**Files:**
- Create: `html/src/map/poi-label-layer.ts`
- Create: `html/src/map/poi-label-layer.test.ts`
- Modify: `html/src/map/map-view.ts`
- Modify: `html/src/map/map-view.test.ts`
- Modify: `html/src/styles/app.css`

**Interfaces:**
- Consumes: `createPoiMapInstances(cells)`.
- Produces:

```ts
export interface PoiLabelLayer {
  setInstances(instances: readonly PoiMapInstance[]): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function createPoiLabelLayer(map: L.Map): PoiLabelLayer;
```

- [ ] **Step 1: Write failing label-layer tests**

Create named and unnamed instances and assert:

- one label is created per named instance;
- no label is created for an unnamed instance;
- duplicate warehouses both read `仓库` and contain no `#`;
- `setVisible(false)` removes the group and `setVisible(true)` restores it.

- [ ] **Step 2: Run label-layer tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/poi-label-layer.test.ts --maxWorkers=1
```

Expected: FAIL because the label layer does not exist.

- [ ] **Step 3: Implement the non-interactive labels**

Use `L.marker` with a `L.divIcon` whose HTML is escaped text only:

```html
<span class="poi-place-label">仓库</span>
```

Set `interactive: false`, `keyboard: false`, center the icon on the instance center, and keep the layer detached initially.

- [ ] **Step 4: Write failing MapView integration tests**

Assert:

- `setWorld` and prepared-save commit call `setInstances(createPoiMapInstances(world.cells))`;
- `setLayerVisibility("labels", true)` shows labels;
- `setLayerVisibility("poi", false)` calls `setPoiIconsVisible(false)` without hiding terrain;
- a new world clears old labels.

- [ ] **Step 5: Run MapView tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/map-view.test.ts --maxWorkers=1
```

Expected: FAIL because MapView has no POI label or icon visibility integration.

- [ ] **Step 6: Implement MapView integration and styling**

Create the label layer once, update it on world changes, route `labels` visibility to it, and route `poi` visibility to both existing POI category markers and atlas icon visibility. Style labels with a compact dark translucent background, light text, orange border, and `pointer-events: none`.

- [ ] **Step 7: Run Task 5 tests and verify GREEN**

Run both Task 5 Vitest commands and expect all tests to pass.

- [ ] **Step 8: Commit**

```powershell
git add -- html/src/map/poi-label-layer.ts html/src/map/poi-label-layer.test.ts html/src/map/map-view.ts html/src/map/map-view.test.ts html/src/styles/app.css
git commit -m "feat: show optional generic POI labels"
```

---

### Task 6: Browser and full-suite verification

**Files:**
- Verify only; modify files only if a failing test exposes a scoped defect.

- [ ] **Step 1: Build and run the complete test suite**

Run:

```powershell
npm.cmd run build
.\node_modules\.bin\vitest.cmd run --maxWorkers=1
git diff --check
```

Expected: Vite build passes; all existing and new tests pass; no whitespace errors.

- [ ] **Step 2: Verify the local map visually**

Open or refresh `http://127.0.0.1:4173/` with the bundled default save. Inspect the three user-reported regions and confirm:

- warehouse, RuinCity, Hideout, and packing-station ground remains continuous;
- scene icons are upright and at most 64px;
- unchecking `POI` removes scene icons but not terrain;
- “地点名称” starts unchecked;
- checking it shows generic names at the current zoom;
- repeated warehouses all read `仓库` with no suffix.

- [ ] **Step 3: Confirm only scoped files are committed**

Run:

```powershell
git status --short
git log -6 --oneline
```

Do not stage or modify the existing unrelated changes in `html/package.json`, `html/tools/authentic-map/`, or `.superpowers/brainstorm/`.
