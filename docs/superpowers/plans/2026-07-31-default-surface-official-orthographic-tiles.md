# Default Surface Official Orthographic Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every isometric-thumbnail terrain visual actually used by the bundled default surface save with a verified 256-pixels-per-cell, north-up orthographic render produced by the official Scrap Mechanic 1.0 TileEditor.

**Architecture:** A Node build tool parses the bundled default DB with the same SQL, Lua, catalog, and terrain-normalization rules as the browser, derives a deterministic UUID capture inventory, validates one official full-size master per UUID, slices each master into canonical 256×256 cells, and reuses the existing lossless terrain-atlas packer to produce rotation-specific atlas entries. The browser preloads the verified orthographic atlas alongside the existing legacy/official assets; the hybrid resolver gives an exact orthographic cell priority and preserves the existing real legacy image or fallback for every cell outside the first-batch inventory.

**Tech Stack:** TypeScript 5.8, Node.js 22, sql.js 1.13, Sharp 0.35, Scrap Mechanic TileEditor 1.0.1.869, Leaflet 1.9, Vite 7, Vitest 3, Playwright 1.55, Windows app control for official-editor capture.

## Global Constraints

- First-batch scope is only the bundled default DB surface world.
- Rebuild only UUIDs whose current official atlas `renderMode` is `isometric-thumbnail` and which do not already resolve to an accepted real orthographic legacy tile.
- Read the game only from `G:\共享文件\Scrap Mechanic`; never modify any file below that root.
- Use `G:\共享文件\Scrap Mechanic\Release\TileEditor.exe`, file version `1.0.1.869`.
- Every master is an official full-scene render: terrain, roads, water, buildings, vegetation, props, shadows, and visible effects remain in the base image.
- Camera projection is orthographic, viewing direction is vertically downward, output is north-up, and density is exactly 256 pixels per game cell.
- Master size is exactly `widthCells * 256` by `heightCells * 256`; a small preview may never be enlarged to satisfy this contract.
- Capture each unique UUID once in canonical rotation zero; derive save rotations during atlas packing.
- Location names, POI icons, and resource markers remain independent overlays and are off by default.
- Existing search, filters, location list, region switching, upload, pan, zoom, reset, and URL state remain functional.
- A missing, black, transparent, malformed, wrongly oriented, wrong-size, or known-preview capture blocks the orthographic atlas build.
- Never substitute another UUID, a similar island, classification color, hand-drawn reference, or the old isometric thumbnail for a failed first-batch target.
- Public manifests contain only relative paths and hashes; absolute install paths, usernames, and private save paths never enter public output.
- Preserve unrelated working-tree changes. Stage and commit only the files listed by the current task.
- Implement behavior test-first and observe each focused test fail before changing production code.

---

## File Structure

### Shared save parsing

- `html/src/save/sqlite-records.ts`: SQL-engine-independent extraction of `Game` and surface `ScriptData` records.
- `html/src/save/sqlite-records.test.ts`: shared-query behavior and safety-budget tests.
- `html/src/save/sqlite-reader.ts`: browser sql.js initialization only; delegates record extraction.
- `html/src/save/sqlite-reader.test.ts`: browser wrapper regressions.

### Default-surface capture inventory

- `html/tools/authentic-map/default-surface-types.ts`: inventory, target, receipt, and verified-master types.
- `html/tools/authentic-map/default-surface-job.ts`: parses the bundled DB and derives the canonical first-batch target list.
- `html/tools/authentic-map/default-surface-job.test.ts`: default-save parsing, filtering, ordering, dimensions, and privacy tests.
- `html/tools/authentic-map/verify-surface-capture.ts`: validates one full-scene TileEditor master and receipt per target.
- `html/tools/authentic-map/verify-surface-capture.test.ts`: image, receipt, source, orientation, dimensions, transparency, and preview-reuse tests.
- `html/tools/authentic-map/slice-surface-captures.ts`: losslessly cuts masters into canonical per-cell PNGs and verifies reconstruction.
- `html/tools/authentic-map/slice-surface-captures.test.ts`: offset, orientation, edge, determinism, and reconstruction tests.
- `html/tools/authentic-map/cli.ts`: `surface-inventory`, `surface-verify`, and `surface-pack` commands in addition to existing prototype commands.
- `html/package.json`: retains the single `data:authentic-map` entry point.

### Generated atlas

- `html/public/atlas/orthographic/terrain-cell-atlas.json`: self-hashed first-batch manifest.
- `html/public/atlas/orthographic/terrain-<n>.webp`: lossless 256-pixel-cell atlas pages.
- `html/public/atlas/orthographic/terrain-<n>-low.webp`: lossless overview pages.
- `html/public/data/generated/default-surface-orthographic-inventory.json`: reviewed input coverage and capture provenance without private paths.

### Runtime

