import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RuntimeIsolationReceipt,
  RuntimePatchOptions,
  RuntimePatchReceipt,
} from "./runtime-types.ts";

const APPROVED_ROOT = "F:\\Scrap Mechanical";
const SURVIVAL_RELATIVE = "Survival/Scripts/game/SurvivalGame.lua" as const;
const COMPANION_RELATIVE = "Survival/Scripts/game/SmOverviewCapture.lua" as const;
const LUA_SOURCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "lua",
  "SmOverviewCapture.lua",
);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const BLOCKS = {
  dofile: [
    "-- SM_OVERVIEW_PATCH_BEGIN dofile",
    'dofile( "$SURVIVAL_DATA/Scripts/game/SmOverviewCapture.lua" )',
    "-- SM_OVERVIEW_PATCH_END dofile",
  ],
  bind: [
    "\t-- SM_OVERVIEW_PATCH_BEGIN bind",
    "\tSmOverviewCapture.bind( self )",
    "\t-- SM_OVERVIEW_PATCH_END bind",
  ],
  client: [
    "\t-- SM_OVERVIEW_PATCH_BEGIN client",
    "\tif SmOverviewCapture.handleClient( self, params ) then return end",
    "\t-- SM_OVERVIEW_PATCH_END client",
  ],
  update: [
    "\t-- SM_OVERVIEW_PATCH_BEGIN update",
    "\tSmOverviewCapture.update( self )",
    "\t-- SM_OVERVIEW_PATCH_END update",
  ],
  server: [
    "-- SM_OVERVIEW_PATCH_BEGIN server",
    "function SurvivalGame.sv_smOverviewCaptureTeleport( self, params, player )",
    "\tSmOverviewCapture.teleport( self, params, player )",
    "end",
    "-- SM_OVERVIEW_PATCH_END server",
  ],
} as const;

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(comparable(root), comparable(candidate));
  return difference === "" || (
    difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
  );
}

async function canonicalExisting(path: string, label: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(resolve(path));
  } catch {
    throw new Error(`${label} is unavailable.`);
  }
  if (comparable(canonical) !== comparable(resolve(path))) {
    throw new Error(`${label} must use its canonical path without junctions.`);
  }
  return canonical;
}

async function canonicalFuture(path: string, label: string): Promise<string> {
  const unresolved: string[] = [];
  let current = resolve(path);
  while (true) {
    try {
      const ancestor = await realpath(current);
      const canonical = resolve(ancestor, ...unresolved);
      if (comparable(canonical) !== comparable(resolve(path))) {
        throw new Error(`${label} must use its canonical path without junctions.`);
      }
      return canonical;
    } catch (error) {
      if (error instanceof Error && error.message.includes("canonical path")) throw error;
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      const parent = dirname(current);
      if (code !== "ENOENT" || parent === current) throw new Error(`${label} is unavailable.`);
      unresolved.unshift(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      current = parent;
    }
  }
}

function countExact(text: string, value: string): number {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(value, index)) >= 0) {
    count += 1;
    index += value.length;
  }
  return count;
}

function requireOneAnchor(text: string, anchor: string): number {
  const count = countExact(text, anchor);
  if (count !== 1) throw new Error(`Expected exactly one runtime patch anchor: ${anchor}`);
  return text.indexOf(anchor);
}

function insertFirstLine(text: string, anchor: string, block: readonly string[], eol: string): string {
  const at = requireOneAnchor(text, anchor) + anchor.length;
  return `${text.slice(0, at)}${eol}${block.join(eol)}${text.slice(at)}`;
}

function insertAtFunctionEnd(text: string, anchor: string, block: readonly string[], eol: string): string {
  const start = requireOneAnchor(text, anchor);
  const next = text.indexOf(`${eol}function `, start + anchor.length);
  const boundary = next < 0 ? text.length : next;
  const segment = text.slice(start, boundary);
  const endPattern = new RegExp(`${eol.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}end(?:${eol.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}|$)`, "g");
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = endPattern.exec(segment)) !== null) last = match;
  if (!last) throw new Error(`Runtime patch anchor has no function end: ${anchor}`);
  const at = start + last.index + eol.length;
  return `${text.slice(0, at)}${block.join(eol)}${eol}${text.slice(at)}`;
}

