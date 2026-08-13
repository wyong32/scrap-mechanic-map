# Runtime Surface Capture Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and validate one real 5-by-5, north-up Scrap Mechanic 1.0 Survival map sample from the official game runtime without touching the Steam installation or existing player saves.

**Architecture:** A TypeScript build tool proves process-local user-data isolation, builds a canonical 25-point capture job, safely patches only the writable game copy with a deterministic scripted camera, validates official-runtime screenshots, and stitches them with bounded translation-only alignment. The real GUI run uses Computer Use against the writable copy; all screenshots and receipts remain under `F:\Scrap Mechanical\runtime-captures\default-surface-prototype`, and the website is not changed in this prototype.

**Tech Stack:** TypeScript 5.8, Node.js 22, Sharp 0.35, Vitest 3, Scrap Mechanic `ScrapMechanic.exe` file version `1.0.1.869`, Lua, Windows Computer Use.

## Global Constraints

- The Steam installation `G:\steam\steamapps\common\Scrap Mechanic` is read-only for this plan.
- The supplied package root `G:\共享文件\Scrap Mechanic` is read-only for this plan.
- Existing player-save directories below `%APPDATA%\Axolot Games\Scrap Mechanic` are read-only for this plan.
- The only writable game root is `F:\Scrap Mechanical\tileeditor-working-copy-1.0.1.869`.
- Runtime user data and all capture artifacts must remain below `F:\Scrap Mechanical`.
- Before any Lua patch, the exact working-copy game must prove process-local user-data redirection through both its recorded command line and files/logs created below the redirected root; otherwise execution stops.
- The capture job is exactly 5 rows by 5 columns, centered on default-save cell `(-39, 19)`, with cell size `64`, world center `(-2464, 1248)`, point spacing `350`, camera Z `250`, vertical-down direction `(0, 0, -1)`, north-up yaw, and FOV `90`.
- The required game window is `1920x1080`; the accepted gameplay crop is `left=585`, `top=165`, `width=750`, `height=750`.
- Every accepted coordinate requires two consecutive official-runtime frames whose normalized mean absolute RGB difference is at most `0.015`; retry limit is `3` attempts per coordinate.
- Frames with at least `85%` pixels at luminance `<= 8`, wrong dimensions, missing camera-log proof, visible HUD/menu/chat/cursor in the crop, or unstable pairs are rejected.
- Stitching uses nominal stride `525`, nominal overlap `225`, and translation search radius `48` pixels. It may crop and translate only; rotation, scaling, perspective warp, cloning, generative fill, and substitute images are forbidden.
- TileEditor previews, legacy approximations, terrain-category fills, hand-made references, and similar images are never accepted as runtime captures.
- Real screenshots, redirected user data, patched game files, and capture receipts are external artifacts and are not committed.
- The prototype does not replace the website basemap and does not capture the complete surface or fixed regions.

---

### Task 1: Prove process-local runtime isolation

**Files:**
- Create: `html/tools/runtime-capture/runtime-types.ts`
- Create: `html/tools/runtime-capture/tree-fingerprint.ts`
- Create: `html/tools/runtime-capture/runtime-probe.ts`
- Create: `html/tools/runtime-capture/tree-fingerprint.test.ts`
- Create: `html/tools/runtime-capture/runtime-probe.test.ts`
- Modify: `html/tools/authentic-map/cli.ts`
- Modify: `html/tools/authentic-map/cli.test.ts`

**Interfaces:**
- Produces: `TreeFingerprint`, `RuntimeProbeSession`, and `RuntimeIsolationReceipt` types.
- Produces: `fingerprintTree(root: string): Promise<TreeFingerprint>`.
- Produces: `startRuntimeProbe(options: RuntimeProbeOptions): Promise<RuntimeProbeSession>`.
- Produces: `finishRuntimeProbe(options: FinishRuntimeProbeOptions): Promise<RuntimeIsolationReceipt>`.
- Adds CLI commands `runtime-probe-start` and `runtime-probe-finish` to `data:authentic-map`.
- The finish command is the load-bearing gate consumed by Task 3; it must not claim success unless the redirected root contains a new Scrap Mechanic log and both protected fingerprints are unchanged.

Use these exact option types:

```ts
export interface RuntimeProbeOptions {
  gameRoot: string;
  userDataRoot: string;
  protectedRoots: readonly string[];
  sessionPath: string;
}

export interface FinishRuntimeProbeOptions {
  sessionPath: string;
  receiptPath: string;
}
```

