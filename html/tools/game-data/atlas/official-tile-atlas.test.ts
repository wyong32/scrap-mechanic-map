import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { expect, it } from "vitest";
import {
  buildOfficialTileAtlas,
  isOfficialDeepWaterTile,
  prepareOfficialDeepWaterPreview,
  prepareOfficialIcon,
  selectOfficialPreviewProjection,
  selectOfficialPreviewMode,
  rectifyOfficialPreview
} from "./official-tile-atlas.ts";

it("recognizes deep water and submerged lake POIs as water surfaces", () => {
  expect(isOfficialDeepWaterTile(
    "Survival/Terrain/Tiles/lake/Lake(1111)_04.tile"
  )).toBe(true);
  expect(isOfficialDeepWaterTile(
    "Survival/Terrain/Tiles/lake/Lake(0111)_04.tile"
  )).toBe(false);
  expect(isOfficialDeepWaterTile(
    "Survival/Terrain/Tiles/poi/Random_Lake_64_01.tile"
  )).toBe(true);
  expect(isOfficialDeepWaterTile(
    "Survival/Terrain/Tiles/poi/Ruin_Lake_128_01.tile"
  )).toBe(true);
  expect(isOfficialDeepWaterTile(
    "Survival/Terrain/Tiles/poi/CampingSpot_WaterFront_256_01.tile"
  )).toBe(false);
});

it("marks only canonical deep-water previews as verified orthographic surfaces", () => {
  expect(selectOfficialPreviewProjection(
    "Survival/Terrain/Tiles/lake/Lake(1111)_04.tile"
  )).toBe("verified-orthographic");
  expect(selectOfficialPreviewProjection(
    "Survival/Terrain/Tiles/roads/Road(1111)_01.tile"
  )).toBeUndefined();
});

it("uses only the official water surface for a deep-water preview", async () => {
  const input = await sharp({
    create: {
      width: 220,
      height: 150,
      channels: 3,
      background: { r: 60, g: 62, b: 71 }
    }
  }).composite([
    {
      input: Buffer.from(
        '<svg width="220" height="150">'
          + '<polygon points="109,37 215,93 110,149 4,93" fill="#e66b21"/>'
          + '<rect x="76" y="54" width="68" height="24" fill="#168fc4"/>'
          + '<rect x="100" y="58" width="12" height="12" fill="#d5a42b"/>'
          + '</svg>'
      )
    }
  ]).png().toBuffer();

  const output = await prepareOfficialDeepWaterPreview(input, 32);
  const { data, info } = await sharp(output)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  expect(info).toMatchObject({ width: 32, height: 32, channels: 3 });
  for (let offset = 0; offset < data.length; offset += 3) {
    expect(data[offset]).toBeLessThan(60);
    expect(data[offset + 2]).toBeGreaterThan(140);
  }
});

it("uses one canonical water surface across deep-water preview variants", async () => {
  const preview = async (color: string) => sharp({
    create: {
      width: 220,
      height: 150,
      channels: 3,
      background: color
    }
  }).png().toBuffer();

  const light = await prepareOfficialDeepWaterPreview(
    await preview("#21aadd"),
    16
  );
  const dark = await prepareOfficialDeepWaterPreview(
    await preview("#087ca8"),
    16
  );

  expect(light.equals(dark)).toBe(true);
});

it("rectifies the official 220x150 diamond into a square without the editor background", async () => {
  const source = {
    create: {
      width: 220,
      height: 150,
      channels: 3 as const,
      background: { r: 60, g: 62, b: 71 }
    }
  };
  const diamond = Buffer.from(
    `<svg width="220" height="150"><polygon points="109,37 215,93 110,149 4,93" fill="#22aa44"/></svg>`
  );
  const input = await sharp(source).composite([{ input: diamond }]).png().toBuffer();
  const output = await rectifyOfficialPreview(input, 32);
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });

  expect(info).toMatchObject({ width: 32, height: 32, channels: 4 });
  for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31], [16, 16]]) {
    const offset = (y * 32 + x) * 4;
    expect(data[offset + 1]).toBeGreaterThan(130);
    expect(data[offset + 2]).toBeLessThan(120);
  }
});

it("orients the editor diamond to the legacy north-up coordinate system", async () => {
  const background = {
    create: {
      width: 220,
      height: 150,
      channels: 3 as const,
      background: { r: 60, g: 62, b: 71 }
    }
  };
  const quadrants = Buffer.from(`<svg width="220" height="150">
    <polygon points="109,37 109,93 4,93" fill="#ffff00"/>
    <polygon points="109,37 215,93 109,93" fill="#ff0000"/>
    <polygon points="215,93 110,149 109,93" fill="#00ff00"/>
    <polygon points="110,149 4,93 109,93" fill="#0000ff"/>
  </svg>`);
  const input = await sharp(background)
    .composite([{ input: quadrants }])
    .png()
    .toBuffer();
  const output = await rectifyOfficialPreview(input, 32);
  const { data } = await sharp(output).removeAlpha().raw().toBuffer({
    resolveWithObject: true
  });
  const pixel = (x: number, y: number) =>
    [...data.subarray((y * 32 + x) * 3, (y * 32 + x) * 3 + 3)];

  expect(pixel(3, 3)).toEqual([0, 0, 255]);
  expect(pixel(28, 3)).toEqual([255, 0, 0]);
  expect(pixel(28, 28)).toEqual([0, 255, 0]);
  expect(pixel(3, 28)[0]).toBeLessThan(20);
  expect(pixel(3, 28)[1]).toBeGreaterThan(200);
  expect(pixel(3, 28)[2]).toBeLessThan(40);
});