- `html/src/legacy/legacy-visual-types.ts`: orthographic atlas entry and preloaded-cell types.
- `html/src/legacy/legacy-asset-repository.ts`: verifies the orthographic manifest/pages and adds exact cells to the immutable bundle.
- `html/src/legacy/legacy-asset-repository.test.ts`: integrity, page loading, retry, and privacy tests.
- `html/src/legacy/hybrid-terrain-resolver.ts`: exact orthographic cell wins before legacy or preview resolution.
- `html/src/legacy/hybrid-terrain-resolver.test.ts`: precedence and four-rotation reconstruction tests.
- `html/src/map/legacy-terrain-renderer.ts`: recognizes pre-rotated orthographic assets without rotating them twice.
- `html/src/map/legacy-terrain-renderer.test.ts`: source-rectangle and no-double-rotation tests.
- `html/src/domain/map-layers.ts`: makes names, POI, and resources off by default.
- `html/src/domain/map-layers.test.ts`: default layer set and explicit URL restoration.
- `html/src/main.ts`: supplies the orthographic manifest URL to the asset repository.

### Browser verification

- `html/tests/e2e/default-orthographic-map.spec.ts`: bundled-save automatic load, overlay defaults, three zoom levels, and regression journey.
- `html/tests/e2e/default-orthographic-map.spec.ts-snapshots/`: reviewed overview, normal, and maximum-zoom Chromium/Firefox images.
- `html/README.md`: capture, verification, rebuild, data-size, and no-fallback instructions.

---

### Task 1: Share the Save Record Reader with Node Build Tools

**Files:**
- Create: `html/src/save/sqlite-records.ts`
- Create: `html/src/save/sqlite-records.test.ts`
- Modify: `html/src/save/sqlite-reader.ts`
- Modify: `html/src/save/sqlite-reader.test.ts`

**Interfaces:**
- Consumes: an initialized sql.js-compatible constructor and default-save bytes.
- Produces:

```ts
export interface SqlDatabaseConstructor {
  new (data?: Uint8Array): {
    close(): void;
    exec(sql: string, params?: unknown[]): Array<{
      columns: string[];
      values: unknown[][];
    }>;
    prepare(sql: string): {
      bind(values?: unknown[]): boolean;
      free(): boolean;
      get(): unknown[];
      step(): boolean;
    };
  };
}

export function readSaveRecordsWithSql(
  Database: SqlDatabaseConstructor,
  bytes: Uint8Array
): SaveRecords;
```

- [ ] **Step 1: Write failing shared-reader tests**

Move the existing fake SQL database cases into `sqlite-records.test.ts` and add:

```ts
it("returns the one v28 seed and longest-first world-1 blobs", () => {
  const records = readSaveRecordsWithSql(FakeDatabase, sqliteBytes);
  expect(records).toEqual({
    saveVersion: 28,
    seed: 306160198,
    surfaceCandidates: [largeBlob, smallBlob]
  });
});
```

Keep explicit failure cases for a missing `Game` table, missing `ScriptData`,
multiple `Game` rows, a non-v28 save, more than eight candidates, and more than
12 MiB of retained candidate data.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
cd "F:\Scrap Mechanical\sm_overview-main\.worktrees\phase-3-save-map\html"
npm.cmd test -- src/save/sqlite-records.test.ts src/save/sqlite-reader.test.ts
```

Expected: FAIL because `readSaveRecordsWithSql` is not exported.

- [ ] **Step 3: Extract the pure record reader**

Move `requireTables`, `readSingleGameRow`, and `readSurfaceCandidates` into
`sqlite-records.ts`. Implement the public function with an always-close guard:

```ts
export function readSaveRecordsWithSql(
  Database: SqlDatabaseConstructor,
  bytes: Uint8Array
): SaveRecords {
  const database = new Database(bytes);
  try {
    requireTables(database);
    const { saveVersion, seed } = readSingleGameRow(database);
    return {
      saveVersion,
      seed,
      surfaceCandidates: readSurfaceCandidates(database)
    };
  } finally {
    database.close();
  }
}
```

Keep browser-specific `initSqlJs`, the Vite WASM URL, and error serialization in
`sqlite-reader.ts`; its `readSaveRecords` calls the shared function after SQL
initialization.

- [ ] **Step 4: Run save tests and verify GREEN**

Run:

```powershell
npm.cmd test -- src/save/sqlite-records.test.ts src/save/sqlite-reader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add html/src/save/sqlite-records.ts html/src/save/sqlite-records.test.ts `
  html/src/save/sqlite-reader.ts html/src/save/sqlite-reader.test.ts
git commit -m "refactor: share save record extraction"
```

---

### Task 2: Derive the Exact Default-Surface Capture Inventory

**Files:**
- Create: `html/tools/authentic-map/default-surface-types.ts`
- Create: `html/tools/authentic-map/default-surface-job.ts`
- Create: `html/tools/authentic-map/default-surface-job.test.ts`
- Modify: `html/tools/authentic-map/cli.ts`
- Modify: `html/package.json`

**Interfaces:**
- Consumes: `public/data/default-save.db`, verified build/catalog documents,
  and `public/atlas/official/official-tile-atlas.json`.
