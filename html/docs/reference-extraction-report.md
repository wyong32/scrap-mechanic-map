# Reference surface UUID extraction: final evidence and handoff

## Decision

The extraction experiment is **not suitable for the requested 96.6% map completion**. The real quality gate failed, so Task 6 was intentionally skipped. No extracted atlas was published and no runtime, public-asset, or personal-map wiring was added.

The authenticated reference has 442 UUID types and the target `test.db` has 444: their intersection is 429 shared types, leaving 13 reference-only and 15 target-only types. The often-cited **429/444 (96.62%)** figure therefore has one narrow meaning: 429 of the target save's 444 UUID types also occur in the reference and were evaluated as shared UUIDs. It is **not accepted type coverage, accepted cell coverage, or rendered-map completion**. Quality-accepted coverage was only 34/442 full-reference types (7.69%), 3,808/12,288 playable cells (30.99%), and 3,682/12,262 target-eligible cells (30.03%).

## Reproducible identity

The save input described below is historical evidence, not a tracked/public
artifact. Current reproduction requires an explicit `--default-save <save.db>`
or a developer-owned file at ignored `local-assets/default-save.db`; the latter
is absent from this release worktree. GitHub and Vercel receive no save DB.

- Plan base: `79a4c94531891172a65fb0e4fc5adcbf922d4ea7`
- Extraction implementation range: `f7600b595f81822de995fc4d0100704ed4726157` through `b80e69d17c4bb87098e72f8645da43a6eaef3ee7`
- Final evidence source commit before this report: `b80e69d17c4bb87098e72f8645da43a6eaef3ee7`
- Failed-run schema: 2
- Failed-run normalized logical root-manifest content address: `8f52dfaac96fed092d7c13e1f1ce861da460753bad465812898f0299c9dfb0d8`. The verifier derives this by serializing the manifest with its self-hash field replaced by 64 zeroes; it is not the literal stored-file SHA-256.
- Stored `run-summary.json`: 8,870,442 bytes; literal file SHA-256 `5483bc12f15242b91437a5c14bceec7a4378f9f113951125e42dd98173ab5f4a`
- Atomic pointer: `html/local-assets/reference-extraction/af20ef7b483d37d020e57091a68e115fb7f756fc525aa9628b7c99347b8ece74.failed/current.json`
- Immutable run: `runs/8f52dfaac96fed092d7c13e1f1ce861da460753bad465812898f0299c9dfb0d8/`

Exact implementation commits, in order:

- `f7600b595f81822de995fc4d0100704ed4726157` - map reference cells to fractional image edges
- `e62f3efc971fb8c390889e767c84a24560efa612` - reject unsupported reference orientations
- `7debc6f6b63ebbbd79bd820ad968785017dce407` - inventory shared reference terrain UUIDs
- `e898171d25bf03f2e811535dbb9ee58b480428d2` - validate reference extraction inputs
- `64e404212dccea39b9d337bcf49be32e8b98d64b` - select stable reference terrain candidates
- `4faeeff03e40c4c268c9ce6bde79a5cee4804b61` - harden reference candidate grouping
- `209291ec49bff061c7fb03bd17415d0b30f3b25d` - gate extracted terrain by reconstruction quality
- `3af52f174a903480dd8e2fdbb823cb19834103cb` - harden reconstruction quality evidence
- `ba1aa642e68da6a27a646730f17a3c1314f4efdf` - verify reconstruction seam and source provenance
- `630d5eb6211ac69933f6c47ccb56ce31cf008cb2` - reject unverified reconstruction attestations
- `1a992f7c9f9b03cc52e3ac28fc1a6669aecd33a1` - add local reference extraction evaluator
- `87b492007a382f5815dda849e80b4387961d5d5a` - authenticate complete run manifest
- `b80e69d17c4bb87098e72f8645da43a6eaef3ee7` - reject unmanifested candidate directories

Checked inputs:

| Input | SHA-256 |
| --- | --- |
| Source WebP, 10,775 x 8,480 | `af20ef7b483d37d020e57091a68e115fb7f756fc525aa9628b7c99347b8ece74` |
| Reference-world source file | `9524b4bddaeb3390e27916dde0d820b037cbdb8c8c89bcd790a2a30bd6430e27` |
| Reference-world canonical artifact | `168e68326b9e0e746967c8a23e3c9741a29185ab2e93451a59ca357fd171a3ab` |
| Build info | `425ee9051125d2e15e5a8df44a11424158837f2a24bb33668bccae59eb8c28a1` |
| Tile catalog | `0ea22541a6626da3f0fa581f388f357f88febcac5cb60a8173100f1c7ab46383` |
| Default save | `e6f85a908f529fb373ec6a64f85113da024a99edbd3b8eef7d87d938f6d76278` |
| Real target save | `f5159d21729cfbf9914eddfa6016abe1bb1e47e5fa76f4da627405be05967106` |
| Target-world canonical artifact | `45a4a0d49ecc752abe834a503ae94ed420bcf9b19b2f8cefc2427a046df9467f` |

