# Runtime Auto-Capture Control Design

## Goal

Complete the official-runtime 5-by-5 surface capture without keyboard input. The writable Scrap Mechanic copy must move the audited camera only when an external, deterministic control command names a canonical capture point. Each point remains active until its two frames pass the existing validator, so a rejection never advances the batch.

This design replaces only the unavailable chat-input transport. It does not relax the runtime isolation gate, frame validation, stitching rules, or protected-root guarantees.

## Confirmed constraint

Task 6 v4 proved that the isolated `default-save` loads in the official Build 869 runtime and that the installed capture hooks load without Lua or bind errors. Windows SendInput, including the on-screen keyboard, is ignored by the game, while mouse input reaches the game. The v4 run produced no capture marker or frame and ended with `protectedRootsUnchanged: true`.

## Options considered

1. **Audited control-file handshake — selected.** A small generated Lua job file contains the canonical 25-point whitelist. An external CLI atomically changes only a generation number and canonical point ID. The game polls that control file, resolves coordinates from the whitelist, moves the camera, and emits an exact log marker. This preserves per-point acceptance and retry control without keyboard input.
2. **Fixed timed queue.** The game advances on a timer. This is simpler, but it can advance before a rejected frame is retried or before automation captures both frames.
3. **Virtual keyboard/gamepad or custom in-game GUI.** These introduce driver/install risk or a much larger game-UI implementation and provide weaker auditability.

## Architecture

### Generated job companion

Before launch, a new CLI command generates `SmOverviewCaptureJob.lua` inside only the writable F-drive game copy. It contains:

- schema version `1`;
- the exact `capture-job.json` content hash;
- all 25 canonical point IDs and coordinates;
- center capability point `r2-c2`;
- FOV `90`, vertical direction, and north-up contract;
- a SHA-256 recorded in an external receipt.

The generator accepts only the existing validated `RuntimeCaptureJob`, refuses repository, Steam, shared-package, junction, or noncanonical paths, and is idempotent.

### Runtime control file

`SmOverviewCaptureControl.lua` is an atomic, generated data file in the writable game copy. It contains only:

- schema version;
- capture-job content hash;
- monotonically increasing generation;
- action: `point` or `off`;
- canonical point ID;
- attempt `1`, `2`, or `3` when the action is `point`.

Coordinates never come from this file. The runtime resolves the point ID through the generated whitelist, preventing arbitrary teleport requests.

The CLI owns an external `control-session.json` below the fresh capture root. It enforces this progression:

1. first accepted command must be center `r2-c2` attempt 1;
2. while capability is unaccepted, only center retries are allowed;
3. after the center crop is accepted, points advance in row-major order;
4. a rejected point may increment only its own attempt, up to 3;
5. the next point is allowed only after the current manifest entry exists and its file/hash validate;
6. `off` is allowed after completion or during fail-closed shutdown.

Every control write uses atomic replacement and produces a non-private receipt containing hashes, generation, point ID, attempt, and job hash.

### Lua state machine

The existing `SmOverviewCapture.lua` keeps manual chat commands for compatibility and adds an automatic controller:

1. wait until the Survival client and local player are available;
2. poll the control file at a bounded interval, not every frame;
3. ignore malformed data, stale generations, wrong job hashes, unknown points, or attempts outside 1–3 and print a rejection marker;
4. for a new valid generation, request the existing server teleport callback and lock the scripted top-down camera;
5. hold the same point indefinitely;
6. after an 8-second settle interval with the camera continuously applied, print exactly one ready marker for that generation;
7. change point only when a higher audited generation appears;
8. on `off`, restore GUI and controls and print an off marker.

Ready marker format:

```text
SM_OVERVIEW_CAPTURE_READY generation=<n> point=<id> attempt=<n> x=<x> y=<y> z=250.000 fov=90 direction=0,0,-1 gui=hidden job=<contentHash>
```

The marker proves that the official runtime applied the requested audited generation. The existing two-frame stability and visual checks remain responsible for rejecting loading, black, HUD-visible, or unstable imagery.

## Capture workflow

1. Close the game and verify no game, reporter, or temporary AppID process/file remains.
2. Create a fresh isolated user-data and capture root; place the DB at the proven `Profile\\AppData\\Roaming` save path.
3. Generate the canonical JSON job, Lua job whitelist, initial disabled control file, patch/control receipts, and DB backup.
4. Run the full protected-root pre-fingerprint and launch the exact patched Build 869 executable with the proven isolated environment.
5. Load the unique isolated save using Computer Use.
6. Issue center generation 1 through the control CLI, wait for the exact marker and settle period, then save two unmodified 1920x1080 Windows.Graphics.Capture frames at least 500 ms apart.
7. Run the existing frame acceptor and visually inspect the 750x750 center crop. If it fails, retry only the center up to attempt 3; otherwise send `off`, close, and report blocked.
8. After center acceptance, command each of the 25 points in row-major order. Capture and validate before issuing the next generation. The center is captured again at its canonical row-major position so the manifest is uniform.
9. Send `off`, close the exact game process, remove the guarded AppID, and run the full protected-root post-fingerprint.
10. Stitch only when the manifest has 25 accepted frames and 40 passing neighbor alignments.

## Failure handling

- Any malformed/stale control file, hash mismatch, unknown point, out-of-order point, fourth attempt, missing marker, frame rejection, process identity mismatch, or protected-root change fails closed.
- Atomic control replacement retries only bounded sharing violations; it never edits a partially read file in place.
- A failed command creates no accepted crop and cannot advance the control session.
- Runtime capture artifacts and receipts remain below `F:\\Scrap Mechanical`; real images are not committed.
- Steam installation, shared package, and normal AppData remain read-only.
- The first center capability gate remains load-bearing. No other point is captured before it passes.

## Testing and acceptance

Automated tests cover:

- canonical 25-point Lua generation and deterministic hashes;
- canonical-path and junction rejection;
- control-session ordering, center gate, retries, row-major progression, and `off`;
- atomic writes and bounded sharing-violation retry;
- Lua parsing/state transitions with stale, malformed, wrong-hash, and unknown-point controls;
- one ready marker per generation and indefinite hold until the next generation;
- compatibility with existing manual commands;
- receipt privacy and deterministic serialization.

Real acceptance still requires:

- exact official Build 869 PID and executable hash;
- successful isolated save load;
- center marker plus accepted center crop;
- 25 accepted crops, 40 passing alignments, and a native stitched PNG;
- post-run `protectedRootsUnchanged: true`;
- independent review of code, receipts, manifest, alignments, and the native image.

## Scope

This work produces one real 5-by-5 prototype and its reproducible controls. It does not replace the website basemap, capture the full surface, or capture fixed regions. Those remain separate follow-up work after this capability is proven.
