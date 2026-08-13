import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { WorldMap } from "../../src/domain/map-model.ts";
import type { TileDefinition } from "../game-data/extract-catalog.ts";
import {
  AUTHENTIC_LAYER_IDS,
  type OfficialCaptureReceipt,
} from "./authentic-map-types.ts";
import { buildGrowLabCaptureJob } from "./grow-lab-job.ts";
import { verifyOfficialCapture } from "./verify-capture.ts";

const createdDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const job = (() => {
  const world = JSON.parse(
    readFileSync("public/data/generated/worlds/growlab_01.json", "utf8"),
  ) as { world: WorldMap };
  const catalog = JSON.parse(
    readFileSync("public/data/generated/tile-catalog.json", "utf8"),
  ) as { tiles: TileDefinition[] };
  return buildGrowLabCaptureJob(world.world, catalog.tiles);
})();

function receipt(): OfficialCaptureReceipt {
  return {
    editor: "TileEditor",
    editorVersion: "1.0.1.869",
    sourceTileUuid: "d3d4d976-d2a6-4d21-95bd-fada26b6b371",
    sourceTileRelativePath:
      "Survival/DungeonTiles/Minidungeon/Minidungeon_Interior_01.tile",
    camera: {
      projection: "orthographic",
      direction: "north-up",
      pixelsPerCell: 128,
      width: 1280,
      height: 1280,
    },
    layers: Object.fromEntries(
      AUTHENTIC_LAYER_IDS.map((id) => [
        id,
        {
          file: `${id}.png`,
          officialInstanceCount: 1,
          transparentAllowed: false,
        },
      ]),
    ) as OfficialCaptureReceipt["layers"],
  };
}

async function fixtureDirectory(
  mutate?: (value: OfficialCaptureReceipt, directory: string) => void | Promise<void>,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sm-authentic-capture-"));
  createdDirectories.push(directory);
  const image = await sharp({
    create: {
      width: 1280,
      height: 1280,
      channels: 4,
      background: { r: 52, g: 124, b: 83, alpha: 1 },
    },
  }).png().toBuffer();
  await Promise.all(
    AUTHENTIC_LAYER_IDS.map((id) => writeFile(join(directory, `${id}.png`), image)),
  );
  const value = receipt();
  await mutate?.(value, directory);
  await writeFile(
    join(directory, "capture-receipt.json"),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  return directory;
}

describe("verifyOfficialCapture", () => {
  it("verifies seven aligned official TileEditor PNG captures", async () => {
    const directory = await fixtureDirectory();
    const capture = await verifyOfficialCapture(job, directory);
    expect(capture.receipt).toMatchObject({
      editor: "TileEditor",
      editorVersion: "1.0.1.869",
    });
    expect([...capture.files.keys()]).toEqual(AUTHENTIC_LAYER_IDS);
    expect(capture.files.get("terrain")).toMatchObject({
      width: 1280,
      height: 1280,
    });
    expect(capture.files.get("terrain")?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a missing layer", async () => {
    const directory = await fixtureDirectory(async (_value, path) => {
      await rm(join(path, "effects.png"));
    });
    await expect(verifyOfficialCapture(job, directory)).rejects.toThrow(
      /missing capture layer/i,
    );
  });

  it("rejects dimensions other than 1280x1280", async () => {
    const directory = await fixtureDirectory(async (_value, path) => {
      const image = await sharp({
        create: {
          width: 1279,
          height: 1280,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 1 },
        },
      }).png().toBuffer();
      await writeFile(join(path, "terrain.png"), image);
    });
    await expect(verifyOfficialCapture(job, directory)).rejects.toThrow(
      /1280x1280/,
    );
  });

  it("rejects non-PNG bytes", async () => {
    const directory = await fixtureDirectory(async (_value, path) => {
      await writeFile(join(path, "props.png"), "not a PNG");
    });
    await expect(verifyOfficialCapture(job, directory)).rejects.toThrow(/PNG/);
  });

  it("rejects wrong editor identity and source tile UUID", async () => {
    const wrongEditor = await fixtureDirectory((value) => {
      value.editorVersion = "1.0.0.0" as "1.0.1.869";
    });
    await expect(verifyOfficialCapture(job, wrongEditor)).rejects.toThrow(
      /official TileEditor receipt/,
    );

    const wrongTile = await fixtureDirectory((value) => {
      value.sourceTileUuid =
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as typeof value.sourceTileUuid;
    });
    await expect(verifyOfficialCapture(job, wrongTile)).rejects.toThrow(
      /capture source/i,
    );
  });

  it("rejects a transparent layer that claims official instances", async () => {
    const directory = await fixtureDirectory(async (_value, path) => {
      const transparent = await sharp({
        create: {
          width: 1280,
          height: 1280,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png().toBuffer();
      await writeFile(join(path, "vegetation.png"), transparent);
    });
    await expect(verifyOfficialCapture(job, directory)).rejects.toThrow(
      /transparent capture.*official instances/i,
    );
  });

  it("allows a transparent layer only when the receipt reports zero instances", async () => {
    const directory = await fixtureDirectory(async (value, path) => {
      value.layers.effects.officialInstanceCount = 0;
      value.layers.effects.transparentAllowed = true;
      const transparent = await sharp({
        create: {
          width: 1280,
          height: 1280,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png().toBuffer();
      await writeFile(join(path, "effects.png"), transparent);
    });
    await expect(verifyOfficialCapture(job, directory)).resolves.toBeDefined();
  });

  it("rejects absolute source paths and unknown receipt layers without leaking paths", async () => {
    const absolute = await fixtureDirectory((value) => {
      value.sourceTileRelativePath =
        "G:\\private\\Scrap Mechanic\\Survival\\DungeonTiles\\Minidungeon\\Minidungeon_Interior_01.tile";
    });
    let message = "";
    try {
      await verifyOfficialCapture(job, absolute);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/capture source/i);
    expect(message).not.toContain("G:\\");

    const unknown = await fixtureDirectory((value) => {
      (value.layers as Record<string, unknown>).lighting = {
        file: "lighting.png",
        officialInstanceCount: 0,
        transparentAllowed: true,
      };
    });
    await expect(verifyOfficialCapture(job, unknown)).rejects.toThrow(
      /exactly seven reviewed layers/,
    );
  });

  it("hashes the exact PNG bytes", async () => {
    const directory = await fixtureDirectory();
    const capture = await verifyOfficialCapture(job, directory);
    const original = await readFile(join(directory, "terrain.png"));
    expect(original.byteLength).toBeGreaterThan(0);
    expect(capture.files.get("terrain")?.sha256).toBe(
      createHash("sha256").update(original).digest("hex"),
    );
    expect(capture.files.get("terrain")?.absolutePath).toBe(
      join(directory, "terrain.png"),
    );
  });
});