The calibrated full source domain is 144 x 112 = 16,128 cells, bounds `x=-72..71`, `y=-56..55`. The central playable domain is 128 x 96 = 12,288 cells.

## Inventory, candidates, and acceptance

UUID inventory is **429 shared, 13 reference-only, and 15 target-only**. The reference contains 442 UUID types in total (429 shared + 13 reference-only), while the target contains 444 (429 shared + 15 target-only). Thus 429/444 target types were evaluated for target reuse. Target-only UUIDs have no source occurrence in this reference and were never eligible for extraction:

- `0df21966-6aab-4045-b0b8-506b7e6a0e42`
- `21359ca2-a302-47ac-b4d2-cafd32c792de`
- `283704ff-0ea5-4fcf-ac73-fc4f4944dc8d`
- `2e599b00-a4f6-4490-b714-b4673e539268`
- `2eb07292-e901-4c84-add5-78130abb32ef`
- `2f4ba29a-c09a-43f7-ac95-012f9e31b307`
- `320e4f1c-f27d-4a8e-b763-a8f67a822b7f`
- `48f54a64-6e5c-4c65-bf3d-9af0fe944afd`
- `72e26acb-5f66-4835-a52d-83fb01143381`
- `76add552-5c6f-438b-bfc0-1227edb3be2b`
- `76f90b37-08fc-4433-a646-642adc6b3bf1`
- `b2e9abc1-4079-4211-b39a-4495dd5f336d`
- `c92c0f49-0cc8-4c96-b4ba-aad83389c812`
- `df62624d-8d81-4dd8-b6a5-59f359952dc1`
- `fb56e962-a472-4fbc-91e5-90ca406f4d55`

Selection and quality counts use different gates and must not be conflated:

| Stage/domain | Accepted or covered | Rejected or uncovered | Denominator |
| --- | ---: | ---: | ---: |
| Candidate files | 12,288 generated | - | 12,288 playable cells |
| Candidate groups | 2,225 evaluated | - | 2,225 groups |
| Selector groups | 335 | 1,890 | 2,225 groups |
| Selector full types | 113 | 329 | 442 types |
| Selector full rotations | 289 | 1,002 | 1,291 type/rotation pairs |
| Selector full cells | 10,154 | 5,974 | 16,128 cells |
| Final quality groups | 142 | 2,083 | 2,225 groups |
| Final full types | 34 | 408 | 442 types |
| Final full rotations | 103 | 1,188 | 1,291 type/rotation pairs |
| Final full cells | 7,641 | 8,487 | 16,128 cells |
| Final playable cells | 3,808 | 8,480 | 12,288 cells |
| Final target-eligible types | 34 | 395 | 429 shared types |
| Final target-eligible rotations | 103 | 1,167 | 1,270 shared type/rotation pairs |
| Final target-eligible cells | 3,682 | 8,580 | 12,262 target cells whose UUID is shared |

Final ratios are 7.69% full-type, 7.98% full-rotation, 47.38% full-cell, 30.99% playable-cell, 7.93% target-eligible-type, 8.11% target-eligible-rotation, and 30.03% target-eligible-cell coverage. These are quality-accepted ratios, unlike the evaluated-shared UUID ratio of 96.62%.

Group rejection evidence was dominated by 1,890 `insufficient-consistent-candidates` groups, followed by 153 `group-seam-error-exceeded` and 120 `group-image-difference-exceeded` groups. A group can carry more than one reason, so rejection-reason counts are not a second group denominator.

## Frozen gates and measured quality

Candidate thresholds were fixed before the real run: normalized crop 64 x 64, interior inset 8, edge strip 8, maximum mean interior distance 0.06, maximum per-edge distance 0.08, minimum consistent cluster 2, and maximum exact-search group 256.

Quality thresholds were not loosened after failure:

| Measure | Threshold | Measured/result |
| --- | ---: | ---: |
| Global image mean | <= 0.18 | 0.409449, failed |
| Global image maximum | <= 1.00 | 1.000000, passed |
| Global seam mean | <= 0.18 | 0.082716, passed |
| Global seam maximum | <= 1.00 | 0.543137, passed |
| Per-group image mean / maximum | <= 0.12 / 0.80 | applied per group |
| Per-group seam mean / maximum | <= 0.12 / 0.80 | applied per group |
| Minimum full type / rotation / cell | 0.65 / 0.70 / 0.80 | 0.0769 / 0.0798 / 0.4738, failed |
| Minimum playable cell | 0.80 | 0.3099, failed |
| Minimum target-eligible cell | 0.80 | 0.3003, failed |

The seam measurement accounted for all 2,408,665 expected samples: 1,330,525 placed-to-placed, 357,550 placed-to-missing, and 720,590 missing-to-missing. Passing global seam limits does not rescue the reconstruction because image difference and every required coverage gate failed.

## Visual review

The immutable overview and cell-detail evidence was inspected without regenerating it.

