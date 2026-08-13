# Reference Surface UUID Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract reviewable UUID/rotation terrain sprites from the authentic default 1.0 surface image, validate them by reconstructing the default world, and use only accepted sprites to render the 429 UUID types shared with `test.db`.

**Architecture:** A local-only pipeline parses the checked-in default save and reference world, maps fractional cell edges into the 10,775 x 8,480 source image, groups crops by UUID and rotation, selects consistent medoid candidates, and emits diagnostics. A quality gate reconstructs the default world before a reviewed atlas is wired into the existing on-demand official terrain repository.

**Tech Stack:** TypeScript, Vitest, Sharp, sql.js, existing terrain decoder/catalog, existing official atlas repository, Playwright.

## Global Constraints

- Source image: `public/assets/reference-surface-1.0.webp`, exactly 10,775 x 8,480 for the calibrated revision.
- Reference world bounds: `x=-72..71`, `y=-56..55`, exactly 144 x 112 cells.
- The pipeline evaluates all 429 measured shared UUIDs but publishes only candidates that pass quality gates.
- Catalog recognition is never reported as qualified image coverage.
- Raw crops, rejected candidates, difference images, and reports remain under ignored `local-assets` storage.
- No old legacy images or rejected offline orthographic images return to the public release.
- Every behavior change follows RED -> GREEN and keeps deterministic hashes/provenance.

---

### Task 1: Fractional world-to-image calibration

**Files:**
- Create: `tools/reference-extraction/reference-transform.ts`
- Create: `tools/reference-extraction/reference-transform.test.ts`

**Interfaces:**
- Produces: `ReferenceTransformInput`, `PixelEdges`, `createReferenceTransform(input)`, and `cellPixelEdges(x, y)`.
- `createReferenceTransform` validates dimensions/bounds and exposes the selected orientation without reading files.

- [ ] **Step 1: Write failing tests for exact full-image coverage**

```ts
const transform = createReferenceTransform({
  imageWidth: 10_775,
  imageHeight: 8_480,
  bounds: { minX: -72, minY: -56, maxX: 71, maxY: 55 },
  orientation: "x-right-y-down"
});
expect(transform.cellPixelEdges(-72, -56)).toEqual({ left: 0, top: 0, right: 75, bottom: 76 });
expect(transform.cellPixelEdges(71, 55)).toEqual({ left: 10_700, top: 8_404, right: 10_775, bottom: 8_480 });
expect(transform.rowEdges()).toEqual(expect.arrayContaining([0, 8_480]));
```

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- --run tools/reference-extraction/reference-transform.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement edge-based mapping**

```ts
const edge = (index: number, count: number, pixels: number) =>
  Math.round(index * pixels / count);
```

Validate every adjacent edge is shared, the first edge is zero, and the final edge is the exact image dimension. Implement four explicit axis/flip orientations; do not infer orientation here.

- [ ] **Step 4: Run GREEN and lint**

Run: `npm.cmd test -- --run tools/reference-extraction/reference-transform.test.ts && npm.cmd run lint`

Expected: tests and TypeScript exit 0.

- [ ] **Step 5: Commit**

```powershell
git add html/tools/reference-extraction/reference-transform.ts html/tools/reference-extraction/reference-transform.test.ts
git commit -m "feat: map reference cells to fractional image edges"
```

---

### Task 2: Parse inputs and inventory the default/test UUID intersection

**Files:**
- Create: `tools/reference-extraction/reference-inputs.ts`
- Create: `tools/reference-extraction/reference-inputs.test.ts`
- Create: `tools/reference-extraction/reference-extraction-types.ts`

**Interfaces:**
- Consumes: existing `readSaveRecordsWithSql`, `decodeSurfaceCandidates`, `parseTileCatalogDocuments`, and `normalizeTerrain`.
- Produces: `loadReferenceExtractionInputs(options): Promise<ReferenceExtractionInputs>` and `compareUuidSets(reference, target): UuidIntersectionReport`.
- `ReferenceExtractionInputs` contains source hash/dimensions, parsed reference world, target world, and catalog metadata.

