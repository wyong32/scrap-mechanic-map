# Location Name Disclosure Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Location Names disclosure button to the row end and make all first- and second-level branches collapsed by default.

**Architecture:** Keep disclosure state private to `createMapLayerTree`; change only its initial state and DOM row order. CSS turns expandable rows into full-width flex rows so labels occupy the available width and arrow buttons sit at the far right. Selection state remains independent and existing focus restoration continues to address controls by logical IDs.

**Tech Stack:** TypeScript, DOM APIs, CSS, Vitest/jsdom.

## Global Constraints

- The initial component state has `Location Names`, `Fixed & Story Locations`, and `Generated Locations` collapsed.
- Row order is checkbox, English label/count, then disclosure button at the far right.
- Disclosure activation never changes selected location type IDs.
- Hidden descendants are excluded from keyboard navigation.
- No Category Filters or POI data changes are included.

---

### Task 1: Collapsed Disclosure State and Row Order

**Files:**
- Modify: `src/components/map-layer-tree.ts`
- Modify: `src/components/map-layer-tree-final-review.test.ts`
- Modify: `src/components/map-layer-tree.test.ts`

**Interfaces:**
- Consumes: `createMapLayerTree(root, callbacks)` and its existing `render(input)` contract.
- Produces: the same `MapLayerTree` API with revised initial disclosure state and DOM order.

- [ ] **Step 1: Write failing component tests**

Assert that the initial master disclosure has `aria-expanded="false"`, the master children container is hidden, and both group child containers remain hidden after only the master branch is expanded. Assert that each row label precedes its disclosure button using `compareDocumentPosition`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm.cmd test -- --run src/components/map-layer-tree-final-review.test.ts src/components/map-layer-tree.test.ts
```

Expected: failures showing the master and groups initially expanded and disclosure buttons preceding labels.

- [ ] **Step 3: Implement minimal component changes**

Initialize `locationNamesExpanded` as `false`; initialize the collapsed group set with `fixed-story` and `generated`; append each label before its disclosure button in both master and group headers. Preserve existing datasets, `aria-expanded`, `aria-controls`, selection synchronization, click handling, and focus identity.

- [ ] **Step 4: Run component tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Commit component behaviour**

```powershell
git add -- src/components/map-layer-tree.ts src/components/map-layer-tree-final-review.test.ts src/components/map-layer-tree.test.ts
git commit -m "fix: collapse location name branches by default"
```

### Task 2: End-Aligned Disclosure Layout and Regression Verification

**Files:**
- Modify: `src/styles/app.css`
- Test: `src/components/map-layer-tree-final-review.test.ts`

**Interfaces:**
- Consumes: master and group header DOM order from Task 1.
- Produces: full-width row layout with end-aligned disclosure buttons.

- [ ] **Step 1: Add failing style contract assertions**

Read the shipped stylesheet in the test and assert that master and group headers use a shared full-width flex layout, label growth, and `margin-left: auto` on disclosure buttons.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- --run src/components/map-layer-tree-final-review.test.ts
```

Expected: failure because disclosure buttons are still positioned at the row start.

- [ ] **Step 3: Implement minimal CSS**

Use `display: flex; align-items: center; width: 100%` for the expandable row headers, `flex: 1 1 auto` for their labels, and `margin-left: auto` for the disclosure buttons. Keep existing indentation for second- and third-level descendants.

- [ ] **Step 4: Run focused and integration verification**

```powershell
npm.cmd test -- --run src/components/map-layer-tree-final-review.test.ts src/components/map-layer-tree.test.ts src/app/app-controller.test.ts src/app/app-shell.test.ts
npm.cmd run lint
npm.cmd run build
```

Expected: every command exits 0.

- [ ] **Step 5: Verify the local browser**

Reload `http://127.0.0.1:4173/`; confirm only the Location Names first-level row appears initially, its arrow is on the right, opening it shows two collapsed second-level rows, and opening one second-level row reveals only its own third-level children.

- [ ] **Step 6: Commit layout and verification**

```powershell
git add -- src/styles/app.css src/components/map-layer-tree-final-review.test.ts
git commit -m "style: align location disclosure controls"
```

