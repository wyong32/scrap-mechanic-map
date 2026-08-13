# Terrain atlas intake

Every newly rendered 1.0 tile input must be a lossless PNG named `<uuid>__<xOffset>__<yOffset>.png`. Render it with an orthographic, top-down camera, identical world scale, transparent or fixed neutral background, and north-up rotation zero. Rotation is produced by the packer, not by hand.

Before distribution, reviewers must verify the source and the Scrap Mechanic/Axolot Games licensing position. Legacy images are reusable only after an explicit checked-in legacy path/ID to 1.0 UUID mapping is reviewed; filename digits are never identity evidence.

The canonical deployable output is `html/public/atlas`; the browser, packer,
and verifier all use that directory. Legacy mappings are derived separately
from official game-script registrations such as `AddLegacyUpgrade` and
`addPoiTileLegacy`. A new 1.0 render must not add, infer, or modify a legacy
mapping.

From `html/`:

```powershell
$gameRoot = "<Scrap Mechanic install root>"
$atlasInputs = "<external north-up PNG directory>"
npm.cmd run data:build -- --game-root $gameRoot
npm.cmd run data:verify -- --game-root $gameRoot
npm.cmd run data:legacy -- --game-root $gameRoot
# data:atlas performs intake and prints every missing render filename.
npm.cmd run data:atlas -- --game-root $gameRoot --input-directory $atlasInputs
npm.cmd run data:verify -- --game-root $gameRoot
```

The reviewed 1.0 render flow is:

1. Run `data:verify` to prove the checked-in generated bundle and legacy
   image manifest exactly match the supplied game source. This command does
   not discover or pack atlas inputs.
2. Run `data:atlas` with the external input directory. If inputs are
   incomplete, it prints each required
   `<uuid>__<xOffset>__<yOffset>.png` name and exits without packing.
3. Render each required tile with the camera, scale, background, and north-up
   contract above. Record the source and licensing review.
4. Place the PNGs in the external input directory and rerun `data:atlas`.
5. Rerun `data:verify`, run `data:legacy` for the aggregate coverage report,
   and review the generated atlas diff. Do not edit
   `legacyBridge` or use filename similarity to make the render legacy-backed.

The atlas command derives all required UUID/offset/rotation keys from the 19
generated worlds, hashes each real PNG, and writes native/low WebP pages plus
`terrain-cell-atlas.json`. It rejects missing inputs and outputs located inside
the game root. `data:build` never overwrites a packed atlas. `data:legacy`
rebuilds the reviewed original-image manifest independently. `data:verify`
checks source reproducibility and portable integrity; `data:atlas` owns intake
discovery and packing. Development-only UI hatching flags absent *visible*
cells, never production terrain substitutes.