- [ ] **Step 1: Write failing fixture tests**

Test that two small `WorldMap` values yield deterministic sorted `shared`, `referenceOnly`, and `targetOnly` arrays, and that mismatched source dimensions/bounds fail closed.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- --run tools/reference-extraction/reference-inputs.test.ts`

Expected: FAIL because the loader and report do not exist.

- [ ] **Step 3: Implement deterministic input loading**

Read the image metadata with Sharp, hash raw source bytes, parse both DBs through the existing production decoder, and compare the parsed checked-in reference world with the default DB. Reject if bounds, UUID, rotation, offsets, or cell coordinates differ.

- [ ] **Step 4: Run GREEN**

Run: `npm.cmd test -- --run tools/reference-extraction/reference-inputs.test.ts tools/authentic-map/default-surface-job.test.ts`

Expected: all tests pass; the existing known empty-inventory assertions may not be changed in this task.

- [ ] **Step 5: Commit**

```powershell
git add html/tools/reference-extraction/reference-inputs.ts html/tools/reference-extraction/reference-inputs.test.ts html/tools/reference-extraction/reference-extraction-types.ts
git commit -m "feat: inventory shared reference terrain UUIDs"
```

---

### Task 3: Extract, normalize, group, and select candidates

**Files:**
- Create: `tools/reference-extraction/candidate-extractor.ts`
- Create: `tools/reference-extraction/candidate-extractor.test.ts`
- Create: `tools/reference-extraction/candidate-selector.ts`
- Create: `tools/reference-extraction/candidate-selector.test.ts`

**Interfaces:**
- Consumes: `ReferenceExtractionInputs` and `createReferenceTransform`.
- Produces: `extractCandidates(input, outputRoot): Promise<ExtractionCandidate[]>`.
- Produces: `selectCandidateGroup(candidates, thresholds): CandidateDecision`.
- Each `ExtractionCandidate` records UUID, rotation, world coordinate, pixel edges, SHA-256, dimensions, and local filename.

- [ ] **Step 1: Write RED extraction tests**

Create a synthetic image with non-integer cell widths and assert exact crop provenance, dimensions, content, and stable filenames for every orientation.

- [ ] **Step 2: Run extraction RED**

Run: `npm.cmd test -- --run tools/reference-extraction/candidate-extractor.test.ts`

Expected: FAIL because extraction is missing.

- [ ] **Step 3: Implement extraction with Sharp**

Crop from absolute computed edges. Write candidates only below a caller-supplied ignored output root. Refuse junctions/symlinks and paths outside that root.

- [ ] **Step 4: Write RED selector tests**

Use small real pixel fixtures to prove the selector chooses the medoid of a consistent cluster, rejects a lone inconsistent crop, rejects excessive edge error, and rotates a square verified crop exactly by quarter turns.

- [ ] **Step 5: Run selector RED**

Run: `npm.cmd test -- --run tools/reference-extraction/candidate-selector.test.ts`

Expected: FAIL because selection is missing.

- [ ] **Step 6: Implement deterministic selection**

Calculate normalized interior perceptual distance and four edge-strip distances. Sort ties by source coordinate and hash. Do not average candidates. Record every score and rejection reason.

- [ ] **Step 7: Run GREEN and lint**

Run: `npm.cmd test -- --run tools/reference-extraction/candidate-extractor.test.ts tools/reference-extraction/candidate-selector.test.ts && npm.cmd run lint`

Expected: all tests and TypeScript pass.

- [ ] **Step 8: Commit**

```powershell
git add html/tools/reference-extraction/candidate-*.ts
git commit -m "feat: select stable reference terrain candidates"
```

---

### Task 4: Reconstruct the reference world and enforce quality gates

**Files:**
- Create: `tools/reference-extraction/reconstruct-reference.ts`
- Create: `tools/reference-extraction/reconstruct-reference.test.ts`
- Create: `tools/reference-extraction/quality-report.ts`
- Create: `tools/reference-extraction/quality-report.test.ts`

**Interfaces:**
- Consumes: selected candidate decisions, reference world, source image, and transform.
- Produces: `reconstructReference(options): Promise<ReconstructionResult>`.
- Produces: `evaluateReconstruction(result, thresholds): ReferenceQualityReport`.
- Report includes type, rotation, and cell coverage; seam metrics; image-difference metrics; accepted/rejected provenance.

- [ ] **Step 1: Write failing reconstruction tests**

Use a four-cell fixture to prove rotation placement, full canvas dimensions, transparent/missing cells, and deterministic output hash.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- --run tools/reference-extraction/reconstruct-reference.test.ts tools/reference-extraction/quality-report.test.ts`

