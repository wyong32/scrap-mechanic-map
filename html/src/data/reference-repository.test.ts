import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferenceMapRepository } from "./reference-repository";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  return value;
}
function envelope<T extends object>(payload: T) {
  const document: Record<string, unknown> = { schemaVersion: 1, gameVersion: "1.0.0", generatedFrom: ["fixture"], ...payload };
  document.contentHash = createHash("sha256").update(JSON.stringify(canonicalize(document))).digest("hex");
  return document;
}
function text(document: object): string { return `${JSON.stringify(canonicalize(document), null, 2)}\n`; }

function installGeneratedFetch(options: {
  alter?: "content" | "version" | "hash" | "bytes";
  crlf?: boolean;
  failOnce?: boolean;
} = {}) {
  const requested: string[] = [];
  const regions = envelope({ displayNames: { surface: "地表世界", fixed: "固定区域" }, regions: [
    { id: "surface", name: "surface", group: "surface", source: "reference", bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
    { id: "fixed", name: "fixed", group: "underground", source: "fixed-region", bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, worldIds: ["fixed-world"] },
  ] });
  const locations = envelope({ locations: [{ id: "fixed-location", regionId: "fixed", name: "固定地点", category: "poi", precision: "exact", questIds: [], resourceIds: [], enemyIds: [], relatedRegionIds: [] }] });
  const fixedWorld = envelope({ world: { id: "fixed-world", source: "fixed-region", gameVersion: "1.0.0", bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, cells: [], locations: [], connections: [] } });
  const reference = envelope({ world: { id: "reference-surface", source: "reference", gameVersion: "1.0.0", bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, cells: [], locations: [], connections: [] } });
  const documents = new Map<string, string>([
    ["regions.json", text(regions)], ["locations.json", text(locations)], ["worlds/fixed-world.json", text(fixedWorld)], ["reference-world.json", text(reference)],
  ]);
  const files = [...documents].map(([name, body]) => ({ name, contentHash: (JSON.parse(body) as { contentHash: string }).contentHash, bytes: new TextEncoder().encode(body).byteLength }));
  if (options.alter === "bytes") files.find((file) => file.name === "regions.json")!.bytes += 1;
  const buildInfo = envelope({ files });
  documents.set("build-info.json", text(buildInfo));
  if (options.alter === "content") documents.set("regions.json", text({ ...regions, displayNames: { surface: "tampered" } }));
  if (options.alter === "version") documents.set("regions.json", text(envelope({ ...regions, gameVersion: "9.9.9" })));
  if (options.alter === "hash") documents.set("regions.json", text({ ...regions, contentHash: "0".repeat(64) }));
  let failed = false;
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const name = String(input).replace("/data/generated/", ""); requested.push(name);
    if (options.failOnce && name === "regions.json" && !failed) { failed = true; return new Response("temporary", { status: 503 }); }
    const body = documents.get(name);
    const servedBody = options.crlf ? body?.replace(/\n/g, "\r\n") : body;
    return new Response(servedBody, { status: servedBody === undefined ? 404 : 200 });
  });
  return requested;
}

afterEach(() => vi.unstubAllGlobals());

describe("ReferenceMapRepository", () => {
  it("self-validates, consults build-info and lazily fetches only the selected fixed world", async () => {
    const requested = installGeneratedFetch();
    const world = await new ReferenceMapRepository().loadWorld("fixed");
    expect(world.id).toBe("fixed-world");
    expect(world.locations.map((location) => location.id)).toEqual(["fixed-location"]);
    expect(requested[0]).toBe("build-info.json");
    expect(requested).toContain("worlds/fixed-world.json");
    expect(requested).not.toContain("reference-world.json");
  });

  it.each(["content", "version", "hash", "bytes"] as const)("rejects a %s integrity mismatch", async (alter) => {
    installGeneratedFetch({ alter });
    await expect(new ReferenceMapRepository().loadRegions()).rejects.toThrow(/integrity|mismatch|byte size/i);
  });

  it("accepts CRLF generated bundles whose hashes and portable byte counts agree", async () => {
    installGeneratedFetch({ crlf: true });

    await expect(new ReferenceMapRepository().loadWorld("fixed")).resolves.toMatchObject({
      id: "fixed-world"
    });
  });

  it.each(["content", "hash", "bytes"] as const)(
    "rejects CRLF bundles with %s tampering",
    async (alter) => {
      installGeneratedFetch({ alter, crlf: true });

      await expect(new ReferenceMapRepository().loadRegions()).rejects.toThrow(
        /integrity|mismatch|byte size/i
      );
    }
  );

  it("clears a rejected cached request so the user can retry", async () => {
    installGeneratedFetch({ failOnce: true });
    const repository = new ReferenceMapRepository();
    await expect(repository.loadRegions()).rejects.toThrow("Unable to load");
    await expect(repository.loadRegions()).resolves.toHaveLength(2);
  });
});
