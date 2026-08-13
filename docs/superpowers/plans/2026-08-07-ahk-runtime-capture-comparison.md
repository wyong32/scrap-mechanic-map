# AHK Runtime Capture Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the first same-location comparison image for the legacy open-source tile library, the shipped TileEditor preview, and the original AHK-style in-game overhead capture, with measured production time.

**Architecture:** Use the already isolated Scrap Mechanic 1.0 working copy and default save. Center the experiment on world cell `(-39, 19)` / game position `(-2464, 1248, 250)`, capture one stable north-up gameplay frame, then crop and label all sources without content repair. Store source evidence outside the website assets so the experiment cannot silently become terrain data.

**Tech Stack:** Scrap Mechanic 1.0.1.869, reviewed runtime camera patch, Computer Use window capture, TypeScript, Sharp, Vitest.

## Global Constraints

- Output root: `F:/Scrap Mechanical/runtime-captures/ahk-comparison-1/`.
- Do not modify the Steam installation or normal player save directory.
- Do not use offline-rendered terrain, generative fill, sharpening, content-aware repair, or synthetic replacements.
- Preserve every source image at its native captured resolution.
- Record actual elapsed times; do not substitute configured sleep values for measurements.
- This experiment does not replace the current website basemap.

---

### Task 1: Prepare the reproducible comparison job

**Files:**
- Create: `html/tools/runtime-capture/ahk-comparison.ts`
- Create: `html/tools/runtime-capture/ahk-comparison.test.ts`
- Create externally: `F:/Scrap Mechanical/runtime-captures/ahk-comparison-1/comparison-job.json`

**Interfaces:**
- Consumes: reference world JSON, tile catalog JSON, legacy image repository, target cell `(-39, 19)`.
- Produces: `buildAhkComparisonJob()` and a job JSON containing UUID, legacy ID, rotation, tile path, world/game coordinates, required source paths, and output dimensions.

- [ ] **Step 1: Write a failing test** asserting that `buildAhkComparisonJob()` resolves cell `(-39, 19)`, selects an exact legacy asset, emits game position `(-2464, 1248, 250)`, and rejects a target without an exact legacy image.
- [ ] **Step 2: Run** `npm.cmd test -- tools/runtime-capture/ahk-comparison.test.ts` from `html`; expect failure because the module does not exist.
- [ ] **Step 3: Implement** the smallest resolver that joins the reference cell UUID to the catalog bridge and verifies the legacy image path exists.
- [ ] **Step 4: Run the test** and require PASS.
- [ ] **Step 5: Write** `comparison-job.json` and record its SHA-256.

### Task 2: Capture one AHK-style official-runtime sample

**Files:**
- Create externally: `F:/Scrap Mechanical/runtime-captures/ahk-comparison-1/source/runtime-full-window.png`
- Create externally: `F:/Scrap Mechanical/runtime-captures/ahk-comparison-1/source/runtime-center-750.png`
- Create externally: `F:/Scrap Mechanical/runtime-captures/ahk-comparison-1/runtime-evidence.json`

**Interfaces:**
- Consumes: target game position and crop from `comparison-job.json`.
- Produces: one reviewed HUD-free runtime crop and timing evidence.

- [ ] **Step 1: Fingerprint** the isolated working copy, redirected user-data root, executable, default DB, and active camera script before launch.
- [ ] **Step 2: Launch** the pre-existing isolated official game executable and load the copied default save.
- [ ] **Step 3: Invoke** `/tp -2464,1248,250` when the original command remains available; otherwise invoke `/smoverview_capture -2464 1248 250` and mark the evidence as `compatibility-camera`.
- [ ] **Step 4: Set** FOV 90, hide HUD with Alt+Z, wait at least four seconds after the ready marker, and move the cursor outside the central crop.
- [ ] **Step 5: Capture** two full-window frames at least 500 ms apart, verify stability and visible loaded terrain, retain the first accepted frame, and crop the central 750×750 pixels.
- [ ] **Step 6: Record** cold-start, save-load, positioning, terrain-wait, capture, crop, retry, and total elapsed milliseconds in `runtime-evidence.json`.
- [ ] **Step 7: Fingerprint** protected roots after capture and require no unauthorized change.

### Task 3: Compose and verify the first comparison image

**Files:**
- Modify: `html/tools/runtime-capture/ahk-comparison.ts`
- Modify: `html/tools/runtime-capture/ahk-comparison.test.ts`
- Create externally: `F:/Scrap Mechanical/runtime-captures/ahk-comparison-1/ahk-first-comparison.png`
- Create externally: `F:/Scrap Mechanical/runtime-captures/ahk-comparison-1/efficiency-report.json`

**Interfaces:**
- Consumes: exact legacy asset, official installed preview for the same UUID, accepted runtime crop, and timing evidence.
- Produces: `composeAhkComparison()` and `estimateCaptureEfficiency()`.

- [ ] **Step 1: Write failing tests** for three equal-width panels, immutable aspect-preserving source placement, source labels, timing labels, and estimates for 173 unique Tile images versus the original whole-world grid.
- [ ] **Step 2: Run** `npm.cmd test -- tools/runtime-capture/ahk-comparison.test.ts`; expect the new assertions to fail.
- [ ] **Step 3: Implement** composition with Sharp using a neutral dark background, no image enhancement, and explicit `A/B/C` source labels.
- [ ] **Step 4: Implement** efficiency estimates from measured successful and retry times; report optimistic, observed, and one-retry totals separately.
- [ ] **Step 5: Run** the focused test and require PASS.
- [ ] **Step 6: Generate** the PNG and JSON report, inspect the PNG at native resolution, and verify that no HUD, cursor, black loading block, stretch, or hidden crop exists.
- [ ] **Step 7: Run** `git diff --check` and the focused test again; commit only the reusable composer and its test, leaving captured game artifacts external.