function buildPatchedSource(original: string): string {
  const anchors = {
    bind: "function SurvivalGame.bindChatCommands( self )",
    client: "function SurvivalGame.cl_onChatCommand( self, params )",
    update: "function SurvivalGame.client_onUpdate( self, dt )",
  };
  for (const anchor of Object.values(anchors)) requireOneAnchor(original, anchor);
  if (original.includes("SM_OVERVIEW_PATCH_BEGIN") || original.includes("SM_OVERVIEW_PATCH_END")) {
    throw new Error("Runtime patch markers are present in an invalid source state.");
  }
  const targetInsertions = [
    'dofile( "$SURVIVAL_DATA/Scripts/game/SmOverviewCapture.lua" )',
    "SmOverviewCapture.bind( self )",
    "SmOverviewCapture.handleClient( self, params )",
    "SmOverviewCapture.update( self )",
    "function SurvivalGame.sv_smOverviewCaptureTeleport( self, params, player )",
  ];
  if (targetInsertions.some((insertion) => original.includes(insertion))) {
    throw new Error("SurvivalGame source contains an unmarked runtime capture insertion.");
  }
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  let patched = `${BLOCKS.dofile.join(eol)}${eol}${original}`;
  patched = insertAtFunctionEnd(patched, anchors.bind, BLOCKS.bind, eol);
  patched = insertFirstLine(patched, anchors.client, BLOCKS.client, eol);
  patched = insertFirstLine(patched, anchors.update, BLOCKS.update, eol);
  if (!patched.endsWith(eol)) patched += eol;
  patched += `${eol}${BLOCKS.server.join(eol)}${eol}`;
  return patched;
}

function isIsolationReceipt(value: unknown): value is RuntimeIsolationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return receipt.schemaVersion === 1
    && typeof receipt.processExecutableSha256 === "string"
    && HASH_PATTERN.test(receipt.processExecutableSha256)
    && typeof receipt.commandLineSha256 === "string"
    && HASH_PATTERN.test(receipt.commandLineSha256)
    && typeof receipt.userDataRoot === "string"
    && typeof receipt.proofLogRelativePath === "string"
    && /^working-copy\/Logs\/[^/\\]+\.log$/.test(receipt.proofLogRelativePath)
    && typeof receipt.proofLogSha256 === "string"
    && HASH_PATTERN.test(receipt.proofLogSha256)
    && receipt.protectedRootsUnchanged === true;
}

async function readVerifiedIsolationReceipt(
  path: string,
  gameRoot: string,
  approvedRoot: string,
): Promise<{ receipt: RuntimeIsolationReceipt; sha256: string }> {
  const canonicalPath = await canonicalExisting(path, "Runtime isolation receipt");
  if (!isWithin(approvedRoot, canonicalPath) || isWithin(gameRoot, canonicalPath)) {
    throw new Error("Runtime isolation receipt must be external and inside the approved workspace.");
  }
  let bytes: Buffer;
  let parsed: unknown;
  try {
    bytes = await readFile(canonicalPath);
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Runtime isolation receipt is invalid.");
  }
  if (!isIsolationReceipt(parsed)) throw new Error("Runtime isolation receipt is invalid.");
  const executablePath = await canonicalExisting(join(gameRoot, "Release", "ScrapMechanic.exe"), "Game executable");
  const proofPath = await canonicalExisting(
    join(gameRoot, parsed.proofLogRelativePath.slice("working-copy/".length)),
    "Runtime isolation proof log",
  );
  const userDataRoot = await canonicalExisting(parsed.userDataRoot, "Redirected user-data root");
  if (
    !isWithin(gameRoot, executablePath)
    || !isWithin(gameRoot, proofPath)
    || !isWithin(approvedRoot, userDataRoot)
    || isWithin(gameRoot, userDataRoot)
    || digest(await readFile(executablePath)) !== parsed.processExecutableSha256
    || digest(await readFile(proofPath)) !== parsed.proofLogSha256
  ) {
    throw new Error("Runtime isolation receipt does not verify against the writable game copy.");
  }
  return { receipt: parsed, sha256: digest(bytes) };
}

