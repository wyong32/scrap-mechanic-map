import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { loadTileCatalog } from "./tile-catalog";

afterEach(() => vi.unstubAllGlobals());

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  return value;
}

function hash(payload: Record<string, unknown>): string {
  const { contentHash: _contentHash, ...withoutHash } = payload;
  return createHash("sha256").update(JSON.stringify(canonicalize(withoutHash))).digest("hex");
}

it("accepts the real trusted catalog when checkout line endings are CRLF", async () => {
  const build = readFileSync("public/data/generated/build-info.json", "utf8");
  const catalog = readFileSync("public/data/generated/tile-catalog.json", "utf8")
    .replace(/\r?\n/g, "\r\n");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
    new Response(String(input).endsWith("build-info.json") ? build : catalog)
  ));

  const result = await loadTileCatalog("/data/generated");

  expect(Object.keys(result.tiles)).toHaveLength(1070);
  expect(result.gameVersion).toBe("1.0.0");
  expect(result.legacyBridge.some((entry) => entry.legacyId === 1000001 && entry.tilePath.endsWith("Meadow_64(1111)_01.tile"))).toBe(true);
});

it("rejects a catalog whose portable bytes no longer match build-info", async () => {
  const build = readFileSync(
    "public/data/generated/build-info.json",
    "utf8"
  );
  const catalog = `${readFileSync(
    "public/data/generated/tile-catalog.json",
    "utf8"
  )} `;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) =>
      new Response(String(input).endsWith("build-info.json") ? build : catalog))
  );

  await expect(loadTileCatalog("/data/generated")).rejects.toThrow(
    /build-info|byte/i
  );
});

async function expectInvalidLegacyBridge(legacyBridge: unknown[]): Promise<void> {
  const build = JSON.parse(readFileSync("public/data/generated/build-info.json", "utf8")) as Record<string, unknown>;
  const catalog = JSON.parse(readFileSync("public/data/generated/tile-catalog.json", "utf8")) as Record<string, unknown>;
  catalog.legacyBridge = legacyBridge;
  catalog.contentHash = hash(catalog);
  const files = build.files as Array<Record<string, unknown>>;
  const listed = files.find((file) => file.name === "tile-catalog.json")!;
  listed.contentHash = catalog.contentHash;
  listed.bytes = new TextEncoder().encode(JSON.stringify(catalog)).byteLength;
  build.contentHash = hash(build);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(String(input).endsWith("build-info.json") ? build : catalog))));

  await expect(loadTileCatalog("/data/generated")).rejects.toThrow(/legacy bridge/i);
}

it("rejects hash-valid legacy bridge entries with duplicate IDs", async () => {
  await expectInvalidLegacyBridge([
    { legacyId: 1, uuid: "11111111-2222-4333-8444-555555555555", tilePath: "Survival/Terrain/Tiles/a.tile", status: "active", evidence: "Survival/Scripts/terrain/overworld/a.lua:AddTile" },
    { legacyId: 1, uuid: "22222222-3333-4444-8555-666666666666", tilePath: "Survival/Terrain/Tiles/b.tile", status: "retired", evidence: "Survival/Scripts/terrain/overworld/b.lua:addPoiTileRetired" }
  ]);
});

it("rejects hash-valid legacy bridge entries that are malformed or non-canonical", async () => {
  const valid = { legacyId: 2, uuid: "11111111-2222-4333-8444-555555555555", tilePath: "Survival/Terrain/Tiles/a.tile", status: "active", evidence: "Survival/Scripts/terrain/overworld/a.lua:AddTile" };
  await expectInvalidLegacyBridge([{ ...valid, uuid: "not-a-uuid" }]);
  await expectInvalidLegacyBridge([{ ...valid, tilePath: "G:/private/a.tile" }]);
  await expectInvalidLegacyBridge([{ ...valid, status: "unknown" }]);
  await expectInvalidLegacyBridge([{ ...valid, legacyId: 3 }, valid]);
});
