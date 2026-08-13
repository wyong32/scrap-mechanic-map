# Scrap Mechanic 1.0 Map Phase 2: Game Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the checked-in non-personal reference map, fixed regions, location catalog, and complete tile-atlas manifest from the installed Scrap Mechanic 1.0 files.

**Architecture:** Node.js command-line tools read the game installation through a read-only adapter, normalize Lua/JSON metadata, and write deterministic JSON into `html/public/data/generated/`. Image preparation is separate from metadata extraction, but one verifier joins both outputs and rejects missing UUID/cell/rotation mappings.

**Tech Stack:** TypeScript executed with tsx, Node.js filesystem APIs, Vitest, Sharp for deterministic atlas packing, Vite.

## Global Constraints

- Default development source is `G:\共享文件\Scrap Mechanic`; the path must be a command argument and must never be embedded in production output.
- Source game files are read-only.
- Generated JSON must contain game metadata and map structure only; it must not contain a user save, Steam ID, player identity, creation, container, or inventory data.
- Every generated file includes `schemaVersion`, `gameVersion`, `generatedFrom`, and a SHA-256 `contentHash`.
- Fixed `.world` JSON and supported terrain tile UUIDs must be reproducible from the same command.
- The build fails when a supported region references an atlas cell that cannot be resolved by UUID + xOffset + yOffset + rotation.

---

### Task 1: Add a read-only game-install adapter and source inventory

**Files:**
- Modify: `html/package.json`
- Modify: `html/package-lock.json`
- Create: `html/tools/game-data/paths.ts`
- Create: `html/tools/game-data/inventory.ts`
- Create: `html/tools/game-data/inventory.test.ts`
- Create: `html/tools/game-data/cli.ts`
- Create: `html/tools/game-data/types.ts`

**Interfaces:**
- Produces: `resolveGamePaths(gameRoot: string): GamePaths`.
- Produces: `inventoryGameData(paths: GamePaths): Promise<GameInventory>`.
- Produces: CLI command `npm run data:inventory -- --game-root <path>`.

- [ ] **Step 1: Add tooling dependencies and scripts**

  Add `tsx ^4.20.3` and `sharp ^0.34.3`; add:

  ```json
  {
    "data:inventory": "tsx tools/game-data/cli.ts inventory",
    "data:build": "tsx tools/game-data/cli.ts build",
    "data:verify": "tsx tools/game-data/cli.ts verify"
  }
  ```

  Run: `npm install`

- [ ] **Step 2: Write the path/inventory failure tests**

  Use a temporary fixture containing `Survival/Scripts/terrain/overworld/tile_database.lua`, `Survival/Terrain/Worlds/GrowLab1.world`, and `Survival/Terrain/Tiles/surface.tile`. Assert normalized relative POSIX paths, file counts, SHA-256 hashes, and a clear error when `Survival` is absent.

- [ ] **Step 3: Run the focused test and verify it fails**

  Run: `npm test -- tools/game-data/inventory.test.ts`

  Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: Implement read-only discovery**

  `GamePaths` must expose absolute source paths and `GameInventory` must expose only:

  ```ts
  interface GameInventory {
    gameRoot: string;
    tileFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
    worldFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
    luaFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
  }
  ```

  Reject output directories that resolve inside `gameRoot`.

- [ ] **Step 5: Verify against the installed game and commit**

  Run: `npm test -- tools/game-data/inventory.test.ts`

  Run: `npm run data:inventory -- --game-root "G:\共享文件\Scrap Mechanic"`

  Expected: command reports at least 1,000 `.tile` files and the required terrain Lua/world sources.

  Commit:

  ```bash
  git add html/package.json html/package-lock.json html/tools/game-data
  git commit -m "feat: inventory Scrap Mechanic game data"
  ```

### Task 2: Extract tile, POI, and fixed-world metadata