- [ ] **Step 1: Write tree-fingerprint RED tests**

Create fixtures containing nested files, then assert stable relative-path ordering, SHA-256 content identity, file count, byte count, and changed-path reporting. Include a fixture with two files whose names differ only by case and assert Windows comparison normalizes them.

```ts
expect(await fingerprintTree(root)).toMatchObject({
  fileCount: 2,
  totalBytes: 6,
  sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
});
expect(diffFingerprints(before, after).changed).toEqual(["nested/value.txt"]);
```

- [ ] **Step 2: Run the fingerprint tests and verify RED**

Run:

```powershell
cd html
npm.cmd test -- tools/runtime-capture/tree-fingerprint.test.ts
```

Expected: FAIL because `tree-fingerprint.ts` does not exist.

- [ ] **Step 3: Implement canonical protected-root fingerprints**

Implement these exact public shapes in `runtime-types.ts`:

```ts
export interface TreeFingerprint {
  schemaVersion: 1;
  fileCount: number;
  totalBytes: number;
  sha256: string;
  files: readonly { relativePath: string; bytes: number; sha256: string }[];
}

export interface RuntimeProbeSession {
  schemaVersion: 1;
  pid: number;
  executableVersion: "1.0.1.869";
  executableSha256: string;
  startedAt: string;
  commandLine: string;
  userDataRoot: string;
  protectedBefore: Readonly<Record<string, TreeFingerprint>>;
}

export interface RuntimeIsolationReceipt {
  schemaVersion: 1;
  processExecutableSha256: string;
  commandLineSha256: string;
  userDataRoot: string;
  proofLogRelativePath: string;
  proofLogSha256: string;
  protectedRootsUnchanged: true;
}
```

Hash a canonical JSON array of `{relativePath,bytes,sha256}` records. Never include modification times in the aggregate identity. `diffFingerprints` returns sorted added, removed, and changed relative paths.

- [ ] **Step 4: Write runtime-probe RED tests**

Use a temporary fake executable script rather than Scrap Mechanic. Assert:

- `startRuntimeProbe` rejects a user-data root outside `F:\Scrap Mechanical`;
- it rejects a user-data root inside any protected root;
- the child receives `SteamAppId=387990`, `APPDATA=<root>\Roaming`, `LOCALAPPDATA=<root>\Local`, and `USERPROFILE=<root>\Profile`;
- the session records the executable PID, command line, executable hash, and pre-launch protected fingerprints;
- `finishRuntimeProbe` rejects missing redirected logs, a still-running PID, or any protected-root diff;
- errors report relative changed paths but do not echo private absolute paths.

- [ ] **Step 5: Run runtime-probe tests and verify RED**

Run:

```powershell
cd html
npm.cmd test -- tools/runtime-capture/runtime-probe.test.ts
```

Expected: FAIL because the runtime probe is not implemented.

- [ ] **Step 6: Implement the probe launcher and verifier**

`startRuntimeProbe` must:

1. resolve and verify `gameRoot\Release\ScrapMechanic.exe`;
2. read its Windows file version through PowerShell and require `1.0.1.869`;
3. fingerprint every protected root before launch;
4. create only the requested F-drive user-data directories;
5. start the exact executable with `cwd=gameRoot\Release`, no arguments, and a child environment containing the five overrides above plus `SteamAppId=387990`;
6. write the canonical session JSON outside the repository and return immediately after the PID is observable.

`finishRuntimeProbe` must require that the PID exited, find a newly created `*.log` below the redirected root after `startedAt`, require the log to contain `Scrap Mechanic` or `ScrapMechanic`, compute post-run fingerprints, and reject any protected-root change.

- [ ] **Step 7: Wire the two CLI commands**

Add exact usage:

```powershell
npm.cmd run data:authentic-map -- runtime-probe-start `
  --game-root "F:\Scrap Mechanical\tileeditor-working-copy-1.0.1.869" `
  --user-data-root "F:\Scrap Mechanical\runtime-user-data\default-surface-prototype" `
  --protected-root "G:\steam\steamapps\common\Scrap Mechanic" `
  --protected-root "G:\共享文件\Scrap Mechanic" `
  --protected-root "$env:APPDATA\Axolot Games\Scrap Mechanic" `
  --session "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\probe-session.json"
```

and:

```powershell
npm.cmd run data:authentic-map -- runtime-probe-finish `
  --session "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\probe-session.json" `
  --receipt "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\runtime-isolation-receipt.json"
```

Repeated `--protected-root` options must be collected in order; existing single-value option behavior must remain unchanged.

