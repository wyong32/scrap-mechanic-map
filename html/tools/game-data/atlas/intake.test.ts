import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import type { WorldMap } from "../../../src/domain/map-model.ts";
import { deriveAtlasIntake } from "./intake.ts";
import { buildAtlas } from "./pack-atlas.ts";
import { verifyAtlasCoverage } from "./atlas-manifest.ts";
import { loadAtlasManifest, verifyAtlasFiles } from "./verify-atlas.ts";

const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const worlds: WorldMap[] = ["one", "two"].map((id, index) => ({ id, source: "fixed-region", gameVersion: "1.0.0", bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 }, locations: [], connections: [], cells: [{ x: 0, y: 0, uuid, xOffset: 0, yOffset: 0, rotation: index as 0 | 1, flags: 0, terrainType: "x" }, { x: 1, y: 0, uuid, xOffset: 1, yOffset: 0, rotation: 2, flags: 0, terrainType: "x" }] }));
it("derives deduplicated north-up inputs, reports partial intake, then packs and strictly verifies complete input", async () => {
  const root = await mkdtemp(join(tmpdir(), "sm-intake-")); const inputs = join(root, "inputs"); await import("node:fs/promises").then(({ mkdir }) => mkdir(inputs));
  await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toFile(join(inputs, `${uuid}__0__0.png`));
  let intake = await deriveAtlasIntake(worlds, inputs); expect(intake.uniqueInputs).toEqual([`${uuid}__0__0.png`, `${uuid}__1__0.png`]); expect(intake.requiredKeys).toHaveLength(3); expect(intake.missing).toEqual([`${uuid}__1__0.png`]);
  await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).png().toFile(join(inputs, `${uuid}__1__0.png`)); intake = await deriveAtlasIntake(worlds, inputs); const atlas = join(root, "atlas"); await buildAtlas(intake.cells, atlas); const manifest = await loadAtlasManifest(atlas); await verifyAtlasFiles(atlas, manifest); expect(verifyAtlasCoverage(worlds, manifest)).toMatchObject({ occurrences: 4, distinctKeys: 3, covered: 4, missing: [] });
});