async function atomicWrite(path: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function applyRuntimePatch(options: RuntimePatchOptions): Promise<RuntimePatchReceipt> {
  const approvedRoot = await canonicalExisting(APPROVED_ROOT, "Approved workspace");
  const repositoryRoot = await canonicalExisting(REPOSITORY_ROOT, "Repository root");
  if (!isWithin(approvedRoot, resolve(options.gameRoot)) || comparable(resolve(options.gameRoot)) === comparable(approvedRoot)) {
    throw new Error("Game root must be inside the approved workspace.");
  }
  const gameRoot = await canonicalExisting(options.gameRoot, "Game root");
  if (!isWithin(approvedRoot, gameRoot) || gameRoot === approvedRoot) {
    throw new Error("Game root must be inside the approved workspace.");
  }
  const backupRoot = await canonicalFuture(options.backupRoot, "Backup root");
  const receiptPath = await canonicalFuture(options.receiptPath, "Patch receipt path");
  const isolationReceiptPath = await canonicalExisting(
    options.isolationReceiptPath,
    "Runtime isolation receipt",
  );
  if (
    !isWithin(approvedRoot, backupRoot)
    || !isWithin(approvedRoot, receiptPath)
    || isWithin(gameRoot, backupRoot)
    || isWithin(gameRoot, receiptPath)
  ) {
    throw new Error("Backup and receipt must be external and inside the approved workspace.");
  }
  if (isWithin(repositoryRoot, backupRoot) || isWithin(repositoryRoot, receiptPath)) {
    throw new Error("Backup and receipt must be outside the repository.");
  }
  if (comparable(receiptPath) === comparable(isolationReceiptPath)) {
    throw new Error("Patch receipt and isolation receipt paths must be distinct.");
  }

  const isolation = await readVerifiedIsolationReceipt(
    options.isolationReceiptPath,
    gameRoot,
    approvedRoot,
  );
  const sourcePath = await canonicalExisting(join(gameRoot, ...SURVIVAL_RELATIVE.split("/")), "SurvivalGame source");
  if (!isWithin(gameRoot, sourcePath)) throw new Error("SurvivalGame source escaped the game root.");
  const backupPath = await canonicalFuture(
    join(backupRoot, ...SURVIVAL_RELATIVE.split("/")),
    "SurvivalGame backup",
  );
  const companionPath = await canonicalFuture(
    join(gameRoot, ...COMPANION_RELATIVE.split("/")),
    "Capture companion script",
  );
  if (comparable(receiptPath) === comparable(backupPath)) {
    throw new Error("Patch receipt and byte-identical backup paths must be distinct.");
  }
  const currentBytes = await readFile(sourcePath);
  const currentText = currentBytes.toString("utf8");
  const companionBytes = await readFile(LUA_SOURCE_PATH);

  let preexistingCompanion: Buffer | undefined;
  try {
    preexistingCompanion = await readFile(companionPath);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code !== "ENOENT") throw error;
  }
  if (preexistingCompanion && !preexistingCompanion.equals(companionBytes)) {
    throw new Error("Pre-existing capture companion script differs from the reviewed script.");
  }

  let originalBytes = currentBytes;
  let patchedText: string;
  const alreadyPatched = currentText.includes("SM_OVERVIEW_PATCH_BEGIN");
  try {
    const existingBackup = await readFile(backupPath);
    originalBytes = existingBackup;
    if (!alreadyPatched && digest(existingBackup) !== digest(currentBytes)) {
      throw new Error("Existing backup hash differs from the current original source.");
    }
    patchedText = buildPatchedSource(existingBackup.toString("utf8"));
    if (alreadyPatched && currentText !== patchedText) {
      throw new Error("Existing runtime patch does not match its byte-identical backup.");
    }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code !== "ENOENT") throw error;
    if (alreadyPatched) throw new Error("Patched source is missing its byte-identical backup.");
    patchedText = buildPatchedSource(currentText);
  }

  const patchedBytes = Buffer.from(patchedText, "utf8");
  if (alreadyPatched) {
    if (!preexistingCompanion) {
      throw new Error("Patched source is missing its companion script.");
    }
  }

  if (!alreadyPatched) {
    await atomicWrite(backupPath, originalBytes);
    await atomicWrite(sourcePath, patchedBytes);
    await atomicWrite(companionPath, companionBytes);
  }

  const executableHash = isolation.receipt.processExecutableSha256;
  const receipt: RuntimePatchReceipt = {
    schemaVersion: 1,
    gameExecutableSha256: executableHash,
    isolationReceiptSha256: isolation.sha256,
    survivalGame: {
      relativePath: SURVIVAL_RELATIVE,
      backupRelativePath: SURVIVAL_RELATIVE,
      originalSha256: digest(originalBytes),
      backupSha256: digest(await readFile(backupPath)),
      patchedSha256: digest(await readFile(sourcePath)),
    },
    companionScript: {
      relativePath: COMPANION_RELATIVE,
      sha256: digest(await readFile(companionPath)),
    },
  };
  await atomicWrite(receiptPath, canonicalJson(receipt));
  return receipt;
}