- [ ] **Step 8: Run focused and adjacent tests**

Run:

```powershell
cd html
npm.cmd test -- tools/runtime-capture/tree-fingerprint.test.ts tools/runtime-capture/runtime-probe.test.ts tools/authentic-map/cli.test.ts
npm.cmd run lint
```

Expected: all focused tests pass and TypeScript exits `0`.

- [ ] **Step 9: Execute the real isolation capability gate**

Start the probe with the exact command above. Use `computer-use:computer-use` to observe the working-copy Scrap Mechanic window long enough to create its normal log, then close only that working-copy process. Run `runtime-probe-finish`.

Gate:

- PASS only if the process command line names the F-drive executable, a new log exists below the F-drive redirected root, the Steam install fingerprint is unchanged, and the normal player-save fingerprint is unchanged.
- BLOCKED if any proof is missing. Do not continue to Task 2 and do not patch Lua.

- [ ] **Step 10: Commit Task 1**

```powershell
git add html/tools/runtime-capture/runtime-types.ts `
  html/tools/runtime-capture/tree-fingerprint.ts `
  html/tools/runtime-capture/runtime-probe.ts `
  html/tools/runtime-capture/tree-fingerprint.test.ts `
  html/tools/runtime-capture/runtime-probe.test.ts `
  html/tools/authentic-map/cli.ts `
  html/tools/authentic-map/cli.test.ts
git commit -m "feat: prove isolated runtime capture root"
```

---

### Task 2: Build the canonical 5-by-5 capture job

**Files:**
- Create: `html/tools/runtime-capture/capture-job.ts`
- Create: `html/tools/runtime-capture/capture-job.test.ts`
- Modify: `html/tools/runtime-capture/runtime-types.ts`
- Modify: `html/tools/authentic-map/cli.ts`

**Interfaces:**
- Produces: `RuntimeCaptureJob` and `RuntimeCapturePoint`.
- Produces: `buildRuntimeCaptureJob(sourceSaveSha256: string): RuntimeCaptureJob`.
- Adds CLI command `runtime-job`.
- Task 4 consumes the exact point IDs, coordinates, crop, stability, and retry contract.

- [ ] **Step 1: Write capture-job RED tests**

Assert exactly 25 row-major points with these corners and center:

```ts
expect(job.points).toHaveLength(25);
expect(job.points[0]).toMatchObject({ id: "r0-c0", row: 0, column: 0, x: -3164, y: 1948, z: 250 });
expect(job.points[12]).toMatchObject({ id: "r2-c2", row: 2, column: 2, x: -2464, y: 1248, z: 250 });
expect(job.points[24]).toMatchObject({ id: "r4-c4", row: 4, column: 4, x: -1764, y: 548, z: 250 });
expect(job.camera).toEqual({
  direction: [0, 0, -1],
  northUp: true,
  fov: 90,
  window: { width: 1920, height: 1080 },
  crop: { left: 585, top: 165, width: 750, height: 750 }
});
```

Also assert schema version `1`, spacing `350`, nominal stride `525`, overlap `225`, search radius `48`, stability threshold `0.015`, retry limit `3`, canonical key ordering, and deterministic `contentHash`.

- [ ] **Step 2: Run the capture-job test and verify RED**

Run:

```powershell
cd html
npm.cmd test -- tools/runtime-capture/capture-job.test.ts
```

Expected: FAIL because the builder is absent.

- [ ] **Step 3: Implement the exact job types**

Add:

```ts
export interface RuntimeCapturePoint {
  id: `r${number}-c${number}`;
  row: number;
  column: number;
  x: number;
  y: number;
  z: 250;
}

export interface RuntimeCaptureJob {
  schemaVersion: 1;
  gameVersion: "1.0.0";
  executableVersion: "1.0.1.869";
  sourceSaveSha256: string;
  centerCell: { x: -39; y: 19; cellSize: 64 };
  spacing: 350;
  camera: {
    direction: readonly [0, 0, -1];
    northUp: true;
    fov: 90;
    window: { width: 1920; height: 1080 };
    crop: { left: 585; top: 165; width: 750; height: 750 };
  };
  validation: { stabilityThreshold: 0.015; retryLimit: 3; darkLuminance: 8; maxDarkRatio: 0.85 };
  stitch: { nominalStride: 525; nominalOverlap: 225; searchRadius: 48 };
  points: readonly RuntimeCapturePoint[];
  contentHash: string;
}
```

