# Final compatibility fix report

Date: 2026-07-29

Baseline: `ccd4cc5b6a44ecb5d7406187450dfa777f8d38a0`

Scope: one consolidated fix wave for the nine Important findings and four
Minor findings from the final whole-branch review.

## Outcome

All nine Important findings are fixed with regression coverage. All four Minor
findings were adjudicated and resolved. The intentionally parked null-Canvas
constructor rollback was not changed.

## Important findings

### 1. Multiple official aliases selected inconsistently

Pre-fix RED tests showed three same-status alias groups selecting an alias with
no usable original visual at runtime while aggregate verification counted a
different alias as covered.

The fix adds one deterministic alias selector shared by runtime loading and
coverage verification. Official status remains authoritative; actual tile/POI
asset availability resolves same-status aliases, followed by numeric ID and
explicit code-point ordering. Runtime and release coverage now select the same
candidate and the three regressions render their available originals.

### 2. Crash-site coordinate images were incorrectly treated as multi-cell POIs

Pre-fix RED tests showed each of four coordinate images expanding over multiple
cells and suppressing neighboring terrain.

The rules are now a discriminated union. Those four records are span-one
coordinate tile overrides, while the actual multi-cell crash-site record
retains its original semantics. Resolver tests cover the override cell,
overlap, and unaffected neighbors.

### 3. Rotated multi-cell POIs missed destination corrections

Pre-fix RED tests failed the authoritative final bounds for rotations 1, 2,
and 3 across multi-cell spans.

The renderer now applies the original rotation-dependent destination offsets
before culling and drawing. Rotation degrees and offsets live in one shared
module used by legacy rendering and atlas packing. Unit tests cover every
non-zero rotation across the reviewed spans; browser tests compare asymmetric
source pixels and final canvas bounds exactly, without tolerance.

### 4. Missing optional atlas was reported as a runtime failure

Pre-fix RED tests showed missing-manifest responses producing a persistent
atlas error and successful fallback/legacy commits failing to clear stale
error state.

Atlas availability is now an explicit cached capability. A missing manifest,
including a development server's HTML shell response, activates the honest
overview fallback and signals ready. Malformed JSON, invalid structure, and
corrupt atlas data still fail closed. Reference/save surfaces use the offline
overview deliberately, fixed worlds with actual legacy visuals use the legacy
resolver, and fixed worlds without one retain the optional atlas plus visible
fallback behavior. A transient legacy staging error is cleared only after a
successful redraw: prepared restage defers readiness until commit, while a
successful refresh of the prior committed frame clears the candidate's stale
error exactly once.

### 5. Personal mode disabled legacy resolution for fixed regions

Pre-fix RED tests showed that navigating from a personal save to a fixed region
never prepared its available original visuals.

Policy is now based on the current world's source and resolvable visuals.
Personal state replaces only the personal surface; fixed regions use the same
resolver whether or not a save was loaded earlier. Chromium and Firefox cover
the personal-to-fixed transition with an integrity-valid fixed-world bundle.
After an awaited map commit, the controller also rechecks destruction,
generation, and exact selection ownership before publishing personal state, so
an older continuation cannot overwrite newer navigation.

### 6. Failed or stale prepared commits leaked the candidate viewport

Pre-fix RED tests showed a failed/stale restage moving the live center, zoom,
and URL while leaving the old layer committed.

Prepared commit is now transactional. Viewport notifications are suppressed
during staging; the prior center, zoom, layer, and visible generation are
captured; failure/staleness removes the candidate, restores the prior viewport,
and awaits redraw of the still-current committed frame. Success publishes one
viewport update. Browser coverage injects a distant restage failure and asserts
exact prior URL and canvas equality as well as the absence of a prepared layer.
If two callers race the same prepared token, a stale sibling can no longer hide
or mutate the layer already committed by the winner.

### 7. Native atlas geometry used one map unit per terrain cell

Pre-fix RED coverage using real `CRS.Simple` geometry drew the wrong size and
viewport intersection.

Atlas visibility, placement, and destination dimensions now use the shared
cell-to-map transform and the 64-unit terrain-cell contract. Tests exercise
real map bounds rather than zero-valued geometry mocks.

### 8. Atlas pack rotations 1 and 3 were reversed

