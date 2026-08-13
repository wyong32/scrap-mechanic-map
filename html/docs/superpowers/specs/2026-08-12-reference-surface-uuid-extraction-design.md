# Reference Surface UUID Extraction Design

## Goal

Reuse the authentic default Scrap Mechanic 1.0 surface image to provide qualified terrain imagery for the UUIDs shared by the checked-in default save and a player save such as `test.db`.

The first target is the measured intersection between the two saves: 429 shared UUIDs out of the 444 UUIDs in `test.db` (96.62% type coverage). A shared UUID is not automatically publishable: every extracted image must pass reconstruction quality checks before it can contribute to cell coverage.

## Verified Inputs

- `public/assets/reference-surface-1.0.webp`: 10,775 x 8,480 authentic default surface image.
- Historical extraction input (no longer public or tracked): the inspected save
  contained 12,288 cells and 442 unique UUIDs. To reproduce locally, pass
  `--default-save <save.db>` or place a developer-owned file at the ignored
  `local-assets/default-save.db`; no save DB is published with GitHub/Vercel.
- `public/data/generated/reference-world.json`: world bounds `x=-72..71`, `y=-56..55` (144 x 112 cells).
- Player `test.db`: 12,288 cells and 444 unique UUIDs.
- Measured default/test intersection: 429 UUIDs; 13 default-only; 15 test-only.

The reference image is not an integer number of pixels per cell. Extraction therefore uses fractional world-to-image coordinates instead of repeatedly rounding a fixed cell size.

## Architecture

### 1. Coordinate calibration

Create a deterministic transform from world-cell edges to source-image pixel edges:

- normalize a cell edge against the full 144 x 112 world bounds;
- multiply normalized coordinates by the exact source width and height;
- round only the final crop edge;
- preserve orientation explicitly and test all supported axis/flip candidates against the default world.

Calibration produces a versioned manifest containing source dimensions, world bounds, chosen orientation, and a hash of the source image and reference world.

### 2. Candidate extraction

For every occurrence in the default world, extract a candidate keyed by:

- terrain UUID;
- recorded quarter-turn rotation;
- cell span and offsets;
- source coordinate.

Candidates retain provenance. The pipeline never silently treats a crop as a verified reusable tile.

### 3. Candidate selection

For each `UUID + rotation` group:

- compare repeated occurrences at a normalized resolution;
- score edge agreement and interior similarity;
- reject candidates dominated by neighboring objects, hard edge discontinuities, or inconsistent samples;
- choose a medoid candidate from the most mutually consistent cluster;
- synthesize a missing rotation from a verified rotation only when the tile footprint permits an exact quarter-turn.

No averaging is used for the published image because it would blur real terrain detail.

### 4. Reconstruction quality gate

Reassemble the default world from selected candidates and compare it with the authentic source image.

The report records:

- accepted and rejected UUID/rotation groups;
- accepted cell count and true cell coverage;
- seam error at shared edges;
- reconstruction difference score;
- source coordinates for every selected candidate.

A candidate is published only if it passes both its group-consistency threshold and the reconstruction threshold. Failed cells remain visibly unavailable.

### 5. Player-save rendering

Build a reviewed atlas from accepted candidates and feed it through the existing official terrain repository. Render `test.db` using its own cell coordinates and rotations. The UI reports separately:

- shared UUID type coverage;
- qualified UUID/rotation coverage;
- qualified cell coverage;
- missing cell count.

The 15 `test.db`-only UUIDs remain missing until separately captured or otherwise verified.

## Outputs

Local generation outputs:

- calibration manifest;
- candidate crops and provenance manifest;
- accepted atlas pages and runtime manifest;
- default reconstruction image;
- reconstruction difference image;
- `test.db` comparison render and coverage report.

Only accepted atlas pages and the minimal runtime manifest are candidates for the public package. Raw candidates, diagnostics, and rejected images stay under ignored local tooling storage.

## Failure Handling

- Abort if source image dimensions, world bounds, or content hashes differ from the calibrated inputs.
- Abort if a UUID occurrence references invalid offsets or an unsupported footprint.
- Reject an individual candidate rather than filling it with a visually similar UUID.
- Never count catalog recognition as image coverage.
- Preserve previously generated artifacts until a complete new run passes validation.

## Testing and Acceptance

The implementation follows test-first development.

1. Unit tests prove fractional edge mapping covers the source exactly without accumulated gaps or overlaps.
2. Orientation tests select the expected world/image transform using known landmarks and reconstruction evidence.
3. Candidate tests prove deterministic grouping, medoid selection, rejection, and safe rotation.
4. Reconstruction tests verify seam and difference calculations and fail closed above thresholds.
5. Integration tests generate a small fixture atlas and render a differently arranged save.
6. The real run must produce the default reconstruction, difference image, `test.db` render, and an honest coverage report before runtime wiring is changed.

Success for this phase means the pipeline evaluates all 429 shared UUIDs and publishes only those that pass. It does not promise 96.62% qualified cell coverage before the image-quality gate is measured.
