import type { ChildProcess, SpawnOptions } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  finishRuntimeProbe,
  startRuntimeProbe,
} from "./runtime-probe.ts";

const execFileAsync = promisify(execFile);
const TEST_PARENT = "F:\\Scrap Mechanical";
let suiteRoot: string;
let fakeExecutable: string;
const livePids = new Set<number>();
const scriptedLauncherPids = new Set<number>();

const fakeSource = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;

[assembly: AssemblyVersion("1.0.1.869")]
[assembly: AssemblyFileVersion("1.0.1.869")]

public static class FakeScrapMechanic {
  public static void Main() {
    var appData = Environment.GetEnvironmentVariable("APPDATA") ?? "";
    var userProfile = Environment.GetEnvironmentVariable("USERPROFILE") ?? "";
    if (!File.Exists(Path.Combine(Environment.CurrentDirectory, "suppress-artifact.flag"))) {
      Directory.CreateDirectory(appData);
      File.WriteAllLines(Path.Combine(appData, "fake-env.txt"), new[] {
        "PID=" + Process.GetCurrentProcess().Id,
        "CWD=" + Environment.CurrentDirectory,
        "SteamAppId=" + Environment.GetEnvironmentVariable("SteamAppId"),
        "APPDATA=" + appData,
        "LOCALAPPDATA=" + Environment.GetEnvironmentVariable("LOCALAPPDATA"),
        "USERPROFILE=" + userProfile,
        "SM_RUNTIME_EXECUTABLE=" + Environment.GetEnvironmentVariable("SM_RUNTIME_EXECUTABLE"),
        "SM_RUNTIME_WORKING_DIRECTORY=" + Environment.GetEnvironmentVariable("SM_RUNTIME_WORKING_DIRECTORY"),
        "SM_RUNTIME_ROAMING=" + Environment.GetEnvironmentVariable("SM_RUNTIME_ROAMING"),
        "SM_RUNTIME_LOCAL=" + Environment.GetEnvironmentVariable("SM_RUNTIME_LOCAL"),
        "SM_RUNTIME_PROFILE=" + Environment.GetEnvironmentVariable("SM_RUNTIME_PROFILE"),
        "PROFILE_APPDATA_ROAMING_EXISTS=" + Directory.Exists(Path.Combine(userProfile, "AppData", "Roaming")),
        "PROFILE_APPDATA_LOCAL_EXISTS=" + Directory.Exists(Path.Combine(userProfile, "AppData", "Local"))
      });
    }
    if (File.Exists(Path.Combine(Environment.CurrentDirectory, "write-log.flag"))) {
      var logDirectory = Path.Combine(appData, "Axolot Games", "Scrap Mechanic", "User");
      Directory.CreateDirectory(logDirectory);
      File.WriteAllText(Path.Combine(logDirectory, "ScrapMechanic-test.log"), "Scrap Mechanic fake runtime log");
    }
    if (File.Exists(Path.Combine(Environment.CurrentDirectory, "write-working-log.flag"))) {
      var logDirectory = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "..", "Logs"));
      Directory.CreateDirectory(logDirectory);
      File.WriteAllText(
        Path.Combine(logDirectory, "game-test.log"),
        "18:09:34 (1/0) [Main:24884] [Default] Initialized Logger\r\n" +
        "18:09:34 (1/0) [Main:24884] [Default] Game version 1.0.1.869\r\n"
      );
    }
    if (File.Exists(Path.Combine(Environment.CurrentDirectory, "exit-early.flag"))) {
      Thread.Sleep(1800);
      Environment.Exit(23);
    }
    Thread.Sleep(File.Exists(Path.Combine(Environment.CurrentDirectory, "stay-running.flag")) ? 30000 : 4000);
  }
}
`;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for fake runtime state.");
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  await waitFor(async () => !isRunning(pid));
  livePids.delete(pid);
}

async function countProcessesAt(executablePath: string): Promise<number> {
  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "@((Get-CimInstance Win32_Process -Filter \"Name = 'ScrapMechanic.exe'\") | Where-Object { $_.ExecutablePath -eq $env:SM_FAKE_EXE }).Count",
    ],
    {
      env: { ...process.env, SM_FAKE_EXE: executablePath },
      windowsHide: true,
    },
  );
  return Number.parseInt(result.stdout.trim(), 10);
}

async function makeFixture(name: string): Promise<{
  gameRoot: string;
  releaseRoot: string;
  userDataRoot: string;
  protectedRoots: string[];
  sessionPath: string;
  receiptPath: string;
}> {
  const root = join(suiteRoot, name);
  const gameRoot = join(root, "game");
  const releaseRoot = join(gameRoot, "Release");
  const protectedRoots = [join(root, "protected-a"), join(root, "protected-b")];
  await Promise.all([
    mkdir(releaseRoot, { recursive: true }),
    ...protectedRoots.map((path) => mkdir(path, { recursive: true })),
  ]);
  await copyFile(fakeExecutable, join(releaseRoot, "ScrapMechanic.exe"));
  await writeFile(join(protectedRoots[0], "kept.txt"), "safe");
  return {
    gameRoot,
    releaseRoot,
    userDataRoot: join(root, "user-data"),
    protectedRoots,
    sessionPath: join(root, "capture", "probe-session.json"),
    receiptPath: join(root, "capture", "runtime-isolation-receipt.json"),
  };
}

async function startFixture(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
) {
  const session = await startRuntimeProbe(fixture);
  livePids.add(session.pid);
  return session;
}

interface TestObservedProcessIdentity {
  executablePath: string;
  commandLine: string;
  createdAt: string;
}

interface TestProcessObservationOptions {
  readIdentity: (
    pid: number,
    signal?: AbortSignal,
  ) => Promise<TestObservedProcessIdentity | undefined>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface TestStartDependencies {
  observation?: TestProcessObservationOptions;
  spawnLauncher?: (
    executable: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  pidLineTimeoutMs?: number;
}

async function startFixtureWithDependencies(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  dependencies: TestStartDependencies,
) {
  const startWithDependencies = startRuntimeProbe as unknown as (
    options: Parameters<typeof startRuntimeProbe>[0],
    testDependencies: TestStartDependencies,
  ) => ReturnType<typeof startRuntimeProbe>;
  const session = await startWithDependencies(fixture, dependencies);
  livePids.add(session.pid);
  return session;
}

async function startFixtureWithObservation(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  observation: TestProcessObservationOptions,
) {
  return await startFixtureWithDependencies(fixture, { observation });
}

function spawnScriptedLauncher(
  script: string,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  if (child.pid) scriptedLauncherPids.add(child.pid);
  child.once("exit", () => {
    if (child.pid) scriptedLauncherPids.delete(child.pid);
  });
  return child;
}

async function expectNoStartArtifacts(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<void> {
  await expect(access(fixture.sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(fixture.receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(join(
    fixture.userDataRoot,
    ".runtime-probe-session",
  ))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(join(
    fixture.userDataRoot,
    ".runtime-probe.lock",
  ))).rejects.toMatchObject({ code: "ENOENT" });
}

beforeAll(async () => {
  suiteRoot = await mkdtemp(join(TEST_PARENT, "runtime-probe-tests-"));
  fakeExecutable = join(suiteRoot, "FakeScrapMechanic.exe");
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -TypeDefinition $env:SM_FAKE_SOURCE -Language CSharp -OutputAssembly $env:SM_FAKE_EXE -OutputType WindowsApplication",
    ],
    {
      env: {
        ...process.env,
        SM_FAKE_SOURCE: fakeSource,
        SM_FAKE_EXE: fakeExecutable,
      },
      windowsHide: true,
    },
  );
}, 30_000);

afterEach(async () => {
  const pids = [...livePids];
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // The fake process may already have exited between the test and cleanup.
    }
  }
  await Promise.all(pids.map((pid) =>
    waitFor(async () => !isRunning(pid), 2_000).catch(() => undefined)
  ));
  livePids.clear();
  const launcherPids = [...scriptedLauncherPids];
  for (const pid of launcherPids) {
    try {
      process.kill(pid);
    } catch {
      // The scripted launcher may already have exited during failure cleanup.
    }
  }
  await Promise.all(launcherPids.map((pid) =>
    waitFor(async () => !isRunning(pid), 2_000).catch(() => undefined)
  ));
  scriptedLauncherPids.clear();
});

afterAll(async () => {
  await rm(suiteRoot, { recursive: true, force: true });
});

describe("startRuntimeProbe", () => {
  it("rejects a user-data root outside F:\\Scrap Mechanical", async () => {
    // Break caught: the launcher can redirect writes outside the approved F-drive root.
    const fixture = await makeFixture("outside-root");

    await expect(startRuntimeProbe({
      ...fixture,
      userDataRoot: "C:\\private-runtime-data",
    })).rejects.toThrow("User-data root must be below the approved F-drive root.");
  });

  it("rejects a user-data root inside any protected root", async () => {
    // Break caught: redirected writes can target a protected source tree.
    const fixture = await makeFixture("inside-protected");

    await expect(startRuntimeProbe({
      ...fixture,
      userDataRoot: join(fixture.protectedRoots[1], "runtime-data"),
    })).rejects.toThrow("User-data root must be outside every protected root.");
  });

  it("rejects a session path inside the repository", async () => {
    // Break caught: private process evidence can be written into the source tree.
    const fixture = await makeFixture("session-in-repository");

    await expect(startRuntimeProbe({
      ...fixture,
      sessionPath: join(process.cwd(), "probe-session.json"),
    })).rejects.toThrow("Runtime probe session must be outside the repository.");
  });

  it("rejects an empty protected-root set before launching", async () => {
    // Break caught: start can create a session that finish must never accept.
    const fixture = await makeFixture("empty-protected-roots");

    await expect(startRuntimeProbe({
      ...fixture,
      protectedRoots: [],
    })).rejects.toThrow("At least one protected root is required.");
  });

  it("launches the reviewed executable with isolated environment and records evidence", async () => {
    // Break caught: the wrong process/environment launches or pre-launch evidence is omitted.
    const fixture = await makeFixture("launch-evidence-';$()[]");
    await Promise.all([
      writeFile(join(fixture.releaseRoot, "write-log.flag"), ""),
      writeFile(join(fixture.releaseRoot, "stay-running.flag"), ""),
    ]);

    const session = await startFixture(fixture);
    const environmentPath = join(fixture.userDataRoot, "Roaming", "fake-env.txt");
    await waitFor(async () => {
      try {
        await readFile(environmentPath);
        return true;
      } catch {
        return false;
      }
    });
    const environment = await readFile(environmentPath, "utf8");

    expect(environment.split(/\r?\n/)).toEqual(expect.arrayContaining([
      `PID=${session.pid}`,
      `CWD=${fixture.releaseRoot}`,
      "SteamAppId=387990",
      `APPDATA=${join(fixture.userDataRoot, "Roaming")}`,
      `LOCALAPPDATA=${join(fixture.userDataRoot, "Local")}`,
      `USERPROFILE=${join(fixture.userDataRoot, "Profile")}`,
      "SM_RUNTIME_EXECUTABLE=",
      "SM_RUNTIME_WORKING_DIRECTORY=",
      "SM_RUNTIME_ROAMING=",
      "SM_RUNTIME_LOCAL=",
      "SM_RUNTIME_PROFILE=",
      "PROFILE_APPDATA_ROAMING_EXISTS=True",
      "PROFILE_APPDATA_LOCAL_EXISTS=True",
    ]));
    expect(session).toMatchObject({
      schemaVersion: 1,
      pid: expect.any(Number),
      executableVersion: "1.0.1.869",
      executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      commandLine: expect.stringContaining(join(fixture.releaseRoot, "ScrapMechanic.exe")),
      userDataRoot: fixture.userDataRoot,
      protectedBefore: {
        [fixture.protectedRoots[0]]: expect.objectContaining({ fileCount: 1 }),
        [fixture.protectedRoots[1]]: expect.objectContaining({ fileCount: 0 }),
      },
    });
    expect(session.pid).toBeGreaterThan(0);
    expect(session).not.toHaveProperty("sessionSeal");
    const envelope = JSON.parse(await readFile(fixture.sessionPath, "utf8"));
    expect(envelope).toEqual({
      schemaVersion: 1,
      protectedPayload: expect.stringMatching(/^[A-Za-z0-9+/]+={0,2}$/),
    });
    expect(JSON.stringify(envelope)).not.toContain(fixture.userDataRoot);
    expect(JSON.stringify(envelope)).not.toContain(fixture.protectedRoots[0]);
    const markerEnvelope = JSON.parse(await readFile(
      join(fixture.userDataRoot, ".runtime-probe-session"),
      "utf8",
    ));
    expect(markerEnvelope).toEqual({
      schemaVersion: 1,
      protectedPayload: expect.stringMatching(/^[A-Za-z0-9+/]+={0,2}$/),
    });
    expect(markerEnvelope).not.toHaveProperty("pid");
    expect(markerEnvelope).not.toHaveProperty("processCreatedAt");
  }, 15_000);

  it("uses the injected monitor-launcher seam instead of directly spawning the game", async () => {
    // Break caught: start bypasses the reviewed ProcessStartInfo launcher and directly spawns the exe.
    const fixture = await makeFixture("launcher-seam-regression");
    let failure: unknown;
    try {
      await startFixtureWithDependencies(fixture, {
        spawnLauncher: () => {
          throw new Error("injected launcher failure");
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The reviewed Scrap Mechanic process could not be launched.",
    );
    expect((failure as Error).message).not.toContain(fixture.gameRoot);
    await expectNoStartArtifacts(fixture);
  }, 15_000);

  it("lets the monitor launcher exit after the reported game process exits", async () => {
    // Break caught: the launcher remains orphaned after its monitored game has ended.
    const fixture = await makeFixture("launcher-exits-with-game");
    let launcherPid: number | undefined;
    const session = await startFixtureWithDependencies(fixture, {
      spawnLauncher: (executable, args, options) => {
        const child = spawn(executable, [...args], options);
        launcherPid = child.pid;
        if (child.pid) scriptedLauncherPids.add(child.pid);
        child.once("exit", () => {
          if (child.pid) scriptedLauncherPids.delete(child.pid);
        });
        return child;
      },
    });

    const monitoredLauncherPid = launcherPid;
    expect(typeof monitoredLauncherPid).toBe("number");
    if (monitoredLauncherPid === undefined) return;
    expect(monitoredLauncherPid).toBeGreaterThan(0);
    await waitForExit(session.pid);
    await waitFor(async () => !isRunning(monitoredLauncherPid), 3_000);
  }, 15_000);

  it("rejects a launcher whose first PID line misses the bounded deadline", async () => {
    // Break caught: a silent launcher holds the probe lock and start call indefinitely.
    const fixture = await makeFixture("launcher-pid-line-timeout");
    let failure: unknown;
    try {
      await startFixtureWithDependencies(fixture, {
        spawnLauncher: () => spawnScriptedLauncher(
          "Start-Sleep -Milliseconds 250; [Console]::Out.WriteLine('12345'); Start-Sleep -Seconds 5",
        ),
        pidLineTimeoutMs: 50,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The reviewed Scrap Mechanic launcher did not report a valid process.",
    );
    expect((failure as Error).message).not.toContain(fixture.gameRoot);
    await expectNoStartArtifacts(fixture);
  }, 15_000);

  it("terminates a launched child tree when the launcher withholds its PID line", async () => {
    // Break caught: killing only PowerShell leaves its already-started child orphaned.
    const fixture = await makeFixture("launcher-withheld-pid-child-tree");
    const childPidPath = join(fixture.releaseRoot, "withheld-child.pid");
    let failure: unknown;
    try {
      await startFixtureWithDependencies(fixture, {
        spawnLauncher: () => spawnScriptedLauncher(
          String.raw`