it("builds separate terrain and icon atlas sources for an official structure", async () => {
  const root = await mkdtemp(join(tmpdir(), "sm-official-atlas-"));
  const gameRoot = join(root, "game");
  const outputDirectory = join(root, "atlas");
  const tileDirectory = join(gameRoot, "Survival", "Terrain", "Tiles", "poi");
  await mkdir(tileDirectory, { recursive: true });
  const uuid = "258be1e5-e4b2-4f72-ab9f-2b09f3480652";
  await writeFile(
    join(tileDirectory, `${uuid}.png`),
    await sharp({
      create: {
        width: 220,
        height: 150,
        channels: 3,
        background: { r: 20, g: 140, b: 40 }
      }
    }).png().toBuffer()
  );
  const catalogPath = join(root, "tile-catalog.json");
  await writeFile(catalogPath, JSON.stringify({
    gameVersion: "1.0.0",
    tiles: [{
      uuid,
      relativePath: "Survival/Terrain/Tiles/poi/sample.tile",
      sourceCategory: "poi",
      width: 2,
      height: 2
    }]
  }));

  const report = await buildOfficialTileAtlas({
    gameRoot,
    catalogPath,
    outputDirectory,
    spriteSize: 32,
    pageSize: 64
  });
  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "official-tile-atlas.json"), "utf8")
  );

  expect(report).toMatchObject({ entries: 1, pages: 2, missing: 0 });
  expect(manifest.entries[uuid]).toMatchObject({
    page: "official-0.webp",
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    spanWidth: 2,
    spanHeight: 2,
    renderMode: "isometric-thumbnail",
    icon: {
      page: "official-icons-0.webp",
      x: 0,
      y: 0,
      width: 32,
      height: 32
    }
  });
  expect(manifest.pages["official-0.webp"]).toMatchObject({
    width: 64,
    height: 64,
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
  });
  expect(manifest.pages["official-icons-0.webp"]).toMatchObject({
    width: 64,
    height: 64,
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
  });
  expect(manifest.contentHash).toMatch(/^[0-9a-f]{64}$/);
});

it("keeps large POI and dungeon editor previews as thumbnails instead of warping them", () => {
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/Terrain/Tiles/poi/Warehouse.tile",
    sourceCategory: "poi",
    width: 4,
    height: 4
  })).toBe("isometric-thumbnail");
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/Terrain/Tiles/poi/CampingSpot_WaterFront_256_01.tile",
    sourceCategory: "poi",
    width: 4,
    height: 4
  })).toBe("terrain");
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/Terrain/Tiles/poi/RuinCity_512_01.tile",
    sourceCategory: "poi",
    width: 8,
    height: 8
  })).toBe("isometric-thumbnail");
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/DungeonTiles/Minidungeon/Interior.tile",
    sourceCategory: "dungeon",
    width: 10,
    height: 10
  })).toBe("isometric-thumbnail");
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/Terrain/Tiles/poi/Kiosk.tile",
    sourceCategory: "poi",
    width: 1,
    height: 1
  })).toBe("isometric-thumbnail");
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/Terrain/Tiles/poi/Ruin_BurntForest_64_02.tile",
    sourceCategory: "poi",
    width: 1,
    height: 1
  })).toBe("isometric-thumbnail");
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/Terrain/Tiles/questtiles/Minidungeon_Overworld_Entrance_256_03.tile",
    sourceCategory: "quest",
    width: 4,
    height: 4
  })).toBe("isometric-thumbnail");
  expect(selectOfficialPreviewMode({
    relativePath: "Survival/Terrain/Tiles/poi/Ruin_Forest_64_01.tile",
    sourceCategory: "poi",
    width: 1,
    height: 1
  })).toBe("terrain");
});

it("keys the editor background out of a contained official structure icon", async () => {
  const input = await sharp({
    create: {
      width: 220,
      height: 150,
      channels: 3,
      background: { r: 60, g: 62, b: 71 }
    }
  }).composite([{
    input: Buffer.from('<svg width="220" height="150"><rect x="90" y="55" width="40" height="40" fill="#ff6600"/></svg>')
  }]).png().toBuffer();
  const icon = await prepareOfficialIcon(input, 64);
  const { data, info } = await sharp(icon).ensureAlpha().raw().toBuffer({
    resolveWithObject: true
  });
  const alphaValues = (pixels: Buffer) => Array.from(
    { length: pixels.length / 4 },
    (_, index) => pixels[index * 4 + 3]!
  );

  expect(info).toMatchObject({ width: 64, height: 64, channels: 4 });
  expect(data[3]).toBe(0);
  expect(Math.max(...alphaValues(data))).toBe(255);
});
