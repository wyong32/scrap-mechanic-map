# Safe Code and Image Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove only provably unused code declarations, obsolete image assets, and regenerable test output while preserving every active map and generation dependency.

**Architecture:** Treat source references, generated manifests, and generation tools as a combined reachability boundary. Make narrow deletions only after a candidate is absent from all three, then validate the unchanged application through compiler, data, unit, build, and browser checks.

**Tech Stack:** TypeScript 5.8, Vite 7, Vitest 3, Playwright, Leaflet, PowerShell.

## Global Constraints

- Preserve all current Surface World coverage.
- Preserve Scrap Mechanic 1.0 atlas assets and all capture/generation tools.
- Do not overwrite or revert unrelated dirty-worktree changes.
- Do not delete files merely because they are untracked.

---

### Task 1: Remove compiler-confirmed dead declarations

**Files:**
- Modify: `html/src/app/app-controller.test.ts`
- Modify: `html/src/legacy/legacy-asset-repository.ts`
- Modify: `html/src/save/validate-save-file.test.ts`
- Modify: `html/tools/authentic-map/default-surface-job.test.ts`
- Modify: `html/tools/game-data/build-data.ts`
- Modify: `html/tools/game-data/verify-generated.ts`

**Interfaces:**
- Consumes: Existing TypeScript imports, helper signatures, and tests.
- Produces: The same runtime and test behavior with no unused declarations.

- [ ] **Step 1: Record the unused-declaration baseline**

Run: `html\\node_modules\\.bin\\tsc.cmd --noEmit --noUnusedLocals --noUnusedParameters`

Expected: seven unused-declaration errors in the listed files.

- [ ] **Step 2: Remove only the reported unused declarations**

Delete unused imports and local helpers. For unused parameters whose position is not part of a public interface, remove the parameter and update local call sites; otherwise prefix it with `_` only when the value is intentionally unused.

- [ ] **Step 3: Verify strict unused checking**

Run: `html\\node_modules\\.bin\\tsc.cmd --noEmit --noUnusedLocals --noUnusedParameters`

Expected: PASS with zero diagnostics.

### Task 2: Remove the obsolete image and regenerable test output

**Files:**
- Delete: `html/public/assets/reference-surface.svg`
- Delete when present: `html/test-results/**`

**Interfaces:**
- Consumes: The proven-zero-reference candidate list.
- Produces: A smaller source tree with active map images unchanged.

- [ ] **Step 1: Recheck the obsolete image has no references**

Run: `rg -n "reference-surface\\.svg" html/src html/tools html/tests html/public/data html/public/atlas`

Expected: no matches.

- [ ] **Step 2: Delete only the confirmed obsolete asset and test output**

Use a scoped patch for the tracked SVG and a validated PowerShell path for `html/test-results`.

- [ ] **Step 3: Confirm retained assets still exist**

Run checks for `reference-surface-1.0.webp`, `fixed-region-backdrop.svg`, `official-tile-atlas.json`, `legacy-assets.json`, and `default-save.db`.

Expected: all five exist.

### Task 3: Verify data, application, and browser behavior

**Files:**
- No intended source changes.

**Interfaces:**
- Consumes: Cleaned source tree.
- Produces: Verification evidence that cleanup did not alter behavior.

- [ ] **Step 1: Run generated-data verification**

Run: `npm.cmd run data:verify`

Expected: PASS.

- [ ] **Step 2: Run lint and focused tests**

Run: `npm.cmd run lint`

Run: `npm.cmd test -- --run src/app src/map src/legacy src/save src/terrain tools/game-data`

Expected: PASS.

- [ ] **Step 3: Build the production bundle**

Run: `npm.cmd run build`

Expected: PASS and a regenerated `html/dist`.

- [ ] **Step 4: Browser smoke-test the current page**

Open `http://127.0.0.1:4173/?region=surface&z=-3&x=0&y=0` and confirm the terrain is visible, `Location Names` and `Player Markers` controls remain available, save selection remains available, and zoom cannot go below `-3`.

- [ ] **Step 5: Report exact cleanup impact**

Compare removed file count and bytes against the pre-cleanup inventory, and report retained assets plus any known baseline test failure without claiming it was caused by cleanup.
