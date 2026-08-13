# Scrap Mechanic 1.0 Map Phase 3: Local Save Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read a user-selected Scrap Mechanic 1.0 Survival save entirely in the browser and replace the reference surface with its exact normalized terrain.

**Architecture:** A module Worker owns sql.js, ScriptData extraction, LZ4 decompression, and Lua binary decoding. It returns a structured transfer object to the main thread; the existing map controller normalizes and renders it through the Phase 2 atlas without exposing SQLite or decoder details to the UI.

**Tech Stack:** TypeScript, Web Workers, sql.js WASM, lz4js, Canvas/OffscreenCanvas, Vitest, Playwright.

## Global Constraints

- Accept only files with the SQLite header and size `1..268435456` bytes.
- Support the verified 1.0 format `savegameversion = 28`; unsupported versions produce a recoverable error and leave the base map visible.
- Read `Game.savegameversion`, `Game.seed`, and the largest candidate `ScriptData.data` for `worldId = 1`.
- Terrain must come from decoded save UUID, xOffset, yOffset, rotation, flags, bounds, and seed; do not regenerate terrain from seed alone.
- Save bytes and decoded personal data remain in memory only and must not enter URL, logs, localStorage, IndexedDB, Cache Storage, analytics, or generated files.
- Decoder errors include byte offset and stage; they must never silently produce a partial map labeled exact.

---

### Task 1: Define the Worker protocol and validate file input

**Files:**
- Modify: `html/package.json`
- Modify: `html/package-lock.json`
- Create: `html/src/save/save-protocol.ts`
- Create: `html/src/save/save-errors.ts`
- Create: `html/src/save/validate-save-file.ts`
- Create: `html/src/save/validate-save-file.test.ts`
- Create: `html/src/save/save-client.ts`
- Create: `html/src/save/save-worker.ts`

**Interfaces:**
- Produces: `parseSave(file: File, onProgress: (stage: SaveStage) => void): Promise<DecodedSave>`.
- Produces stages: `"reading" | "sqlite" | "decompressing" | "decoding" | "normalizing" | "rendering"`.
- Produces error codes: `EMPTY_FILE`, `FILE_TOO_LARGE`, `NOT_SQLITE`, `NOT_SURVIVAL_SAVE`, `UNSUPPORTED_SAVE_VERSION`, `MISSING_SURFACE_DATA`, `DECOMPRESSION_FAILED`, `DECODE_FAILED`, `UNKNOWN_TILE_UUID`, `UNSUPPORTED_BROWSER`.

  ```ts
  export type SaveStage = "reading" | "sqlite" | "decompressing" | "decoding" | "normalizing" | "rendering";
  export type LuaValue =
    | null | boolean | number | string
    | { kind: "array"; values: LuaValue[]; negativeValues: Record<number, LuaValue> }
    | { kind: "table"; entries: Array<[LuaValue, LuaValue]> }
    | { kind: "uuid"; value: string }
    | { kind: "vec3"; x: number; y: number; z: number };
  export interface SupportedProgressRecord {
    locationId: string;
    state: "locked" | "available" | "visited" | "completed";
    source: "script-data" | "generic-data" | "portal";
  }
  export interface SaveMetadata { fileName: string; saveVersion: 28; seed: number }
  export interface DecodedSave {
    metadata: SaveMetadata;
    terrain: LuaValue;
    connections: WorldConnection[];
    progressRecords: SupportedProgressRecord[];
  }
  ```

- [ ] **Step 1: Install local runtime libraries**

  Add runtime dependencies:

  ```json
  {
    "sql.js": "^1.13.0",
    "lz4js": "^0.2.0"
  }
  ```

  Add matching local type declarations under `html/src/types/` when a package does not ship types. Run `npm install`.

- [ ] **Step 2: Write file-validation tests**

  Test empty files, 256 MB + 1 byte metadata without allocating the payload, invalid headers, valid `SQLite format 3\0`, and browsers missing `Worker`, `WebAssembly`, or Canvas support.

- [ ] **Step 3: Run the test and verify it fails**

  Run: `npm test -- src/save/validate-save-file.test.ts`

  Expected: FAIL because validation does not exist.

