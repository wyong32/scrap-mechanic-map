# Default Map Release Mode Design

**Date:** 2026-08-13  
**Status:** Approved for implementation

## Goal

Ship a lightweight public version of Scrap Mechanic Map that presents the verified default 1.0 map and existing browsing tools, while keeping save-import development code available locally but disabled by default and absent from the public runtime path.

## Product Scope

The default public experience keeps:

- the default Surface World map;
- map pan, bounded zoom, and reset controls;
- hierarchical Location Names filters and explicit search;
- player-created markers stored in the browser;
- completed region navigation;
- the honest Under Development state for unfinished regions.

The default public experience does not expose:

- Select Save or Replace Save controls;
- `.db` drag-and-drop;
- Personal Map badges, metadata, or exit controls;
- automatic loading of a bundled/default save;
- save parsing, terrain materialization, or personal-map transitions.

## Configuration Contract

Use one Vite compile-time environment variable:

```text
VITE_ENABLE_SAVE_IMPORT=true
```

Save import is disabled when the variable is absent or has any value other than the exact string `true`. This makes ordinary local development, preview, CI, Vercel, and production builds match the lightweight public mode by default.

Developers may explicitly enable the existing save workflow locally by setting the variable to `true`. No public deployment configuration will enable it.

## Architecture

### Feature flag boundary

A small environment/config module owns parsing the compile-time flag. `main.ts` passes the resulting boolean into application startup. Tests may inject the option directly without mutating global environment state.

### Application shell

The shell receives a save-import capability flag. When disabled, it does not render the save-entry section and keeps all Personal Map controls absent or unreachable. The normal map sidebar fills the freed space.

When enabled, the current save entry, path hint, privacy copy, coverage summary, and Personal Map controls behave as before.

### Controller and worker isolation

The controller must not instantiate `SaveClient` while save import is disabled. Save callbacks are not wired, automatic default-save loading is ignored, and teardown does not assume a parser exists.

Enabled release mode is selected through Vite mode loading (`--mode save-import`
loads `.env.save-import`) or an explicit process value. One resolved exact-true
value drives both the browser replacement and the asset/outDir policy. A save DB
is never read from `public`: an optional developer-owned input may exist only at
ignored `local-assets/default-save.db`; its absence is a supported enabled build.
Reference extraction accepts `--default-save <path>` and otherwise uses that
same ignored local path.

To keep the public JavaScript graph lightweight, the production entry must not statically pull the save client/worker path into a disabled build. Save-import implementation is loaded only behind the enabled capability boundary. The existing source remains available for local development and tests.

### Assets and release output

The default build must not request save-worker, SQL.js, or SQL WASM during initial/default-map use. If Vite still emits unreachable save chunks because of bundler semantics, the release audit and network tests—not file-name assumptions—determine whether the public runtime remains lightweight. Removing local capture/generation tooling is out of scope.

## Behavior and Error Handling

- Disabled mode silently presents the default map; it does not show a disabled upload placeholder or “coming soon” message.
- Save-related query state from an old URL cannot activate Personal Map mode without the enabled capability.
- Supplying `loadDefaultSave` while disabled has no effect.
- Enabled mode retains existing validation, progress, privacy, replacement, cancellation, and error behavior.
- A save-feature loading failure in enabled mode reports the existing status error and leaves the base map usable.

## Testing

Implementation follows test-driven development.

Unit/integration tests must prove:

1. the flag defaults to disabled and only exact `true` enables it;
2. disabled shell output contains no save input, drop zone, path hint, Personal Map badge, or exit control;
3. disabled controller startup does not construct or invoke a save parser and ignores default-save loading;
4. enabled mode preserves the existing save UI and callbacks;
5. default map, search, location filters, markers, and region navigation remain available.

Production-browser verification must prove:

- the default URL shows the default Surface map without save UI;
- no save worker, SQL.js, SQL WASM, default DB, or optional personal-map asset request occurs during cold default-map startup;
- a build made with the explicit local flag still exposes Select Save.

Run type checking, focused tests, production build, release audit, and the relevant Chromium/Firefox flows before completion.

## Rollback and Future Re-enable

No save parser, worker, protocol, terrain normalization, tests, or local generation tools are deleted. Re-enabling is an explicit build-time choice, so future personal-map work can continue without reconstructing the feature. Public activation requires a separate quality review of the generated 1.0 terrain assets and an intentional deployment configuration change.

## Non-goals

- Publishing the failed reference-surface UUID extraction output.
- Improving personal-map terrain quality in this change.
- Deleting historical save-import code or local capture tools.
- Completing unfinished fixed-region maps.
- Uploading, pushing, or deploying the project.