Derive the world center with `cell * 64 + 32`, columns from `centerX - 700` through `centerX + 700`, and rows from `centerY + 700` down through `centerY - 700` so row zero is north.

- [ ] **Step 4: Implement canonical job output and CLI**

`runtime-job` requires:

```powershell
npm.cmd run data:authentic-map -- runtime-job `
  --save "public/data/default-save.db" `
  --output "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\capture-job.json"
```

It hashes the save, refuses output inside the repository or any game root, writes canonical JSON plus newline, and prints only non-private statistics: `points`, `rows`, `columns`, `crop`, and `contentHash`.

- [ ] **Step 5: Run focused tests and lint**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/capture-job.test.ts tools/authentic-map/cli.test.ts
npm.cmd run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add html/tools/runtime-capture/capture-job.ts `
  html/tools/runtime-capture/capture-job.test.ts `
  html/tools/runtime-capture/runtime-types.ts `
  html/tools/authentic-map/cli.ts
git commit -m "feat: define runtime capture prototype job"
```

---

### Task 3: Apply an idempotent capture-only Lua patch

**Files:**
- Create: `html/tools/runtime-capture/lua/SmOverviewCapture.lua`
- Create: `html/tools/runtime-capture/runtime-patch.ts`
- Create: `html/tools/runtime-capture/runtime-patch.test.ts`
- Modify: `html/tools/runtime-capture/runtime-types.ts`
- Modify: `html/tools/authentic-map/cli.ts`

**Interfaces:**
- Consumes: a verified `RuntimeIsolationReceipt` from Task 1.
- Produces: `RuntimePatchReceipt` with original/patched hashes and backup paths.
- Produces: `applyRuntimePatch(options: RuntimePatchOptions): Promise<RuntimePatchReceipt>`.
- Adds CLI command `runtime-patch`.
- The Lua patch exposes `/smoverview_capture x y z` and `/smoverview_capture_off` only in the writable copy.

- [ ] **Step 1: Write patcher RED tests with a modern SurvivalGame fixture**

The fixture must contain the exact 1.0 anchors:

```lua
function SurvivalGame.bindChatCommands( self )
function SurvivalGame.cl_onChatCommand( self, params )
function SurvivalGame.client_onUpdate( self, dt )
```

Assert the patcher:

- refuses a game root outside `F:\Scrap Mechanical`;
- refuses a missing or invalid isolation receipt;
- creates a byte-identical backup before editing;
- adds one `dofile`, one bind call, one client handler call, one update call, and one server callback;
- installs `SmOverviewCapture.lua` with a recorded SHA-256;
- is idempotent on a second run;
- rejects duplicate or missing anchors without writing either file.

- [ ] **Step 2: Run patcher tests and verify RED**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/runtime-patch.test.ts
```

Expected: FAIL because the patcher is absent.

- [ ] **Step 3: Implement `SmOverviewCapture.lua`**

The script must bind exact numeric arguments and keep all capture state in
`self.cl.smOverviewCapture`:

```lua
SmOverviewCapture = {}

function SmOverviewCapture.bind( self )
    sm.game.bindChatCommand( "/smoverview_capture", {
        { "number", "x", false },
        { "number", "y", false },
        { "number", "z", false }
    }, "cl_onChatCommand", "Set the audited overview capture camera" )
    sm.game.bindChatCommand( "/smoverview_capture_off", {}, "cl_onChatCommand", "Disable the overview capture camera" )
end

function SmOverviewCapture.handleClient( self, params )
    if params[1] == "/smoverview_capture" then
        local position = sm.vec3.new( params[2], params[3], params[4] )
        self.cl.smOverviewCapture = { position = position, fov = 90 }
        self.network:sendToServer( "sv_smOverviewCaptureTeleport", { position = position } )
        print( string.format( "SM_OVERVIEW_CAPTURE_READY x=%.3f y=%.3f z=%.3f fov=90 direction=0,0,-1 gui=hidden", params[2], params[3], params[4] ) )
        return true
    elseif params[1] == "/smoverview_capture_off" then
        self.cl.smOverviewCapture = nil
        sm.gui.hideGui( false )
        sm.localPlayer.setLockedControls( false )
        print( "SM_OVERVIEW_CAPTURE_OFF" )
        return true
    end
    return false
end

function SmOverviewCapture.update( self )
    local capture = self.cl.smOverviewCapture
    if capture == nil then return end
    sm.gui.hideGui( true )
    sm.localPlayer.setLockedControls( true )
    sm.camera.setCameraState( sm.camera.state.scriptedTP )
    sm.camera.setPosition( capture.position )
    sm.camera.setDirection( sm.vec3.new( 0, 0, -1 ) )
    sm.camera.setFov( capture.fov )
