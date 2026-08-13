# Progressive Release Assets Design

## Objective

Prepare the Scrap Mechanic map for a GitHub-connected Vercel Pro deployment without removing the local capture and map-generation capability. The published application keeps the authentic default 1.0 surface map, save import, personalized terrain, location filtering, and player markers, while avoiding the current all-at-once download of the legacy and official terrain libraries.

## Current Baseline

- The full `F:\Scrap Mechanical` workspace is about 28 GB.
- About 19.5 GB is a local TileEditor working copy, 6.2 GB is runtime capture output, and 1.27 GB is local capture tooling.
- The active web worktree is about 0.38 GB including dependencies and build output.
- Git currently tracks about 115 MB. The current Vite output is about 126 MB.
- Published runtime assets consist primarily of:
  - 83.33 MB of 334 legacy open-source terrain and POI images;
  - 18.72 MB of official 1.0 atlas pages;
  - 14.92 MB of the authentic default 1.0 surface map;
  - about 8 MB of generated runtime data.
- The application currently starts requests for every legacy image and every official atlas page during startup. This makes the initial network workload exceed 100 MB even when the player only views the default map.
- Vercel Pro allows up to 1 GB of static file uploads, so the deployment size is acceptable, but the startup behavior is not.

## Release Boundary

The GitHub/Vercel release contains only the web application source, build configuration, generated runtime metadata, the authentic default map, and runtime image libraries required by the published features.

The following remain local and must not be uploaded:

- TileEditor and game working copies;
- runtime captures, raw screenshots, capture batches, and browser/user-data directories;
- offline-render experiments and rejected generated images;
- temporary probes, logs, caches, test output, and build output;
- editable image sources such as PDN files when a runtime WebP/PNG/JPEG exists;
- installed dependencies.

Capture and generation source code that is small and required to regenerate published artifacts may remain tracked. Large external programs and generated working data remain outside the release repository.

## Runtime Architecture

### Lightweight base application

Startup loads only:

- the Vite application bundle and CSS;
- generated region, location, tile-catalog, and manifest metadata needed for navigation;
- the authentic `reference-surface-1.0.webp` when the surface map is shown;
- the WebAssembly database parser only when needed by its existing code path or through a safe lazy import where feasible.

The initial transfer budget is 25 MB or less on an uncached load of the default surface map. The JavaScript and CSS budget remains below 1 MB compressed, excluding the SQL WebAssembly file and map imagery.

### Optional personalized-map asset library

The 83.33 MB legacy library and 18.72 MB official atlas remain deployable static assets but are not fetched at application startup.

The repository first loads and validates metadata. After a player selects a save, it:

1. parses the save and materializes its terrain cells;
2. derives the unique UUIDs and legacy/POI keys required by that world;
3. resolves legacy assets first for the existing high-quality exact matches;
4. resolves official 1.0 atlas entries for UUIDs without an accepted legacy visual;
5. fetches only the distinct legacy image files and atlas pages required by the save;
6. verifies fetched bytes against the existing manifest hashes before constructing the terrain frame;
7. caches successful browser requests through normal HTTP caching so subsequent imports do not re-download unchanged assets.

The default reference map never waits for this optional library and never upgrades itself to a legacy-tile rendering in the background.

### Repository interfaces

The terrain asset repository is split into two responsibilities:

- a metadata index that loads the small canonical manifests and determines which assets a set of cells needs;
- an asset loader that fetches, hashes, decodes, and memoizes only those selected assets/pages.

The map controller requests a prepared asset bundle after save parsing. The terrain resolver continues to receive a complete immutable bundle for the selected save, so its image-priority and rotation rules remain isolated from network behavior.

Concurrent requests for the same URL share one promise. A new save selection cancels or ignores stale preparation work using the existing generation checks. Object URLs and decoded images are released when the repository or application is destroyed.

## Failure Behavior

- The authentic default map must remain usable if optional manifests or terrain images fail.
- A failed optional asset reports a concise personalized-map warning and falls back to the official atlas or the save overview where available.
- Hash mismatches remain hard failures for the affected asset; unverified bytes are never rendered.
- Import cancellation and rapid save replacement must not commit an older terrain frame.
- Blocked local storage or cache APIs must not prevent the map from loading.

## Git and Build Protection

- Extend ignore rules for every local-only capture, editor, cache, result, and build directory in the 28 GB workspace.
- Stop tracking editable or experimental binary sources that have runtime equivalents, without deleting the local copies.
- Remove duplicated runtime data only after proving the application and generation pipeline reference the canonical copy.
- Add a release audit command that reports tracked bytes, build bytes, file count, largest files, and initial-entry assets.
- Fail the release audit when a single file exceeds the configured ceiling, a forbidden local directory is tracked, or the initial-load budget is exceeded.
- Configure Vercel with `html` as the project root, `npm run build` as the build command, and `dist` as the output directory. Long-lived immutable cache headers are used for content-addressed build assets and versioned terrain assets where safe.

## Verification

Automated coverage must prove:

- base startup does not request legacy images or official atlas pages;
- save import requests only assets/pages needed by the supplied UUID set;
- duplicate UUIDs and shared atlas pages produce one request each;
- legacy-first and official-fallback resolution remains unchanged;
- missing or corrupt optional assets follow the documented fallback behavior;
- stale save imports cannot commit after a replacement selection;
- the existing default map, location names, filters, player markers, and save parsing tests still pass;
- production build and release audit satisfy the size budgets.

Browser verification must cover a cold default-map load, a save import that uses both legacy and official assets, a repeated import demonstrating cache reuse, and the existing desktop/mobile interaction flows.

## Expected Result

- Local capture capability and approximately 27 GB of source material remain intact.
- GitHub contains only the maintainable web source and required runtime assets.
- Vercel output remains approximately 110-126 MB on Pro unless later moved to external object storage.
- The default-map cold-load transfer falls from more than 100 MB to approximately 18-25 MB.
- Personalized maps retain the existing legacy-image quality and official 1.0 fallback coverage while downloading only what each save needs.

## Out of Scope

- deleting the local TileEditor, captures, or map-generation workspace;
- moving terrain assets to Vercel Blob, R2, or another external CDN in this phase;
- changing map imagery, UUID mapping, terrain rotation, or POI classification rules;
- deploying to production before the release audit and browser acceptance checks pass;
- pushing to the current upstream remote without the user's GitHub repository destination being confirmed.
