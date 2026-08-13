# Task 4 report: Rotated ground and compact upright icon rendering

## Status

Implemented and committed Task 4. Official structure terrain remains in the
existing rotated canvas pass, while an optional compact POI icon is drawn in
screen coordinates after the terrain context is restored. AtlasLayer now
tracks icon visibility and restages the stored legacy frame when it changes.

## RED evidence

### Renderer

Command:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/legacy-terrain-renderer.test.ts --maxWorkers=1
```

Result: exit 1; 1 test file failed; 2 tests failed and 17 passed.

- `sizes POI icons from the smaller footprint dimension within compact bounds`
  failed with `poiIconScreenSize is not a function`.
- `draws rotated terrain before a centered upright POI icon` failed because
  the operation list ended at `restore`; the expected unrotated overlay
  `drawImage` was absent.
- The disabled-overlay assertion preserved the terrain draw and omitted the
  icon, but passed before implementation because overlays were not rendered
  at all. The two failures above proved the new renderer behavior was absent.

### AtlasLayer

Command:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/atlas-layer.test.ts --maxWorkers=1
```

The first run exposed an incomplete fixture expectation: initial legacy
staging also copies the committed overview canvas. The assertion was narrowed
to the real terrain and icon assets, retaining that existing side effect.

The corrected RED result was exit 1; 1 test file failed; 1 test failed and 31
passed. `restages a legacy frame when POI icon visibility changes` failed with
`layer.setPoiIconsVisible is not a function`, proving visibility state and the
restaging API were absent.

## Implementation

- Added exported `poiIconScreenSize(footprintWidth, footprintHeight)`.
- Implemented the exact rule
  `Math.round(Math.min(width, height) * 0.375)`, clamped to 24–64 pixels.
- Extended `drawLegacyTerrainFrame` with optional
  `{ showPoiIcons?: boolean }`.
- Preserved the existing save/translate/rotate/terrain-draw/restore pass.
- Added an overlay pass after `restore`, centered on the footprint in absolute
  screen coordinates, with no inherited or second rotation.
- Supported overlay assets with and without an atlas `sourceRect`.
- Made `showPoiIcons: false` skip only the overlay.
- Added default-true `poiIconsVisible` state to AtlasLayer.
- Added idempotent
  `setPoiIconsVisible(visible: boolean): Promise<void>`.
- Passed icon visibility into every legacy frame staging call and restaged the
  stored active/prepared frame when visibility changes.

## Tests and GREEN evidence

Fresh final commands:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/legacy-terrain-renderer.test.ts --maxWorkers=1
.\node_modules\.bin\vitest.cmd run src/map/atlas-layer.test.ts --maxWorkers=1
.\node_modules\.bin\tsc.cmd --noEmit
```

Results:

- Renderer: exit 0; 1 file passed; 19/19 tests passed.
- AtlasLayer: exit 0; 1 file passed; 32/32 tests passed.
- TypeScript: exit 0; no diagnostics.
- `git diff --check` and `git diff --cached --check`: exit 0.

## Self-review

- Exact formula and lower/upper clamp literals are covered independently.
- Rotation-2 operation ordering is asserted as:
  `save`, `translate`, `rotate(Math.PI)`, terrain draw, `restore`, icon draw.
- The icon destination is asserted as centered and 48×48 for a 128×128
  footprint.
- No second `rotate` can satisfy the exact operation assertion.
- Disabled rendering asserts the terrain pass remains byte-for-byte present
  while the icon draw is absent.
- AtlasLayer verifies initial/default icons, disabled restaging with terrain
  only, and re-enabled restaging with the overlay restored.
- The setter avoids unnecessary restaging when the requested state is already
  current and safely stores visibility while no drawable legacy frame exists.
- Only the four Task 4 files were staged and committed; unrelated dirty and
  untracked worktree files were preserved.

## Commit

`9ed5cb1 fix: render compact upright POI icons`

Committed files:

- `html/src/map/legacy-terrain-renderer.ts`
- `html/src/map/legacy-terrain-renderer.test.ts`
- `html/src/map/atlas-layer.ts`
- `html/src/map/atlas-layer.test.ts`

## Concerns

None for Task 4. The worktree still contains pre-existing unrelated modified
and untracked files, intentionally excluded from the commit.

## Review fix round 1

### Findings reproduced

Renderer culling was based only on the unrotated footprint rectangle. This
discarded two visible cases before either rendering pass:

- a 90°/270° rotated non-square terrain image whose swapped axis-aligned
  bounding box intersected the viewport;
- a centered icon clamped up to the 24px minimum whose rectangle intersected
  the viewport while its smaller terrain footprint did not.

The renderer RED command failed 2 of 21 tests. Both regressions observed zero
draws where the rotated terrain or clamped icon intersected the viewport.

`prepareLegacyFrame` aborted the prior render controller but retained
`legacyFrame` while awaiting overview preparation. A concurrent
`setPoiIconsVisible` call could therefore restage that old frame using the new
generation and copy stale terrain into the canvas being prepared.

The AtlasLayer RED command failed 1 of 33 tests. While a newer fallback
overview was deliberately paused at its yield boundary, the concurrent
visibility change redrew the old frame exactly once.

### Fixes

- Culling now checks the union of the rotated terrain AABB and the actual
  centered overlay rectangle.
- Quarter-turn rotations swap rectangular terrain width and height around the
  unchanged footprint center.
- Overlay culling reuses `poiIconScreenSize`, so the tested bounds exactly
  match the later destination rectangle and its 24–64px clamp.
- `prepareLegacyFrame` now aborts and clears the active controller and clears
  `legacyFrame` before its first await.
- The incoming frame is published only after its overview preparation
  completes, preventing a visibility restage from binding old content to the
  new generation.

### Regression coverage

- `draws a rotated rectangular terrain AABB that intersects the viewport`
- `draws a minimum-size centered POI icon that intersects the viewport`
- `does not redraw a stale legacy frame during a newer preparation`

Fresh final verification:

```powershell
.\node_modules\.bin\vitest.cmd run src/map/legacy-terrain-renderer.test.ts --maxWorkers=1
.\node_modules\.bin\vitest.cmd run src/map/atlas-layer.test.ts --maxWorkers=1
.\node_modules\.bin\tsc.cmd --noEmit
```

Results:

- Renderer: exit 0; 1 file passed; 21/21 tests passed.
- AtlasLayer: exit 0; 1 file passed; 33/33 tests passed.
- TypeScript: exit 0; no diagnostics.

### Review fix concerns

None. Unrelated worktree modifications and untracked files remain untouched.