end

function SmOverviewCapture.teleport( self, params, player )
    local pos = params.position
    local cellX, cellY = math.floor( pos.x / 64 ), math.floor( pos.y / 64 )
    self.sv.saved.overworld:loadCell( cellX, cellY, player, "sv_recreatePlayerCharacter", {
        pos = pos,
        dir = sm.vec3.new( 0, 1, 0 )
    } )
end
```

- [ ] **Step 4: Implement the four minimal SurvivalGame insertions**

Insert marker-bounded calls only:

```lua
dofile( "$SURVIVAL_DATA/Scripts/game/SmOverviewCapture.lua" )
```

At the end of `bindChatCommands` call `SmOverviewCapture.bind( self )`. At the first line of `cl_onChatCommand`, return when `SmOverviewCapture.handleClient` returns true. At the first line of `client_onUpdate`, call `SmOverviewCapture.update( self )`. Add:

```lua
function SurvivalGame.sv_smOverviewCaptureTeleport( self, params, player )
    SmOverviewCapture.teleport( self, params, player )
end
```

Do not change `g_survivalDev`, existing commands, inventory settings, time defaults, or any source outside the writable copy.

- [ ] **Step 5: Implement patch receipts and CLI**

Exact command:

```powershell
npm.cmd run data:authentic-map -- runtime-patch `
  --game-root "F:\Scrap Mechanical\tileeditor-working-copy-1.0.1.869" `
  --isolation-receipt "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\runtime-isolation-receipt.json" `
  --backup-root "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\game-backup" `
  --receipt "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\runtime-patch-receipt.json"
```

The receipt records the original, backup, patched, and companion-script hashes. Refuse an existing backup with a different hash.

- [ ] **Step 6: Run focused tests and lint**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/runtime-patch.test.ts tools/authentic-map/cli.test.ts
npm.cmd run lint
```

Expected: PASS.

- [ ] **Step 7: Apply the patch only after the real Task 1 gate passed**

Run the exact command from Step 5. Compare the two recorded source files with the receipt. Do not launch the game in this step.

- [ ] **Step 8: Commit Task 3**

```powershell
git add html/tools/runtime-capture/lua/SmOverviewCapture.lua `
  html/tools/runtime-capture/runtime-patch.ts `
  html/tools/runtime-capture/runtime-patch.test.ts `
  html/tools/runtime-capture/runtime-types.ts `
  html/tools/authentic-map/cli.ts
git commit -m "feat: prepare isolated runtime capture camera"
```

---

### Task 4: Validate and accept official-runtime frame pairs

**Files:**
- Create: `html/tools/runtime-capture/frame-validation.ts`
- Create: `html/tools/runtime-capture/frame-validation.test.ts`
- Modify: `html/tools/runtime-capture/runtime-types.ts`
- Modify: `html/tools/authentic-map/cli.ts`

**Interfaces:**
- Produces: `RuntimeFrameEvidence`, `AcceptedRuntimeFrame`, and `RuntimeCaptureManifest`.
- Produces: `validateRuntimeFramePair(job, point, inputs): Promise<AcceptedRuntimeFrame>`.
- Adds CLI command `runtime-frame-accept`.
- Task 5 consumes only accepted 750x750 crops and their hashes.

- [ ] **Step 1: Write frame-validation RED tests**

Generate PNG fixtures with Sharp. Cover:

- two identical 1920x1080 frames pass and produce a 750x750 crop;
- normalized mean absolute RGB difference `0.015` passes and `0.0151` fails;
- dark ratio `0.85` passes and `0.8501` fails;
- 1919x1080 and 1920x1079 fail;
- missing `SM_OVERVIEW_CAPTURE_READY` log evidence fails;
- wrong X, Y, Z, FOV, direction, or `gui=hidden` token fails;
- `cursorOutsideCrop: false`, `hudReviewedHidden: false`, or mismatched PID fails;
- output outside the declared capture root fails;
- a rejected attempt creates no accepted crop or manifest entry.

- [ ] **Step 2: Run frame-validation tests and verify RED**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/frame-validation.test.ts
```

Expected: FAIL because validation is absent.

- [ ] **Step 3: Implement evidence and accepted-frame types**

```ts
export interface RuntimeFrameEvidence {
  schemaVersion: 1;
  pointId: RuntimeCapturePoint["id"];
  pid: number;
  executableSha256: string;
  firstFrame: string;
  secondFrame: string;
  cameraLog: string;
  cameraLogSha256: string;
  cursorOutsideCrop: true;
  hudReviewedHidden: true;
  capturedAt: string;
}

