import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorldMap } from "../../src/domain/map-model";
import { describe, expect, it } from "vitest";
import { buildLocationNameInventory } from "../../src/map/location-name-inventory";
import { loadReferenceSurface } from "./reference-world";

describe("checked-in Scrap Mechanic 1.0 reference world", () => {
  it("keeps the complete default layout and its generated location points", async () => {
    const world = await loadReferenceSurface(
      join(process.cwd(), "tools", "game-data", "source", "reference-world.json"),
      "1.0.0"
    );
    const generatedBundle = JSON.parse(
      await readFile(
        join(process.cwd(), "public", "data", "generated", "reference-world.json"),
        "utf8"
      )
    ) as { world: WorldMap };
    const inventory = buildLocationNameInventory(generatedBundle.world);
    const generatedGroup = inventory.groups.find((group) => group.id === "generated");

    expect(world.cells).toHaveLength(16_128);
    expect(new Set(generatedBundle.world.cells.flatMap((cell) => cell.poiType ?? []))).toHaveLength(73);
    expect(generatedGroup?.count).toBe(376);
    expect(generatedGroup?.types.map((type) => type.name)).toEqual([
      "Builder Quest Locations",
      "Camps & Ruins",
      "Major Generated Locations",
      "Resource & Hazard",
      "Road Locations",
      "Warehouse"
    ]);
  });
});
