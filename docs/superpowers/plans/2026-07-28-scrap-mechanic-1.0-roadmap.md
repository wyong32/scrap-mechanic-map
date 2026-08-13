# Scrap Mechanic 1.0 Interactive Map Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap plan-by-plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved dual-mode Scrap Mechanic 1.0 interactive map as four independently testable releases.

**Architecture:** The existing `html/` application is upgraded in place to a Vite + TypeScript + Leaflet static app. Build-time tools extract non-personal 1.0 game data, while a browser Worker reads a user-selected SQLite save and emits the same normalized map model consumed by the base map.

**Tech Stack:** Vite, TypeScript, Leaflet with `L.CRS.Simple`, Vitest, Playwright, sql.js, lz4js, Canvas, Web Workers, Node.js extraction scripts.

## Global Constraints

- Target Scrap Mechanic version is 1.0 / Drilling Thunder; the verified save format is `savegameversion = 28`.
- Production output must be static files and must not require an application server.
- All runtime dependencies must be bundled locally; no CDN requests are allowed.
- Save files are read-only, remain in browser memory, and are never uploaded, written back, logged, or persisted by default.
- Save files larger than 256 MB must be rejected before SQLite initialization.
- The base map, fixed regions, search, filters, location list, and details remain usable without a save.
- URL state may contain region, center, zoom, category/layer filters, search text, and selected location; it must never contain save content or personal progress.
- The existing The1Killer attribution, repository link, CC BY-NC-SA 4.0 notice, and Axolot Games non-affiliation notice must remain visible in the repository and application.

---

## Delivery Sequence

- [ ] **Phase 1: Application foundation and base interaction**

  Execute `2026-07-28-sm-map-phase-1-app-foundation.md`.

  Exit gate: `npm run build`, `npm test`, and the Playwright base-map journey pass; the page has the approved desktop/mobile layout, region navigation, search, filters, location list, details, and an inert local-save entry point.

- [ ] **Phase 2: Scrap Mechanic 1.0 content pipeline**

  Execute `2026-07-28-sm-map-phase-2-game-data.md`.

  Exit gate: a deterministic command reads `G:\共享文件\Scrap Mechanic`, emits versioned reference/fixed-region data plus an atlas manifest, and fails when a supported region references a missing tile UUID.

- [ ] **Phase 3: Browser-local save decoding and personalized terrain**

  Execute `2026-07-28-sm-map-phase-3-save-map.md`.

  Exit gate: a valid 1.0 `.db` is parsed in a Worker, normalized, rendered from UUID/offset/rotation data, and swapped into the existing surface view without losing the base mode on error.

- [ ] **Phase 4: Locations, progress, hardening, and release**

  Execute `2026-07-28-sm-map-phase-4-release.md`.

  Exit gate: save-derived locations and reliable progress overlay the map, privacy/performance/accessibility checks pass, browser screenshots are reviewed, and the README documents local use and data refresh.

## Cross-Phase Verification

- [ ] Run `npm ci`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` from `html/`.
- [ ] Run `npm run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"` and confirm it reports zero missing UUIDs for supported regions.
- [ ] Open the production build with network disabled and confirm the base map remains usable.
- [ ] Select the local 1.0 fixture save and confirm the mode badge shows save version 28, the seed, and personalized terrain.
- [ ] Exit personalized mode and confirm Worker, Canvas, object URLs, and in-memory save data are released.
- [ ] Confirm `git grep -I` does not find the private save filename, Steam user ID, save bytes, or absolute save path in tracked files.

## Specification Coverage

| Approved requirement | Owning plan |
|---|---|
| Shared base/personal mode shell | Phase 1 controller; Phase 3 mode switch |
| Surface and all fixed/generated region groups | Phase 1 catalog; Phase 2 world extraction |
| Search, category/layer filters, count, list, details | Phase 1 UI; Phase 4 provenance details |
| Mechanical workshop desktop/mobile layout | Phase 1 responsive shell |
| Local `.db` selection and drag/drop | Phase 1 save entry; Phase 3 validation |
| SQLite, ScriptData, LZ4, Lua value decoding | Phase 3 Worker pipeline |
| Exact UUID/offset/rotation/bounds/seed terrain | Phase 3 normalization and Canvas renderer |
| Fixed places, POIs, connections, and conservative progress | Phase 4 location/progress resolvers |
| 1.0 game-source extraction and fixed `.world` conversion | Phase 2 data pipeline |
| Complete atlas and missing-UUID build failure | Phase 2 atlas verifier |
| URL state without save data | Phase 1 URL state; Phase 4 privacy suite |
| Recoverable errors with base map retained | Phase 3 controller and browser tests |
| 256 MB limit, Worker execution, lazy images, cleanup | Phase 3 validation/rendering; Phase 4 lifecycle/performance |
| Keyboard, screen reader, contrast, reduced motion | Phase 4 accessibility suite |
| Chromium, Firefox, Edge, desktop/mobile visual checks | Phase 4 release verification |
| Local start, save path, privacy, version, refresh documentation | Phase 4 documentation |
| Attribution, license, and non-affiliation | Phase 4 documentation and release UI |