Expected: FAIL because reconstruction/report modules do not exist.

- [ ] **Step 3: Implement reconstruction and difference output**

Composite accepted sprites at transform edges, preserving target cell rotation. Generate a reconstruction WebP and an amplified PNG difference image without mutating the source.

- [ ] **Step 4: Implement fail-closed quality reporting**

Count coverage from placed cells, not UUID recognition. Reject any candidate group whose seam or reconstruction contribution exceeds explicit thresholds. Emit stable canonical JSON with source hashes.

- [ ] **Step 5: Run GREEN**

Run: `npm.cmd test -- --run tools/reference-extraction/reconstruct-reference.test.ts tools/reference-extraction/quality-report.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add html/tools/reference-extraction/reconstruct-reference.ts html/tools/reference-extraction/reconstruct-reference.test.ts html/tools/reference-extraction/quality-report.ts html/tools/reference-extraction/quality-report.test.ts
git commit -m "feat: gate extracted terrain by reconstruction quality"
```

---

### Task 5: Add the local CLI and run the real 429-UUID evaluation

**Files:**
- Create: `tools/reference-extraction/cli.ts`
- Create: `tools/reference-extraction/cli.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces command: `npm.cmd run data:reference-extract -- --target <save.db>`.
- Writes raw and diagnostic output to `local-assets/reference-extraction/<source-hash>/`.
- Writes no public files unless invoked later with a separate reviewed publish command.

- [ ] **Step 1: Write CLI RED tests**

Test required arguments, path containment, deterministic reruns, source-hash isolation, atomic output replacement, and nonzero exit on failed quality gates.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- --run tools/reference-extraction/cli.test.ts`

Expected: FAIL because the command is absent.

- [ ] **Step 3: Implement the local-only CLI**

Wire Tasks 1-4, use a temporary sibling directory, verify the complete report, then rename atomically. Preserve the previous successful run on failure.

- [ ] **Step 4: Run GREEN and focused suite**

Run: `npm.cmd test -- --run tools/reference-extraction/*.test.ts`

Expected: all extraction tests pass.

- [ ] **Step 5: Execute the real evaluation**

Run:

```powershell
npm.cmd run data:reference-extract -- --target "C:\Users\User\AppData\Roaming\Axolot Games\Scrap Mechanic\User\User_76561198777858656\Save\Survival\test.db"
```

Expected outputs include the measured 429 shared UUIDs, accepted/rejected counts, default reconstruction, difference image, and a `test.db` preview. Stop here if alignment or quality evidence is unacceptable; do not publish an atlas.

- [ ] **Step 6: Review the real images and thresholds**

Open the source, reconstruction, difference image, and `test.db` preview. Record whether seams, rotations, roads, coastlines, structures, and foliage are acceptable. Threshold changes require new fixture tests and a second real run.

- [ ] **Step 7: Commit tooling only**

```powershell
git add html/package.json .gitignore html/tools/reference-extraction/cli.ts html/tools/reference-extraction/cli.test.ts
git commit -m "feat: evaluate reference terrain extraction locally"
```

---

### Task 6: Publish accepted sprites and render personalized saves

