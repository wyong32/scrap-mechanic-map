# Authentic Legacy-First Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authentic original orthographic images the only raster terrain source and safely downgrade all unverified 1.0 preview imagery to optional icons or fallback colors.

**Architecture:** Keep the existing legacy repository, UUID bridge, resolver, and Canvas renderer. Add explicit projection provenance to official atlas entries, gate terrain selection on that provenance, and let fallback visuals retain a small optional icon overlay.

**Tech Stack:** TypeScript 5.8, Vitest, Canvas 2D, Vite, Playwright

## Global Constraints

- Do not use 220x150 TileEditor previews as terrain.
- Do not use the 2020 `scrapmechanicmap` world as the 1.0 default.
- Preserve the bundled DB auto-load and uploaded-save workflow.
- Preserve user-controlled POI visibility and default-hidden overlay state.
- Do not modify or delete unrelated untracked files.

---

### Task 1: Gate official terrain by projection provenance

**Files:**
- Modify: `html/src/legacy/legacy-visual-types.ts`
- Modify: `html/src/legacy/legacy-asset-repository.ts`
- Modify: `html/src/legacy/hybrid-terrain-resolver.ts`
- Test: `html/src/legacy/hybrid-terrain-resolver.test.ts`
- Test: `html/src/legacy/legacy-asset-repository.test.ts`

**Interfaces:**
- Consumes: `OfficialTileAtlasEntry` manifest records.
- Produces: `projection?: "verified-orthographic" | "isometric-preview"` and resolver behavior that uses only the first value as terrain.

- [ ] Write a resolver test where an official `terrain` entry without verified projection resolves to fallback.
- [ ] Run the focused test and confirm it fails because the entry currently resolves as `one-dot-zero-tile`.
- [ ] Add and validate the projection field, and gate both single-cell and multi-cell official terrain resolution.
- [ ] Run focused resolver and repository tests and confirm they pass.

### Task 2: Keep optional POI icons small over fallback terrain

**Files:**
- Modify: `html/src/legacy/hybrid-terrain-resolver.ts`
- Modify: `html/src/map/legacy-terrain-renderer.ts`
- Test: `html/src/legacy/hybrid-terrain-resolver.test.ts`
- Test: `html/src/map/legacy-terrain-renderer.test.ts`

**Interfaces:**
- Consumes: fallback visual with `overlayAsset`.
- Produces: fallback color plus a 24-64px icon controlled by `showPoiIcons`.

- [ ] Write failing tests proving an isometric preview is attached only as an overlay and the renderer still paints fallback terrain.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Preserve the overlay in the resolver and change the renderer so fallback drawing does not skip icon handling.
- [ ] Run focused tests and confirm they pass.

### Task 3: Verify authentic legacy coverage and browser behavior

**Files:**
- Modify only if required by failing evidence: `html/tests/e2e/personal-map.spec.ts`, `html/tests/e2e/base-map.spec.ts`

**Interfaces:**
- Consumes: bundled DB, legacy manifest, UUID bridge, projection-gated resolver.
- Produces: a refresh-stable authentic-first surface map with clean fallback cells.

- [ ] Run the complete Vitest suite.
- [ ] Run `npm run build`.
- [ ] Start the local preview and run the relevant Playwright tests.
- [ ] Inspect the bundled map at overview and close zoom for large tilted thumbnails, duplicated fragments, black blocks, and auto-load failures.
- [ ] Record remaining missing UUID counts as content gaps, not rendering defects.

