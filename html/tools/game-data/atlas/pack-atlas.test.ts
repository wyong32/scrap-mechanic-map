import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { atlasKey } from "./atlas-manifest.ts";
import { buildAtlas } from "./pack-atlas.ts";

const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
async function fixture() { const root = await mkdtemp(join(tmpdir(), "sm-atlas-")); const image = join(root, "north.png"); await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toFile(image); return { root, image }; }
async function asymmetricFixture() {
  const root = await mkdtemp(join(tmpdir(), "sm-atlas-asymmetric-"));
  const image = join(root, "quadrants.png");
  await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 255 }
    }
  }).composite([
    {
      input: {
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 255 }
        }
      },
      left: 2,
      top: 0
    },
    {
      input: {
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 0, g: 0, b: 255, alpha: 255 }
        }
      },
      left: 0,
      top: 2
    },
    {
      input: {
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 255, g: 255, b: 0, alpha: 255 }
        }
      },
      left: 2,
      top: 2
    }
  ]).png().toFile(image);
  return { root, image };
}
it("packs canonical rotation keys deterministically with explicit half-scale geometry", async () => {
  const { root, image } = await fixture(); const cells = [0, 1, 2, 3].map((rotation) => ({ key: atlasKey(uuid.toUpperCase(), 0, 0, rotation as 0 | 1 | 2 | 3), imagePath: image, logicalSize: 256, sourceHash: "source" }));
  const first = await buildAtlas(cells, join(root, "one")); const second = await buildAtlas([...cells].reverse(), join(root, "two"));
  expect(Object.keys(first.entries)).toEqual([0, 1, 2, 3].map((rotation) => atlasKey(uuid, 0, 0, rotation as 0 | 1 | 2 | 3)));
  expect(first.entries[atlasKey(uuid, 0, 0, 0)]).toMatchObject({ x: 0, y: 0, lowX: 0, lowY: 0, lowWidth: 128, lowHeight: 128, sourceHash: "source" });
  expect(first.contentHash).toBe(second.contentHash); expect(first.generatedFrom).toEqual(["north.png"]); expect(await readFile(join(root, "one", "terrain-cell-atlas.json"), "utf8")).toBe(await readFile(join(root, "two", "terrain-cell-atlas.json"), "utf8"));
});
it("rejects semantic duplicates after canonicalization", async () => {
  const { root, image } = await fixture(); const cell = { key: atlasKey(uuid, 0, 0, 0), imagePath: image, logicalSize: 256, sourceHash: "source" };
  await expect(buildAtlas([cell, { ...cell, key: cell.key.toUpperCase() as typeof cell.key }], join(root, "out"))).rejects.toThrow("Duplicate atlas key");
});

it("packs all four asymmetric quadrants with the original rotation mapping", async () => {
  const { root, image } = await asymmetricFixture();
  const manifest = await buildAtlas(
    ([0, 1, 2, 3] as const).map((rotation) => ({
      key: atlasKey(uuid, 0, 0, rotation),
      imagePath: image,
      logicalSize: 4,
      sourceHash: "quadrants"
    })),
    join(root, "atlas")
  );
  const pageName = manifest.entries[atlasKey(uuid, 0, 0, 0)]!.page;
  const { data, info } = await sharp(join(root, "atlas", pageName))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const offset = (y * info.width + x) * 4;
    return [...data.subarray(offset, offset + 3)];
  };
  const corners = (rotation: 0 | 1 | 2 | 3) => {
    const entry = manifest.entries[atlasKey(uuid, 0, 0, rotation)]!;
    return [
      pixel(entry.x, entry.y),
      pixel(entry.x + 3, entry.y),
      pixel(entry.x, entry.y + 3),
      pixel(entry.x + 3, entry.y + 3)
    ];
  };

  expect(corners(0)).toEqual([
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0]
  ]);
  expect(corners(1)).toEqual([
    [0, 255, 0],
    [255, 255, 0],
    [255, 0, 0],
    [0, 0, 255]
  ]);
  expect(corners(2)).toEqual([
    [255, 255, 0],
    [0, 0, 255],
    [0, 255, 0],
    [255, 0, 0]
  ]);
  expect(corners(3)).toEqual([
    [0, 0, 255],
    [255, 0, 0],
    [255, 255, 0],
    [0, 255, 0]
  ]);
});
