import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseRuntimeFrameAcceptOptions,
  parseRuntimePatchOptions,
  parseRuntimeProbeStartOptions,
  parseRuntimeStitchOptions,
  runAuthenticMapCli,
} from "./cli.ts";

describe("runAuthenticMapCli", () => {
  it("does not echo an unsupported absolute-path command", async () => {
    const command = "G:\\private\\Scrap Mechanic\\Survival";

    await expect(runAuthenticMapCli([command])).rejects.toThrow(
      "Unsupported authentic-map command.",
    );
    await expect(runAuthenticMapCli([command])).rejects.not.toThrow(command);
    await expect(runAuthenticMapCli([command])).rejects.not.toThrow("G:\\");
  });

  it("collects protected roots in order while preserving first-value option behavior", () => {
    // Break caught: repeated protected roots collapse or ordinary options change semantics.
    expect(parseRuntimeProbeStartOptions([
      "runtime-probe-start",
      "--game-root",
      "F:\\first-game",
      "--game-root",
      "F:\\ignored-game",
      "--user-data-root",
      "F:\\Scrap Mechanical\\runtime-user-data\\probe",
      "--protected-root",
      "G:\\steam\\Scrap Mechanic",
      "--protected-root",
      "G:\\shared\\Scrap Mechanic",
      "--session",
      "F:\\Scrap Mechanical\\runtime-captures\\probe-session.json",
    ])).toEqual({
      gameRoot: "F:\\first-game",
      userDataRoot: "F:\\Scrap Mechanical\\runtime-user-data\\probe",
      protectedRoots: [
        "G:\\steam\\Scrap Mechanic",
        "G:\\shared\\Scrap Mechanic",
      ],
      sessionPath: "F:\\Scrap Mechanical\\runtime-captures\\probe-session.json",
    });
  });

  it("validates required runtime probe start and finish options", async () => {
    // Break caught: a partially specified gate command reaches the filesystem or process layer.
    await expect(runAuthenticMapCli([
      "runtime-probe-start",
      "--game-root",
      "F:\\game",
    ])).rejects.toThrow("Missing required option: --user-data-root <path>");
    await expect(runAuthenticMapCli([
      "runtime-probe-finish",
      "--session",
      "F:\\session.json",
    ])).rejects.toThrow("Missing required option: --receipt <path>");
  });

  it("parses runtime patch paths and rejects incomplete patch commands before filesystem access", async () => {
    expect(parseRuntimePatchOptions([
      "runtime-patch",
      "--game-root", "F:\\Scrap Mechanical\\working-copy",
      "--isolation-receipt", "F:\\Scrap Mechanical\\captures\\isolation.json",
      "--backup-root", "F:\\Scrap Mechanical\\captures\\backup",
      "--receipt", "F:\\Scrap Mechanical\\captures\\patch.json",
    ])).toEqual({
      gameRoot: "F:\\Scrap Mechanical\\working-copy",
      isolationReceiptPath: "F:\\Scrap Mechanical\\captures\\isolation.json",
      backupRoot: "F:\\Scrap Mechanical\\captures\\backup",
      receiptPath: "F:\\Scrap Mechanical\\captures\\patch.json",
    });
    await expect(runAuthenticMapCli(["runtime-patch", "--game-root", "F:\\game"]))
      .rejects.toThrow("Missing required option: --isolation-receipt <path>");
  });

  it("writes a canonical runtime job outside the repository and reports only public statistics", async () => {
    // Break caught: runtime-job leaks the save path or writes a non-canonical capture contract.
    const root = await mkdtemp(join(tmpdir(), "sm-runtime-job-"));
    const save = join(root, "input", "source.db");
    const output = join(root, "output", "capture-job.json");
    await mkdir(dirname(save), { recursive: true });
    await writeFile(save, "fixture-save", "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runAuthenticMapCli([
      "runtime-job",
      "--save",
      save,
      "--output",
      output,
    ]);

    const text = await readFile(output, "utf8");
    const document = JSON.parse(text) as {
      sourceSaveSha256: string;
      points: unknown[];
      contentHash: string;
    };
    expect(text.endsWith("\n")).toBe(true);
    expect(document.sourceSaveSha256).toBe(
      createHash("sha256").update("fixture-save").digest("hex"),
    );
    expect(document.points).toHaveLength(25);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      points: 25,
      rows: 5,
      columns: 5,
      crop: { left: 585, top: 165, width: 750, height: 750 },
      contentHash: document.contentHash,
    });
    expect(String(log.mock.calls[0]?.[0])).not.toContain(save);
    log.mockRestore();
  });

  it("refuses runtime-job output in the repository or a detected game root", async () => {
    // Break caught: capture metadata can overwrite source or official/writable game files.
    const root = await mkdtemp(join(tmpdir(), "sm-runtime-job-safe-"));
    const save = join(root, "source.db");
    await writeFile(save, "fixture-save", "utf8");
    const repositoryOutput = join(process.cwd(), "runtime-job-forbidden.json");
    await expect(runAuthenticMapCli([
      "runtime-job", "--save", save, "--output", repositoryOutput,
    ])).rejects.toThrow("Runtime job output must be outside the repository and game roots.");

    const worktreeRoot = dirname(process.cwd());
    await expect(runAuthenticMapCli([
      "runtime-job",
      "--save",
      save,
      "--output",
      join(worktreeRoot, "docs", "runtime-job-forbidden.json"),
    ])).rejects.toThrow("Runtime job output must be outside the repository and game roots.");

    const repositoryAlias = join(root, "repository-alias");
    await symlink(worktreeRoot, repositoryAlias, "junction");
    await expect(runAuthenticMapCli([
      "runtime-job",
      "--save",
      save,
      "--output",
      join(repositoryAlias, "docs", "runtime-job-forbidden.json"),
    ])).rejects.toThrow("Runtime job output must be outside the repository and game roots.");

    const gameRoot = join(root, "game");
    await mkdir(join(gameRoot, "Release"), { recursive: true });
    await writeFile(join(gameRoot, "Release", "ScrapMechanic.exe"), "fixture", "utf8");
    await expect(runAuthenticMapCli([
      "runtime-job",
      "--save",
      save,
      "--output",
      join(gameRoot, "captures", "capture-job.json"),
    ])).rejects.toThrow("Runtime job output must be outside the repository and game roots.");
  });

  it("requires both runtime-job arguments before touching the filesystem", async () => {
    // Break caught: an incomplete command resolves or hashes an unintended default path.
    await expect(runAuthenticMapCli(["runtime-job"]))
      .rejects.toThrow("Missing required option: --save <path>");
    await expect(runAuthenticMapCli(["runtime-job", "--save", "missing.db"]))
      .rejects.toThrow("Missing required option: --output <path>");
  });

  it("parses the exact runtime-frame-accept paths and rejects incomplete commands", async () => {
    // Break caught: a frame command silently defaults an evidence or capture-root path.
    expect(parseRuntimeFrameAcceptOptions([
      "runtime-frame-accept",
      "--job", "F:\\Scrap Mechanical\\captures\\capture-job.json",
      "--point", "r0-c0",
      "--first", "F:\\Scrap Mechanical\\captures\\source\\r0-c0-a1.png",
      "--second", "F:\\Scrap Mechanical\\captures\\source\\r0-c0-b1.png",
      "--evidence", "F:\\Scrap Mechanical\\captures\\evidence\\r0-c0-a1.json",
      "--output-root", "F:\\Scrap Mechanical\\captures",
    ])).toEqual({
      jobPath: "F:\\Scrap Mechanical\\captures\\capture-job.json",
      pointId: "r0-c0",
      firstFrame: "F:\\Scrap Mechanical\\captures\\source\\r0-c0-a1.png",
      secondFrame: "F:\\Scrap Mechanical\\captures\\source\\r0-c0-b1.png",
      evidencePath: "F:\\Scrap Mechanical\\captures\\evidence\\r0-c0-a1.json",
      outputRoot: "F:\\Scrap Mechanical\\captures",
    });
    await expect(runAuthenticMapCli([
      "runtime-frame-accept",
      "--job", "capture-job.json",
    ])).rejects.toThrow("Missing required option: --point <id>");
  });

  it.skipIf(process.platform !== "win32")(
    "rejects a runtime-frame output root outside F:\\Scrap Mechanical",
    async () => {
      // Break caught: runtime artifacts can be written to a protected or unapproved drive.
      const root = await mkdtemp(join(tmpdir(), "sm-runtime-frame-root-"));
      const job = join(root, "capture-job.json");
      await writeFile(job, "{}", "utf8");
      await expect(runAuthenticMapCli([
        "runtime-frame-accept",
        "--job", job,
        "--point", "r0-c0",
        "--first", join(root, "source", "r0-c0-a1.png"),
        "--second", join(root, "source", "r0-c0-b1.png"),
        "--evidence", join(root, "evidence", "r0-c0-a1.json"),
        "--output-root", root,
      ])).rejects.toThrow(
        "Runtime frame output root must be below F:\\Scrap Mechanical.",
      );
    },
  );

  it("parses the exact runtime-stitch paths and rejects incomplete commands", async () => {
    expect(parseRuntimeStitchOptions([
      "runtime-stitch",
      "--job", "F:\\Scrap Mechanical\\captures\\capture-job.json",
      "--manifest", "F:\\Scrap Mechanical\\captures\\capture-manifest.json",
      "--output-root", "F:\\Scrap Mechanical\\captures",
    ])).toEqual({
      jobPath: "F:\\Scrap Mechanical\\captures\\capture-job.json",
      manifestPath: "F:\\Scrap Mechanical\\captures\\capture-manifest.json",
      outputRoot: "F:\\Scrap Mechanical\\captures",
    });
    await expect(runAuthenticMapCli([
      "runtime-stitch", "--job", "capture-job.json",
    ])).rejects.toThrow("Missing required option: --manifest <path>");
  });
});
