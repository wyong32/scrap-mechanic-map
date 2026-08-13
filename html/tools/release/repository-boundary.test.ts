import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const forbiddenTrackedSegments = [
  "runtime-captures/",
  "tileeditor-working-copy",
  "offline-render-work/",
  "runtime-user-data/",
  "/dist/",
  "/node_modules/"
] as const;

export const expectedCanonicalGeneratedPaths = [
  "html/public/data/generated/build-info.json",
  "html/public/data/generated/default-surface-orthographic-inventory.json",
  "html/public/data/generated/locations.json",
  "html/public/data/generated/reference-world.json",
  "html/public/data/generated/regions.json",
  "html/public/data/generated/tile-catalog.json",
  "html/public/data/generated/worlds/growlab_01.json",
  "html/public/data/generated/worlds/growlab_02.json",
  "html/public/data/generated/worlds/growlab_03.json",
  "html/public/data/generated/worlds/growlab_04.json",
  "html/public/data/generated/worlds/growlab_05.json",
  "html/public/data/generated/worlds/growlab_06.json",
  "html/public/data/generated/worlds/growlab_07.json",
  "html/public/data/generated/worlds/overworld_excavation_island.json",
  "html/public/data/generated/worlds/undergroundworld_drill_01.json",
  "html/public/data/generated/worlds/undergroundworld_drill_02.json",
  "html/public/data/generated/worlds/undergroundworld_empty.json",
  "html/public/data/generated/worlds/undergroundworld_final_boss_lobby.json",
  "html/public/data/generated/worlds/undergroundworld_mininghub.json",
  "html/public/data/generated/worlds/undergroundworld_onboarding.json",
  "html/public/data/generated/worlds/undergroundworld_scrapyard.json",
  "html/public/data/generated/worlds/undergroundworld_station_01.json",
  "html/public/data/generated/worlds/undergroundworld_station_02.json",
  "html/public/data/generated/worlds/undergroundworld_trashbot_boss.json",
  "html/public/data/generated/worlds/world_builder_excavationisland_01.json"
] as const;

async function trackedPaths(): Promise<string[]> {
  const { stdout } = await runFile("git", ["ls-files", "-z"], { cwd: repositoryRoot });
  return stdout.split("\0").filter(Boolean);
}

describe("repository release boundary", () => {
  it("keeps local capture sources and obsolete public data out of tracked releases", async () => {
    const tracked = await trackedPaths();
    const forbidden = tracked.filter((path) =>
      path.endsWith(".pdn") || forbiddenTrackedSegments.some((segment) => path.includes(segment))
    );

    expect(forbidden).toEqual([]);
    expect(tracked).not.toContain("html/public/data/reference-world.json");
    expect(tracked).not.toContain("html/public/data/locations.json");
    expect(tracked).not.toContain("html/public/data/regions.json");
    expect(tracked).not.toContain("html/public/data/default-save.db");
    expect(tracked.some((path) => path.startsWith("html/local-assets/"))).toBe(false);
    expect(tracked).not.toContain("html/public/data/generated/legacy-assets.json");
    expect(tracked.some((path) => path.startsWith("html/public/legacy/"))).toBe(false);
    expect(tracked.some((path) =>
      path.startsWith("html/public/atlas/official/orthographic-")
    )).toBe(false);
    expect(tracked).toContain("html/tools/game-data/source/reference-world.json");

    const generated = tracked
      .filter((path) => path.startsWith("html/public/data/generated/") && path.endsWith(".json"))
      .sort();
    expect(generated).toEqual(expectedCanonicalGeneratedPaths);
    await Promise.all(expectedCanonicalGeneratedPaths.map((path) => access(join(repositoryRoot, path))));
  });
});