$child = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') -PassThru
[IO.File]::WriteAllText($env:SM_TEST_CHILD_PID_PATH, [string]$child.Id)
Start-Sleep -Seconds 30
`,
          {
            ...process.env,
            SM_TEST_CHILD_PID_PATH: childPidPath,
          },
        ),
        pidLineTimeoutMs: 1_000,
      });
    } catch (error) {
      failure = error;
    }

    const childPid = Number.parseInt(await readFile(childPidPath, "utf8"), 10);
    expect(Number.isSafeInteger(childPid)).toBe(true);
    livePids.add(childPid);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The reviewed Scrap Mechanic launcher did not report a valid process.",
    );
    expect(isRunning(childPid)).toBe(false);
    livePids.delete(childPid);
    await expectNoStartArtifacts(fixture);
  }, 15_000);

  it("rejects a malformed first launcher PID line", async () => {
    // Break caught: malformed launcher output is coerced into a PID and sealed as evidence.
    const fixture = await makeFixture("launcher-malformed-pid-line");
    let failure: unknown;
    try {
      await startFixtureWithDependencies(fixture, {
        spawnLauncher: () => spawnScriptedLauncher(
          "[Console]::Out.WriteLine('123x'); Start-Sleep -Seconds 5",
        ),
        pidLineTimeoutMs: 1_000,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The reviewed Scrap Mechanic launcher did not report a valid process.",
    );
    expect((failure as Error).message).not.toContain(fixture.gameRoot);
    await expectNoStartArtifacts(fixture);
  }, 15_000);

  it("rejects a monitor launcher that exits before reporting the game PID", async () => {
    // Break caught: a launcher failure is treated as a successful but unobservable game start.
    const fixture = await makeFixture("launcher-exits-before-pid");
    let failure: unknown;
    try {
      await startFixtureWithDependencies(fixture, {
        spawnLauncher: () => spawnScriptedLauncher("exit 31"),
        pidLineTimeoutMs: 1_000,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The reviewed Scrap Mechanic process could not be launched.",
    );
    expect((failure as Error).message).not.toContain(fixture.gameRoot);
    await expectNoStartArtifacts(fixture);
  }, 15_000);

  it("converts a spawn denial into a fixed privacy-safe error", async () => {
    // Break caught: Node's raw spawn error discloses the absolute executable path.
    const fixture = await makeFixture("spawn-denied");
    const executablePath = join(fixture.releaseRoot, "ScrapMechanic.exe");
    await execFileAsync(
      "icacls.exe",
      [executablePath, "/deny", "*S-1-1-0:(X)"],
      { windowsHide: true },
    );

    let failure: unknown;
    try {
      await startFixture(fixture);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The reviewed Scrap Mechanic process could not be launched.",
    );
    expect((failure as Error).message).not.toContain(executablePath);
    expect((failure as Error).message).not.toContain("F:\\");
  });

  it("rejects an observed child that exits during the startup window without artifacts", async () => {
    // Break caught: an early controlled exit is persisted as a usable probe session.
    const fixture = await makeFixture("early-exit-observation");
    await writeFile(join(fixture.releaseRoot, "exit-early.flag"), "");

    let failure: unknown;
    try {
      await startFixture(fixture);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(
      /^The reviewed Scrap Mechanic process exited during startup \(exit code 23; lifetime \d+ ms\)\.$/,
    );
    expect((failure as Error).message).not.toContain(fixture.gameRoot);
    await expect(access(fixture.sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fixture.receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      fixture.userDataRoot,
      ".runtime-probe-session",
    ))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      fixture.userDataRoot,
      ".runtime-probe.lock",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("polls through transient CIM absence until the exact child identity is observable", async () => {
    // Break caught: a newly spawned reviewed process is rejected before CIM registers it.
    const fixture = await makeFixture("delayed-cim-registration");
    const executablePath = join(fixture.releaseRoot, "ScrapMechanic.exe");
    let attempts = 0;
    let clock = 1_000;

    const session = await startFixtureWithObservation(fixture, {
      readIdentity: async () => {
        attempts += 1;
        if (attempts <= 3) return undefined;
        return {
          executablePath,
          commandLine: `"${executablePath}"`,
          createdAt: "2026-08-01T11:30:00.000Z",
        };
      },
      now: () => clock,
      wait: async (milliseconds) => {
        clock += milliseconds;
      },
      timeoutMs: 5_000,
      pollIntervalMs: 50,
    });

    expect(attempts).toBe(4);
    expect(session.pid).toBeGreaterThan(0);
    expect(session.commandLine).toBe(`"${executablePath}"`);
  }, 15_000);

  it("does not accept an exact identity first returned after the observation deadline", async () => {
    // Break caught: a slow CIM read can turn the bounded observation into an unbounded acceptance.
    const fixture = await makeFixture("cim-registration-after-deadline");
    const executablePath = join(fixture.releaseRoot, "ScrapMechanic.exe");
    let attempts = 0;
    let clock = 1_000;

    let failure: unknown;
    try {
      await startFixtureWithObservation(fixture, {
        readIdentity: async () => {
          attempts += 1;
          clock = 6_001;
          return {
            executablePath,
            commandLine: `"${executablePath}"`,
            createdAt: "2026-08-01T11:30:00.000Z",
          };
        },
        now: () => clock,
        wait: async (milliseconds) => {
          clock += milliseconds;
        },
        timeoutMs: 5_000,
        pollIntervalMs: 50,
      });
    } catch (error) {
      failure = error;
    }

    expect(attempts).toBe(1);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The reviewed Scrap Mechanic process did not become observable.",
    );
    await expect(access(fixture.sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      fixture.userDataRoot,
      ".runtime-probe-session",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("aborts an identity read that does not settle within the observation window", async () => {
    // Break caught: a hung CIM subprocess holds the lock and spawned game beyond the deadline.
    const fixture = await makeFixture("cim-read-does-not-settle");
    let readStarted: (() => void) | undefined;
    const readStartedPromise = new Promise<void>((resolveStarted) => {
      readStarted = resolveStarted;
    });
    let aborted = false;
    let resolveAborted: (() => void) | undefined;
    const abortedPromise = new Promise<void>((resolve) => {
      resolveAborted = resolve;
    });

    const startPromise = startFixtureWithObservation(fixture, {
      readIdentity: async (_pid, signal) => await new Promise((resolveIdentity) => {
        readStarted?.();
        const fallback = setTimeout(() => resolveIdentity(undefined), 500);
        signal?.addEventListener("abort", () => {
          aborted = true;
          resolveAborted?.();
          clearTimeout(fallback);
          resolveIdentity(undefined);
        }, { once: true });
      }),
      timeoutMs: 20,
      pollIntervalMs: 5,
    });
    const startOutcome = startPromise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
    await readStartedPromise;
    const boundedAbort = await Promise.race([
      abortedPromise.then(() => "aborted" as const),
      new Promise<"pending">((resolvePending) => {
        setTimeout(() => resolvePending("pending"), 100);
      }),
    ]);
    const boundedOutcome = await Promise.race([
      startOutcome,
      new Promise<"pending">((resolvePending) => {
        setTimeout(() => resolvePending("pending"), 3_000);
      }),
    ]);

    expect(boundedAbort).toBe("aborted");
    expect(boundedOutcome).toBe("rejected");
    expect(aborted).toBe(true);
    await expect(access(fixture.sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      fixture.userDataRoot,
      ".runtime-probe-session",
    ))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      fixture.userDataRoot,
      ".runtime-probe.lock",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("fails with exit evidence when the child exits while CIM is still absent", async () => {
    // Break caught: an exit during CIM polling degrades into a generic timeout or writes a session.
    const fixture = await makeFixture("exit-during-cim-registration");
    await writeFile(join(fixture.releaseRoot, "exit-early.flag"), "");
    let attempts = 0;

    let failure: unknown;
    try {
      await startFixtureWithObservation(fixture, {
        readIdentity: async () => {
          attempts += 1;
          return undefined;
        },
        timeoutMs: 5_000,
        pollIntervalMs: 50,
      });
    } catch (error) {
      failure = error;
    }

    expect(attempts).toBeGreaterThan(1);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(
      /^The reviewed Scrap Mechanic process exited during observation \(exit code 23; lifetime \d+ ms\)\.$/,
    );
    expect((failure as Error).message).not.toContain(fixture.gameRoot);
    await expect(access(fixture.sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fixture.receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      fixture.userDataRoot,
      ".runtime-probe-session",
    ))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      fixture.userDataRoot,
      ".runtime-probe.lock",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it.each(["executable path", "command line"])(
    "rejects an observable wrong %s immediately without polling into acceptance",
    async (mismatch) => {
      // Break caught: a mismatched observable identity is treated as transient and later accepted.
      const fixture = await makeFixture(`observable-wrong-${mismatch.replace(" ", "-")}`);
      const executablePath = join(fixture.releaseRoot, "ScrapMechanic.exe");
      const wrongExecutablePath = join(fixture.gameRoot, "unreviewed", "ScrapMechanic.exe");
      let attempts = 0;
      let waits = 0;

      let failure: unknown;
      try {
        await startFixtureWithObservation(fixture, {
          readIdentity: async () => {
            attempts += 1;
            if (attempts > 1) {
              return {
                executablePath,
                commandLine: `"${executablePath}"`,
                createdAt: "2026-08-01T11:30:00.000Z",
              };
            }
            return {
              executablePath: mismatch === "executable path"
                ? wrongExecutablePath
                : executablePath,
              commandLine: mismatch === "command line"
                ? `"${wrongExecutablePath}"`
                : `"${executablePath}"`,
              createdAt: "2026-08-01T11:30:00.000Z",
            };
          },
          wait: async () => {
            waits += 1;
          },
          timeoutMs: 5_000,
          pollIntervalMs: 50,
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "The reviewed Scrap Mechanic process identity did not match the reviewed executable.",
      );
      expect((failure as Error).message).not.toContain(fixture.gameRoot);
      expect(attempts).toBe(1);
      expect(waits).toBe(0);
      await expect(access(fixture.sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(
        fixture.userDataRoot,
        ".runtime-probe-session",
      ))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(
        fixture.userDataRoot,
        ".runtime-probe.lock",
      ))).rejects.toMatchObject({ code: "ENOENT" });
    },
    15_000,
  );

  it("blocks a second same-root start until the first observed process exits", async () => {
    // Break caught: an older live PID can produce the log later attributed to a newer session.
    const fixture = await makeFixture("overlapping-live-session");
    await Promise.all([
      writeFile(join(fixture.releaseRoot, "write-log.flag"), ""),
      writeFile(join(fixture.releaseRoot, "stay-running.flag"), ""),
    ]);
    const first = await startFixture(fixture);
    const markerPath = join(fixture.userDataRoot, ".runtime-probe-session");
    const firstMarker = await readFile(markerPath, "utf8");
    const executablePath = join(fixture.releaseRoot, "ScrapMechanic.exe");
    expect(await countProcessesAt(executablePath)).toBe(1);
    const secondFixture = {
      ...fixture,
      sessionPath: join(dirname(fixture.sessionPath), "second-session.json"),
    };

    const expectOverlapRejected = async (
      candidate: typeof secondFixture,
    ): Promise<void> => {
      let overlapFailure: unknown;
      try {
        await startFixture(candidate);
      } catch (error) {
        overlapFailure = error;
      }
      expect(overlapFailure).toBeInstanceOf(Error);
      expect((overlapFailure as Error).message).toBe(
        "A Scrap Mechanic runtime probe is already running.",
      );
    };

    const parsedMarker = JSON.parse(firstMarker) as Record<string, unknown>;
    await writeFile(markerPath, JSON.stringify({
      ...parsedMarker,
      pid: 999_999,
      processCreatedAt: new Date(0).toISOString(),
    }));
    await expectOverlapRejected(secondFixture);
    await writeFile(markerPath, JSON.stringify({
      schemaVersion: 1,
      protectedPayload: Buffer.from("random marker payload").toString("base64"),
    }));
    await expectOverlapRejected(secondFixture);
    await writeFile(markerPath, firstMarker);
    await expectOverlapRejected(secondFixture);
    expect(await countProcessesAt(executablePath)).toBe(1);
    expect(await readFile(markerPath, "utf8")).toBe(firstMarker);

    process.kill(first.pid);
    await waitForExit(first.pid);
    const second = await startFixture(secondFixture);
    const secondMarker = await readFile(markerPath, "utf8");
    expect(secondMarker).not.toBe(firstMarker);

    await writeFile(markerPath, firstMarker);
    const thirdFixture = {
      ...fixture,
      sessionPath: join(dirname(fixture.sessionPath), "third-session.json"),
    };
    await expectOverlapRejected(thirdFixture);
    expect(await countProcessesAt(executablePath)).toBe(1);
    await writeFile(markerPath, secondMarker);
    process.kill(second.pid);
    await waitForExit(second.pid);
    await rm(join(fixture.releaseRoot, "stay-running.flag"));
    const third = await startFixture(thirdFixture);
    await waitForExit(third.pid);
    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "Runtime probe session is unavailable or invalid.",
    );
  }, 30_000);
});

describe("finishRuntimeProbe", () => {
  it("rejects an internally consistent raw-session JSON replacement", async () => {
    // Break caught: coherent raw JSON can replace the required opaque storage envelope.
    const fixture = await makeFixture("raw-session-replacement");
    await writeFile(join(fixture.releaseRoot, "write-log.flag"), "");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    await writeFile(fixture.sessionPath, JSON.stringify({
      ...session,
      pid: 999_999,
    }));
    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "Runtime probe session is unavailable or invalid.",
    );
  }, 15_000);

  it("rejects a valid but stale envelope after a newer start replaces its marker", async () => {
    // Break caught: replaying old opaque evidence can be mistaken for the latest start.
    const fixture = await makeFixture("stale-session-envelope");
    await writeFile(join(fixture.releaseRoot, "write-log.flag"), "");
    const first = await startFixture(fixture);
    const staleEnvelope = await readFile(fixture.sessionPath, "utf8");
    await waitForExit(first.pid);
    const second = await startFixture(fixture);
    await waitForExit(second.pid);

    await writeFile(fixture.sessionPath, staleEnvelope);
    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "Runtime probe session is unavailable or invalid.",
    );
  }, 15_000);

  it("fails a concurrent start closed while finish holds the user-root lock", async () => {
    // Break caught: a new start can replace the marker during finish's log/fingerprint gap.
    const fixture = await makeFixture("concurrent-start-finish");
    const noiseRoot = join(fixture.userDataRoot, "Roaming", "noise");
    await mkdir(noiseRoot, { recursive: true });
    await Promise.all(Array.from({ length: 400 }, (_, index) =>
      writeFile(join(noiseRoot, `noise-${index}.log`), "unrelated runtime output")
    ));
    await writeFile(join(fixture.releaseRoot, "write-log.flag"), "");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    const finishing = finishRuntimeProbe(fixture);
    const lockPath = join(fixture.userDataRoot, ".runtime-probe.lock");
    await waitFor(async () => {
      try {
        await access(lockPath);
        return true;
      } catch {
        return false;
      }
    });

    await expect(startRuntimeProbe(fixture)).rejects.toThrow(
      "Runtime probe session is busy.",
    );
    await expect(finishing).resolves.toMatchObject({
      protectedRootsUnchanged: true,
    });
    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);

  it("rejects a session that contains no protected-root evidence", async () => {
    // Break caught: zero verified roots can claim protectedRootsUnchanged.
    const fixture = await makeFixture("empty-protected-evidence");
    await mkdir(dirname(fixture.sessionPath), { recursive: true });
    await writeFile(fixture.sessionPath, JSON.stringify({
      schemaVersion: 1,
      pid: 999_999,
      executableVersion: "1.0.1.869",
      executableSha256: "a".repeat(64),
      startedAt: new Date().toISOString(),
      commandLine: "ScrapMechanic.exe",
      userDataRoot: fixture.userDataRoot,
      protectedBefore: {},
    }));

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "Runtime probe session is unavailable or invalid.",
    );
  });

  it("rejects a session with no newly created redirected Scrap Mechanic log", async () => {
    // Break caught: a receipt can be issued without evidence of redirected game output.
    const fixture = await makeFixture("missing-log");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "No new redirected Scrap Mechanic log was found.",
    );
  }, 15_000);

  it("accepts an official working-copy log when redirected user data materialized", async () => {
    // Break caught: official writable-copy logs are ignored even though redirected output exists.
    const fixture = await makeFixture("working-copy-log");
    await writeFile(join(fixture.releaseRoot, "write-working-log.flag"), "");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    const receipt = await finishRuntimeProbe(fixture);

    expect(receipt.proofLogRelativePath).toBe("working-copy/Logs/game-test.log");
    expect(receipt.proofLogSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.protectedRootsUnchanged).toBe(true);
  }, 15_000);

  it("rejects a working-copy log when no redirected artifact materialized", async () => {
    // Break caught: a writable-copy log alone can falsely prove redirected isolation.
    const fixture = await makeFixture("working-log-without-artifact");
    await Promise.all([
      writeFile(join(fixture.releaseRoot, "write-working-log.flag"), ""),
      writeFile(join(fixture.releaseRoot, "suppress-artifact.flag"), ""),
    ]);
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    let failure: unknown;
    try {
      await finishRuntimeProbe(fixture);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "No new redirected user-data artifact was found.",
    );
    expect((failure as Error).message).not.toContain(fixture.userDataRoot);
    expect((failure as Error).message).not.toContain(fixture.gameRoot);
    expect((failure as Error).message).not.toContain("F:\\");
  }, 15_000);

  it("rejects stale pre-start working logs and redirected artifacts", async () => {
    // Break caught: pre-existing files can be replayed as evidence for a new session.
    const fixture = await makeFixture("stale-proof-files");
    const workingLogs = join(fixture.gameRoot, "Logs");
    const redirectedArtifacts = join(fixture.userDataRoot, "Roaming");
    await Promise.all([
      mkdir(workingLogs, { recursive: true }),
      mkdir(redirectedArtifacts, { recursive: true }),
      writeFile(join(fixture.releaseRoot, "suppress-artifact.flag"), ""),
    ]);
    await Promise.all([
      writeFile(
        join(workingLogs, "game-stale.log"),
        "18:09:34 (1/0) [Main:24884] [Default] Initialized Logger\r\n"
          + "18:09:34 (1/0) [Main:24884] [Default] Game version 1.0.1.869\r\n",
      ),
      writeFile(join(redirectedArtifacts, "stale-user-data.bin"), "stale"),
    ]);
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "No new redirected Scrap Mechanic log was found.",
    );
  }, 15_000);

  it("does not count a stale redirected artifact beside a new working-copy log", async () => {
    // Break caught: the artifact gate accepts any pre-existing user-data file.
    const fixture = await makeFixture("stale-redirected-artifact");
    const redirectedArtifacts = join(fixture.userDataRoot, "Roaming");
    await mkdir(redirectedArtifacts, { recursive: true });
    await Promise.all([
      writeFile(join(fixture.releaseRoot, "write-working-log.flag"), ""),
      writeFile(join(fixture.releaseRoot, "suppress-artifact.flag"), ""),
      writeFile(join(redirectedArtifacts, "stale-user-data.bin"), "stale"),
    ]);
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "No new redirected user-data artifact was found.",
    );
  }, 15_000);

  it("rejects a new working-copy log without both official logger markers", async () => {
    // Break caught: arbitrary working-copy text is accepted as official 1.0.1.869 evidence.
    const fixture = await makeFixture("invalid-working-copy-log");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);
    const workingLogs = join(fixture.gameRoot, "Logs");
    await mkdir(workingLogs, { recursive: true });
    await writeFile(
      join(workingLogs, "game-invalid.log"),
      "18:09:34 (1/0) [Main:24884] [Default] Initialized Logger\r\n"
        + "18:09:34 (1/0) [Main:24884] [Default] Game version 1.0.1.8690\r\n",
    );

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "No new redirected Scrap Mechanic log was found.",
    );
  }, 15_000);

  it("rejects a working-copy version marker that is not a complete log line", async () => {
    // Break caught: a prefixed diagnostic line impersonates the official version line.
    const fixture = await makeFixture("prefixed-working-copy-version");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);
    const workingLogs = join(fixture.gameRoot, "Logs");
    await mkdir(workingLogs, { recursive: true });
    await writeFile(
      join(workingLogs, "game-prefixed.log"),
      "18:09:34 (1/0) [Main:24884] [Default] Initialized Logger\r\n"
        + "18:09:34 (1/0) [Main:24884] [Default] Invalid Game version 1.0.1.869\r\n",
    );

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "No new redirected Scrap Mechanic log was found.",
    );
  }, 15_000);

  it("rejects working-copy markers with a nonstandard prefix or level", async () => {
    // Break caught: exact marker text is accepted without the official Scrap log envelope.
    const fixture = await makeFixture("wrong-working-copy-envelope");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);
    const workingLogs = join(fixture.gameRoot, "Logs");
    await mkdir(workingLogs, { recursive: true });
    await Promise.all([
      writeFile(
        join(workingLogs, "game-wrong-level.log"),
        "18:09:34 (1/0) [Main:24884] [Default] Initialized Logger\r\n"
          + "18:09:34 (1/0) [Main:24884] [Warning] Game version 1.0.1.869\r\n",
      ),
      writeFile(
        join(workingLogs, "game-wrong-prefix.log"),
        "Initialized Logger\r\nGame version 1.0.1.869\r\n",
      ),
    ]);

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "No new redirected Scrap Mechanic log was found.",
    );
  }, 15_000);

  it("rejects a session whose launched PID is still running", async () => {
    // Break caught: mutable protected roots are verified before the observed process exits.
    const fixture = await makeFixture("still-running");
    await Promise.all([
      writeFile(join(fixture.releaseRoot, "write-log.flag"), ""),
      writeFile(join(fixture.releaseRoot, "stay-running.flag"), ""),
    ]);
    await startFixture(fixture);

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "The probed Scrap Mechanic process is still running.",
    );
  }, 15_000);

  it("rejects command-line evidence that is not bound to the launched executable", async () => {
    // Break caught: a modified session can substitute arbitrary process evidence.
    const fixture = await makeFixture("tampered-command-line");
    await writeFile(join(fixture.releaseRoot, "write-log.flag"), "");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);
    await writeFile(fixture.sessionPath, JSON.stringify({
      ...session,
      commandLine: '"F:\\unreviewed\\ScrapMechanic.exe"',
    }));

    await expect(finishRuntimeProbe(fixture)).rejects.toThrow(
      "Runtime probe session is unavailable or invalid.",
    );
  }, 15_000);

  it("reports relative protected-root changes without echoing private absolute paths", async () => {
    // Break caught: protected mutations are accepted or privacy-sensitive roots leak in errors.
    const fixture = await makeFixture("protected-diff");
    await writeFile(join(fixture.releaseRoot, "write-log.flag"), "");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);
    await mkdir(join(fixture.protectedRoots[0], "nested"));
    await writeFile(join(fixture.protectedRoots[0], "nested", "private.txt"), "changed");

    let failure: unknown;
    try {
      await finishRuntimeProbe(fixture);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("nested/private.txt");
    expect((failure as Error).message).not.toContain(fixture.protectedRoots[0]);
    expect((failure as Error).message).not.toContain("F:\\");
  }, 15_000);

  it("does not leak an absolute protected root when post-run fingerprinting fails", async () => {
    // Break caught: raw filesystem errors expose a private protected-root path.
    const fixture = await makeFixture("missing-protected-root");
    await writeFile(join(fixture.releaseRoot, "write-log.flag"), "");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);
    await rm(fixture.protectedRoots[0], { recursive: true, force: true });

    let failure: unknown;
    try {
      await finishRuntimeProbe(fixture);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Protected root 1 could not be verified.",
    );
    expect((failure as Error).message).not.toContain(fixture.protectedRoots[0]);
    expect((failure as Error).message).not.toContain("F:\\");
  }, 15_000);

  it("writes a receipt only after redirected-log and protected-root proof pass", async () => {
    // Break caught: successful proof fields are missing or not persisted canonically.
    const fixture = await makeFixture("successful-finish");
    await writeFile(join(fixture.releaseRoot, "write-log.flag"), "");
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    const receipt = await finishRuntimeProbe(fixture);

    expect(receipt).toEqual({
      schemaVersion: 1,
      processExecutableSha256: session.executableSha256,
      commandLineSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      userDataRoot: fixture.userDataRoot,
      proofLogRelativePath: "Roaming/Axolot Games/Scrap Mechanic/User/ScrapMechanic-test.log",
      proofLogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      protectedRootsUnchanged: true,
    });
    expect(JSON.parse(await readFile(fixture.receiptPath, "utf8"))).toEqual(receipt);
  }, 15_000);

  it("accepts sealed evidence containing two real files that differ only by case", async () => {
    // Break caught: session validation rejects a fingerprint startRuntimeProbe created itself.
    const fixture = await makeFixture("case-sensitive-protected-root");
    await execFileAsync(
      "fsutil.exe",
      ["file", "setCaseSensitiveInfo", fixture.protectedRoots[0], "enable"],
      { windowsHide: true },
    );
    await Promise.all([
      writeFile(join(fixture.protectedRoots[0], "Value.txt"), "upper"),
      writeFile(join(fixture.protectedRoots[0], "value.txt"), "lower"),
      writeFile(join(fixture.releaseRoot, "write-log.flag"), ""),
    ]);
    const session = await startFixture(fixture);
    await waitForExit(session.pid);

    await expect(finishRuntimeProbe(fixture)).resolves.toMatchObject({
      protectedRootsUnchanged: true,
    });
  }, 15_000);
});
