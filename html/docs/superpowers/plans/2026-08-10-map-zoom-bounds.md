# Map Zoom Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict every map to zoom levels `-5` through `0`, using the current opening size as the zoom-out floor and the new reference image's useful native detail as the zoom-in ceiling.

**Architecture:** Keep one shared pair of zoom constants in `map-model.ts`. Leaflet, the shell buttons, URL parsing, and URL serialization continue consuming those constants; only URL parsing needs new clamping behavior. Existing map rendering and viewport synchronization remain unchanged.

**Tech Stack:** TypeScript, Leaflet, Vitest, Vite

## Global Constraints

- Minimum zoom is exactly `-5`.
- Maximum zoom is exactly `0`.
- URL zooms below or above the range clamp to the nearest boundary.
- Existing centers, layers, labels, markers, personal saves, and fixed regions must not change.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Enforce shared zoom limits

**Files:**
- Modify: `src/domain/map-model.ts:6-7`
- Modify: `src/domain/ui-state.ts:52-65`
- Test: `src/domain/ui-state.test.ts`
- Test: `src/app/app-shell.test.ts`
- Test: `src/map/map-view.test.ts`
- Test: `src/app/app-controller.test.ts`

**Interfaces:**
- Consumes: `MIN_MAP_ZOOM` and `MAX_MAP_ZOOM` from `src/domain/map-model.ts`.
- Produces: one shared valid zoom interval `[-5, 0]` for URL state, Leaflet, and map controls.

- [ ] **Step 1: Write failing URL-boundary tests**

Replace the out-of-range URL test with explicit lower and upper clamping assertions:

```ts
it("clamps URL zoom to the supported map range", () => {
  expect(parseUiState("?z=-6").zoom).toBe(-5);
  expect(parseUiState("?z=1").zoom).toBe(0);
  expect(parseUiState("?z=not-a-number").zoom).toBe(0);
});
```

- [ ] **Step 2: Write failing control and Leaflet boundary tests**

Update the shell test so Zoom Out is disabled at `-5` and Zoom In is disabled at `0`. Update the map-view range test to verify requested zooms below and above the interval resolve to `-5` and `0`:

```ts
view.setViewport({ center: { x: 0, y: 0 }, zoom: -6 });
expect(view.getViewport().zoom).toBe(-5);
view.setViewport({ center: { x: 0, y: 0 }, zoom: 1 });
expect(view.getViewport().zoom).toBe(0);
```

- [ ] **Step 3: Write a failing controller saturation test**

Start at `z=-5`, click Zoom Out, and assert the URL/readout stay at `-5`; start at `z=0`, click Zoom In, and assert they stay at `0`. Also assert the corresponding button is disabled at each boundary.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd test -- --run src/domain/ui-state.test.ts src/app/app-shell.test.ts src/map/map-view.test.ts src/app/app-controller.test.ts
```

Expected: failures show the existing `-6..6` bounds and non-clamping URL parser.

- [ ] **Step 5: Implement the shared constants and URL clamp**

Change the constants:

```ts
export const MIN_MAP_ZOOM = -5;
export const MAX_MAP_ZOOM = 0;
```

Change `readZoom` so malformed values still use the default while finite integer values clamp:

```ts
function readZoom(value: string | null): number | undefined {
  const zoom = readFiniteNumber(value);
  if (zoom === undefined || !Number.isInteger(zoom)) return undefined;
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, zoom));
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 4 command.

Expected: all selected test files pass with zero failures.

- [ ] **Step 7: Run production verification**

Run:

```powershell
npm.cmd run build
git diff --check
```

Expected: TypeScript and Vite exit `0`; `git diff --check` reports no whitespace errors.

- [ ] **Step 8: Verify in the local preview**

At `http://127.0.0.1:4173/`, confirm the initial readout is `Zoom -5`, Zoom Out is disabled, repeated Zoom In stops at `Zoom 0`, and Zoom In is disabled there. Confirm the new 1.0 reference image remains visible and no old Atlas canvas becomes visible.

- [ ] **Step 9: Commit only the zoom-bound changes**

Stage only the exact zoom-related hunks, preserving unrelated working-tree changes:

```powershell
git add -p -- src/domain/map-model.ts src/domain/ui-state.ts src/domain/ui-state.test.ts src/app/app-shell.test.ts src/map/map-view.test.ts src/app/app-controller.test.ts
git commit -m "fix: bound map zoom to useful detail"
```
