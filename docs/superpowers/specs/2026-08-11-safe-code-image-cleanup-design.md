# Safe Code and Image Cleanup Design

## Goal

Reduce unused code and image clutter without removing any asset or tool that contributes to the current map, save import, data generation, or future capture workflow.

## Safety boundary

- Preserve all terrain images listed by the generated legacy manifest.
- Preserve the Scrap Mechanic 1.0 official atlas and its manifest.
- Preserve the current reference surface backdrop and bundled default save.
- Preserve capture, extraction, atlas, and data-generation tools.
- Preserve generated fixed-region data even while those pages are marked Under Development.
- Delete an image only when it has no source reference, no generated-data reference, and no generation-pipeline reference.
- Limit code cleanup to declarations reported unused by TypeScript; do not restructure behavior.
- Do not alter unrelated dirty-worktree changes.

## Confirmed cleanup candidates

- `html/public/assets/reference-surface.svg`: obsolete placeholder with no runtime, manifest, test, or tool reference.
- Seven unused TypeScript declarations reported by `tsc --noUnusedLocals --noUnusedParameters`.
- Regenerable test-result files, when present; build output is rebuilt rather than treated as source.

## Explicitly retained

- `html/public/legacy/img/**`, including the runtime minidungeon capture, because the manifest and POI rules reference these files.
- `html/public/atlas/official/**`, because the hybrid terrain resolver loads this Scrap Mechanic 1.0 atlas.
- `html/public/assets/reference-surface-1.0.webp`, because the default Surface World uses it.
- `html/public/assets/fixed-region-backdrop.svg`, because the map view still references its fallback path.
- All scripts under `html/tools/**`.

## Verification

Run strict unused-declaration checking, normal lint/build, the focused application and map tests, generated-data verification, and a browser smoke check of the default Surface World. The page must retain terrain, location labels, player markers, save selection, and the current zoom limits.
