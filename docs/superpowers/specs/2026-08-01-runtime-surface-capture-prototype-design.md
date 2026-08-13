# Scrap Mechanic 1.0 Runtime Surface Capture Prototype Design

## Goal

Prove that a real Scrap Mechanic 1.0 Survival world can be captured from the
official game runtime as a continuous, north-up overhead map without using
TileEditor thumbnails, synthetic reference art, classification fills, or
stretched substitute images.

This prototype covers one reviewed 5-by-5 capture grid from the bundled
default save. It produces source screenshots, an auditable capture manifest,
and one stitched sample image. It does not replace the website basemap and it
does not yet capture the complete default surface.

## Why the runtime route

The current `sm_overview` repository reads world layout data and displays
pre-captured JPG assets. It does not render official `.tile` files itself. Its
predecessor, `sm_overview_ahk`, generated an overview by running Scrap Mechanic,
teleporting across the Survival world at a fixed height, taking overlapping
screenshots, and arranging them by capture coordinate.

The reviewed TileEditor route cannot reliably open the shipped Survival tile
paths required by the default save. The runtime route instead captures the
world after the official game has already generated and rendered it, so roads,
terrain, coastlines, vegetation, props, and buildings all come from the same
official scene.

## Scope

### Included

- An isolated writable Scrap Mechanic working copy below
  `F:\Scrap Mechanical`.
- A dedicated test save derived from the bundled default DB; no player save is
  used as a capture target.
- Development-mode and teleport/camera changes applied only to the working
  copy.
- One 5-by-5 sample grid selected to include roads, vegetation, shoreline, and
  at least one building or POI.
- Twenty-five raw screenshots plus retry screenshots when validation rejects a
  frame.
- Capture stability checks, a canonical manifest, overlap alignment, cropping,
  and one lossless stitched PNG.
- Read-only pre/post fingerprints of the Steam installation and player save
  roots.

### Excluded

- Complete default-surface capture.
- Grow Labs, digging island, mining center, underground stations, scrapyard,
  boss regions, or other fixed regions.
- A reusable UUID atlas for arbitrary uploaded saves.
- Website basemap replacement or new frontend controls.
- Editing the Steam-managed installation or any existing player save.
- Filling a failed capture with a TileEditor preview, legacy approximation,
  hand-made image, category color, or other placeholder.

## Safety boundary

The capture process may write only to explicitly created paths below
`F:\Scrap Mechanical`. It must not launch an executable from the Steam
installation and must not write to the Steam installation or existing
player-save directories.

Before any Lua patch or real capture, a capability probe must prove that the
working-copy game can use a capture-only user-data root below
`F:\Scrap Mechanical`. The proof must come from the launched process command
line plus game logs that identify the redirected save path. If the installed
game has no supported user-data redirection mechanism, the prototype stops;
copying the test DB into the player's normal save directory is not an allowed
fallback.

Before any game launch, the workflow records a sorted metadata fingerprint for
the Steam installation and existing save roots. It records them again after
capture. A mismatch blocks acceptance and the workflow reports the changed
paths without deleting, reverting, or overwriting user data.

The dedicated test save is backed up before every capture run. No capture run
uses a save whose identity is not recorded in the manifest.

## Architecture

### 1. Runtime preparation

A preparation tool validates the working-copy executable and required game
data, proves the capture-only user-data root, identifies the dedicated test
save inside that root, records source hashes, and applies a small reviewed
runtime-capture patch only inside the working copy. The patch enables a
deterministic teleport command and a capture camera with fixed position, yaw,
pitch, and height.

Preparation is idempotent: a second run either reports that the exact reviewed
patch is already present or stops on an unexpected file state. It never
blindly appends Lua code.

### 2. Capture job

The capture job is a canonical JSON document containing:

- capture-job format version;
- game executable version and SHA-256;
- test-save SHA-256 and non-private capture identity;
- 25 ordered grid points;
- world X/Y position for each point;
- camera height, pitch, yaw, FOV, and north direction;
- game time and weather requirements;
- expected window and crop dimensions;
- stabilization thresholds and retry limit;
- overlap size and output paths.

The selected grid uses a constant world-space step and constant camera
settings. North is the top edge of every accepted screenshot. The capture
window and crop rectangle are identical for all 25 points.

### 3. Runtime capture controller