- Produces:

```ts
export interface DefaultSurfaceCaptureTarget {
  uuid: string;
  sourceTileRelativePath: string;
  widthCells: number;
  heightCells: number;
  outputPixels: { width: number; height: number };
  usedRotations: readonly (0 | 1 | 2 | 3)[];
  occurrences: number;
  sourcePreviewSha256: string;
}

export interface DefaultSurfaceCaptureInventory {
  schemaVersion: 1;
  gameVersion: "1.0.0";
  saveSha256: string;
  saveSeed: number;
  pixelsPerCell: 256;
  targets: readonly DefaultSurfaceCaptureTarget[];
  contentHash: string;
}

export async function buildDefaultSurfaceCaptureInventory(options: {
  savePath: string;
  buildInfoPath: string;
  catalogPath: string;
  officialManifestPath: string;
  gameRoot: string;
}): Promise<{
  inventory: DefaultSurfaceCaptureInventory;
  world: WorldMap;
}>;

export function selectCapabilityTarget(
  inventory: DefaultSurfaceCaptureInventory
): DefaultSurfaceCaptureTarget;
```

- [ ] **Step 1: Write failing inventory tests**

Use the checked-in DB for the integration case and small generated fixtures for
filter failures. Assert:

```ts
const { inventory, world } = await buildDefaultSurfaceCaptureInventory(paths);

expect(world.source).toBe("save");
expect(world.seed).toBe(inventory.saveSeed);
expect(inventory.pixelsPerCell).toBe(256);
expect(inventory.targets.length).toBeGreaterThan(0);
expect(inventory.targets).toEqual(
  [...inventory.targets].sort((a, b) => a.uuid.localeCompare(b.uuid))
);
expect(inventory.targets.every((target) =>
  target.outputPixels.width === target.widthCells * 256
  && target.outputPixels.height === target.heightCells * 256
)).toBe(true);
```

For every target, assert the official manifest says `isometric-thumbnail`, the
UUID appears in the default world, and the source path is relative below
`Survival/`. Assert UUIDs already backed by a reviewed real legacy tile are
excluded. Assert the serialized inventory contains neither `G:\` nor `F:\`.

`selectCapabilityTarget` must choose greatest `widthCells * heightCells`, then
lexicographically smallest UUID on a tie.

- [ ] **Step 2: Run the inventory test and verify RED**

Run:

```powershell
npm.cmd test -- tools/authentic-map/default-surface-job.test.ts
```

Expected: FAIL because the inventory builder does not exist.

- [ ] **Step 3: Implement Node-side default-save parsing**

Initialize sql.js with:

```ts
const SQL = await initSqlJs({
  locateFile: () => resolve("node_modules/sql.js/dist/sql-wasm.wasm")
});
const records = readSaveRecordsWithSql(SQL.Database, await readFile(savePath));
const decoded = decodeSurfaceCandidates(records.surfaceCandidates);
const catalog = await parseTileCatalogDocuments(
  await readFile(buildInfoPath, "utf8"),
  await readFile(catalogPath, "utf8")
);
const world = normalizeTerrain(decoded, {
  fileName: "default-save.db",
  saveVersion: 28,
  seed: records.seed
}, catalog);
```

Join normalized UUIDs with the generated catalog for dimensions/source paths,
the official manifest for `renderMode`, and the reviewed legacy bridge/assets
for exclusion. Group occurrences and rotations by UUID. Compute hashes from
canonical JSON without `contentHash`.

- [ ] **Step 4: Add the inventory CLI command**

Support:

```powershell
npm.cmd run data:authentic-map -- surface-inventory `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --save "public/data/default-save.db" `
  --output "public/data/generated/default-surface-orthographic-inventory.json"
```

Print target count, total canonical cells, largest target dimensions, and public
output path. Do not print the absolute game root.

- [ ] **Step 5: Run tests and generate the reviewed inventory**

Run:

```powershell
npm.cmd test -- tools/authentic-map/default-surface-job.test.ts
npm.cmd run data:authentic-map -- surface-inventory `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --save "public/data/default-save.db" `
  --output "public/data/generated/default-surface-orthographic-inventory.json"
```

Expected: test PASS and a non-empty, canonically sorted inventory.

- [ ] **Step 6: Commit**

```powershell
git add html/tools/authentic-map/default-surface-types.ts `
  html/tools/authentic-map/default-surface-job.ts `
  html/tools/authentic-map/default-surface-job.test.ts `
  html/tools/authentic-map/cli.ts html/package.json `
  html/public/data/generated/default-surface-orthographic-inventory.json
