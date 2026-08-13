# Final whole-branch fix report

## Outcome

All two Important findings and three Minor findings from `final-review.md` were
addressed on the current tree. The historical DB blob was not rewritten; it
remains an explicit **DO NOT PUSH/DEPLOY** launch blocker requiring a future
clean-history/squashed release branch and reachable-object scan.

## RED / GREEN evidence

- RED: the release-mode module was absent; Vercel still expected plain build;
  and a junction used as `publicRoot` was followed. GREEN: 14/14 focused
  release/config tests pass.
- Runtime and build policy now share one exact-true flag resolved with Vite
  `loadEnv(mode, envDir, "")`; an explicit process value has priority for
  Playwright/CI compatibility. The same value is defined for the client and
  selects personal assets plus `dist`/`dist-save-import`.
- `.env.save-import` plus `--mode save-import` exercises ordinary Vite mode
  loading. Enabled Chromium/Firefox verify controls and HTTP availability of
  the tile catalog and official atlas manifest; no real DB is present.
- `vercel.json` now runs `npm run release:check`, so the default build and audit
  are one non-recursive deployment gate.
- The deprecated `StartAppOptions.saveClient` alias is removed; tests use lazy
  `createSaveParser`. Controller tests pass 60/60.
- The collector rejects reparse roots/entries, verifies canonical containment,
  reads through an opened handle, compares pre/open/post file identity, and
  closes the handle. Optional local DB absence remains supported.

## Verification

- Focused release/config: 14/14 passed.
- Controller focused: 60/60 passed.
- `npm.cmd run lint`: passed.
- `npm.cmd run release:check`: passed, zero violations; default output 34 files
  / 21,610,945 bytes, initial asset 15,645,120, compressed code 114,938.
- Default request ledger: Chromium 3/3; Firefox 3/3.
- Enabled smoke: Chromium 1/1; Firefox 1/1.
- Final default release check is run after enabled verification so `dist` is the
  final audited artifact.

An attempted unfiltered historical `npm run test:e2e` exceeded the command
budget; its owned process tree was safely stopped and is not cited as evidence.
The scoped required browser matrix above completed normally.

## Publication boundary

Current tree/index/public/default and enabled output contain no DB, and the
optional `local-assets/default-save.db` is absent. Blob
`403166717338813072f990e6e8e0108647a07cb7` remains in ancestry. This commit
must not be pushed or deployed; launch requires an authorized clean-history
candidate, blob/path scan, and fresh full matrix.
