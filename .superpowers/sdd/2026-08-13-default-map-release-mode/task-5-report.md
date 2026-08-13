# Task 5 Report: Production Browser and Release Verification

## RED evidence

The default production E2E was written before the dedicated enabled-mode
configuration. Its protected break is a release accidentally built with save
import enabled. I forced that condition only for the RED command with a
PowerShell process environment variable:

```text
$env:VITE_ENABLE_SAVE_IMPORT='true'; npm.cmd run test:e2e -- tests/e2e/default-map-release.spec.ts --project=chromium --reporter=line
```

The production build and preview started successfully, then the test failed at
the intended UI boundary: `input[type="file"]` expected count 0, received 1.
The environment variable was removed before the GREEN run.

The enabled smoke was also first run through the default Playwright config. It
failed because `getByLabel('Select a Scrap Mechanic .db save file')` found no
element. Adding only the dedicated configuration and script made it GREEN.

## Request ledger design and browser evidence

`default-map-release.spec.ts` attaches listeners before navigation and records
every same-origin request from Playwright's `request` event. A `Map<Request,
pathname>` is populated at request time, removed only by `requestfinished` or
`requestfailed`, and failed requests retain their error text. After the map's
reference WebP is visibly decoded, a bounded 15-second barrier requires both an
empty in-flight map and 500 ms without request lifecycle activity. The final
assertions independently require zero failures and zero unaccounted in-flight
requests; this is not a response snapshot.

Default production cold-start counts:

- Chromium: 8 same-origin requests, 0 failed, 0 in flight.
- Firefox: 9 same-origin requests, 0 failed, 0 in flight; the ninth request is
  the favicon.
- Both requested only the document, index JS/CSS, build/regions/locations
  metadata, reference-world JSON, and the reference-surface WebP (plus Firefox
  favicon). Neither requested save-worker, SQL WASM, default-save DB,
  `/legacy/img/`, nor `/atlas/official/`.

The default E2E also confirms that Interactive Map, Surface World, Location
Names, search input/button, and Add Marker are visible and enabled, while file
input, drop zone, path hint, Select/Replace Save, Personal Map, and Exit
Personal Map are absent.

The enabled smoke uses port 4176 and Playwright `webServer.env` with exact
`VITE_ENABLE_SAVE_IMPORT: "true"`, which is shell-independent on Windows. The
real file input is attached and enabled, and Select Save, drop copy, and the
save path hint are visible. Chromium and Firefox each passed one smoke test.

## Emitted versus requested save assets

The default `release:check` build emitted these retained, lazy save artifacts:

- `assets/save-client-BM87qT7k.js`: 3,748 bytes
- `assets/save-worker-VCpW-f0z.js`: 66,178 bytes
- `assets/sql-wasm-C1U8OeUW.wasm`: 659,806 bytes
- `data/default-save.db`: 815,104 bytes

Total emitted save/SQL/default-DB bytes: 1,544,836. Default browser requests
for all four were zero. Optional personal-map atlas output was also retained
(9 files, 11,548,542 bytes) while default requests under `/atlas/official/`
and `/legacy/img/` were zero.

## Release metrics and final matrix

`npm.cmd run release:check` reported:

```text
Tracked bytes: 39313466
Output bytes: 34584779
Output files: 46
Initial asset bytes: 15645120
Compressed code bytes: 114954
Violations: none
```

Final commands and exits:

```text
npm.cmd test -- --run src/app/save-import-feature.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts src/main.test.ts tools/release/release-audit.test.ts
exit 0; 5 files, 116 tests passed

npm.cmd run lint
exit 0

npm.cmd run release:check
exit 0; violations none

npm.cmd run test:e2e -- tests/e2e/default-map-release.spec.ts --project=chromium --project=firefox --reporter=line
exit 0; 2 tests passed

npm.cmd run test:e2e:save-import -- --project=chromium --project=firefox --reporter=line
exit 0; 2 tests passed