git commit -m "feat: derive default surface capture inventory"
```

---

### Task 3: Verify Official Full-Scene Surface Masters

**Files:**
- Create: `html/tools/authentic-map/verify-surface-capture.ts`
- Create: `html/tools/authentic-map/verify-surface-capture.test.ts`
- Modify: `html/tools/authentic-map/default-surface-types.ts`
- Modify: `html/tools/authentic-map/cli.ts`
- External, not committed: `F:\Scrap Mechanical\authentic-captures\default-surface\`

**Interfaces:**
- Consumes: inventory plus `<uuid>/scene.png` and
  `<uuid>/capture-receipt.json`.
- Produces:

```ts
export interface SurfaceCaptureReceipt {
  editor: "TileEditor";
  editorVersion: "1.0.1.869";
  sourceTileUuid: string;
  sourceTileRelativePath: string;
  camera: {
    projection: "orthographic";
    direction: "north-up";
    pixelsPerCell: 256;
    width: number;
    height: number;
  };
  image: {
    file: "scene.png";
    fullScene: true;
  };
}

export interface VerifiedSurfaceMaster {
  target: DefaultSurfaceCaptureTarget;
  receipt: SurfaceCaptureReceipt;
  absolutePath: string;
  sha256: string;
  width: number;
  height: number;
}

export async function verifySurfaceCapture(
  target: DefaultSurfaceCaptureTarget,
  targetDirectory: string,
  officialPreviewPath: string
): Promise<VerifiedSurfaceMaster>;
```

- [ ] **Step 1: Write failing verifier tests**

Generate Sharp fixtures for 1×1, 4×4, and 8×8 targets. Assert a valid master
returns its exact hash and dimensions. Reject independently:

- missing receipt or image;
- invalid JSON or non-PNG bytes;
- editor/version/source UUID/source relative path mismatch;
- perspective or non-north-up camera;
- density other than 256;
- one-pixel dimension mismatch;
- `fullScene: false`;
- fully transparent output;
- RGB maximum at or below 16 with at least 99% opaque pixels;
- an exact preview file or a resized/rectified derivative of the official
  220×150 preview;
- absolute paths and extra receipt fields.

- [ ] **Step 2: Run the verifier tests and verify RED**

Run:

```powershell
npm.cmd test -- tools/authentic-map/verify-surface-capture.test.ts
```

Expected: FAIL because `verifySurfaceCapture` does not exist.

- [ ] **Step 3: Implement strict receipt and image validation**

Parse with an exact-key check. Read image metadata and stats with Sharp:

```ts
const expectedWidth = target.widthCells * 256;
const expectedHeight = target.heightCells * 256;
if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
  throw new Error(`Capture '${target.uuid}' has the wrong pixel dimensions.`);
}
const alpha = metadata.hasAlpha ? stats.channels.at(-1) : undefined;
if (alpha?.max === 0) {
  throw new Error(`Capture '${target.uuid}' is fully transparent.`);
}
```

Hash the original PNG bytes and reject the known official preview hash. Load the
official 220×150 preview from the game root, verify its hash equals
`sourcePreviewSha256`, create the same rectified 256×256 image used by the old
preview atlas, stretch it to the target dimensions, and compare both images as
32×32 RGB samples. Reject an RMSE at or below 3 because that proves the proposed
master is only a derivative of the old preview.

- [ ] **Step 4: Add the batch verification command**

Support:

```powershell
npm.cmd run data:authentic-map -- surface-verify `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --inventory "public/data/generated/default-surface-orthographic-inventory.json" `
  --capture-directory "F:\Scrap Mechanical\authentic-captures\default-surface"
```

The command validates every target and exits non-zero with sorted
`<uuid>: <reason>` lines if any target fails. It also rejects identical verified
master hashes assigned to different UUIDs.

- [ ] **Step 5: Run verifier tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tools/authentic-map/verify-surface-capture.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add html/tools/authentic-map/default-surface-types.ts `
  html/tools/authentic-map/verify-surface-capture.ts `
  html/tools/authentic-map/verify-surface-capture.test.ts `
  html/tools/authentic-map/cli.ts
git commit -m "feat: verify official surface captures"
```

---

### Task 4: Pass the TileEditor Capability Gate and Capture the Batch

**Files:**
- External, not committed: `F:\Scrap Mechanical\authentic-captures\default-surface\`
- Modify after successful capture: each external target receipt only

**Interfaces:**
- Consumes: the deterministic capability target from Task 2.
- Produces: one verified `scene.png` and receipt for every inventory UUID.

- [ ] **Step 1: Print the exact capability target**

Run:

```powershell
npm.cmd run data:authentic-map -- surface-inventory `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --save "public/data/default-save.db" `
  --output "public/data/generated/default-surface-orthographic-inventory.json"