- [ ] **Step 4: Implement validation and typed Worker messages**

  The main thread reads only the first 16 bytes before validation. Define request IDs so a replacement file cancels the previous request and stale replies are ignored. `SaveClient.dispose()` terminates the Worker and clears callbacks.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- src/save/validate-save-file.test.ts && npm run lint`

  Expected: PASS.

  Commit:

  ```bash
  git add html/package.json html/package-lock.json html/src/save html/src/types
  git commit -m "feat: validate local save input"
  ```

### Task 2: Read the minimal SQLite save records in the Worker

**Files:**
- Create: `html/src/save/sqlite-reader.ts`
- Create: `html/src/save/sqlite-reader.test.ts`
- Create: `html/src/save/fixtures/create-save-fixture.ts`
- Modify: `html/src/save/save-worker.ts`

**Interfaces:**
- Produces: `readSaveRecords(bytes: Uint8Array): SaveRecords`.
- Produces: `SaveRecords = { saveVersion: number; seed: number; surfaceCandidates: Uint8Array[] }`.

- [ ] **Step 1: Build a synthetic in-memory SQLite fixture**

  The fixture contains:

  ```sql
  CREATE TABLE Game (savegameversion INTEGER NOT NULL, seed INTEGER NOT NULL);
  CREATE TABLE ScriptData (worldId INTEGER NOT NULL, data BLOB NOT NULL);
  INSERT INTO Game VALUES (28, 360160198);
  ```

  Insert two deterministic blobs for world 1 and one unrelated world 65534; assert candidates are returned longest first.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm test -- src/save/sqlite-reader.test.ts`

  Expected: FAIL because `readSaveRecords` does not exist.

- [ ] **Step 3: Implement read-only SQLite access**

  Initialize sql.js from a Vite-bundled WASM URL, inspect `sqlite_master`, require `Game` and `ScriptData`, execute parameterized reads, copy required blobs out, then close the database in `finally`. Never query or return player/inventory tables.

