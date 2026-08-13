import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { estimateNeighborTranslation } from "./overlap-alignment.ts";

const SIZE = 750;
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function texture(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = (x * 17 + y * 31 + ((x * y) % 251)) & 255;
      pixels[offset + 1] = (x * 43 + y * 7 + ((x ^ y) % 239)) & 255;
      pixels[offset + 2] = (x * 11 + y * 59 + ((x + y) % 227)) & 255;
    }
  }
  return pixels;
}

function adversarialTexture(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = ((x % 5) * 47 + (y % 4) * 13) & 255;
      pixels[offset + 1] = ((x % 5) * 37 + (y % 4) * 29) & 255;
      pixels[offset + 2] = ((x % 5) * 31 + (y % 4) * 11) & 255;
    }
  }
  return pixels;
}

async function neighborFixture(axis: "horizontal" | "vertical", adjustment: number) {
  const root = await mkdtemp(join(tmpdir(), "sm-align-"));
  cleanupRoots.push(root);
  await mkdir(root, { recursive: true });
  const stride = 525 + adjustment;
  const width = axis === "horizontal" ? SIZE + stride : SIZE;
  const height = axis === "vertical" ? SIZE + stride : SIZE;
  const source = texture(width, height);
  const left = join(root, "left.png");
  const right = join(root, "right.png");
  await sharp(source, { raw: { width, height, channels: 3 } })
    .extract({ left: 0, top: 0, width: SIZE, height: SIZE }).png().toFile(left);
  await sharp(source, { raw: { width, height, channels: 3 } })
    .extract(axis === "horizontal"
      ? { left: stride, top: 0, width: SIZE, height: SIZE }
      : { left: 0, top: stride, width: SIZE, height: SIZE })
    .png().toFile(right);
  return { left, right };
}

async function adversarialOffLatticeFixture() {
  const root = await mkdtemp(join(tmpdir(), "sm-align-off-lattice-"));
  cleanupRoots.push(root);
  const stride = 526;
  const source = adversarialTexture(SIZE + stride, SIZE);
  const left = join(root, "left.png");
  const right = join(root, "right.png");
  await sharp(source, { raw: { width: SIZE + stride, height: SIZE, channels: 3 } })
    .extract({ left: 0, top: 0, width: SIZE, height: SIZE }).png().toFile(left);
  await sharp(source, { raw: { width: SIZE + stride, height: SIZE, channels: 3 } })
    .extract({ left: stride, top: 0, width: SIZE, height: SIZE }).png().toFile(right);
  return { left, right };
}

const contract = { nominalStride: 525, nominalOverlap: 225, searchRadius: 48 } as const;

describe("estimateNeighborTranslation", () => {
  it.each([-48, 0, 48])("recovers horizontal adjustment %i exactly", async (adjustment) => {
    const fixture = await neighborFixture("horizontal", adjustment);
    await expect(estimateNeighborTranslation(fixture.left, fixture.right, {
      ...contract,
      axis: "horizontal",
    })).resolves.toMatchObject({ x: 525 + adjustment, y: 0, error: 0 });
  });

  it.each([-48, 0, 48])("recovers vertical adjustment %i exactly", async (adjustment) => {
    const fixture = await neighborFixture("vertical", adjustment);
    await expect(estimateNeighborTranslation(fixture.left, fixture.right, {
      ...contract,
      axis: "vertical",
    })).resolves.toMatchObject({ x: 0, y: 525 + adjustment, error: 0 });
  });

  it("uses deterministic ties: smallest absolute adjustment, then X, then Y", async () => {
    const root = await mkdtemp(join(tmpdir(), "sm-align-tie-"));
    cleanupRoots.push(root);
    const left = join(root, "left.png");
    const right = join(root, "right.png");
    const flat = Buffer.alloc(SIZE * SIZE * 3, 90);
    await Promise.all([
      sharp(flat, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(left),
      sharp(flat, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(right),
    ]);
    await expect(estimateNeighborTranslation(left, right, {
      ...contract,
      axis: "horizontal",
    })).resolves.toMatchObject({ x: 525, y: 0, error: 0 });
  });

  it("finds the exact global minimum at an adversarial off-lattice integer", async () => {
    // Break caught: coarse top-N seed refinement never evaluates the true integer candidate.
    const fixture = await adversarialOffLatticeFixture();
    await expect(estimateNeighborTranslation(fixture.left, fixture.right, {
      ...contract,
      axis: "horizontal",
    })).resolves.toMatchObject({ x: 526, y: 0, error: 0 });
  });

  it("rejects a best normalized luminance error above 0.08", async () => {
    const root = await mkdtemp(join(tmpdir(), "sm-align-error-"));
    cleanupRoots.push(root);
    const left = join(root, "left.png");
    const right = join(root, "right.png");
    await Promise.all([
      sharp(Buffer.alloc(SIZE * SIZE * 3, 0), { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(left),
      sharp(Buffer.alloc(SIZE * SIZE * 3, 255), { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(right),
    ]);
    await expect(estimateNeighborTranslation(left, right, {
      ...contract,
      axis: "horizontal",
    })).rejects.toThrow("alignment error");
  });
});