export interface AcceptedRuntimeFrame {
  pointId: RuntimeCapturePoint["id"];
  file: string;
  sha256: string;
  width: 750;
  height: 750;
  normalizedMeanAbsoluteDifference: number;
  darkRatio: number;
  attempt: 1 | 2 | 3;
}
```

- [ ] **Step 4: Implement deterministic image checks**

Use Sharp raw RGB buffers. Crop both full frames with the job rectangle. Compute:

```ts
normalizedMeanAbsoluteDifference = sum(abs(a[i] - b[i])) / (bufferLength * 255);
darkRatio = darkPixels / pixelCount;
```

where luminance is `0.2126*r + 0.7152*g + 0.0722*b`. Accept the second frame unchanged as the canonical crop only after all evidence and thresholds pass. Write it as lossless PNG with deterministic Sharp settings and compute its SHA-256 after writing.

- [ ] **Step 5: Implement CLI acceptance**

Exact per-point command pattern:

```powershell
npm.cmd run data:authentic-map -- runtime-frame-accept `
  --job "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\capture-job.json" `
  --point "r0-c0" `
  --first "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\source\r0-c0-a1.png" `
  --second "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\source\r0-c0-b1.png" `
  --evidence "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\evidence\r0-c0-a1.json" `
  --output-root "F:\Scrap Mechanical\runtime-captures\default-surface-prototype"
```

The command atomically adds or replaces that point's accepted entry in `capture-manifest.json`. It refuses attempt `4` and refuses a different accepted image for an already accepted point unless the previous entry is explicitly removed by the operator outside the command.

- [ ] **Step 6: Run focused tests and lint**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/frame-validation.test.ts tools/authentic-map/cli.test.ts
npm.cmd run lint
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add html/tools/runtime-capture/frame-validation.ts `
  html/tools/runtime-capture/frame-validation.test.ts `
  html/tools/runtime-capture/runtime-types.ts `
  html/tools/authentic-map/cli.ts
git commit -m "feat: validate runtime capture frames"
```

---

### Task 5: Stitch the accepted grid without resampling

**Files:**
- Create: `html/tools/runtime-capture/overlap-alignment.ts`
- Create: `html/tools/runtime-capture/overlap-alignment.test.ts`
- Create: `html/tools/runtime-capture/stitch-runtime-grid.ts`
- Create: `html/tools/runtime-capture/stitch-runtime-grid.test.ts`
- Modify: `html/tools/runtime-capture/runtime-types.ts`
- Modify: `html/tools/authentic-map/cli.ts`

**Interfaces:**
- Produces: `estimateNeighborTranslation(left, right, contract): Promise<NeighborAlignment>`.
- Produces: `stitchRuntimeGrid(job, manifest, outputRoot): Promise<RuntimeStitchReceipt>`.
- Adds CLI command `runtime-stitch`.

- [ ] **Step 1: Write overlap-alignment RED tests**

Create textured synthetic 750x750 neighbors cut from one larger source. Assert exact recovery for X/Y offsets at `-48`, `0`, and `48`, deterministic tie-breaking by smallest absolute offset then X then Y, and rejection when the best normalized error exceeds `0.08`.

- [ ] **Step 2: Run overlap tests and verify RED**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/overlap-alignment.test.ts
```

Expected: FAIL because alignment is absent.

- [ ] **Step 3: Implement bounded translation search**

Downsample comparison strips to one quarter for scoring, but return full-resolution integer offsets. Search only within `nominalStride ± 48` along the joining axis and `±48` on the cross axis. Score mean absolute luminance error on the true shared overlap. Never rotate or resize source frames.

- [ ] **Step 4: Write stitcher RED tests**

Assert:

- a complete 5x5 manifest produces one image and 40 neighbor alignment records;
- any missing point, hash mismatch, non-750x750 input, or failed neighbor blocks output;
- output pixels come byte-for-byte from one accepted source frame after crop/translation; no interpolated pixel is introduced;
- repeated input produces identical PNG and receipt hashes;
- the output is north-up, with `r0-c0` at the northwest and `r4-c4` at the southeast.