**Files:**
- Create: `html/tools/game-data/lua-table-reader.ts`
- Create: `html/tools/game-data/lua-table-reader.test.ts`
- Create: `html/tools/game-data/world-reader.ts`
- Create: `html/tools/game-data/world-reader.test.ts`
- Create: `html/tools/game-data/extract-catalog.ts`
- Create: `html/tools/game-data/fixtures/tile-database.lua`
- Create: `html/tools/game-data/fixtures/fixed-region.world`

**Interfaces:**
- Consumes: `GameInventory` and `GamePaths`.
- Produces: `extractCatalog(paths: GamePaths): Promise<GeneratedCatalog>`.
- Produces: canonical `TileDefinition`, `PoiDefinition`, and `FixedWorldDefinition`.

- [ ] **Step 1: Write parser tests with exact supported syntax**

  Cover Lua UUID strings, `$CONTENT_DATA` path expressions, named table entries, numeric offsets, comments, trailing commas, and duplicate UUID rejection. Cover `.world` JSON cell grids, bounds, rotations `0..3`, and portal connections.

- [ ] **Step 2: Run tests and verify they fail**

  Run: `npm test -- tools/game-data/lua-table-reader.test.ts tools/game-data/world-reader.test.ts`

  Expected: FAIL because readers do not exist.

- [ ] **Step 3: Implement a non-executing Lua subset reader**

  Tokenize strings, numbers, identifiers, `{}`, `[]`, `=`, commas, and concatenation. Permit only table declarations and the `$CONTENT_DATA` constant; reject function calls and executable statements with file/line/column diagnostics. Never execute game Lua during extraction.

- [ ] **Step 4: Normalize worlds and catalog records**

  Emit stable records:

  ```ts
  interface TileDefinition {
    uuid: string; relativePath: string; width: number; height: number;
    terrainType: string; poiType?: string; sourceHash: string;
  }
  interface FixedWorldDefinition {
    id: string; nameKey: string; group: string; bounds: CellBounds;
    cells: TerrainCell[]; connections: WorldConnection[];
  }
  ```

  Sort arrays by ID, then coordinates, so two runs on unchanged sources are byte-identical.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- tools/game-data`

  Expected: PASS.

  Commit:

  ```bash
  git add html/tools/game-data
  git commit -m "feat: extract 1.0 terrain and region catalog"
  ```

### Task 3: Build the reference-world and application data bundle

**Files:**
- Create: `html/tools/game-data/build-data.ts`
- Create: `html/tools/game-data/build-data.test.ts`
- Create: `html/tools/game-data/reference-world.ts`
- Create: `html/tools/game-data/location-catalog.ts`
- Create: `html/public/data/generated/.gitkeep`
- Modify: `html/src/data/reference-repository.ts`

**Interfaces:**
- Consumes: `GeneratedCatalog`.
- Produces: `reference-world.json`, `regions.json`, `locations.json`, `tile-catalog.json`, and `build-info.json`.
- Produces: `buildGameData(options: BuildGameDataOptions): Promise<BuildReport>`.

- [ ] **Step 1: Write deterministic-output and privacy tests**

  Run the builder twice on fixtures and assert byte equality. Recursively assert output keys do not match `/steam|player|inventory|container|creation|save(path|file)?/i`. Assert every region ID in `locations.json` exists in `regions.json`.

- [ ] **Step 2: Run test and verify it fails**

  Run: `npm test -- tools/game-data/build-data.test.ts`

  Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement the builders**

  Build the fixed-region list from discovered `.world` files, group known IDs as surface, story, Grow Labs, underground facilities, and bosses, and include Chinese display names in a separate string dictionary. Generate the base reference surface from the checked-in sanitized cell fixture until a new canonical reference export is intentionally selected.

- [ ] **Step 4: Point the app repository to generated files**

  `ReferenceMapRepository` must load `/data/generated/build-info.json` first, validate `schemaVersion = 1`, then lazy-load a selected region. A failed region request leaves the current region visible and reports an actionable message.

- [ ] **Step 5: Verify against the game installation and commit**

  Run: `npm run data:build -- --game-root "G:\共享文件\Scrap Mechanic"`

  Run: `npm test && npm run build`

  Expected: generated files are byte-stable on a second run and the base application opens every supported fixed region.

  Commit:

  ```bash
  git add html/tools/game-data html/public/data/generated html/src/data/reference-repository.ts
  git commit -m "feat: generate 1.0 map data bundle"
  ```

### Task 4: Pack terrain-cell images and enforce atlas coverage

**Files:**
- Create: `html/tools/game-data/atlas/atlas-manifest.ts`
- Create: `html/tools/game-data/atlas/atlas-manifest.test.ts`
- Create: `html/tools/game-data/atlas/legacy-image-matcher.ts`
- Create: `html/tools/game-data/atlas/pack-atlas.ts`
- Create: `html/tools/game-data/atlas/verify-atlas.ts`
- Create: `html/tools/game-data/atlas/README.md`
- Create: `html/public/atlas/.gitkeep`
- Create: `html/src/map/atlas-layer.ts`
- Create: `html/src/map/atlas-layer.test.ts`

**Interfaces:**
- Produces: `AtlasKey = \`${string}:${number}:${number}:${0|1|2|3}\``.
- Produces: `buildAtlas(cells: AtlasSourceCell[], outputDir: string): Promise<AtlasManifest>`.
- Produces: `verifyAtlasCoverage(worlds: WorldMap[], manifest: AtlasManifest): CoverageReport`.
- Consumes in browser: `AtlasLayer.setCells(cells: TerrainCell[]): Promise<void>`.

  ```ts
  interface AtlasSourceCell {
    key: AtlasKey; imagePath: string; logicalSize: number; sourceHash: string;
  }
  interface AtlasManifestEntry {
    page: string; x: number; y: number; width: number; height: number; logicalSize: number;
  }
  interface AtlasManifest {
    schemaVersion: 1; gameVersion: string; entries: Record<AtlasKey, AtlasManifestEntry>;
  }
  interface CoverageReport {
    covered: number;
    missing: Array<{ regionId: string; uuid: string; xOffset: number; yOffset: number; rotation: 0 | 1 | 2 | 3 }>;
  }
  ```

