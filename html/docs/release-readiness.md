# Default-map release readiness

Assessment date: 2026-08-13

Implementation baseline entering the final fix: `a13e5d3`

Current-tree status: **READY FOR LOCAL VERIFICATION ONLY**

Push/deploy/launch status: **BLOCKED**

## Launch blocker

**DO NOT PUSH OR DEPLOY THIS ANCESTRY.** The current index, public source, local
asset input, and release outputs contain no save database. However, populated DB
blob `403166717338813072f990e6e8e0108647a07cb7` remains reachable in Git history.
History rewriting is destructive and was not authorized for this task.

Before release, create a clean-history/squashed branch that does not descend
from the contaminated commits, scan every reachable object and path for that
blob and all `.db` files, then rerun the complete release/browser matrix from a
fresh checkout. A clean worktree or clean `dist` is not proof that this ancestry
is safe to publish.

## Current default artifact

The final-fix candidate's fresh `npm.cmd run release:check` passed with no
violations. Its default-disabled output is 34 files / 21,610,945 bytes;
the initial reference image is 15,645,120 bytes and compressed code is 114,938
bytes. Hash-named code chunks can vary across commits, so these measurements
supersede the stale Task 7 390-file artifact figures.

The default artifact contains no database, official atlas, legacy images,
tile catalog, or orthographic inventory. Save/SQL dynamic chunks may be emitted
by the source graph, but the production request ledger proves they are not
requested at cold startup.

## Verified matrix

- Focused release/config tests: 14/14 passed.
- Controller tests after removing the deprecated parser alias: 60/60 passed.
- TypeScript lint passed.
- `release:check` passed with zero violations.
- Default release ledger: Chromium 3/3 and Firefox 3/3 passed.
- Enabled mode (`--mode save-import`): Chromium 1/1 and Firefox 1/1 passed,
  including HTTP availability of the enabled-only tile catalog and official
  atlas manifest with no local DB present.

The implementation commit is the commit containing this document; a future
clean-history release candidate must replace this evidence with its own SHA and
fresh measurements.

## Vercel contract

Use `html` as the project root, Vite as the framework, `dist` as output, and the
checked-in `vercel.json`. Its build command is `npm run release:check`, making
the repository/privacy and byte-budget audit a deployment build gate. The
default Vercel environment must not set `VITE_ENABLE_SAVE_IMPORT=true`.
