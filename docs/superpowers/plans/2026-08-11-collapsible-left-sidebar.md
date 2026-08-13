# Collapsible Left Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, accessible desktop control that collapses the Location Browser into a 40px rail and expands the map.

**Architecture:** `createAppShell` owns the collapsed preference and exposes it through a shell data attribute plus a dedicated button. Responsive CSS changes the desktop grid width and hides sidebar content while leaving the existing mobile drawer untouched.

**Tech Stack:** TypeScript 5.8, DOM APIs, CSS Grid, Vitest/jsdom, Vite, browser smoke testing.

## Global Constraints

- Apply the collapsible rail only at viewport widths of 760px and above.
- Preserve the existing mobile drawer behavior below 760px.
- Store only a boolean collapsed preference in localStorage; storage failures must be silent.
- Preserve search, filters, scroll state, selection, save import, and player-marker editor state.
- Dispatch a resize notification after each desktop toggle so Leaflet can recalculate.
- Do not modify map data or controller URL state.

---

### Task 1: Specify desktop sidebar behavior with failing tests

**Files:**
- Modify: `html/src/app/app-shell.test.ts`

**Interfaces:**
- Consumes: `createAppShell(root, callbacks)` and the existing viewport test stub.
- Produces: Tests for `[data-location-panel-toggle]`, `data-location-panel-collapsed`, localStorage key `sm-map:location-sidebar-collapsed:v1`, and resize notification.

- [ ] **Step 1: Add a default-state test**

Create a shell with desktop viewport and empty storage. Assert that the toggle exists, has text `‹`, `aria-expanded="true"`, `aria-controls="location-panel"`, and the shell attribute is `false`.

- [ ] **Step 2: Add toggle and persistence tests**

Click the unique `[data-location-panel-toggle]` button. Assert shell state `true`, button text `›`, `aria-expanded="false"`, location content is inert/hidden from accessibility, localStorage contains `true`, and one resize event fires. Click again and assert all values return to expanded.

- [ ] **Step 3: Add restoration and failure tests**

Seed storage with `true` and assert the shell starts collapsed. Mock localStorage access to throw and assert shell creation and toggling still work with expanded fallback.

- [ ] **Step 4: Add mobile-isolation and state-preservation tests**

Assert the desktop preference does not change mobile drawer `data-open`. Render sidebar content, toggle twice, and assert the original search element and value remain the same DOM node and value.

- [ ] **Step 5: Run the focused test and verify RED**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts`

Expected: FAIL because the desktop sidebar toggle and persisted shell state do not exist.

### Task 2: Implement shell state and accessible toggle

**Files:**
- Modify: `html/src/app/app-shell.ts`
- Test: `html/src/app/app-shell.test.ts`

**Interfaces:**
- Consumes: localStorage and `window.matchMedia("(max-width: 759px)")`.
- Produces: A button marked `data-location-panel-toggle` and a `.app-shell[data-location-panel-collapsed]` state contract for CSS.

- [ ] **Step 1: Add constants and defensive preference helpers**

Define the key `sm-map:location-sidebar-collapsed:v1`. A read returns `true` only for the exact stored string `"true"`; exceptions return `false`. A write catches and ignores storage exceptions.

- [ ] **Step 2: Add the rail toggle markup**

Insert a button inside `#location-panel` before the heading, and wrap the existing heading, mobile region selector, Location Browser, save entry, and mobile exit button in `<div class="location-panel__content">`:

```html
<button class="location-panel-toggle" type="button"
  data-location-panel-toggle aria-controls="location-panel"></button>
<div class="location-panel__content">…existing panel content…</div>
```

- [ ] **Step 3: Synchronize collapsed state**

Set `shell.dataset.locationPanelCollapsed`, toggle the location panel's collapsed class/state, set the button glyph and accessible name, set `aria-expanded`, and make the content container inert while collapsed. Do not make the entire aside inert because the restore button must remain interactive.

- [ ] **Step 4: Wire persistence, resize, and cleanup**

On click, invert the state only for the desktop behavior, persist it, and dispatch `new Event("resize")`. Register one listener and remove it in `destroy()`.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts`

Expected: PASS.

### Task 3: Add responsive rail layout and animation

**Files:**
- Modify: `html/src/styles/app.css`
- Test: `html/src/app/app-shell.test.ts`

**Interfaces:**
- Consumes: `data-location-panel-collapsed="true"` and `.location-panel-toggle`.
- Produces: A 40px desktop rail, expanded map column, and unchanged mobile drawer.

- [ ] **Step 1: Add base desktop transition styles**

Use a custom property for the location column width and transition the grid column plus panel content opacity/transform over 180ms. Position the toggle at the right side of the rail/panel with a 40px minimum hit target.

- [ ] **Step 2: Add collapsed desktop selectors**

At `min-width: 760px`, set `--location-panel-width: 40px` when collapsed and hide `.location-panel__content` using visibility, opacity, pointer-events, and inert state from TypeScript. Keep the toggle visible.

- [ ] **Step 3: Preserve responsive rules**

Update the 1100px desktop grid to use the custom property. Within the mobile media query, hide `.location-panel-toggle`, restore normal panel content visibility, and leave the drawer transform rules authoritative.

- [ ] **Step 4: Verify CSS and unit tests**

Run: `npm.cmd test -- --run src/app/app-shell.test.ts`

Run: `npm.cmd run lint`

Expected: PASS.

### Task 4: Regression and browser verification

**Files:**
- No intended source changes.

**Interfaces:**
- Consumes: Completed shell and CSS changes.
- Produces: Evidence that the feature works without map or sidebar regressions.

- [ ] **Step 1: Run application and map regression tests**

Run: `npm.cmd test -- --run src/app src/components src/map src/player-markers src/save`

Expected: PASS.

- [ ] **Step 2: Build production assets**

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 3: Verify in the local browser**

At `http://127.0.0.1:4173/?region=surface&z=-3&x=0&y=0`, record the map width, click the unique `Collapse location sidebar` button, and verify the left column is 40px, map width increases, the button becomes `Expand location sidebar`, and the terrain remains visible. Reload and verify the collapsed state persists; expand and reload again to leave the page expanded.

- [ ] **Step 4: Check console and working-tree scope**

Confirm no new browser errors, run `git diff --check`, and verify only `app-shell.ts`, `app-shell.test.ts`, and `app.css` contain implementation changes for this feature.