- [ ] **Step 5: Run stitcher tests and verify RED**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/stitch-runtime-grid.test.ts
```

Expected: FAIL because stitching is absent.

- [ ] **Step 6: Implement hard-midpoint seam composition**

Place frames from their solved translations. For every overlap, choose the midpoint seam and copy pixels from exactly one source side. Do not alpha-blend. Record each source frame's final origin, crop rectangle, and every neighbor score in `RuntimeStitchReceipt`.

- [ ] **Step 7: Add `runtime-stitch` CLI**

```powershell
npm.cmd run data:authentic-map -- runtime-stitch `
  --job "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\capture-job.json" `
  --manifest "F:\Scrap Mechanical\runtime-captures\default-surface-prototype\capture-manifest.json" `
  --output-root "F:\Scrap Mechanical\runtime-captures\default-surface-prototype"
```

Outputs:

```text
stitched/default-surface-5x5.png
reports/stitch-receipt.json
```

- [ ] **Step 8: Run focused tests and lint**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/overlap-alignment.test.ts tools/runtime-capture/stitch-runtime-grid.test.ts tools/authentic-map/cli.test.ts
npm.cmd run lint
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```powershell
git add html/tools/runtime-capture/overlap-alignment.ts `
  html/tools/runtime-capture/overlap-alignment.test.ts `
  html/tools/runtime-capture/stitch-runtime-grid.ts `
  html/tools/runtime-capture/stitch-runtime-grid.test.ts `
  html/tools/runtime-capture/runtime-types.ts `
  html/tools/authentic-map/cli.ts
git commit -m "feat: stitch runtime capture grid"
```

---

### Task 6: Capture the real 5-by-5 official-runtime sample

**Files:**
- External only: `F:\Scrap Mechanical\runtime-user-data\default-surface-prototype\`
- External only: `F:\Scrap Mechanical\runtime-captures\default-surface-prototype\`
- Modify after the run: `html/README.md`

**Interfaces:**
- Consumes: the Task 1 isolation receipt, Task 2 job, Task 3 patch receipt, Task 4 frame acceptor, and Task 5 stitcher.
- Produces externally: 25 accepted crops, 25 evidence records, `capture-manifest.json`, the stitched PNG, and stitch receipt.
- Produces in the repository: reproducible operator instructions only; no real image is committed.

- [ ] **Step 1: Read the Computer Use skill and verify protected preconditions**

Read `computer-use:computer-use` in full. Re-run protected-root fingerprints and confirm the working-copy process is not running. Verify the exact patched executable version remains `1.0.1.869`.

- [ ] **Step 2: Populate only the redirected test-save root**

With the game closed, copy `html/public/data/default-save.db` into the save directory created below the proven redirected user-data root. Do not write to `%APPDATA%\Axolot Games\Scrap Mechanic`. Record the copied DB SHA-256 in the capture job and create a second byte-identical backup below the capture root.

- [ ] **Step 3: Generate the canonical job**

Run the Task 2 command and verify the 25 point coordinates and content hash against the job tests.

- [ ] **Step 4: Launch the patched game with the proven isolated environment**

Use the same process environment and working directory proven by Task 1. Use Computer Use for every GUI action. Select only the redirected default test save. Set borderless `1920x1080`, FOV `90`, daytime `0.5`, time progression off, and god mode on.

- [ ] **Step 5: Prove one capability coordinate before the batch**

At `r2-c2`, enter:

```text
/smoverview_capture -2464 1248 250
```

Wait at least four seconds, confirm the log contains the exact ready marker, move the cursor outside the 750x750 crop, and save two Computer Use window captures 500 ms apart. Write a truthful evidence JSON with the process PID, executable hash, log hash, `cursorOutsideCrop: true`, and `hudReviewedHidden: true`. Run `runtime-frame-accept`.

Save the unmodified Computer Use window image from the documented data URL; do not use a browser screenshot or resize it:

```js
const state = await sky.get_window_state({
  window: gameWindow,
  include_screenshot: true,
  include_text: false
});
const screenshot = [...state.screenshots].sort((a, b) => a.zIndex - b.zIndex).at(-1);
if (!screenshot?.url.startsWith("data:image/png;base64,")) throw new Error("PNG window capture is unavailable");
const bytes = Buffer.from(screenshot.url.split(",", 2)[1], "base64");
await (await import("node:fs/promises")).writeFile(sourcePath, bytes);
```

Gate: the resulting crop must visibly show a vertical top-down official scene with north at the top, no HUD/chat/cursor, no black loading block, and no isometric preview. If this fails, stop with `BLOCKED`; do not capture the other 24 points.

- [ ] **Step 6: Capture all 25 coordinates in row-major order**

For each point, issue `/smoverview_capture x y 250`, wait for the ready marker and at least four seconds, then save two full-window frames 500 ms apart. Run `runtime-frame-accept` immediately. Retry only the same point, at most three attempts. Do not advance after a rejection.

- [ ] **Step 7: Close the working-copy game and finish protected-root verification**

Use `/smoverview_capture_off`, close the working-copy process, and compute post-run fingerprints. Any Steam-install or normal-save-root change blocks acceptance and must be reported without automatic cleanup.

- [ ] **Step 8: Stitch the accepted grid**

Run `runtime-stitch`. Require 25 accepted frames and 40 passing neighbor records. Open the native stitched PNG and inspect roads, shoreline, vegetation, and the building/POI region.

- [ ] **Step 9: Document the reproducible operator workflow**

Add a `Runtime 5x5 capture prototype` section to `html/README.md` containing the exact CLI commands, external directory layout, safety gate, camera command, frame retry rule, stitch command, and explicit statement that the sample is not the website basemap.

- [ ] **Step 10: Commit Task 6 documentation only**

```powershell
git add html/README.md
git commit -m "docs: explain runtime capture prototype"
```

---

### Task 7: Verify the prototype and prepare the acceptance report

**Files:**
- Create: `html/tools/runtime-capture/runtime-report.ts`
- Create: `html/tools/runtime-capture/runtime-report.test.ts`
- Modify: `html/tools/authentic-map/cli.ts`
- External only: `F:\Scrap Mechanical\runtime-captures\default-surface-prototype\reports\capture-report.json`

**Interfaces:**
- Produces: `buildRuntimeCaptureReport(job, isolation, patch, manifest, stitch, fingerprints): RuntimeCaptureReport`.
- Adds CLI command `runtime-report`.
- The report contains aggregate evidence only and must not expose player names, private save paths, Steam account IDs, DB seed, or absolute protected-root paths.

- [ ] **Step 1: Write report RED tests**

Assert a valid report contains:

```ts
expect(report).toMatchObject({
  schemaVersion: 1,
  status: "accepted",
  gameExecutableVersion: "1.0.1.869",
  pointsExpected: 25,
  pointsAccepted: 25,
  neighborAlignments: 40,
  protectedRootsUnchanged: true,
  transforms: "translation-and-crop-only"
});
```

Assert rejection for 24 frames, a failed neighbor, a protected-root diff, missing capability evidence, or an image/hash mismatch. Scan serialized output for drive roots, `User_`, `.db` filenames, and UUID-like account identifiers.

- [ ] **Step 2: Run report tests and verify RED**

```powershell
cd html
npm.cmd test -- tools/runtime-capture/runtime-report.test.ts
```

Expected: FAIL because report generation is absent.

- [ ] **Step 3: Implement aggregate report generation and CLI**

Exact command:

```powershell
npm.cmd run data:authentic-map -- runtime-report `
  --capture-root "F:\Scrap Mechanical\runtime-captures\default-surface-prototype"
```