Pre-fix RED tests using an asymmetric four-quadrant image showed the two
rotations reversed.

The packer now consumes the same authoritative rotation mapping as the legacy
renderer. Pixel-level packing tests verify all four rotations.

### 9. Release verification accepted incomplete or unsafe atlas inputs

Pre-fix RED tests demonstrated partial variants being reported as complete,
invalid native/low/page geometry passing, altered generated bundles passing,
and unsafe generated-world paths being accepted.

Verification now:

- requires every canonical offset/rotation key before a UUID is rendered;
- computes legacy coverage through the same runtime resolver and certifies a
  UUID only when every observed world-cell occurrence resolves to an actual
  asset, including complete compatible POI rectangles;
- validates square logical geometry, native/low coordinate relationships,
  page roles, page dimensions, non-overlap, safe page names, hashes, bytes,
  and decoded image dimensions;
- rejects unused, mixed-role, missing, or corrupt pages;
- validates build inventory entries and safe relative paths;
- verifies build-info and world self-hashes, cross-hashes, and normalized
  portable byte counts before loading generated worlds.

Mutation tests cover each fail-closed boundary.

## Minor findings

1. **Portable tile-catalog bytes — fixed.** Runtime validation now compares
   normalized UTF-8 byte length with the build inventory. Trailing-byte and
   CRLF cases are covered.
2. **Locale-independent ordering — fixed.** Build and runtime use one explicit
   code-point comparator; generated manifests were regenerated.
3. **Atlas workflow documentation — fixed.** The documentation now separates
   source verification from optional atlas intake/packing and uses generic,
   portable placeholders.
4. **Unapproved duplicate numeric asset — removed.** The file had no entry in
   the authoritative original runtime whitelist, no bridge/source evidence,
   and duplicated an approved image. The exact reviewed whitelist contains 297
   numeric assets. The tracked duplicate was removed, generated data was
   rebuilt, and count-only tests were replaced with an exact source-derived set
   comparison.

## TDD trace

Regression tests were introduced and observed failing before their production
fixes:

- Wave A: alias disagreement, coordinate-override expansion, and all reviewed
  POI destination-offset cases.
- Wave B: optional-atlas absence/error readiness, current-world resolver
  policy, and failed/stale viewport atomicity.
- Wave C: real-coordinate atlas geometry, asymmetric pack rotation, partial
  variant coverage, invalid atlas geometry/page mutations, generated-world
  path/hash/byte mutations, and tile-catalog portable bytes.
- Minor ordering follow-up: a supplementary Unicode scalar initially sorted by
  UTF-16 units; the focused RED regression now passes with explicit code-point
  iteration.
- Independent-review follow-up: five focused assertions were observed RED for
  transient legacy readiness, committed rollback readiness, post-commit
  selection ownership, incomplete POI-only coverage, and duplicate prepared
  commit ownership. All five are GREEN; a positive/negative POI pair also
  proves that complete rectangles are accepted while any fallback occurrence
  keeps the UUID out of legacy-covered counts.

Each wave was brought to green before the next wave. The final focused browser
set passed 4/4 in Chromium and 4/4 in Firefox, covering reference fallback,
personal-to-fixed legacy resolution, atomic distant rollback, and exact rotated
POI pixels.

## Final validation

- Full unit suite: 42 files passed; 372 tests passed; 3 existing
  environment-dependent tests skipped.
- Full E2E: 210/210 passed across Chromium and Firefox.
- Type-check/lint: passed.
- Production build: passed.
- Dependency audit at high severity: 0 vulnerabilities.
- Data regeneration: passed and byte-stable.
- Legacy aggregate: 297 reviewed asset IDs, 406 official mappings, 68 covered
  UUIDs, 0 complete optional-atlas rendered UUIDs, and 28 honest fallbacks.
- Generated/legacy source verification: passed.
- Diff whitespace check: passed.
- Privacy: the complete two-browser privacy suite passed; preloaded legacy
  requests equal the generated manifest's exact URL inventory; generated data
  and this report contain no private source paths, save names, seeds, or UUID
  lists.
- Independent final re-review: no remaining Critical, Important, or Minor
  issue; merge-ready from code-review perspective.

The fixed production build is served from the current worktree at
`127.0.0.1:4173` after final validation.
