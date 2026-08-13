import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { expect, it } from "vitest";
import { buildOrthographicAtlasOverlay } from "./orthographic-atlas.ts";

it("packs variable-size verified orthographic renders and preserves POI icons", async () => {
  const root = await mkdtemp(join(tmpdir(), "sm-ortho-atlas-"));
  const inputDirectory = join(root, "inputs");
  const outputDirectory = join(root, "atlas");
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const one = "11111111-1111-4111-8111-111111111111";
  const two = "22222222-2222-4222-8222-222222222222";
  const manifestPath = join(outputDirectory, "official-tile-atlas.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    contentHash: "old",
    spriteSize: 32,
    pages: {
      "official-icons-0.webp": { width: 64, height: 64, sha256: "a".repeat(64) }
    },
    entries: {
      [one]: {
        uuid: one,
        page: "old.webp",
        x: 0,
        y: 0,
        width: 32,
        height: 32,
        spanWidth: 1,
        spanHeight: 1,
        renderMode: "terrain"
      },
      [two]: {
        uuid: two,
        page: "old.webp",
        x: 32,
        y: 0,
        width: 32,
        height: 32,
        spanWidth: 2,
        spanHeight: 1,
        renderMode: "isometric-thumbnail",
        icon: {
          page: "official-icons-0.webp",
          x: 0,
          y: 0,
          width: 32,
          height: 32
        }
      }
    }
  }));
  await writeFile(
    join(inputDirectory, `${one}.png`),
    await sharp({ create: { width: 32, height: 32, channels: 3, background: "#228844" } }).png().toBuffer()
  );
  await writeFile(
    join(inputDirectory, `${two}.png`),
    await sharp({ create: { width: 64, height: 32, channels: 3, background: "#884422" } }).png().toBuffer()
  );

  const report = await buildOrthographicAtlasOverlay({
    manifestPath,
    inputDirectory,
    outputDirectory,
    pixelsPerCell: 32,
    pageSize: 64
  });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  expect(report).toEqual({ entries: 2, pages: 1 });
  expect(manifest.entries[one]).toMatchObject({
    page: "orthographic-0.webp",
    width: 32,
    height: 32,
    projection: "verified-orthographic",
    renderMode: "terrain"
  });
  expect(manifest.entries[two]).toMatchObject({
    page: "orthographic-0.webp",
    width: 64,
    height: 32,
    projection: "verified-orthographic",
    renderMode: "terrain",
    icon: { page: "official-icons-0.webp" }
  });
  expect(manifest.pages["orthographic-0.webp"]).toMatchObject({
    width: 64,
    height: 64,
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
  });
  expect(manifest.contentHash).toMatch(/^[0-9a-f]{64}$/);
});

it("rejects a render whose dimensions do not match its tile span", async () => {
  const root = await mkdtemp(join(tmpdir(), "sm-ortho-atlas-invalid-"));
  const inputDirectory = join(root, "inputs");
  const outputDirectory = join(root, "atlas");
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const uuid = "33333333-3333-4333-8333-333333333333";
  const manifestPath = join(outputDirectory, "official-tile-atlas.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    contentHash: "old",
    spriteSize: 32,
    pages: {},
    entries: {
      [uuid]: { uuid, page: "old.webp", x: 0, y: 0, width: 32, height: 32, spanWidth: 2, spanHeight: 1 }
    }
  }));
  await writeFile(
    join(inputDirectory, `${uuid}.png`),
    await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ffffff" } }).png().toBuffer()
  );

  await expect(buildOrthographicAtlasOverlay({
    manifestPath,
    inputDirectory,
    outputDirectory,
    pixelsPerCell: 32,
    pageSize: 64
  })).rejects.toThrow("must be 64x32");
});