```

Read the reported capability UUID and its relative `.tile` path from the public
inventory. Do not choose a visually convenient substitute.

- [ ] **Step 2: Prove official-editor capture capability**

Using Windows app control, start:

```text
G:\共享文件\Scrap Mechanic\Release\TileEditor.exe
```

Open the capability target's exact `.tile` file and prove all conditions:

1. the complete tile opens with official textures, models, vegetation, water,
   roads, props, shadows, and visible effects;
2. the camera can be set to orthographic vertical top-down;
3. north can be aligned to the top edge;
4. grid, selection outline, gizmos, cursor, and editor chrome can be excluded;
5. the render can be produced at the target's exact output dimensions without
   enlarging a smaller preview;
6. reopening and capturing again with identical settings produces the same
   dimensions and orientation;
7. closing the editor leaves the game installation unmodified.

If any condition fails, stop at this capability gate and report the failed
condition. Do not continue with screenshots of the existing 220×150 preview.

- [ ] **Step 3: Capture and verify the capability target**

Create:

```text
F:\Scrap Mechanical\authentic-captures\default-surface\<uuid>\scene.png
F:\Scrap Mechanical\authentic-captures\default-surface\<uuid>\capture-receipt.json
```

Use the exact receipt schema from Task 3, then run `surface-verify`. It may report
the remaining UUIDs as missing, but the capability UUID itself must not appear in
the error list.

- [ ] **Step 4: Visually compare the capability target**

Open the PNG at original resolution and verify:

- roads and coastlines are not diagonal-smear rectifications;
- buildings are vertically oriented and not isometric thumbnails;
- no black editor background covers real terrain;
- the full bounds are present;
- one game cell measures exactly 256 pixels.

- [ ] **Step 5: Capture all remaining inventory targets**

For each target in canonical inventory order:

1. open the exact relative `.tile`;
2. reuse the proven camera, north, lighting, background, and UI settings;
3. set output dimensions to `widthCells * 256` by `heightCells * 256`;
4. capture full-scene `scene.png`;
5. write the exact receipt;
6. immediately run the single-target verifier before moving to the next UUID.

Never reuse a previous target's image or receipt.

- [ ] **Step 6: Verify the complete external batch**

Run:

```powershell
npm.cmd run data:authentic-map -- surface-verify `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --inventory "public/data/generated/default-surface-orthographic-inventory.json" `
  --capture-directory "F:\Scrap Mechanical\authentic-captures\default-surface"
