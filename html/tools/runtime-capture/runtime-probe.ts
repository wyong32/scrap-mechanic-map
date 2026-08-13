import { createHash, randomBytes } from "node:crypto";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import type {
  FinishRuntimeProbeOptions,
  RuntimeIsolationReceipt,
  RuntimeProbeOptions,
  RuntimeProbeSession,
  TreeFingerprint,
} from "./runtime-types.ts";
import { diffFingerprints, fingerprintTree } from "./tree-fingerprint.ts";

const execFileAsync = promisify(execFile);
const APPROVED_USER_DATA_PARENT = "F:\\Scrap Mechanical";
const EXECUTABLE_VERSION = "1.0.1.869";
const SESSION_MARKER_NAME = ".runtime-probe-session";
const SESSION_LOCK_NAME = ".runtime-probe.lock";
const POWERSHELL_OUTPUT_LIMIT = 256 * 1024 * 1024;
const PROCESS_OBSERVATION_TIMEOUT_MS = 5_000;
const PROCESS_OBSERVATION_POLL_INTERVAL_MS = 50;
const LAUNCHER_PID_LINE_TIMEOUT_MS = 5_000;
const LAUNCHER_PID_LINE_MAX_BYTES = 64;
const STARTUP_OBSERVATION_MS = 1_500;
const PROCESS_START_INFO_LAUNCHER_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$privateNames = @(
  'SM_RUNTIME_EXECUTABLE',
  'SM_RUNTIME_WORKING_DIRECTORY',
  'SM_RUNTIME_ROAMING',
  'SM_RUNTIME_LOCAL',
  'SM_RUNTIME_PROFILE'
)
foreach ($name in $privateNames) {
  if ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) {
    exit 125
  }
}
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $env:SM_RUNTIME_EXECUTABLE
$startInfo.WorkingDirectory = $env:SM_RUNTIME_WORKING_DIRECTORY
$startInfo.UseShellExecute = $false
foreach ($name in $privateNames) {
  [void]$startInfo.EnvironmentVariables.Remove($name)
}
$startInfo.EnvironmentVariables['SteamAppId'] = '387990'
$startInfo.EnvironmentVariables['APPDATA'] = $env:SM_RUNTIME_ROAMING
$startInfo.EnvironmentVariables['LOCALAPPDATA'] = $env:SM_RUNTIME_LOCAL
$startInfo.EnvironmentVariables['USERPROFILE'] = $env:SM_RUNTIME_PROFILE
$game = [Diagnostics.Process]::new()
$game.StartInfo = $startInfo
$gameStarted = $false
try {
  if (-not $game.Start()) {
    exit 125
  }
  $gameStarted = $true
  [Console]::Out.WriteLine([string]$game.Id)
  [Console]::Out.Flush()
  $game.WaitForExit()
  $gameExitCode = $game.ExitCode
} catch {
  if ($gameStarted -and -not $game.HasExited) {
    $game.Kill()
    $game.WaitForExit()
  }
  exit 125
} finally {
  $game.Dispose()
}
exit $gameExitCode
`;

interface RuntimeProbeStoredPayload {
  schemaVersion: 1;
  sessionPath: string;
  sessionId: string;
  processCreatedAt: string;
  session: RuntimeProbeSession;
}

interface RuntimeProbeSessionEnvelope {
  schemaVersion: 1;
  protectedPayload: string;
}

interface RuntimeProbeLock {
  handle: FileHandle;
  lockPath: string;
  ownerToken: string;
}

interface ObservedProcessIdentity {
  executablePath: string;
  commandLine: string;
  createdAt: string;
}

interface ProcessObservationOptions {
  readIdentity?: (
    pid: number,
    signal: AbortSignal,
  ) => Promise<ObservedProcessIdentity | undefined>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface StartRuntimeProbeDependencies {
  observation?: ProcessObservationOptions;
  spawnLauncher?: (
    executable: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  pidLineTimeoutMs?: number;
}

interface RuntimeProbeActiveMarker {
  schemaVersion: 1;
  state: "active";
  sessionId: string;
  pid: number;
  sessionPathSha256: string;
  startedAt: string;
  processCreatedAt: string;
  executablePathSha256: string;
  executableSha256: string;
  commandLineSha256: string;
}

interface RuntimeProbeConsumedMarker {
  schemaVersion: 1;
  state: "consumed";
  sessionId: string;
}

type RuntimeProbeMarker = RuntimeProbeActiveMarker | RuntimeProbeConsumedMarker;

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

async function runPowerShellTransform(
  command: string,
  input: string,
): Promise<string> {
  return await new Promise<string>((resolveTransform, rejectTransform) => {
    let child: ChildProcess;
    try {
      child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
    } catch {
      rejectTransform(new Error("transform failed"));
      return;
    }
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // The helper may already have exited.
      }
      rejectTransform(new Error("transform failed"));
    };
    if (!child.stdin || !child.stdout || !child.stderr) {
      fail();
      return;
    }
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > POWERSHELL_OUTPUT_LIMIT) {
        fail();
        return;
      }
      output.push(chunk);
    });
    child.stderr.resume();
    child.once("error", fail);
    child.stdin.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        rejectTransform(new Error("transform failed"));
        return;
      }
      resolveTransform(Buffer.concat(output).toString("utf8"));
    });
    child.stdin.end(input, "utf8");
  });
}

async function protectCanonicalValue(
  value: unknown,
  failureMessage: string,
): Promise<string> {
  try {
    const protectedPayload = (await runPowerShellTransform(
      "Add-Type -AssemblyName System.Security; $text = [Console]::In.ReadToEnd(); $plain = [Text.Encoding]::UTF8.GetBytes($text); $sealed = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($sealed))",
      canonicalJson(value),
    )).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(protectedPayload)) {
      throw new Error("invalid");
    }
    return protectedPayload;
  } catch {
    throw new Error(failureMessage);
  }
}

async function unprotectCanonicalValue(
  protectedPayload: string,
  failureMessage: string,
): Promise<unknown> {
  try {
    const plaintext = await runPowerShellTransform(
      "Add-Type -AssemblyName System.Security; $text = [Console]::In.ReadToEnd(); $sealed = [Convert]::FromBase64String($text); $plain = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
      protectedPayload,
    );
    return JSON.parse(plaintext) as unknown;
  } catch {
    throw new Error(failureMessage);
  }
}

async function acquireRuntimeProbeLock(
  userDataRoot: string,
): Promise<RuntimeProbeLock> {
  const lockPath = join(userDataRoot, SESSION_LOCK_NAME);
  const ownerToken = randomBytes(32).toString("hex");
  let lock: RuntimeProbeLock | undefined;
  try {
    const handle = await open(lockPath, "wx");
    lock = { handle, lockPath, ownerToken };
    await lock.handle.writeFile(`${ownerToken}\n`, "utf8");
    await lock.handle.sync();
  } catch {
    if (lock) await releaseRuntimeProbeLock(lock);
    throw new Error("Runtime probe session is busy.");
  }
  return lock;
}

async function releaseRuntimeProbeLock(lock: RuntimeProbeLock): Promise<void> {
  let stillOwned = false;
  try {
    stillOwned = (await readFile(lock.lockPath, "utf8")).trim()
      === lock.ownerToken;
  } catch {
    // A missing or replaced lock must never be deleted as if it were ours.
  }
  try {
    await lock.handle.close();
  } catch {
    // The handle may already have been closed after an I/O failure.
  }
  if (!stillOwned) return;
  try {
    const ownerAfterClose = (await readFile(lock.lockPath, "utf8")).trim();
    if (ownerAfterClose === lock.ownerToken) await unlink(lock.lockPath);
  } catch {
    // Fail closed: an unreleased lock prevents later overlapping probes.
  }
}

function activeMarkerFor(
  payload: RuntimeProbeStoredPayload,
): RuntimeProbeActiveMarker {
  const executablePath = commandLineExecutable(payload.session.commandLine);
  if (!executablePath) throw new Error("invalid");
  return {
    schemaVersion: 1,
    state: "active",
    sessionId: payload.sessionId,
    pid: payload.session.pid,
    sessionPathSha256: digest(comparablePath(payload.sessionPath)),
    startedAt: payload.session.startedAt,
    processCreatedAt: payload.processCreatedAt,
    executablePathSha256: digest(comparablePath(resolve(executablePath))),
    executableSha256: payload.session.executableSha256,
    commandLineSha256: digest(payload.session.commandLine),
  };
}

function isActiveMarker(value: unknown): value is RuntimeProbeActiveMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  const expectedKeys = [
    "commandLineSha256",
    "executablePathSha256",
    "executableSha256",
    "pid",
    "processCreatedAt",
    "schemaVersion",
    "sessionId",
    "sessionPathSha256",
    "startedAt",
    "state",
  ].sort();
  return Object.keys(marker).sort().join("\n") === expectedKeys.join("\n")
    && marker.schemaVersion === 1
    && marker.state === "active"
    && typeof marker.sessionId === "string"
    && /^[a-f0-9]{64}$/.test(marker.sessionId)
    && Number.isSafeInteger(marker.pid)
    && (marker.pid as number) > 0
    && typeof marker.startedAt === "string"
    && Number.isFinite(Date.parse(marker.startedAt))
    && typeof marker.processCreatedAt === "string"
    && Number.isFinite(Date.parse(marker.processCreatedAt))
    && [
      marker.sessionPathSha256,
      marker.executablePathSha256,
      marker.executableSha256,
      marker.commandLineSha256,
    ].every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}

function isConsumedMarker(value: unknown): value is RuntimeProbeConsumedMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return Object.keys(marker).sort().join("\n")
      === ["schemaVersion", "sessionId", "state"].join("\n")
    && marker.schemaVersion === 1
    && marker.state === "consumed"
    && typeof marker.sessionId === "string"
    && /^[a-f0-9]{64}$/.test(marker.sessionId);
}

async function writeSealedMarker(
  userDataRoot: string,
  marker: RuntimeProbeMarker,
): Promise<void> {
  const envelope: RuntimeProbeSessionEnvelope = {
    schemaVersion: 1,
    protectedPayload: await protectCanonicalValue(
      marker,
      "Runtime probe marker could not be sealed.",
    ),
  };
  await writeFile(
    join(userDataRoot, SESSION_MARKER_NAME),
    canonicalJson(envelope),
    "utf8",
  );
}

async function readMarker(
  userDataRoot: string,
): Promise<RuntimeProbeMarker | undefined> {
  let text: string;
  try {
    text = await readFile(join(userDataRoot, SESSION_MARKER_NAME), "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (code === "ENOENT") return undefined;
    throw new Error("invalid");
  }
  try {
    const envelope: unknown = JSON.parse(text);
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new Error("invalid");
    }
    const record = envelope as Record<string, unknown>;
    if (
      Object.keys(record).sort().join("\n")
        !== ["protectedPayload", "schemaVersion"].join("\n")
      || record.schemaVersion !== 1
      || typeof record.protectedPayload !== "string"
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.protectedPayload)
    ) throw new Error("invalid");
    const marker = await unprotectCanonicalValue(
      record.protectedPayload,
      "invalid",
    );
    if (!isActiveMarker(marker) && !isConsumedMarker(marker)) {
      throw new Error("invalid");
    }
    return marker;
  } catch {
    throw new Error("invalid");
  }
}

async function readActiveMarker(
  userDataRoot: string,
): Promise<RuntimeProbeActiveMarker | undefined> {
  const marker = await readMarker(userDataRoot);
  return marker?.state === "active" ? marker : undefined;
}

async function rejectOverlappingLiveProbe(
  userDataRoot: string,
  expectedExecutable: string,
  expectedExecutableSha256: string,
): Promise<void> {
  let marker: RuntimeProbeActiveMarker | undefined;
  try {
    marker = await readActiveMarker(userDataRoot);
  } catch {
    throw new Error("A Scrap Mechanic runtime probe is already running.");
  }
  if (marker && await processIsRunning(marker.pid)) {
    let observed: ObservedProcessIdentity;
    try {
      observed = await readProcessIdentity(marker.pid);
    } catch {
      throw new Error("A Scrap Mechanic runtime probe is already running.");
    }
    if (Date.parse(observed.createdAt) === Date.parse(marker.processCreatedAt)) {
      const createdAt = Date.parse(observed.createdAt);
      const startedAt = Date.parse(marker.startedAt);
      let executableHashMatches = false;
      try {
        executableHashMatches = digest(await readFile(observed.executablePath))
          === marker.executableSha256;
      } catch {
        // An unverifiable still-live process must block an overlapping launch.
      }
      const identityMatches = digest(comparablePath(observed.executablePath))
          === marker.executablePathSha256
        && digest(observed.commandLine) === marker.commandLineSha256
        && createdAt >= startedAt - 5_000
        && createdAt <= startedAt + 60_000
        && executableHashMatches;
      if (!identityMatches) {
        throw new Error("A Scrap Mechanic runtime probe is already running.");
      }
      throw new Error("A Scrap Mechanic runtime probe is already running.");
    }
  }
  let processes: ObservedProcessIdentity[];
  try {
    processes = await listScrapMechanicProcesses();
  } catch {
    throw new Error("A Scrap Mechanic runtime probe is already running.");
  }
  for (const processIdentity of processes) {
    if (
      comparablePath(processIdentity.executablePath)
        !== comparablePath(resolve(expectedExecutable))
    ) continue;
    try {
      const runningExecutableSha256 = digest(
        await readFile(processIdentity.executablePath),
      );
      if (runningExecutableSha256 !== expectedExecutableSha256) {
        throw new Error("identity changed");
      }
    } catch {
      throw new Error("A Scrap Mechanic runtime probe is already running.");
    }
    throw new Error("A Scrap Mechanic runtime probe is already running.");
  }
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(comparablePath(root), comparablePath(candidate));
  return difference === "" || (
    difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
  );
}

async function resolveThroughNearestExistingAncestor(path: string): Promise<string> {
  const unresolved: string[] = [];
  let candidate = resolve(path);
  while (true) {
    try {
      return resolve(await realpath(candidate), ...unresolved);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
      const parent = dirname(candidate);
      if (code !== "ENOENT" || parent === candidate) throw error;
      unresolved.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

async function findRepositoryRoot(): Promise<string> {
  let candidate = resolve(".");
  while (true) {
    try {
      await access(join(candidate, ".git"));
      return resolve(await realpath(candidate));
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new Error("Runtime probe repository root is unavailable.");
      }
      candidate = parent;
    }
  }
}

async function readExecutableVersion(executablePath: string): Promise<string> {
  try {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-Item -LiteralPath $env:SM_RUNTIME_EXECUTABLE).VersionInfo.FileVersion",
      ],
      {
        env: { ...process.env, SM_RUNTIME_EXECUTABLE: executablePath },
        windowsHide: true,
      },
    );
    return result.stdout.trim();
  } catch {
    throw new Error("The reviewed Scrap Mechanic executable is unavailable.");
  }
}

async function processIsRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    return code !== "ESRCH";
  }
}

function commandLineExecutable(commandLine: string): string | undefined {
  const value = commandLine.trim();
  const match = /^"([^"]+\\ScrapMechanic\.exe)"$/i.exec(value)
    ?? /^([^"\r\n]+\\ScrapMechanic\.exe)$/i.exec(value);
  return match?.[1];
}

async function readProcessIdentity(
  pid: number,
  signal?: AbortSignal,
): Promise<ObservedProcessIdentity> {
  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:SM_RUNTIME_PID); if ($null -eq $p) { exit 2 }; [pscustomobject]@{ ExecutablePath = $p.ExecutablePath; CommandLine = $p.CommandLine; CreatedAt = ([datetime]$p.CreationDate).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress",
    ],
    {
      env: { ...process.env, SM_RUNTIME_PID: String(pid) },
      signal,
      windowsHide: true,
    },
  );
  const value = JSON.parse(result.stdout) as Record<string, unknown>;
  if (
    typeof value.ExecutablePath !== "string"
    || typeof value.CommandLine !== "string"
    || typeof value.CreatedAt !== "string"
    || !Number.isFinite(Date.parse(value.CreatedAt))
  ) throw new Error("invalid");
  return {
    executablePath: resolve(value.ExecutablePath),
    commandLine: value.CommandLine,
    createdAt: value.CreatedAt,
  };
}

async function readProcessIdentityWhenAvailable(
  pid: number,
  signal: AbortSignal,
): Promise<ObservedProcessIdentity | undefined> {
  try {
    return await readProcessIdentity(pid, signal);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? Number(error.code)
      : Number.NaN;
    if (code === 2) return undefined;
    throw error;
  }
}

async function listScrapMechanicProcesses(): Promise<ObservedProcessIdentity[]> {
  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$items = @(Get-CimInstance Win32_Process -Filter \"Name = 'ScrapMechanic.exe'\" | ForEach-Object { [pscustomobject]@{ ExecutablePath = $_.ExecutablePath; CommandLine = $_.CommandLine; CreatedAt = ([datetime]$_.CreationDate).ToUniversalTime().ToString('o') } }); [Console]::Out.Write((ConvertTo-Json -InputObject $items -Compress))",
    ],
    { windowsHide: true },
  );
  const values: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(values)) throw new Error("invalid");
  return values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid");
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.ExecutablePath !== "string"
      || typeof record.CommandLine !== "string"
      || typeof record.CreatedAt !== "string"
      || !Number.isFinite(Date.parse(record.CreatedAt))
    ) throw new Error("invalid");
    return {
      executablePath: resolve(record.ExecutablePath),
      commandLine: record.CommandLine,
      createdAt: record.CreatedAt,
    };
  });
}

async function observeProcess(
  child: Pick<ChildProcess, "exitCode" | "signalCode">,
  pid: number,
  expectedExecutable: string,
  startedAt: string,
  options: ProcessObservationOptions = {},
): Promise<ObservedProcessIdentity> {
  const readIdentity = options.readIdentity ?? readProcessIdentityWhenAvailable;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (async (milliseconds: number) => {
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));
  });
  const timeoutMs = options.timeoutMs ?? PROCESS_OBSERVATION_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs
    ?? PROCESS_OBSERVATION_POLL_INTERVAL_MS;
  const deadline = now() + timeoutMs;
  const expectedPath = comparablePath(resolve(expectedExecutable));

  const exitFailure = (): Error | undefined => {
    if (child.exitCode === null && child.signalCode === null) return undefined;
    const lifetimeMs = Math.max(0, now() - Date.parse(startedAt));
    const exitCode = child.exitCode === null ? "unavailable" : String(child.exitCode);
    return new Error(
      `The reviewed Scrap Mechanic process exited during observation (exit code ${exitCode}; lifetime ${lifetimeMs} ms).`,
    );
  };

  while (true) {
    const exitedBeforeRead = exitFailure();
    if (exitedBeforeRead) throw exitedBeforeRead;

    const readBudgetMs = deadline - now();
    if (readBudgetMs <= 0) {
      throw new Error("The reviewed Scrap Mechanic process did not become observable.");
    }
    const readAbortController = new AbortController();
    let readTimeout: ReturnType<typeof setTimeout> | undefined;
    const readOutcome = await Promise.race([
      readIdentity(pid, readAbortController.signal).then(
        (identity) => ({ type: "identity" as const, identity }),
        () => ({ type: "error" as const }),
      ),
      new Promise<{ type: "timeout" }>((resolveTimeout) => {
        readTimeout = setTimeout(
          () => resolveTimeout({ type: "timeout" }),
          readBudgetMs,
        );
      }),
    ]);
    if (readOutcome.type === "timeout") {
      readAbortController.abort();
    } else if (readTimeout) {
      clearTimeout(readTimeout);
    }

    const exitedAfterRead = exitFailure();
    if (exitedAfterRead) throw exitedAfterRead;
    if (readOutcome.type !== "identity") {
      throw new Error("The reviewed Scrap Mechanic process did not become observable.");
    }
    const observed = readOutcome.identity;
    if (observed) {
      if (
        comparablePath(observed.executablePath) !== expectedPath
        || comparablePath(resolve(commandLineExecutable(observed.commandLine) ?? ""))
          !== expectedPath
      ) {
        throw new Error(
          "The reviewed Scrap Mechanic process identity did not match the reviewed executable.",
        );
      }
      if (now() > deadline) {
        throw new Error("The reviewed Scrap Mechanic process did not become observable.");
      }
      return observed;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new Error("The reviewed Scrap Mechanic process did not become observable.");
    }
    await wait(Math.min(pollIntervalMs, remainingMs));
  }
}

async function observeStartupWindow(
  child: ChildProcess,
  processCreatedAt: string,
): Promise<void> {
  const existingExitCode = child.exitCode;
  if (existingExitCode !== null || child.signalCode !== null) {
    const lifetimeMs = Math.max(0, Date.now() - Date.parse(processCreatedAt));
    const exitCode = existingExitCode === null ? "unavailable" : String(existingExitCode);
    throw new Error(
      `The reviewed Scrap Mechanic process exited during startup (exit code ${exitCode}; lifetime ${lifetimeMs} ms).`,
    );
  }
  const earlyExit = await new Promise<{ code: number | null; exitedAt: number } | undefined>(
    (resolveExit) => {
      const onExit = (code: number | null) => {
        clearTimeout(timer);
        resolveExit({ code, exitedAt: Date.now() });
      };
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolveExit(undefined);
      }, STARTUP_OBSERVATION_MS);
      child.once("exit", onExit);
    },
  );
  if (!earlyExit) return;
  const lifetimeMs = Math.max(
    0,
    earlyExit.exitedAt - Date.parse(processCreatedAt),
  );
  const exitCode = earlyExit.code === null ? "unavailable" : String(earlyExit.code);
  throw new Error(
    `The reviewed Scrap Mechanic process exited during startup (exit code ${exitCode}; lifetime ${lifetimeMs} ms).`,
  );
}

async function readLauncherGamePid(
  launcher: ChildProcess,
  timeoutMs: number,
): Promise<number> {
  return await new Promise<number>((resolvePid, rejectPid) => {
    const output = launcher.stdout;
    if (!output) {
      rejectPid(new Error("The reviewed Scrap Mechanic process could not be launched."));
      return;
    }
    let firstLineBuffer = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      output.off("data", onData);
      launcher.off("error", onError);
      launcher.off("close", onClose);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPid(new Error(message));
    };
    const onError = () => {
      fail("The reviewed Scrap Mechanic process could not be launched.");
    };
    const onClose = () => {
      fail("The reviewed Scrap Mechanic process could not be launched.");
    };
    const onData = (chunk: Buffer | string) => {
      if (settled) return;
      firstLineBuffer += chunk.toString();
      const newlineIndex = firstLineBuffer.indexOf("\n");
      const candidate = newlineIndex >= 0
        ? firstLineBuffer.slice(0, newlineIndex)
        : firstLineBuffer;
      if (Buffer.byteLength(candidate, "utf8") > LAUNCHER_PID_LINE_MAX_BYTES) {
        fail("The reviewed Scrap Mechanic launcher did not report a valid process.");
        return;
      }
      if (newlineIndex < 0) return;
      const line = candidate.endsWith("\r") ? candidate.slice(0, -1) : candidate;
      if (!/^[1-9]\d{0,9}$/.test(line)) {
        fail("The reviewed Scrap Mechanic launcher did not report a valid process.");
        return;
      }
      const pid = Number.parseInt(line, 10);
      if (!Number.isSafeInteger(pid) || pid > 0xffff_ffff) {
        fail("The reviewed Scrap Mechanic launcher did not report a valid process.");
        return;
      }
      settled = true;
      cleanup();
      resolvePid(pid);
    };
    const timer = setTimeout(() => {
      fail("The reviewed Scrap Mechanic launcher did not report a valid process.");
    }, timeoutMs);
    output.on("data", onData);
    launcher.once("error", onError);
    launcher.once("close", onClose);
  });
}

function terminateProcess(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    // The exact process may already have exited.
  }
}

async function terminateLauncher(launcher: ChildProcess): Promise<void> {
  launcher.stdout?.destroy();
  if (launcher.exitCode !== null || launcher.signalCode !== null) return;
  const closed = new Promise<void>((resolveClosed) => {
    const timer = setTimeout(resolveClosed, 1_000);
    launcher.once("exit", () => {
      clearTimeout(timer);
      resolveClosed();
    });
  });
  let treeTerminated = false;
  if (process.platform === "win32" && launcher.pid !== undefined) {
    try {
      await execFileAsync(
        "taskkill.exe",
        ["/PID", String(launcher.pid), "/T", "/F"],
        { windowsHide: true, timeout: 2_000 },
      );
      treeTerminated = true;
    } catch {
      // Fall through to terminating the launcher if its process tree vanished.
    }
  }
  if (!treeTerminated) {
    try {
      launcher.kill();
    } catch {
      // The launcher may have exited between the state check and termination.
    }
  }
  await closed;
}

function releaseLauncher(launcher: ChildProcess): void {
  launcher.stdout?.destroy();
  launcher.unref();
}

function isTreeFingerprint(value: unknown): value is TreeFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fingerprint = value as Record<string, unknown>;
  if (!(fingerprint.schemaVersion === 1
    && Number.isSafeInteger(fingerprint.fileCount)
    && (fingerprint.fileCount as number) >= 0
    && Number.isSafeInteger(fingerprint.totalBytes)
    && (fingerprint.totalBytes as number) >= 0
    && typeof fingerprint.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(fingerprint.sha256)
    && Array.isArray(fingerprint.files)
    && fingerprint.files.every((file) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) return false;
      const record = file as Record<string, unknown>;
      return typeof record.relativePath === "string"
        && record.relativePath.length > 0
        && !record.relativePath.includes("\\")
        && !isAbsolute(record.relativePath)
        && !record.relativePath.split("/").includes("..")
        && Number.isSafeInteger(record.bytes)
        && (record.bytes as number) >= 0
        && typeof record.sha256 === "string"
        && /^[a-f0-9]{64}$/.test(record.sha256);
    }))) return false;
  const files = fingerprint.files as TreeFingerprint["files"];
  const canonicalFiles = files.map(({ relativePath, bytes, sha256 }) => ({
    relativePath,
    bytes,
    sha256,
  }));
  const exactPaths = new Set<string>();
  const normalizedGroups = new Map<string, Set<string>>();
  for (const file of files) {
    if (exactPaths.has(file.relativePath)) return false;
    exactPaths.add(file.relativePath);
    const normalized = comparablePath(file.relativePath);
    const group = normalizedGroups.get(normalized) ?? new Set<string>();
    if (group.has(file.relativePath)) return false;
    group.add(file.relativePath);
    normalizedGroups.set(normalized, group);
  }
  return fingerprint.fileCount === files.length
    && fingerprint.totalBytes === files.reduce((sum, file) => sum + file.bytes, 0)
    && fingerprint.sha256 === digest(JSON.stringify(canonicalFiles));
}

function isRuntimeProbeSession(value: unknown): value is RuntimeProbeSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (
    session.schemaVersion !== 1
    || !Number.isSafeInteger(session.pid)
    || (session.pid as number) <= 0
    || session.executableVersion !== EXECUTABLE_VERSION
    || typeof session.executableSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(session.executableSha256)
    || typeof session.startedAt !== "string"
    || !Number.isFinite(Date.parse(session.startedAt))
    || typeof session.commandLine !== "string"
    || typeof session.userDataRoot !== "string"
    || !session.protectedBefore
    || typeof session.protectedBefore !== "object"
    || Array.isArray(session.protectedBefore)
  ) {
    return false;
  }
  const exactKeys = [
    "commandLine",
    "executableSha256",
    "executableVersion",
    "pid",
    "protectedBefore",
    "schemaVersion",
    "startedAt",
    "userDataRoot",
  ];
  if (Object.keys(session).sort().join("\n") !== exactKeys.join("\n")) return false;
  const protectedBefore = session.protectedBefore as Record<string, unknown>;
  const roots = Object.keys(protectedBefore);
  return roots.length > 0
    && roots.every((root) => isAbsolute(root))
    && Object.values(protectedBefore).every(isTreeFingerprint);
}

function isStoredPayload(value: unknown): value is RuntimeProbeStoredPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).sort().join("\n")
      === [
        "processCreatedAt",
        "schemaVersion",
        "session",
        "sessionId",
        "sessionPath",
      ].join("\n")
    && payload.schemaVersion === 1
    && typeof payload.sessionPath === "string"
    && isAbsolute(payload.sessionPath)
    && typeof payload.sessionId === "string"
    && /^[a-f0-9]{64}$/.test(payload.sessionId)
    && typeof payload.processCreatedAt === "string"
    && Number.isFinite(Date.parse(payload.processCreatedAt))
    && isRuntimeProbeSession(payload.session);
}

async function readStoredPayload(
  sessionPath: string,
): Promise<RuntimeProbeStoredPayload> {
  try {
    const envelope: unknown = JSON.parse(await readFile(sessionPath, "utf8"));
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new Error("invalid");
    }
    const record = envelope as Record<string, unknown>;
    if (
      Object.keys(record).sort().join("\n")
        !== ["protectedPayload", "schemaVersion"].join("\n")
      || record.schemaVersion !== 1
      || typeof record.protectedPayload !== "string"
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.protectedPayload)
    ) {
      throw new Error("invalid");
    }
    const payload = await unprotectCanonicalValue(
      record.protectedPayload,
      "Runtime probe session is unavailable or invalid.",
    );
    if (
      !isStoredPayload(payload)
      || comparablePath(payload.sessionPath) !== comparablePath(sessionPath)
    ) throw new Error("invalid");
    return payload;
  } catch {
    throw new Error("Runtime probe session is unavailable or invalid.");
  }
}

async function collectLogs(root: string, directory = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }
  const logs: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      logs.push(...await collectLogs(root, path));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".log")) {
      logs.push(path);
    }
  }
  return logs;
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function hasOfficialScrapLogLine(text: string, message: string): boolean {
  const escapedMessage = message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const standardLine = new RegExp(
    `^\\d{2}:\\d{2}:\\d{2} \\(\\d+/\\d+\\) \\[Main:\\d+\\] \\[Default\\] ${escapedMessage}$`,
  );
  return text.split(/\r?\n/).some((line) => standardLine.test(line));
}

async function findProofLog(
  userDataRoot: string,
  workingLogsRoot: string,
  startedAt: string,
): Promise<{ relativePath: string; sha256: string }> {
  const startTime = Date.parse(startedAt);
  const redirectedCandidates: Array<{ path: string; relativePath: string }> = [];
  for (const path of await collectLogs(userDataRoot)) {
    const metadata = await stat(path);
    if (metadata.birthtimeMs < startTime) continue;
    const contents = await readFile(path);
    const text = contents.toString("utf8");
    if (!text.includes("Scrap Mechanic") && !text.includes("ScrapMechanic")) continue;
    redirectedCandidates.push({
      path,
      relativePath: relative(userDataRoot, path).split(sep).join("/"),
    });
  }
  redirectedCandidates.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );

  const workingCandidates: Array<{ path: string; relativePath: string }> = [];
  for (const path of await collectLogs(workingLogsRoot)) {
    const metadata = await stat(path);
    if (metadata.birthtimeMs < startTime) continue;
    const contents = await readFile(path);
    const text = contents.toString("utf8");
    if (
      !hasOfficialScrapLogLine(text, "Initialized Logger")
      || !hasOfficialScrapLogLine(text, `Game version ${EXECUTABLE_VERSION}`)
    ) continue;
    workingCandidates.push({
      path,
      relativePath: `working-copy/Logs/${relative(workingLogsRoot, path).split(sep).join("/")}`,
    });
  }
  workingCandidates.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );

  const proof = redirectedCandidates[0] ?? workingCandidates[0];
  if (!proof) {
    throw new Error("No new redirected Scrap Mechanic log was found.");
  }
  return {
    relativePath: proof.relativePath,
    sha256: digest(await readFile(proof.path)),
  };
}

async function requireRedirectedArtifact(
  userDataRoot: string,
  startedAt: string,
  excludedPaths: string[],
): Promise<void> {
  const startTime = Date.parse(startedAt);
  const excluded = new Set(excludedPaths.map(comparablePath));
  for (const path of await collectFiles(userDataRoot)) {
    if (excluded.has(comparablePath(path))) continue;
    if ((await stat(path)).birthtimeMs >= startTime) return;
  }
  throw new Error("No new redirected user-data artifact was found.");
}

export function startRuntimeProbe(
  options: RuntimeProbeOptions,
): Promise<RuntimeProbeSession>;
export async function startRuntimeProbe(
  options: RuntimeProbeOptions,
  dependencies: StartRuntimeProbeDependencies = {},
): Promise<RuntimeProbeSession> {
  if (options.protectedRoots.length === 0) {
    throw new Error("At least one protected root is required.");
  }
  let approvedParent: string;
  let userDataRoot: string;
  let sessionPath: string;
  let repositoryRoot: string;
  try {
    [approvedParent, userDataRoot, sessionPath, repositoryRoot] = await Promise.all([
      resolveThroughNearestExistingAncestor(APPROVED_USER_DATA_PARENT),
      resolveThroughNearestExistingAncestor(options.userDataRoot),
      resolveThroughNearestExistingAncestor(options.sessionPath),
      findRepositoryRoot(),
    ]);
  } catch {
    throw new Error("Runtime probe paths are unavailable.");
  }
  if (isWithin(repositoryRoot, sessionPath)) {
    throw new Error("Runtime probe session must be outside the repository.");
  }
  if (userDataRoot === approvedParent || !isWithin(approvedParent, userDataRoot)) {
    throw new Error("User-data root must be below the approved F-drive root.");
  }

  let protectedRoots: string[];
  try {
    protectedRoots = await Promise.all(options.protectedRoots.map((root) =>
      resolveThroughNearestExistingAncestor(root)
    ));
  } catch {
    throw new Error("Protected roots are unavailable.");
  }
  if (protectedRoots.some((root) => isWithin(root, userDataRoot))) {
    throw new Error("User-data root must be outside every protected root.");
  }

  let gameRoot: string;
  try {
    gameRoot = await resolveThroughNearestExistingAncestor(options.gameRoot);
  } catch {
    throw new Error("The reviewed Scrap Mechanic executable is unavailable.");
  }
  const releaseRoot = join(gameRoot, "Release");
  const executablePath = join(releaseRoot, "ScrapMechanic.exe");
  try {
    await access(executablePath);
  } catch {
    throw new Error("The reviewed Scrap Mechanic executable is unavailable.");
  }
  const executableVersion = await readExecutableVersion(executablePath);
  if (executableVersion !== EXECUTABLE_VERSION) {
    throw new Error("The Scrap Mechanic executable version is not the reviewed 1.0 build.");
  }

  const protectedBefore: Record<string, TreeFingerprint> = {};
  for (let index = 0; index < protectedRoots.length; index += 1) {
    try {
      protectedBefore[protectedRoots[index]] = await fingerprintTree(protectedRoots[index]);
    } catch {
      throw new Error(`Protected root ${index + 1} could not be fingerprinted.`);
    }
  }
  let executableSha256: string;
  try {
    executableSha256 = digest(await readFile(executablePath));
  } catch {
    throw new Error("The reviewed Scrap Mechanic executable is unavailable.");
  }
  const roamingRoot = join(userDataRoot, "Roaming");
  const localRoot = join(userDataRoot, "Local");
  const profileRoot = join(userDataRoot, "Profile");
  const profileRoamingRoot = join(profileRoot, "AppData", "Roaming");
  const profileLocalRoot = join(profileRoot, "AppData", "Local");
  try {
    await Promise.all([
      mkdir(roamingRoot, { recursive: true }),
      mkdir(localRoot, { recursive: true }),
      mkdir(profileRoot, { recursive: true }),
      mkdir(profileRoamingRoot, { recursive: true }),
      mkdir(profileLocalRoot, { recursive: true }),
    ]);
  } catch {
    throw new Error("Redirected user-data directories could not be created.");
  }

  const probeLock = await acquireRuntimeProbeLock(userDataRoot);
  try {
    await rejectOverlappingLiveProbe(
      userDataRoot,
      executablePath,
      executableSha256,
    );
    const startedAt = new Date().toISOString();
    const spawnLauncher = dependencies.spawnLauncher
      ?? ((executable: string, args: readonly string[], spawnOptions: SpawnOptions) =>
        spawn(executable, [...args], spawnOptions));
    let launcher: ChildProcess;
    try {
      launcher = spawnLauncher(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          PROCESS_START_INFO_LAUNCHER_COMMAND,
        ],
        {
          env: {
            ...process.env,
            SM_RUNTIME_EXECUTABLE: executablePath,
            SM_RUNTIME_WORKING_DIRECTORY: releaseRoot,
            SM_RUNTIME_ROAMING: roamingRoot,
            SM_RUNTIME_LOCAL: localRoot,
            SM_RUNTIME_PROFILE: profileRoot,
          },
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        },
      );
    } catch {
      throw new Error("The reviewed Scrap Mechanic process could not be launched.");
    }
    let gamePid: number;
    try {
      gamePid = await readLauncherGamePid(
        launcher,
        dependencies.pidLineTimeoutMs ?? LAUNCHER_PID_LINE_TIMEOUT_MS,
      );
    } catch (error) {
      await terminateLauncher(launcher);
      throw error;
    }
    try {
      const observed = await observeProcess(
        launcher,
        gamePid,
        executablePath,
        startedAt,
        dependencies.observation,
      );
      await observeStartupWindow(launcher, observed.createdAt);
      const session: RuntimeProbeSession = {
        schemaVersion: 1,
        pid: gamePid,
        executableVersion: EXECUTABLE_VERSION,
        executableSha256,
        startedAt,
        commandLine: observed.commandLine,
        userDataRoot,
        protectedBefore,
      };
      const storedPayload: RuntimeProbeStoredPayload = {
        schemaVersion: 1,
        sessionPath,
        sessionId: randomBytes(32).toString("hex"),
        processCreatedAt: observed.createdAt,
        session,
      };
      const envelope: RuntimeProbeSessionEnvelope = {
        schemaVersion: 1,
        protectedPayload: await protectCanonicalValue(
          storedPayload,
          "Runtime probe session could not be sealed.",
        ),
      };
      try {
        await mkdir(dirname(sessionPath), { recursive: true });
        await writeSealedMarker(userDataRoot, activeMarkerFor(storedPayload));
        await writeFile(sessionPath, canonicalJson(envelope), "utf8");
      } catch {
        throw new Error("Runtime probe session could not be written.");
      }
      releaseLauncher(launcher);
      return session;
    } catch (error) {
      terminateProcess(gamePid);
      await terminateLauncher(launcher);
      throw error;
    }
  } finally {
    await releaseRuntimeProbeLock(probeLock);
  }
}

export async function finishRuntimeProbe(
  options: FinishRuntimeProbeOptions,
): Promise<RuntimeIsolationReceipt> {
  let sessionPath: string;
  try {
    sessionPath = await resolveThroughNearestExistingAncestor(options.sessionPath);
  } catch {
    throw new Error("Runtime probe session is unavailable or invalid.");
  }
  const previewPayload = await readStoredPayload(sessionPath);
  let lockedUserDataRoot: string;
  try {
    const [approvedParent, previewUserDataRoot] = await Promise.all([
      resolveThroughNearestExistingAncestor(APPROVED_USER_DATA_PARENT),
      resolveThroughNearestExistingAncestor(previewPayload.session.userDataRoot),
    ]);
    if (
      previewUserDataRoot === approvedParent
      || !isWithin(approvedParent, previewUserDataRoot)
    ) {
      throw new Error("invalid");
    }
    lockedUserDataRoot = previewUserDataRoot;
  } catch {
    throw new Error("Runtime probe session is unavailable or invalid.");
  }
  const probeLock = await acquireRuntimeProbeLock(lockedUserDataRoot);
  try {
    const storedPayload = await readStoredPayload(sessionPath);
    const { session } = storedPayload;
    let userDataRoot: string;
    let executable: string;
    try {
      const executablePath = commandLineExecutable(session.commandLine);
      let approvedParent: string;
      [approvedParent, userDataRoot, executable] = await Promise.all([
        resolveThroughNearestExistingAncestor(APPROVED_USER_DATA_PARENT),
        resolveThroughNearestExistingAncestor(session.userDataRoot),
        executablePath
          ? resolveThroughNearestExistingAncestor(executablePath)
          : Promise.reject(new Error("invalid")),
      ]);
      const currentMarker = await readActiveMarker(userDataRoot);
      if (
        comparablePath(userDataRoot) !== comparablePath(lockedUserDataRoot)
        || userDataRoot === approvedParent
        || !isWithin(approvedParent, userDataRoot)
        || basename(executable).toLowerCase() !== "scrapmechanic.exe"
        || basename(dirname(executable)).toLowerCase() !== "release"
        || digest(await readFile(executable)) !== session.executableSha256
        || !currentMarker
        || canonicalJson(currentMarker)
          !== canonicalJson(activeMarkerFor(storedPayload))
      ) {
        throw new Error("invalid");
      }
    } catch {
      throw new Error("Runtime probe session is unavailable or invalid.");
    }
    if (await processIsRunning(session.pid)) {
      throw new Error("The probed Scrap Mechanic process is still running.");
    }
    let proofLog: { relativePath: string; sha256: string };
    try {
      const workingLogsRoot = join(dirname(dirname(executable)), "Logs");
      proofLog = await findProofLog(userDataRoot, workingLogsRoot, session.startedAt);
    } catch (error) {
      if (
        error instanceof Error
        && error.message === "No new redirected Scrap Mechanic log was found."
      ) throw error;
      throw new Error("Redirected Scrap Mechanic logs could not be verified.");
    }

    const receiptPath = resolve(options.receiptPath);
    try {
      await requireRedirectedArtifact(userDataRoot, session.startedAt, [
        join(userDataRoot, SESSION_MARKER_NAME),
        join(userDataRoot, SESSION_LOCK_NAME),
        sessionPath,
        receiptPath,
      ]);
    } catch (error) {
      if (
        error instanceof Error
        && error.message === "No new redirected user-data artifact was found."
      ) throw error;
      throw new Error("Redirected user-data artifacts could not be verified.");
    }

    const changes: string[] = [];
    const protectedEntries = Object.entries(session.protectedBefore);
    for (let index = 0; index < protectedEntries.length; index += 1) {
      const [root, before] = protectedEntries[index];
      let after: TreeFingerprint;
      try {
        after = await fingerprintTree(root);
      } catch {
        throw new Error(`Protected root ${index + 1} could not be verified.`);
      }
      const difference = diffFingerprints(before, after);
      const paths = [...difference.added, ...difference.removed, ...difference.changed]
        .sort();
      if (paths.length > 0) {
        changes.push(`protected root ${index + 1}: ${paths.join(", ")}`);
      }
    }
    if (changes.length > 0) {
      throw new Error(`Protected-root changes detected (${changes.join("; ")}).`);
    }

    const receipt: RuntimeIsolationReceipt = {
      schemaVersion: 1,
      processExecutableSha256: session.executableSha256,
      commandLineSha256: digest(session.commandLine),
      userDataRoot: session.userDataRoot,
      proofLogRelativePath: proofLog.relativePath,
      proofLogSha256: proofLog.sha256,
      protectedRootsUnchanged: true,
    };
    try {
      await writeSealedMarker(userDataRoot, {
        schemaVersion: 1,
        state: "consumed",
        sessionId: storedPayload.sessionId,
      });
      await mkdir(dirname(receiptPath), { recursive: true });
      await writeFile(receiptPath, canonicalJson(receipt), "utf8");
    } catch {
      throw new Error("Runtime isolation receipt could not be written.");
    }
    return receipt;
  } finally {
    await releaseRuntimeProbeLock(probeLock);
  }
}
