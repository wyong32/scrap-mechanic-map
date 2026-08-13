import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyRuntimePatch } from "./runtime-patch.ts";

const allowedRoot = "F:\\Scrap Mechanical";
const createdRoots: string[] = [];
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const modernSurvivalGame = [
  "g_survivalDev = false",
  "",
  "function SurvivalGame.bindChatCommands( self )",
  "\tsm.game.bindChatCommand( \"/existing\", {}, \"cl_onChatCommand\", \"Existing\" )",
  "end",
  "",
  "function SurvivalGame.client_onUpdate( self, dt )",
  "\tself.cl.time = dt",
  "end",
  "",
  "function SurvivalGame.cl_onChatCommand( self, params )",
  "\tif params[1] == \"/existing\" then return end",
  "end",
  "",
].join("\r\n");

async function createFixture(source = modernSurvivalGame) {
  const root = await mkdtemp(join(allowedRoot, ".runtime-patch-test-"));
  createdRoots.push(root);
  const gameRoot = join(root, "game");
  const userDataRoot = join(root, "runtime-user-data", "probe");
  const captureRoot = join(root, "runtime-captures", "probe");
  const gameFile = join(gameRoot, "Survival", "Scripts", "game", "SurvivalGame.lua");
  const executable = join(gameRoot, "Release", "ScrapMechanic.exe");
  const proofLog = join(gameRoot, "Logs", "game-test.log");
  await Promise.all([
    mkdir(join(gameRoot, "Survival", "Scripts", "game"), { recursive: true }),
    mkdir(join(gameRoot, "Release"), { recursive: true }),
    mkdir(join(gameRoot, "Logs"), { recursive: true }),
    mkdir(userDataRoot, { recursive: true }),
    mkdir(captureRoot, { recursive: true }),
  ]);
  await writeFile(gameFile, source, "utf8");
  await writeFile(executable, "fixture-executable", "utf8");
  await writeFile(proofLog, "fixture-proof-log", "utf8");
  const isolationReceiptPath = join(captureRoot, "runtime-isolation-receipt.json");
  await writeFile(isolationReceiptPath, `${JSON.stringify({
    schemaVersion: 1,
    processExecutableSha256: sha256("fixture-executable"),
    commandLineSha256: "a".repeat(64),
    userDataRoot,
    proofLogRelativePath: "working-copy/Logs/game-test.log",
    proofLogSha256: sha256("fixture-proof-log"),
    protectedRootsUnchanged: true,
  })}\n`, "utf8");
  return {
    root,
    gameRoot,
    gameFile,
    companionFile: join(gameRoot, "Survival", "Scripts", "game", "SmOverviewCapture.lua"),
    isolationReceiptPath,
    backupRoot: join(captureRoot, "game-backup"),
    receiptPath: join(captureRoot, "runtime-patch-receipt.json"),
  };
}

