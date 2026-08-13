import { expect, it } from "vitest";
import type { WorldMap } from "../../../src/domain/map-model.ts";
import { atlasKey, verifyAtlasCoverage } from "./atlas-manifest.ts";

const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
it("normalizes UUIDs and distinguishes offsets and rotations", () => {
  expect(atlasKey(uuid.toUpperCase(), 0, 1, 3)).toBe(`${uuid}:0:1:3`);
  expect(atlasKey(uuid, 1, 1, 3)).not.toBe(atlasKey(uuid, 0, 1, 3));
});
it("reports the exact missing coverage input", () => {
  const worlds: WorldMap[] = [{ id: "grow-lab-1", source: "fixed-region", gameVersion: "1.0.0", bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, locations: [], connections: [], cells: [{ x: 0, y: 0, uuid, xOffset: 0, yOffset: 1, rotation: 3, flags: 0, terrainType: "fixed" }] }];
  const report = verifyAtlasCoverage(worlds, { schemaVersion: 1, gameVersion: "1.0.0", generatedFrom: [], contentHash: "test", pageSize: 4096, pages: {}, entries: {} });
  expect(report.missing).toEqual([{ regionId: "grow-lab-1", uuid, xOffset: 0, yOffset: 1, rotation: 3 }]);
});
it("rejects invalid UUIDs and rotations", () => {
  expect(() => atlasKey("not-a-uuid", 0, 0, 0)).toThrow("Invalid tile UUID");
  expect(() => atlasKey(uuid, 0, 0, 4 as 0)).toThrow();
});