git diff --check
exit 0
```

The release audit had no RED violation, so `release-audit.ts` and its test were
not changed.

## Commit, self-review, and concerns

Commit: `test: verify lightweight default map release`

Scoped files are the two E2E specs, dedicated enabled config, package script,
and this report. The pre-existing untracked
`.superpowers/sdd/2026-08-12-reference-surface-uuid-extraction/` directory was
not modified or staged. No push, publish, or deployment was performed.

Self-review checked the mutation boundaries: enabling the default build exposes
the file input and fails the default test; omitting exact `"true"` hides the
input and fails the enabled smoke; missing request finish/failure accounting
leaves an in-flight entry; and a failed request remains visible to its own
assertion.

Concern: default production still emits and deploys save/SQL/default-save and
optional atlas files. This is allowed by the brief and existing release budget,
and the browser ledger proves they are not part of cold startup. Vite also logs
the existing sql.js `fs`/`path`/`crypto` browser-externalization warnings during
build; they do not produce audit violations or default network requests.

## Fix round 1: default release asset boundary and stronger ledger

This addendum supersedes the preceding concern: the default release must not
publish the real save DB or optional personal-map public assets. At that fix
stage, source and tooling remained in the repository for explicitly enabled
local builds. Fix round 2 below supersedes that DB-source boundary.

### TDD evidence

The release asset policy tests were written before `release-assets.ts` existed.
The focused RED failed to resolve `./release-assets`; after the minimal policy
and build plugin were implemented, all three policy tests passed. They exercise
real fixture trees and verify that default collection excludes
`data/default-save.db`, `atlas/official/**`, and `legacy/img/**`, while the
then-current exact enabled mode selected `dist-save-import`. Fix round 2 makes
DB inclusion optional and local-only.

Two browser ledger regressions were added before changing the recorder. In the
same Chromium run, the 503 regression failed because `failures` was empty and
the initial 750 ms delayed save-client regression failed because the path was
absent. The final regression delays the request 2.1 seconds to prove the fixed
observation horizon completes before the subsequent quiet barrier begins.
After response-status accounting and the observation horizon were added, all
three Chromium ledger/default tests passed.

Release-audit regressions for DB, official atlas, and legacy-image output were
then run RED: all three expected violations were absent. The minimal default
output policy made the combined asset-policy/audit suite pass 23/23. Finally,
the Vercel config test was changed to require no personal-map route headers; it
failed on the old `/atlas/official/(.*)` header and passed after that stale
default-deployment route configuration was removed.

### Release asset policy

For production builds, Vite no longer performs its implicit whole-directory
public copy. A build-only plugin walks the real public directory, applies the
explicit policy, and emits selected assets through the bundle. Default builds
write `dist` and exclude the DB, official atlas, and legacy images. Exact
`VITE_ENABLE_SAVE_IMPORT=true` builds write `dist-save-import`; the current
local-only DB policy is documented in fix round 2. Development serving still
uses the normal `public` directory. Both output directories are ignored.

The first real default build after the fix produced 36 files / 22,221,133
bytes, down from 46 files / 34,584,779 bytes. It retained bundler-emitted
save-client, save-worker, and SQL WASM chunks, but checks confirmed no
`dist/data/default-save.db`, `dist/atlas/official`, or `dist/legacy/img`.

Enabled-output isolation was verified with a SHA-256 manifest of every default
`dist` file before and after the enabled Chromium smoke: the diff count was
zero. That enabled run contained a DB, official atlas manifest, save-client,
save-worker, and SQL WASM. This is historical evidence, not a requirement that
every enabled build contain a DB; fix round 2 makes the DB an optional ignored
local input. Vite owns cleanup of only its explicit output directory; no
cross-directory deletion command is used.

### Ledger changes

The request-time ledger now retains a separate record for every `Request`,
records every same-origin response status, and treats HTTP status 400 or above
as a failure in addition to transport-level `requestfailed`. From the call to
`settle`, listeners remain active through a fixed minimum two-second
observation horizon, then through empty in-flight state plus a subsequent 500
ms quiet period, with
a bounded 15-second deadline. The default release test keeps listeners attached
until all path, status, failure, and in-flight assertions finish.

The default request contract now combines explicit forbidden patterns
(save-client/worker, SQL.js/SQLite variants, default DB, official atlas, legacy
images) with an allowlist for the exact default startup categories. This catches
future personal-map filenames as unexpected even if their name does not match a
current chunk.

### Final fix-round verification

Fresh default `release:check` metrics after staging the fix:

```text
Tracked bytes: 39327869
Output bytes: 22221133
Output files: 36
Initial asset bytes: 15645120
Compressed code bytes: 114954
Violations: none
```

Commands and exits:

```text
npm.cmd test -- --run src/app/save-import-feature.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts src/main.test.ts tools/release/release-assets.test.ts tools/release/release-audit.test.ts tools/release/vercel-config.test.ts
exit 0; 7 files, 123 tests passed

npm.cmd run lint
exit 0

npm.cmd run release:check
exit 0; violations none

npm.cmd run test:e2e -- tests/e2e/default-map-release.spec.ts --project=chromium --project=firefox --reporter=line
exit 0; 6 tests passed

npm.cmd run test:e2e:save-import -- --project=chromium --project=firefox --reporter=line
exit 0; 2 tests passed; default dist SHA-256 diff count 0

npm.cmd run release:check
exit 0 after enabled smoke; default artifact restored and audited

git diff --check && git diff --cached --check
exit 0
```

Fix commit: `fix: isolate personal map release assets`

Self-review mutations: restoring implicit public copy fails both the asset
policy and release audit; using `dist` for enabled mode changes the default
manifest; deleting response handling fails the 503 regression; ending the
observation/quiet barrier before 2.1 seconds fails the late-request regression;
reintroducing a
personal-map default request fails the forbidden and/or allowlist assertion.

The only remaining concern is the existing Vite sql.js browser-externalization
warning. Dynamic save/SQL chunks are still emitted by the source graph, as the
brief permits, but are neither requested at default startup nor accompanied by
the real DB/optional public terrain assets in the default deployable output.

## Fix round 2: local DB trust boundary and complete optional-data policy

### TDD and provenance boundary

Before implementation, the focused policy/audit/repository run had 10 intended
failures out of 31 tests. They proved that the old collector still accepted a
public DB, default output still admitted the two generated optional-data files,
the audit did not reject those cases, local-only injection did not exist, and
the real repository still tracked `html/public/data/default-save.db`.

The only tracked DB target was verified before mutation as 815,104 bytes with
SHA-256
`E6F85A908F529FB373EC6A64F85113DA024A99EDBD3B8EEF7D87D938F6D76278`.
It was removed from the Git index and moved, without deleting its bytes, to the
explicitly ignored `html/local-assets/default-save.db`. The moved file has the
same byte count and hash. The old public path no longer exists, and neither the
public path nor the local path is Git-tracked.

The public asset collector now rejects `data/default-save.db` in both modes.
Only an exact enabled build may optionally inject that output name from the
explicit trusted local path. A missing local file is a supported state: the
enabled build omits the DB while retaining the enabled UI. The fixture policy
tests cover public-source rejection, missing-local omission, default-mode
non-injection, enabled-mode injection, and byte-for-byte identity.

Accordingly, the current Git tree has no DB as a tracked file, and the default
Vercel artifact has no DB. This only describes the current tree, not push
safety: fix round 3 confirms that publishing this ancestry can still transfer
the old blob. The DB is not committed by this fix. This task does not rewrite
pre-existing Git history and did not push or deploy anything.

### Complete default/enabled asset split

Default production now also excludes exactly:

- `data/generated/tile-catalog.json`
- `data/generated/default-surface-orthographic-inventory.json`

The release audit independently forbids both paths in default output. Exact
enabled output retains both files. On this machine the ignored local DB was
available, so the enabled artifact also received a byte-identical optional DB;
that observation is not a requirement for other enabled builds.

The final fresh default artifact contains none of the DB, the two generated
files, official atlas, or legacy image paths. It produced:

```text
Tracked bytes: 38517278
Output bytes: 21610982
Output files: 34
Initial asset bytes: 15645120
Compressed code bytes: 114954
Violations: none
```

### Final round-2 verification

```text
npm.cmd test -- --run src/app/save-import-feature.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts src/main.test.ts tools/release/release-assets.test.ts tools/release/release-audit.test.ts tools/release/repository-boundary.test.ts tools/release/vercel-config.test.ts
exit 0; 8 files, 131 tests passed

npm.cmd run lint
exit 0

npm.cmd run release:check
exit 0; 34 files / 21,610,982 bytes; violations none

npm.cmd run test:e2e -- tests/e2e/default-map-release.spec.ts --project=chromium --project=firefox --reporter=line
exit 0; 6 tests passed; Chromium 8 and Firefox 9 same-origin requests, failed/in-flight 0

npm.cmd run test:e2e:save-import -- --project=chromium --project=firefox --reporter=line
exit 0; 2 tests passed; isolated dist-save-import retained both optional generated files

local/enabled DB SHA-256 identity check
exit 0; both E6F85A908F529FB373EC6A64F85113DA024A99EDBD3B8EEF7D87D938F6D76278

npm.cmd run release:check
exit 0 after enabled smoke; final dist restored/audited as default
```

The default ledger requested neither optional generated file. The remaining
known warning is the unchanged sql.js browser externalization warning; the
allowed dynamic save/SQL chunks remain unrequested at default startup.

## Fix round 3: preserved tooling, hardened local input, and history hold

### RED/GREEN evidence

The first focused RED run covered the production CLI, release asset reader,
audit, and repository boundary. It produced 11 intended failures among 68
tests: `--default-save` was unsupported, the production pipeline still received
the deleted public path, missing local input reached the pipeline, forced-added
`local-assets` files passed the audit, and local reader containment was absent.
An additional in-root junction regression was then observed RED (1/10) because
the first realpath check did not detect an intermediate reparse point.

After minimal implementation the focused production set passed 4 files / 68
tests. The expanded final focused run passed 10 files / 170 tests, with 6
private-input integration cases skipped because no local DB is present. Those
cases now use `local-assets/default-save.db` when a developer supplies it;
absent-local behavior remains mandatory and is covered by the always-running
CLI fail-closed and enabled-build tests.

### Tooling and local trust boundary

Reference extraction now accepts an optional `--default-save <save.db>` and
prioritizes that explicit path. Without it, the production pipeline uses
`local-assets/default-save.db`. A missing or non-regular default produces clear
recovery guidance before input loading; it never falls back to the deleted
public path.

The enabled release reader now verifies the trusted local-assets root and save
with `lstat`/`realpath`, requires a regular non-symbolic file, requires strict
canonical containment, and rejects both an escaping junction and an in-root
intermediate reparse point. Missing exact local input remains an intentional
omission rather than a build error. Release audit fixtures prove that forced
Git tracking of `local-assets/default-save.db`, a nested `.db`, or even a
non-DB local asset is forbidden. The real repository boundary likewise rejects
every tracked `html/local-assets/**` path.

The ignored DB copied by fix round 2 was agent-produced rather than a user
source. After verifying its exact worktree path, 815,104-byte size, unchanged
SHA-256, and untracked state, this round removed only
`html/local-assets/default-save.db`. No original user save directory or file
was touched. All final release/browser checks ran with that path absent.

### Historical launch blocker

Current-tree safeguards do not erase prior history. Blob
`403166717338813072f990e6e8e0108647a07cb7` remains reachable from this HEAD.
History rewriting is destructive and was explicitly not authorized, so it was
not attempted. This ancestry must not be pushed or deployed. Before a future
GitHub/Vercel release, create a clean-history or squashed release branch that
does not descend from contaminated commits, scan every reachable object for
that blob and `.db` paths, and rerun the full release/browser matrix from a
fresh checkout. `html/docs/release-readiness.md` records this as a launch
blocker, not as a deferred nicety.

### Final round-3 matrix

```text
npm.cmd test -- --run src/app/save-import-feature.test.ts src/app/app-shell.test.ts src/app/app-controller.test.ts src/main.test.ts tools/reference-extraction/cli.test.ts tools/reference-extraction/reference-inputs.test.ts tools/release/release-assets.test.ts tools/release/release-audit.test.ts tools/release/repository-boundary.test.ts tools/release/vercel-config.test.ts
exit 0; 10 files, 170 passed, 6 private-input cases skipped because local DB is absent

npm.cmd run lint
exit 0

npm.cmd run release:check
exit 0; tracked 38,530,629 bytes; default 34 files / 21,610,982 bytes; violations none

npm.cmd run test:e2e -- tests/e2e/default-map-release.spec.ts --project=chromium --project=firefox --reporter=line
exit 0; 6 tests passed; Chromium 8 and Firefox 9 same-origin requests, failed/in-flight 0

npm.cmd run test:e2e:save-import -- --project=chromium --project=firefox --reporter=line
exit 0; 2 tests passed with local DB absent; dist-save-import DB absent and both enabled generated files present

npm.cmd run release:check
exit 0 after enabled smoke; final dist restored/audited as default
```

The known sql.js Vite externalization warnings remain unchanged. No push,
deployment, history rewrite, or original-user-save mutation occurred.
