# Runtime Single-Center Capture Design

## Decision

Build only one real, standard-clarity, north-up center capture from the official Scrap Mechanic Build 869 runtime. This specification supersedes the unimplemented multi-point control-file design in `2026-08-02-runtime-auto-capture-control-design.md`.

The purpose is to prove visual quality with the smallest possible change before doing any 25-point queue, full-world capture, fixed-region capture, stitching expansion, or website basemap replacement.

## Behavior

The writable F-drive game copy receives one capture-only Lua behavior:

1. the isolated `default-save` loads normally;
2. after the Survival client and local player have remained available for 10 seconds, the script triggers once;
3. it loads the center cell and positions the scripted camera at `(-2464, 1248, 250)`;
4. it continuously applies direction `(0, 0, -1)`, FOV `90`, hidden GUI, and locked controls;
5. after another 8-second settlement period, it prints exactly one audited ready marker;
6. it holds the same camera indefinitely until the exact game process is closed.

Ready marker:

```text
SM_OVERVIEW_CAPTURE_READY mode=single-center point=r2-c2 x=-2464.000 y=1248.000 z=250.000 fov=90 direction=0,0,-1 gui=hidden
```

The existing manual chat commands remain installed for compatibility, but the real capability run does not depend on keyboard input.

## Safety

- The automatic behavior is disabled in repository source by default and is enabled only by an explicit patch option applied to the writable F-drive copy while the game is closed.
- The Steam installation, shared package, and normal AppData remain read-only.
- The patch remains backed up, hash-receipted, canonical-path checked, junction-safe, and idempotent.
- The run uses a fresh isolated user-data root with the DB placed at the proven `Profile\\AppData\\Roaming` save path.
- The exact temporary `steam_appid.txt` remains guarded by its known seven-byte SHA-256 and is deleted after the run.
- Full protected-root fingerprints run before launch and after exit. Acceptance requires `protectedRootsUnchanged: true`.
- No 25-point queue, runtime control file, driver, virtual keyboard, or custom in-game GUI is added.

## Capture and acceptance

Only the center point is captured:

1. bind the unique official game window and require Build 869 at 1920x1080 Borderless with FOV 90;
2. load the unique isolated `default-save` using Computer Use;
3. wait for the exact single-center marker and at least the specified settlement period;
4. move the cursor outside the existing 750x750 crop;
5. save two unmodified Windows.Graphics.Capture frames at least 500 ms apart;
6. run the existing frame validator for `r2-c2` with truthful PID, executable hash, log hash, cursor, and HUD evidence;
7. visually inspect the accepted 750x750 crop at native resolution.

The sample passes only if it is a stable, real official-runtime, vertical top-down scene with north at the top, no HUD/chat/cursor, no black loading area, and no isometric preview. Failure produces no accepted sample and stops without trying other points.

## Testing

Automated tests must prove:

- auto mode is off by default;
- explicit single-center mode inserts exactly one deterministic activation path;
- activation occurs once after the two bounded delays;
- the canonical center coordinates and exact marker cannot drift;
- manual commands still work;
- a second patch run is idempotent;
- missing or duplicated anchors fail before writes;
- receipt hashes distinguish manual-only and single-center modes.

The real run then proves the marker, accepted crop, protected-root equality, and absence of residual processes or temporary AppID files.

## Deliverable

The immediate deliverable is one accepted center PNG plus its evidence and isolation receipts under `F:\\Scrap Mechanical\\runtime-captures`. It is a visual prototype for review and is not installed as the website basemap.