```

Expected: PASS for every target, with zero missing or invalid masters.

---

### Task 5: Slice Masters and Build the Orthographic Atlas

**Files:**
- Create: `html/tools/authentic-map/slice-surface-captures.ts`
- Create: `html/tools/authentic-map/slice-surface-captures.test.ts`
- Modify: `html/tools/authentic-map/cli.ts`
- Reuse: `html/tools/game-data/atlas/atlas-manifest.ts`
- Reuse: `html/tools/game-data/atlas/pack-atlas.ts`
- Generate: `html/public/atlas/orthographic/**`

**Interfaces:**
- Consumes: verified masters, inventory, and the parsed default `WorldMap`.
- Produces:

```ts
export interface SlicedSurfaceCapture {
  target: DefaultSurfaceCaptureTarget;
  inputDirectory: string;
  files: ReadonlyMap<
    `${string}__${number}__${number}.png`,
    { absolutePath: string; sha256: string }
  >;
}

export async function sliceSurfaceCapture(
  master: VerifiedSurfaceMaster,
  outputDirectory: string
): Promise<SlicedSurfaceCapture>;

export async function buildDefaultSurfaceOrthographicAtlas(options: {
  inventoryPath: string;
  captureDirectory: string;
  workingDirectory: string;
  outputDirectory: string;
}): Promise<AtlasManifest>;
```

- [ ] **Step 1: Write failing slicing tests**

Create a 3×2 master whose six cells have distinct colors and asymmetric corner
marks. Assert exact files:

```text
<uuid>__0__0.png
<uuid>__1__0.png
<uuid>__2__0.png
<uuid>__0__1.png
<uuid>__1__1.png
<uuid>__2__1.png
```

Each file must be 256×256. Reassemble them in row-major order and require the
resulting PNG pixels to equal the decoded master pixels exactly.

Using default-world fixture cells, build four rotations with the existing
packer and assert a colored 3×2 master reconstructs north-up, 90°, 180°, and
270° layouts without mirror or offset swaps.

- [ ] **Step 2: Run slicing tests and verify RED**

Run:

```powershell
npm.cmd test -- tools/authentic-map/slice-surface-captures.test.ts `
  tools/game-data/atlas/pack-atlas.test.ts
```

Expected: FAIL because the surface slicer does not exist.

- [ ] **Step 3: Implement lossless canonical slicing**

For every `yOffset` and `xOffset`, extract without resizing:

```ts
const bytes = await sharp(master.absolutePath)
  .extract({
    left: xOffset * 256,
    top: yOffset * 256,
    width: 256,
    height: 256
  })
  .png()
  .toBuffer();
```

Write canonical filenames and hashes. Recompose all slices with Sharp and compare
raw RGBA buffers before accepting the target.

- [ ] **Step 4: Implement the surface pack command**

Verify all masters and slice them into a temporary directory. Construct
`targetWorld` by retaining only cells whose UUID is present in the inventory,
then call `deriveAtlasIntake([targetWorld], sliceDirectory, 256)`, reject any
missing target capture name, and call:

```ts
await buildAtlas(
  intake.cells,
  outputDirectory,
  "1.0.0"
);
```

After packing, run `verifyAtlasCoverage([targetWorld], manifest)` and require
that every target occurrence is covered. Cells outside the inventory are absent
by design because the existing resolver supplies them.

- [ ] **Step 5: Run tests and build real assets**

Run:

```powershell
npm.cmd test -- tools/authentic-map/slice-surface-captures.test.ts `
  tools/game-data/atlas/pack-atlas.test.ts `
  tools/game-data/atlas/verify-atlas.test.ts
npm.cmd run data:authentic-map -- surface-pack `
  --game-root "G:\共享文件\Scrap Mechanic" `
  --inventory "public/data/generated/default-surface-orthographic-inventory.json" `
  --capture-directory "F:\Scrap Mechanical\authentic-captures\default-surface" `
  --working-directory "F:\Scrap Mechanical\orthographic-atlas-work" `
  --output-directory "public/atlas/orthographic"
```

Expected: manifest plus native/low lossless WebP pages, zero missing
inventory-target keys, and no absolute path in public JSON.

- [ ] **Step 6: Commit**

```powershell
git add html/tools/authentic-map/slice-surface-captures.ts `
  html/tools/authentic-map/slice-surface-captures.test.ts `
  html/tools/authentic-map/cli.ts html/public/atlas/orthographic
git commit -m "feat: build default surface orthographic atlas"
```

---

### Task 6: Load Verified Orthographic Cells into the Existing Asset Bundle

**Files:**
- Modify: `html/src/legacy/legacy-visual-types.ts`
- Modify: `html/src/legacy/legacy-asset-repository.ts`
- Modify: `html/src/legacy/legacy-asset-repository.test.ts`
- Modify: `html/src/main.ts`

**Interfaces:**
- Consumes: `/atlas/orthographic/terrain-cell-atlas.json` and its page files.
- Produces:

```ts
export interface PreloadedOrthographicCell {
  key: string;
  image: HTMLImageElement;
  sourceRect: { x: number; y: number; width: number; height: number };
  preRotated: true;
}

export interface PreloadedTerrainAsset {
  image: HTMLImageElement;
  sourceRect?: { x: number; y: number; width: number; height: number };
}

export interface PreloadedLegacyAsset extends PreloadedTerrainAsset {
  record: LegacyAssetRecord;
}

export interface ResolvedTerrainVisual {
  origin: { x: number; y: number };
  span: { width: number; height: number };
  rotation: 0 | 1 | 2 | 3;
  source:
    | "legacy-tile"
    | "legacy-poi"
    | "one-dot-zero-orthographic"
    | "one-dot-zero-tile"
    | "one-dot-zero-thumbnail"
    | "one-dot-zero-fallback";
  asset?: PreloadedTerrainAsset;
  overlayAsset?: PreloadedLegacyAsset;
  terrainType: string;
  coveredCells: readonly string[];
}

export interface LegacyAssetBundle {
  assets: ReadonlyMap<string, PreloadedLegacyAsset>;
  bridgeByUuid: ReadonlyMap<string, LegacyBridgeEntry>;
  poiRules: readonly LegacyPoiRule[];
  officialByUuid?: ReadonlyMap<string, PreloadedOfficialTile>;
  orthographicByKey?: ReadonlyMap<string, PreloadedOrthographicCell>;
}
```

Extend the constructor:

```ts
constructor(
  manifestUrl: string,
  catalogUrl: string,
  buildInfoUrl: string,
  officialManifestUrl?: string,
  orthographicManifestUrl?: string
)
```

- [ ] **Step 1: Write failing manifest/page tests**

Assert:

- schema, game version, canonical atlas keys, page bounds, source hashes, and
  manifest self-hash are validated;
- native pages are fetched and SHA-256 checked;
- low pages do not enter `orthographicByKey`;
- each native entry becomes an immutable source rectangle;
- malformed keys, traversal, absolute URLs, missing pages, bad hashes, page
  bounds overflow, and wrong dimensions reject the preload;
- a failed preload clears images and remains retryable;
- omitting `orthographicManifestUrl` from the constructor preserves the old
  bundle for isolated tests, while a configured URL returning 404 rejects the
  preload and cannot silently expose old thumbnails.

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```powershell
npm.cmd test -- src/legacy/legacy-asset-repository.test.ts
```

Expected: FAIL because the bundle has no orthographic cells.

- [ ] **Step 3: Implement strict manifest and page loading**

Generalize the existing official-page hashing helper so both official and
orthographic pages use verified bytes before `Image.decode()`. Build entries:

```ts
orthographicEntries.push([
  key,
  Object.freeze({
    key,
    image: pages.get(entry.page)!,
    sourceRect: Object.freeze({
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height
    }),
    preRotated: true as const
  })
]);
```

Do not expose low-page entries to the legacy canvas path; the native 256-pixel
cell is required at maximum zoom.

- [ ] **Step 4: Wire the public manifest**

In `main.ts` construct:

```ts
new LegacyAssetRepository(
  "/data/generated/legacy-assets.json",
  "/data/generated/tile-catalog.json",
  "/data/generated/build-info.json",
  "/atlas/official/official-tile-atlas.json",
  "/atlas/orthographic/terrain-cell-atlas.json"
);
```

- [ ] **Step 5: Run repository tests and verify GREEN**

Run:

```powershell
npm.cmd test -- src/legacy/legacy-asset-repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add html/src/legacy/legacy-visual-types.ts `
  html/src/legacy/legacy-asset-repository.ts `
  html/src/legacy/legacy-asset-repository.test.ts html/src/main.ts
git commit -m "feat: preload orthographic terrain atlas"
```

---

### Task 7: Give Orthographic Cells Priority without Double Rotation

**Files:**
- Modify: `html/src/legacy/legacy-visual-types.ts`
- Modify: `html/src/legacy/hybrid-terrain-resolver.ts`
- Modify: `html/src/legacy/hybrid-terrain-resolver.test.ts`
- Modify: `html/src/map/legacy-terrain-renderer.ts`
- Modify: `html/src/map/legacy-terrain-renderer.test.ts`
- Modify: `html/src/map/map-view.ts`
- Modify: `html/src/map/map-view.test.ts`
- Modify: `html/src/domain/map-layers.ts`
- Modify: `html/src/domain/map-layers.test.ts`

**Interfaces:**
- Consumes the source added to `ResolvedTerrainVisual` in Task 6:

```ts
type ResolvedTerrainVisualSource =
  | "legacy-tile"
  | "legacy-poi"
  | "one-dot-zero-orthographic"
  | "one-dot-zero-tile"
  | "one-dot-zero-thumbnail"
  | "one-dot-zero-fallback";
```

- [ ] **Step 1: Write failing resolver precedence tests**

For the same cell provide orthographic, legacy, and official-preview assets.
Require:

```ts
expect(resolveTerrainVisuals([cell], bundle)[0]).toMatchObject({
  source: "one-dot-zero-orthographic",
  span: { width: 1, height: 1 },
  rotation: 0
});
```

Test all four save rotations and require lookup by the exact
`uuid:xOffset:yOffset:rotation` key. Test a neighboring non-inventory cell still
uses its existing legacy asset. Test a missing orthographic key does not borrow
another offset or UUID.

- [ ] **Step 2: Write failing renderer tests**

Draw an asymmetric pre-rotated atlas source rectangle for a save rotation of 1.
Assert `context.rotate` is called with `0`, not another 90 degrees, and
`drawImage` uses the exact atlas rectangle. Existing legacy and official-preview
visuals must keep their current rotation behavior.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npm.cmd test -- src/legacy/hybrid-terrain-resolver.test.ts `
  src/map/legacy-terrain-renderer.test.ts src/map/map-view.test.ts `
  src/domain/map-layers.test.ts
```

Expected: FAIL because the new source and defaults are absent.

- [ ] **Step 4: Implement resolver priority**

At the beginning of each row-major cell iteration:

```ts
const orthographic = bundle.orthographicByKey?.get(
  atlasKey(
    cell.uuid,
    cell.xOffset,
    cell.yOffset,
    cell.rotation
  )
);
if (orthographic) {
  covered.add(key);
  visuals.push({
    origin: { x: cell.x, y: cell.y },
    span: { width: 1, height: 1 },
    rotation: 0,
    source: "one-dot-zero-orthographic",
    asset: orthographic,
    terrainType: cell.terrainType,
    coveredCells: [key]
  });
  continue;
}
```

Do not change the existing resolution order after this branch.

- [ ] **Step 5: Update renderer coverage and overlay defaults**

Count orthographic cells as 1.0 image coverage. Keep POI icons controlled by the
existing POI layer and labels by the labels layer.

Set only these defaults to false:

```ts
{ id: "labels", available: true, defaultVisible: false, categoryIds: [] }
{ id: "poi", available: true, defaultVisible: false, categoryIds: ["poi", "guide"] }
{ id: "resource", available: true, defaultVisible: false, categoryIds: ["resource"] }
```

Keep terrain visible. Preserve explicit URL layer selections, including a URL
that intentionally enables labels, POI, or resources.

In `map-view.ts`, initialize `poiIconsVisible` to `false` and immediately call
`poiLabelLayer.setVisible(false)` after construction so the first prepared frame
cannot flash either overlay before the controller applies URL state. Add a
`map-view.test.ts` case that prepares a world before any layer callback and
asserts both overlays remain hidden.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add html/src/legacy/legacy-visual-types.ts `
  html/src/legacy/hybrid-terrain-resolver.ts `
  html/src/legacy/hybrid-terrain-resolver.test.ts `
  html/src/map/legacy-terrain-renderer.ts `
  html/src/map/legacy-terrain-renderer.test.ts `
  html/src/map/map-view.ts html/src/map/map-view.test.ts `
  html/src/domain/map-layers.ts html/src/domain/map-layers.test.ts
git commit -m "feat: prefer official orthographic terrain cells"
```

---

### Task 8: Verify Automatic Default Loading and Visual Quality

**Files:**
- Create: `html/tests/e2e/default-orthographic-map.spec.ts`
- Modify: `html/tests/e2e/legacy-map.spec.ts`
- Modify: `html/README.md`

**Interfaces:**
- Consumes: the production application, bundled DB, and committed orthographic
  atlas.
- Produces: automated and visual evidence for the first-batch acceptance gate.

- [ ] **Step 1: Write the automatic-load browser test**

Open `/` in Chromium and assert:

```ts
await expect(page.locator("[data-mode-badge]")).toContainText("专属地图");
await expect(page.locator("[data-mode-meta]")).toContainText(/Seed \d+/);
await expect(page.getByRole("checkbox", { name: /^地形/ })).toBeChecked();
await expect(page.getByRole("checkbox", { name: "地点名称" })).not.toBeChecked();
await expect(page.getByRole("checkbox", { name: "POI", exact: true })).not.toBeChecked();
await expect(page.getByRole("checkbox", { name: "资源" })).not.toBeChecked();
```

Assert the page requested `default-save.db`,
`/atlas/orthographic/terrain-cell-atlas.json`, and at least one native
orthographic page without using the upload input.

- [ ] **Step 2: Add zoom, rotation, and regression journeys**

At total overview, normal zoom, and maximum zoom:

- wait for `data-terrain-frame="committed"`;
- assert no atlas error or save error;
- visit one inventory target for each used rotation present in the generated
  inventory;
- compare the canvas screenshot with committed snapshots using a 0.5% pixel
  threshold;
- toggle names, POI, and resources on and off;
- search and select a location;
- switch to a fixed region and back;
- upload the bundled DB manually and verify the same terrain coverage;
- reload and verify automatic default loading returns.

Network assertions reject any request containing `G:`, `F:`, `AppData`, or a
Windows username.

- [ ] **Step 3: Run the new test and observe RED before final integration fixes**

Run:

```powershell
npx.cmd playwright test tests/e2e/default-orthographic-map.spec.ts `
  --project=chromium
```

Expected before the completed runtime integration: FAIL on a missing
orthographic request or incorrect default overlay state.

- [ ] **Step 4: Fix only defects exposed by the acceptance journey**

Limit changes to incorrect asset URLs, readiness signaling, rotation, canvas
composition, default layer state, or stale preview caching. Do not add another
region or broaden the capture inventory.

- [ ] **Step 5: Run full automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
npx.cmd playwright test tests/e2e/default-orthographic-map.spec.ts `
  --project=chromium --project=firefox
npx.cmd playwright test tests/e2e/legacy-map.spec.ts `
  --project=chromium
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 6: Inspect the real local preview at three zoom levels**

Build and restart the preview on `http://127.0.0.1:4173/`. With overlays off:

1. at overview zoom, inspect the full landmass and ocean for black rectangles,
   repeated island fragments, and oversized scene images;
2. at normal zoom, inspect roads, coastlines, lakes, forests, warehouses, and
   other captured large targets for continuous placement;
3. at maximum zoom, inspect source detail for scaling blur;
4. inspect every used 90°, 180°, and 270° target for inversion or mirroring;
5. enable names, POI, and resources and verify they appear above, not inside,
   the base image.

Any observed black block, old isometric thumbnail, wrong UUID image, mirror,
double rotation, or broken large-target reconstruction fails acceptance.

- [ ] **Step 7: Document the rebuild**

In `html/README.md`, record:

- the exact official editor and reviewed version;
- the three CLI commands and external capture directory layout;
- the 256-pixels-per-cell contract;
- deterministic target filtering;
- public output layout and actual byte total;
- the hard failure policy;
- that the first batch covers only the bundled default surface;
- that game-rendered asset distribution requires a separate licensing review.

- [ ] **Step 8: Commit**

```powershell
git add html/tests/e2e/default-orthographic-map.spec.ts `
  html/tests/e2e/default-orthographic-map.spec.ts-snapshots `
  html/tests/e2e/legacy-map.spec.ts html/README.md
git commit -m "test: verify default orthographic surface map"
```

---

## Final Acceptance Gate

The first batch is complete only when all statements are true:

- The bundled DB loads automatically after a refresh.
- Every target in the generated inventory has a verified official TileEditor
  master at exactly 256 pixels per game cell.
- Every target occurrence in the bundled world resolves to an orthographic
  atlas key; there are zero missing target keys.
- Existing accepted real legacy images remain unchanged outside the target list.
- No target falls back to an isometric thumbnail, another UUID, a reference SVG,
  a classification color, or a fabricated island.
- All used rotations reconstruct without mirror, inversion, or double rotation.
- Overview, normal, and maximum zoom pass browser inspection.
- Location names, POI, and resources are off by default and can be enabled.
- Search, filters, location list, region switching, upload, pan, zoom, reset,
  and URL state pass regression tests.
- Unit tests, production build, Chromium E2E, Firefox E2E, and `git diff --check`
  all pass.
- The generated public files contain no absolute path or private save data.
