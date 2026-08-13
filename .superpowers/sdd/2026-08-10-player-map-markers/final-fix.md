# Player Map Markers Final Fix

Date: 2026-08-10
Starting HEAD: `03ec0f1`

## Resolved findings

- Stopped clicks from the complete map-controls overlay before they reach the Leaflet placement surface. The browser regression exercises Zoom In, Reset View, and the Player Markers layer while placement remains active.
- Added an independent `selectedPlayerMarkerId` view state to location-browser rendering. Player-marker cards now expose `aria-current="true"`, and selection stays synchronized across sidebar cards, map markers, and details for map- and sidebar-originated selection.
- Removed the remaining committed Chinese document, startup-error, official-marker, backdrop alternative, and atlas-error copy. Added a focused English accessibility guard for those surfaces.
- Tightened persisted marker validation to require non-empty IDs/scope/region and canonical ISO timestamps. Malformed records are ignored with the existing warning.
- Centralized placement cleanup so marker selection and map/region/save transitions clear only an active placement announcement and cannot leave stale status text behind.
- Moved `Storage.getItem` inside the store's failure boundary and added a safe browser-store fallback when the `window.localStorage` getter itself throws.
- Added regression coverage confirming scope fingerprints include offsets/rotation and direct loads return fresh nested positions; existing production behavior already satisfied both checks.

## TDD evidence

The focused regressions failed before production changes:

- app-shell control propagation: 1 failed
- location-browser selected player card: 1 failed
- controller selection/status/storage fallback: 3 failed
- store timestamp/read failure: 2 failed (deep clone passed)
- clean `03ec0f1` English guard: 3 failed

After the fixes:

- `npm.cmd test -- --run src/app/app-shell.test.ts src/components/location-browser.test.ts src/player-markers/player-marker-store.test.ts src/player-markers/player-marker-scope.test.ts src/app/app-controller.test.ts src/app/english-map-accessibility.test.ts`
  - PASS: 6 files, 96 tests
- `npm.cmd run test:e2e -- tests/e2e/player-markers.spec.ts`
  - PASS: Chromium and Firefox, 2 tests
- `npm.cmd run build`
  - PASS: TypeScript and Vite production build

## Full-suite note

`npm.cmd test` completed with 87 files / 763 tests passing and three unrelated failures already present in the dirty capture/tooling workspace:

- two `tools/authentic-map/default-surface-job.test.ts` failures because the default surface capture inventory is empty;
- one `tools/runtime-capture/runtime-probe.test.ts` failure because a runtime-probe lock reports another probe already running.

All marker, English, map-view, app-shell, and controller suites passed in that run. No player-marker review finding remains unresolved.