- [ ] **Step 1: Write manifest and coverage tests**

  Assert UUID normalization, offset-sensitive lookup, rotation mapping, duplicate-key rejection, deterministic sprite coordinates, and this error shape:

  ```ts
  expect(report.missing).toEqual([
    { regionId: "grow-lab-1", uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", xOffset: 0, yOffset: 1, rotation: 3 }
  ]);
  ```

- [ ] **Step 2: Run tests and verify they fail**

  Run: `npm test -- tools/game-data/atlas html/src/map/atlas-layer.test.ts`

  Expected: FAIL because atlas modules do not exist.

- [ ] **Step 3: Implement image matching and packing**

  Match legacy images only through an explicit checked-in mapping from legacy ID/path to 1.0 UUID; never infer by filename digits alone. Normalize source cells to square WebP, derive rotations with Sharp, pack in stable key order, and emit page size, pixel rectangle, logical cell size, source hash, and game version.

- [ ] **Step 4: Document and enforce the new-tile render intake**

  `atlas/README.md` must specify the exact render contract: orthographic top-down camera, identical world scale, transparent or fixed neutral background, north-up rotation zero, lossless PNG input named `<uuid>__<xOffset>__<yOffset>.png`, and review of source/game licensing before distribution. `data:verify` must print every missing input filename and exit non-zero.

- [ ] **Step 5: Implement lazy browser atlas rendering**

  Draw only visible cells, use low-resolution atlas pages below zoom 2 and native pages at zoom 2+, release images when switching regions, and show a labeled missing-tile hatch only in development builds.

- [ ] **Step 6: Verify and commit**

  Run: `npm run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"`

  Run: `npm test && npm run build && npm run test:e2e`

  Expected: zero missing atlas keys for supported regions and all tests PASS.

  Commit:

  ```bash
  git add html/tools/game-data/atlas html/public/atlas html/src/map
  git commit -m "feat: add verified 1.0 terrain atlas"
  ```