- [ ] **Step 4: Add version and missing-data assertions**

  Reject multiple Game rows, non-integer seed/version, versions other than 28, empty world 1 candidates, and malformed column types with the exact error codes from Task 1.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- src/save/sqlite-reader.test.ts`

  Expected: PASS.

  Commit:

  ```bash
  git add html/src/save
  git commit -m "feat: read terrain records from Survival saves"
  ```

### Task 3: Decode ScriptData wrappers, LZ4 blocks, and Lua values

**Files:**
- Create: `html/src/save/binary-reader.ts`
- Create: `html/src/save/binary-reader.test.ts`
- Create: `html/src/save/script-data-decoder.ts`
- Create: `html/src/save/script-data-decoder.test.ts`
- Create: `html/src/save/lua-value-decoder.ts`
- Create: `html/src/save/lua-value-decoder.test.ts`
- Create: `html/src/save/fixtures/encoded-values.ts`
- Modify: `html/src/save/save-worker.ts`

**Interfaces:**
- Produces: `decodeScriptData(blob: Uint8Array): LuaValue`.
- Produces: `decodeLuaValue(reader: BinaryReader, references: LuaValue[]): LuaValue`.
- Produces: tagged `LuaValue` union for nil, boolean, number, string, array/table, UUID, vec3, and references.

- [ ] **Step 1: Write byte-level reader tests**

  Cover little-endian signed/unsigned integers, IEEE-754 doubles, UTF-8 length-prefixed strings, bounds errors, and error offsets. Each test uses literal `Uint8Array` bytes and checks the reader offset after success.

- [ ] **Step 2: Write decoder tests for each supported value**

  Handcraft encoded values for nil, booleans, integer/double, negative-index arrays, string-key tables, UUID, vec3, repeated references, an LZ4 literal block, truncated input, invalid tags, and cyclic reference rejection.

- [ ] **Step 3: Run tests and verify they fail**

  Run: `npm test -- src/save/binary-reader.test.ts src/save/lua-value-decoder.test.ts src/save/script-data-decoder.test.ts`

  Expected: FAIL because decoder modules do not exist.

- [ ] **Step 4: Implement bounds-checked decoding**

  Every read checks remaining bytes before advancing. Decoder errors use:

  ```ts
  new SaveParseError("DECODE_FAILED", {
    stage: "lua-value",
    offset: reader.offset,
    message: `Unknown value tag 0x${tag.toString(16)}`
  });
  ```

  Unwrap the ScriptData record, verify declared compressed/uncompressed sizes, decompress with lz4js, and require full consumption except documented alignment bytes.

- [ ] **Step 5: Validate against a local private save without committing it**

  Add a gitignored local command that receives `--save <absolute-path>`, prints only save version, seed, world bounds, cell count, and distinct UUID count, and redacts the supplied path. Run it against the known 1.0 save and expect version 28, world 1, 128 × 96 bounds, and 12,288 terrain cells.

- [ ] **Step 6: Verify and commit**

  Run: `npm test -- src/save`

  Expected: PASS; `git status --short` contains no `.db` or derived private blob.

  Commit:

  ```bash
  git add html/src/save html/.gitignore
  git commit -m "feat: decode Scrap Mechanic ScriptData"
  ```

### Task 4: Normalize decoded terrain and render the personalized world

**Files:**
- Create: `html/src/terrain/normalize-terrain.ts`
- Create: `html/src/terrain/normalize-terrain.test.ts`
- Create: `html/src/terrain/validate-terrain.ts`
- Create: `html/src/terrain/validate-terrain.test.ts`
- Create: `html/src/map/personal-terrain-layer.ts`
- Create: `html/src/map/personal-terrain-layer.test.ts`
- Modify: `html/src/save/save-worker.ts`
- Modify: `html/src/app/app-controller.ts`

**Interfaces:**
- Produces: `normalizeTerrain(decoded: LuaValue, metadata: SaveMetadata, catalog: TileCatalog): WorldMap`.
- Produces: `validateTerrain(world: WorldMap, catalog: TileCatalog): TerrainValidationReport`.
- Produces: `PersonalTerrainLayer.setWorld(world: WorldMap): Promise<void>` and `dispose(): void`.

  ```ts
  export interface TileCatalog {
    gameVersion: string;
    tiles: Record<string, { terrainType: string; poiType?: string }>;
  }
  export interface TerrainValidationReport {
    valid: boolean; expectedCellCount: number; actualCellCount: number; unknownUuids: string[]; errors: string[];
  }
  ```

- [ ] **Step 1: Write terrain invariants tests**

  Assert exact bounds/cell count, unique `(x,y)` coordinates, seed equality, rotation `0..3`, finite offsets, UUID normalization, and rejection of unknown UUIDs. Include a valid 2 × 2 world whose four cells use distinct rotations.

- [ ] **Step 2: Run tests and verify they fail**

  Run: `npm test -- src/terrain src/map/personal-terrain-layer.test.ts`

  Expected: FAIL because normalizer and layer do not exist.

- [ ] **Step 3: Implement normalization and validation**

  Extract `bounds`, `seed`, `uid`, `xOffset`, `yOffset`, `rotation`, and `flags`; require array lengths to equal width × height; build `TerrainCell[]` in row-major order; attach terrain/POI types from the Phase 2 tile catalog.

- [ ] **Step 4: Implement progressive Canvas rendering**

  Render a low-resolution overview first, then visible native cells. Use OffscreenCanvas inside the Worker when available and a main-thread Canvas fallback otherwise. Check request cancellation between rows, transfer `ImageBitmap` where supported, and revoke prior object URLs/bitmaps on replacement.

- [ ] **Step 5: Wire successful mode switching and recoverable errors**

  Keep the base world mounted until personalized terrain passes validation and its first overview frame is ready. On success show file name, seed, save version, `更换存档`, and `退出专属地图`; on failure retain the base map and show the specific recovery action.

- [ ] **Step 6: Verify and commit**

  Run: `npm test && npm run build`

  Expected: PASS.

  Commit:

  ```bash
  git add html/src/terrain html/src/map html/src/save html/src/app
  git commit -m "feat: render personalized save terrain"
  ```

### Task 5: Cover personalized-mode browser journeys

**Files:**
- Create: `html/tests/e2e/fixtures/synthetic-save.ts`
- Create: `html/tests/e2e/personal-map.spec.ts`
- Create: `html/tests/e2e/save-errors.spec.ts`
- Modify: `html/playwright.config.ts`

**Interfaces:**
- Consumes: public UI only.
- Produces: regression coverage for valid save, replacement, exit, invalid file, unsupported version, and privacy.

- [ ] **Step 1: Write a deterministic synthetic save generator**

  Generate a minimal `.db` during the test run with version 28 and a 2 × 2 encoded terrain fixture. Store it only in Playwright’s output directory and delete it through test-runner cleanup.

- [ ] **Step 2: Write the successful flow**

  Select the generated file, assert progress messages, personalized badge, seed/version, four rendered cell records, fixed-region availability, replacement behavior, and return to base mode.

- [ ] **Step 3: Write error and privacy flows**

  Test empty, text, version 27, truncated Lua, unknown UUID, and 256 MB + 1 metadata. Capture requests, console output, URL, localStorage, IndexedDB databases, and Cache Storage keys; assert none contain the file name, seed, or bytes.

- [ ] **Step 4: Run and fix only implementation defects exposed by the tests**

  Run: `npm run test:e2e -- tests/e2e/personal-map.spec.ts tests/e2e/save-errors.spec.ts`

  Expected: PASS in Chromium and Firefox projects.

- [ ] **Step 5: Commit**

  ```bash
  git add html/tests html/playwright.config.ts html/src
  git commit -m "test: cover local personalized map mode"
  ```