afterEach(async () => {
  for (const root of createdRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("applyRuntimePatch", () => {
  it("creates an exact backup and all marker-bounded insertions with recorded hashes", async () => {
    const fixture = await createFixture();
    const original = await readFile(fixture.gameFile);

    const receipt = await applyRuntimePatch(fixture);
    const patched = await readFile(fixture.gameFile, "utf8");
    const backup = await readFile(join(fixture.backupRoot, "Survival", "Scripts", "game", "SurvivalGame.lua"));
    const companion = await readFile(fixture.companionFile, "utf8");

    expect(backup).toEqual(original);
    expect(patched.match(/dofile\( "\$SURVIVAL_DATA\/Scripts\/game\/SmOverviewCapture\.lua" \)/g)).toHaveLength(1);
    expect(patched.match(/SmOverviewCapture\.bind\( self \)/g)).toHaveLength(1);
    expect(patched.match(/SmOverviewCapture\.handleClient\( self, params \)/g)).toHaveLength(1);
    expect(patched.match(/SmOverviewCapture\.update\( self \)/g)).toHaveLength(1);
    expect(patched.match(/function SurvivalGame\.sv_smOverviewCaptureTeleport/g)).toHaveLength(1);
    expect(patched.match(/SM_OVERVIEW_PATCH_BEGIN/g)).toHaveLength(5);
    expect(companion).toContain("SM_OVERVIEW_CAPTURE_READY x=%.3f y=%.3f z=%.3f fov=90 direction=0,0,-1 gui=hidden");
    expect(receipt.survivalGame).toMatchObject({
      relativePath: "Survival/Scripts/game/SurvivalGame.lua",
      originalSha256: sha256(original),
      backupSha256: sha256(original),
      patchedSha256: sha256(patched),
    });
    expect(receipt.companionScript.sha256).toBe(sha256(companion));
    expect(JSON.parse(await readFile(fixture.receiptPath, "utf8"))).toEqual(receipt);
  });

  it("is byte-stable and idempotent on a second run", async () => {
    const fixture = await createFixture();
    const first = await applyRuntimePatch(fixture);
    const firstPatched = await readFile(fixture.gameFile);
    const firstCompanion = await readFile(fixture.companionFile);

    const second = await applyRuntimePatch(fixture);

    expect(await readFile(fixture.gameFile)).toEqual(firstPatched);
    expect(await readFile(fixture.companionFile)).toEqual(firstCompanion);
    expect(second).toEqual(first);
  });

  it.each([
    ["missing", modernSurvivalGame.replace("function SurvivalGame.client_onUpdate( self, dt )", "function SurvivalGame.other( self, dt )")],
    ["duplicate", `${modernSurvivalGame}\r\nfunction SurvivalGame.cl_onChatCommand( self, params )\r\nend\r\n`],
  ])("rejects a %s exact anchor before writing backup or companion", async (_case, source) => {
    const fixture = await createFixture(source);
    const original = await readFile(fixture.gameFile);

    await expect(applyRuntimePatch(fixture)).rejects.toThrow(/anchor/i);

    expect(await readFile(fixture.gameFile)).toEqual(original);
    await expect(readFile(fixture.companionFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(fixture.backupRoot, "Survival", "Scripts", "game", "SurvivalGame.lua"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses missing, invalid, or non-passing isolation receipts", async () => {
    const fixture = await createFixture();
    await rm(fixture.isolationReceiptPath);
    await expect(applyRuntimePatch(fixture)).rejects.toThrow(/isolation receipt/i);
    await writeFile(fixture.isolationReceiptPath, "{}\n", "utf8");
    await expect(applyRuntimePatch(fixture)).rejects.toThrow(/isolation receipt/i);
  });

  it("refuses a game root outside the approved workspace and a junction alias", async () => {
    const fixture = await createFixture();
    await expect(applyRuntimePatch({ ...fixture, gameRoot: "G:\\unapproved-game" }))
      .rejects.toThrow(/approved workspace/i);
    const alias = join(fixture.root, "game-alias");
    await symlink(fixture.gameRoot, alias, "junction");
    await expect(applyRuntimePatch({ ...fixture, gameRoot: alias }))
      .rejects.toThrow(/canonical/i);
  });

  it("refuses an existing backup with a different hash without modifying either source file", async () => {
    const fixture = await createFixture();
    const backup = join(fixture.backupRoot, "Survival", "Scripts", "game", "SurvivalGame.lua");
    await mkdir(join(fixture.backupRoot, "Survival", "Scripts", "game"), { recursive: true });
    await writeFile(backup, "wrong backup", "utf8");
    const original = await readFile(fixture.gameFile);

    await expect(applyRuntimePatch(fixture)).rejects.toThrow(/backup.*hash/i);

    expect(await readFile(fixture.gameFile)).toEqual(original);
    await expect(readFile(fixture.companionFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a pre-existing different companion before writing the backup or source", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.companionFile, "operator-owned script", "utf8");
    const original = await readFile(fixture.gameFile);

    await expect(applyRuntimePatch(fixture)).rejects.toThrow(/companion.*differs/i);

    expect(await readFile(fixture.gameFile)).toEqual(original);
    expect(await readFile(fixture.companionFile, "utf8")).toBe("operator-owned script");
    await expect(readFile(join(fixture.backupRoot, "Survival", "Scripts", "game", "SurvivalGame.lua"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a receipt path that aliases an input or patch output", async () => {
    const fixture = await createFixture();
    await expect(applyRuntimePatch({ ...fixture, receiptPath: fixture.isolationReceiptPath }))
      .rejects.toThrow(/distinct/i);
    await expect(applyRuntimePatch({ ...fixture, receiptPath: fixture.gameFile }))
      .rejects.toThrow(/external/i);
  });

  it("refuses a patch receipt path that aliases the byte-identical backup", async () => {
    const fixture = await createFixture();
    const backup = join(fixture.backupRoot, "Survival", "Scripts", "game", "SurvivalGame.lua");
    await expect(applyRuntimePatch({ ...fixture, receiptPath: backup }))
      .rejects.toThrow(/backup.*distinct/i);
    await expect(readFile(backup)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(fixture.gameFile, "utf8")).toBe(modernSurvivalGame);
  });

  it.each([
    'dofile( "$SURVIVAL_DATA/Scripts/game/SmOverviewCapture.lua" )',
    "SmOverviewCapture.bind( self )",
    "SmOverviewCapture.handleClient( self, params )",
    "SmOverviewCapture.update( self )",
    "function SurvivalGame.sv_smOverviewCaptureTeleport( self, params, player )",
  ])("rejects an unmarked pre-existing target insertion before writing: %s", async (insertion) => {
    const fixture = await createFixture(`${modernSurvivalGame}\r\n${insertion}\r\n`);
    await expect(applyRuntimePatch(fixture)).rejects.toThrow(/unmarked.*insertion/i);
    expect(await readFile(fixture.gameFile, "utf8")).toBe(`${modernSurvivalGame}\r\n${insertion}\r\n`);
    await expect(readFile(fixture.companionFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses repository backup and receipt destinations before modifying the game", async () => {
    const fixture = await createFixture();
    const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
    const reviewedLua = join(import.meta.dirname, "lua", "SmOverviewCapture.lua");
    const reviewedLuaBefore = await readFile(reviewedLua);
    const gameBefore = await readFile(fixture.gameFile);

    await expect(applyRuntimePatch({
      ...fixture,
      backupRoot: join(repositoryRoot, ".forbidden-runtime-backup"),
    })).rejects.toThrow(/outside the repository/i);
    await expect(applyRuntimePatch({ ...fixture, receiptPath: reviewedLua }))
      .rejects.toThrow(/outside the repository/i);

    expect(await readFile(reviewedLua)).toEqual(reviewedLuaBefore);
    expect(await readFile(fixture.gameFile)).toEqual(gameBefore);
    await expect(readFile(fixture.companionFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