- Reconstruction: sparse, fragmented rectangular samples over a largely water-colored field. Roads, coastlines, fields, structures, and foliage do not form a coherent world. Numerous hard crop boundaries, disconnected linear fragments, long bars, and abrupt texture changes are visible. These indicate occurrence contamination and non-reusable crops rather than a clean tile atlas.
- Difference image: most land is near-white at the recorded amplification, while black is concentrated over water and missing/matching regions. This agrees with the 0.409449 mean error and low accepted coverage.
- Target preview: almost the entire landmass is black/transparent; it preserves mostly water and scattered fragments. It is not a usable personal-map terrain preview.
- Orientation: peripheral geography is broadly north-up and there is no evidence of one simple global mirror/axis error. Rotation correctness cannot be claimed across the accepted set because the reconstruction is too sparse and contaminated for a reliable visual proof.
- Seams/clipping/contamination: obvious rectangular discontinuities and clipped linear features remain. The numeric global seam metric passes because large missing/water regions dilute the visual defects; it should not be read as visual acceptance.

## Duration and immutable artifacts

The final real command was:

`npm.cmd run data:reference-extract -- --target "C:\Users\User\AppData\Roaming\Axolot Games\Scrap Mechanic\User\User_76561198777858656\Save\Survival\test.db"`

It exited 1 at the quality gate after 152,400 ms wall time; the internal pipeline reported 122,931 ms. The later schema-v2 evidence migration/re-attestation took 74,115 ms, including promotion and full post-promotion resolution. A separate resolver verification took 12,183 ms. A 100-crop one-decode benchmark took 1,584.641 ms (63.106 crops/s; 3.245-minute linear projection for 12,288 crops). The final extraction phase produced all 12,288 candidate PNGs in about 35 seconds; selection and reconstruction dominated the remaining pipeline time.

The current schema-v2 immutable run has 12,295 files and 159,411,954 bytes, including its 8,870,442-byte stored root manifest. In the table, ordinary files use literal file SHA-256 values; the candidate row instead records the canonical candidate-record manifest/tree digest, and the root row records both its literal stored-file SHA-256 and normalized logical content address:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| 12,288 candidate PNGs | 100,577,701 | Candidate-record manifest/tree digest: `d616b6c2ba704d817fe7a84229c8e6a3291e17b4bf4fbf5394935a90d7e51572` |
| `default-reconstruction.webp` | 6,505,640 | `a939b43d477126f9229e562185a8792224fdc4be9280d45352e6379f9678fb9d` |
| `default-difference.png` | 23,898,612 | `997e2de113ff5ab5820b38dac84823a3f35d74395317e5a0c417c7078038fd49` |
| `test-preview.png` | 801,700 | `199c4443c543f3c9a9b1af347a77981fafdd7ac587e1f8434f66558c91263bd6` |
| `reference-world.json` | 2,271,004 | `168e68326b9e0e746967c8a23e3c9741a29185ab2e93451a59ca357fd171a3ab` |
| `target-world.json` | 1,668,443 | `45a4a0d49ecc752abe834a503ae94ed420bcf9b19b2f8cefc2427a046df9467f` |
| `quality-report.json` | 14,818,412 | `97038c0cc3c6a294f6a4e3c7f49a7897a4bf1d829ad6b88daa746ca08a54e534` |
| Schema-v2 root manifest (`run-summary.json`) | 8,870,442 | Literal file SHA-256: `5483bc12f15242b91437a5c14bceec7a4378f9f113951125e42dd98173ab5f4a`; normalized logical content address: `8f52dfaac96fed092d7c13e1f1ce861da460753bad465812898f0299c9dfb0d8` |

## Fresh verification at handoff

- Explicit focused Vitest suite for the seven extraction files plus legacy repository, terrain plan, hybrid resolver, and map view: **11 files, 176 tests passed** in 5.84 s.
- `npm.cmd run lint`: passed (`tsc --noEmit`).
- `npm.cmd run release:check`: passed; Vite built 45 output files / 34,582,896 bytes and the release audit reported no violations. Vite emitted the existing browser-compatibility externalization warnings for `fs`, `path`, and `crypto` imported by `sql.js`.
- `npm.cmd exec playwright test tests/e2e/personal-map.spec.ts --project=chromium --project=firefox`: **6 passed** in 20.5 s. This includes the current honest "unfinished regions are under development" behavior; it does not demonstrate reference extraction/runtime integration.

Vitest 3 treats the brief's PowerShell `tools/reference-extraction/*.test.ts` argument as a literal filter, so the fresh focused run expanded the seven files explicitly before invoking the otherwise equivalent command.

## Handoff and next viable direction

Keep the failed run as local diagnostic evidence only. Do not copy its candidates into `public`, generate a shipping atlas from them, or wire them into the runtime.

The next viable direction needs a separately reviewed design that models occurrence-specific content instead of assuming all crops sharing UUID/rotation/offset are near-identical. Candidate approaches include separating the reusable base terrain from roads, structures, foliage, biome/edge overlays, and other world-position-dependent layers; clustering by local neighborhood/biome context; or generating a bounded, position-addressed reference surface rather than a UUID atlas. Any replacement should begin with representative adversarial fixtures, freeze its thresholds before the next full run, and must pass visual cell-detail review plus the same full/playable/target coverage gates before publication is reconsidered.
