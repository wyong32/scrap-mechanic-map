# Explicit Location Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add submit/reset search controls and make Mechanic Station the default visible location type.

**Architecture:** `location-browser` owns an unsaved input draft and emits submit/reset callbacks. `app-shell` forwards those callbacks, while `app-controller` applies query state and restores the Mechanic Station-only default. The existing map-layer tree remains the source of manual location-type changes.

**Tech Stack:** TypeScript, DOM APIs, Vitest/JSDOM, Vite CSS.

## Global Constraints

- Typing must never change the active query.
- Submit occurs only through `SEARCH` or Enter.
- Reset restores an empty query and `fixed:mechanic-station` only.
- Location directory disclosure remains collapsed by default.

---

### Task 1: Explicit search component

**Files:**
- Modify: `src/components/location-browser.ts`
- Modify: `src/components/location-browser.test.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: `LocationBrowserCallbacks.onQueryChange(query: string)`
- Produces: `LocationBrowserCallbacks.onSearchReset(): void`

- [ ] Add failing component tests proving input does not emit, button and Enter submit, reset emits and clears, and the visible label is removed.
- [ ] Run the focused test and confirm the live-input implementation fails those assertions.
- [ ] Replace the input listener with form submit and reset button handlers, retaining a visually hidden label.
- [ ] Add the compact three-control row styling.
- [ ] Run the focused component test to green.

### Task 2: Mechanic Station default and reset

**Files:**
- Modify: `src/app/app-shell.ts`
- Modify: `src/app/app-controller.ts`
- Modify: `src/app/app-shell.test.ts`
- Modify: `src/app/app-controller.test.ts`

**Interfaces:**
- Consumes: `onSearchReset()` from the browser component.
- Produces: controller state `{ query: "", locationTypeIds: ["fixed:mechanic-station"] }` when no explicit type query exists and after reset.

- [ ] Add failing shell forwarding and controller initial/reset tests.
- [ ] Run focused tests and confirm current default/reset behavior fails.
- [ ] Forward reset through the shell and implement the controller default/reset transitions.
- [ ] Run focused tests to green.

### Task 3: Integration verification

**Files:**
- Verify all files above.

- [ ] Run location-browser, app-shell, app-controller, map-layer-tree tests.
- [ ] Run lint and production build.
- [ ] Rebuild the local preview and verify typing, submit, reset, default marker, and collapsed directory in the browser.
- [ ] Commit the implementation.