Write canonical `reports/capture-report.json`. Status is `accepted` only when every gate passes; otherwise write `blocked` with non-private reason codes and do not claim a stitched sample is accepted.

- [ ] **Step 4: Run the complete automated suite**

```powershell
cd html
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all tests pass, TypeScript exits `0`, and Vite build exits `0`.

- [ ] **Step 5: Run the real report and inspect native artifacts**

Run `runtime-report`, open `stitched/default-surface-5x5.png` at native resolution, and verify all acceptance conditions from the design. Record any visible seam with its two source point IDs; do not edit the image to conceal it.

- [ ] **Step 6: Commit Task 7**

```powershell
git add html/tools/runtime-capture/runtime-report.ts `
  html/tools/runtime-capture/runtime-report.test.ts `
  html/tools/authentic-map/cli.ts
git commit -m "feat: report runtime capture acceptance"
```

---

## Final review gate

After Tasks 1–7, dispatch one whole-branch reviewer on the most capable available model. The reviewer must inspect the complete branch diff, the SDD ledger, every real capability receipt, protected-root pre/post evidence, the 25-frame manifest, all 40 neighbor alignments, and the native stitched screenshot. A missing or failed real-runtime artifact is load-bearing and blocks completion; tests with synthetic PNGs cannot substitute for the real capability run.

If the final review is clean, use `superpowers:finishing-a-development-branch`. This prototype still does not authorize full-world capture or website basemap replacement; those require the next approved design.