**Files:**
- Create: `tools/reference-extraction/publish-reference-atlas.ts`
- Create: `tools/reference-extraction/publish-reference-atlas.test.ts`
- Modify: `src/legacy/legacy-visual-types.ts`
- Modify: `src/legacy/legacy-asset-repository.ts`
- Modify: `src/legacy/terrain-asset-plan.ts`
- Modify: `src/legacy/hybrid-terrain-resolver.ts`
- Modify: corresponding `*.test.ts` files
- Modify: `tests/e2e/personal-map.spec.ts`

**Interfaces:**
- Consumes only a passing `ReferenceQualityReport` whose source hashes match tracked inputs.
- Produces immutable `reference-extracted-<n>.webp` pages and official manifest entries with projection `verified-reference-extraction` and full provenance.
- Runtime resolver accepts these entries as terrain only after manifest hash/size validation.

- [ ] **Step 1: Write publishing RED tests**

Prove publication rejects failed reports, altered inputs, missing candidate hashes, duplicate/conflicting UUID rotations, and paths outside the public atlas directory.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- --run tools/reference-extraction/publish-reference-atlas.test.ts src/legacy/legacy-asset-repository.test.ts src/legacy/hybrid-terrain-resolver.test.ts`

Expected: FAIL because the new projection and publisher do not exist.

- [ ] **Step 3: Implement publishing and repository validation**

Pack only accepted candidates. Add the new projection as an explicit type and require source-image hash, reference-world hash, extraction-report hash, crop coordinate, and rotation provenance.

- [ ] **Step 4: Update personal-map coverage behavior**

The coverage panel must report qualified extracted cells independently from missing cells. Do not label them generic catalog or UUID matches.

- [ ] **Step 5: Run focused GREEN**

Run: `npm.cmd test -- --run tools/reference-extraction/publish-reference-atlas.test.ts src/legacy/legacy-asset-repository.test.ts src/legacy/terrain-asset-plan.test.ts src/legacy/hybrid-terrain-resolver.test.ts src/map/map-view.test.ts`

Expected: all focused tests pass.

- [ ] **Step 6: Run production browser verification**

Run: `npm.cmd exec playwright test tests/e2e/personal-map.spec.ts --project=chromium --project=firefox`

Expected: both browsers render the real target layout, report the exact qualified/missing cell counts, preserve save replacement behavior, and issue no request for old legacy or rejected orthographic pages.

- [ ] **Step 7: Run release gates**

Run: `npm.cmd run lint && npm.cmd run release:check`

Expected: exit 0 and no banned/untracked public assets.

- [ ] **Step 8: Commit runtime integration**

```powershell
git add html/tools/reference-extraction/publish-reference-atlas* html/src/legacy html/src/map html/tests/e2e/personal-map.spec.ts html/public/atlas/official
git commit -m "feat: render saves from verified reference terrain"
```

---

### Task 7: Final evidence and handoff

**Files:**
- Create: `docs/reference-extraction-report.md`

**Interfaces:**
- Records exact commit, source hashes, thresholds, accepted/rejected counts, type/rotation/cell coverage, artifact sizes, test commands, and known 15 target-only UUIDs.

- [ ] **Step 1: Run the complete focused extraction and runtime suite**

Run: `npm.cmd test -- --run tools/reference-extraction/*.test.ts src/legacy/legacy-asset-repository.test.ts src/legacy/terrain-asset-plan.test.ts src/legacy/hybrid-terrain-resolver.test.ts src/map/map-view.test.ts`

- [ ] **Step 2: Run fresh browser and release checks**

Run: `npm.cmd exec playwright test tests/e2e/personal-map.spec.ts --project=chromium --project=firefox`

Run: `npm.cmd run lint && npm.cmd run release:check`

- [ ] **Step 3: Inspect generated evidence visually**

Open the default reconstruction, difference image, and target render at overview and cell-detail scale. Record visible seam, rotation, clipping, and contamination findings honestly.

- [ ] **Step 4: Write and commit the report**

```powershell
git add html/docs/reference-extraction-report.md
git commit -m "docs: report verified reference terrain coverage"
```

The report must distinguish evaluated shared UUID coverage (429/444) from accepted type coverage and accepted cell coverage.