The controller launches only the working-copy game, opens the dedicated test
save, fixes time progression and weather, hides the HUD, and applies the
capture camera. For each grid point it:

1. teleports to the exact X/Y/height;
2. waits for a minimum loading interval;
3. captures consecutive frames from the game window;
4. compares the gameplay crop until visual change falls below the configured
   threshold;
5. rejects frames containing black/loading areas, menus, chat, HUD, cursor, or
   the wrong dimensions;
6. writes the accepted lossless PNG and its evidence record;
7. retries the same coordinate up to the manifest limit before stopping the
   whole job.

The controller does not advance after an unaccepted coordinate. It keeps every
accepted original frame unchanged.

### 4. Stitching and alignment

The stitcher reads only a fully accepted capture manifest. It places frames by
their authoritative capture-grid coordinates, then estimates translation in
the declared overlap strips. Alignment may adjust X/Y translation within a
small bounded range. It may not rotate, rescale, perspective-warp, content-fill,
or replace any frame.

The stitcher records the calculated offset and overlap score for every
horizontal and vertical neighbor. Exposure normalization may apply one
documented global or per-frame scalar correction; it may not repaint local
terrain or conceal seams.

The final sample is a lossless PNG with north at the top. Raw screenshots and
the complete manifest remain available beside it for review.

## Data flow

```text
bundled default DB
        |
        v
dedicated test save in writable game copy
        |
        v
official Scrap Mechanic runtime + fixed capture camera
        |
        v
25 validated lossless screenshots + capture manifest
        |
        v
bounded overlap translation and cropping
        |
        v
one reviewed 5x5 stitched sample PNG
```

## Validation and failure handling

Each raw frame must satisfy all of the following:

- produced by the recorded working-copy `ScrapMechanic.exe` process;
- exact configured dimensions and gameplay crop;
- north-up orientation and the exact job camera parameters;
- no HUD, menu, chat, cursor, loading screen, or editor chrome;
- no fully black or transparent capture region;
- stable according to the consecutive-frame threshold;
- SHA-256 recorded before any stitching step.

The final sample must show continuous roads, a natural shoreline, and a whole
building/POI across neighboring frames. It must not contain upside-down tiles,
floating isometric thumbnails, stretched pixels, synthetic fills, or a missing
cell covered by another image.

If a frame cannot pass within the retry limit, the job stops and produces no
accepted stitched sample. If an overlap cannot be aligned inside the bounded
translation range, the stitcher stops and identifies the two source frames.
It does not hide the seam by stretching or cloning pixels.

## Testing strategy

Automated tests use synthetic images and fixture manifests to prove:

- canonical job ordering and stable hashes;
- rejection of wrong dimensions, black/loading frames, UI contamination, and
  unstable frame pairs;
- retry and stop behavior;
- overlap translation recovery for known offsets;
- refusal to rotate, scale, or synthesize missing content;
- deterministic stitched output from identical accepted inputs;
- source-root fingerprint mismatch reporting without destructive cleanup;
- refusal to continue when capture-only user-data redirection is unproven.

The real capability run is a manual-review gate. Reviewers inspect all 25 raw
frames, the seam evidence, and the stitched sample at native resolution. The
prototype passes only when the real sample meets the validation rules and both
protected-root fingerprints remain unchanged.

## Prototype outputs

All runtime artifacts remain outside the repository under an explicit capture
root such as:

```text
F:\Scrap Mechanical\runtime-captures\default-surface-prototype\
  capture-job.json
  capture-manifest.json
  raw\<row>_<column>.png
  evidence\<row>_<column>.json
  stitched\default-surface-5x5.png
  reports\capture-report.json
```

The repository contains only the preparation, validation, stitching, tests,
and documentation required to reproduce the run. The real screenshots are not
committed during this prototype.

## Acceptance gate and next phase

The prototype is accepted when:

1. all 25 coordinates have validated official-runtime screenshots;
2. the stitched PNG is north-up and visually continuous at native resolution;
3. roads, shoreline, vegetation, and a building/POI are visibly real and not
   substituted;
4. every transform is a recorded bounded translation/crop rather than a scale
   or content replacement;
5. the Steam installation and existing player-save fingerprints are unchanged.

After acceptance, a separate design will cover full default-surface capture,
map-tile pyramid generation, website integration, fixed regions, and the
reusable 1.0 UUID atlas needed for arbitrary uploaded saves.
