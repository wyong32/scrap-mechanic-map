import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rectifyOfficialPreview } from "../game-data/atlas/official-tile-atlas.ts";
import type {
  DefaultSurfaceCaptureInventory,
  DefaultSurfaceCaptureTarget,
} from "./default-surface-types.ts";
import { runAuthenticMapCli } from "./cli.ts";
import { verifySurfaceCapture } from "./verify-surface-capture.ts";

const createdDirectories: string[] = [];
const REVIEWED_EDITOR_PATH = "G:\\共享文件\\Scrap Mechanic\\Release\\TileEditor.exe";
const WRONG_VERSION_EDITOR_PATH = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "where.exe",
);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

function target(
  size: 1 | 4 | 8,
  uuid = `${size}1111111-2222-4333-8444-555555555555`,
): DefaultSurfaceCaptureTarget {
  return {
    uuid,
    sourceTileRelativePath: `Survival/Test/${uuid}.tile`,
    widthCells: size,
    heightCells: size,
    outputPixels: { width: size * 256, height: size * 256 },
    usedRotations: [0],
    occurrences: 1,
    sourcePreviewSha256: "0".repeat(64),
  };
}

function receipt(value: DefaultSurfaceCaptureTarget): Record<string, unknown> {
  return {
    editor: "TileEditor",
    editorVersion: "1.0.1.869",
    sourceTileUuid: value.uuid,
    sourceTileRelativePath: value.sourceTileRelativePath,
    camera: {
      projection: "orthographic",
      direction: "north-up",
      viewDirection: "vertical-down",
      pixelsPerCell: 256,
      width: value.widthCells * 256,
      height: value.heightCells * 256,
    },
    image: {
      file: "scene.png",
      fullScene: true,
    },
  };
}

async function officialPreview(accent = "#d9822b"): Promise<Buffer> {
  return sharp(Buffer.from(
    `<svg width="220" height="150">
      <rect width="220" height="150" fill="#31506f"/>
      <polygon points="109,37 215,93 110,149 4,93" fill="${accent}"/>
      <circle cx="78" cy="86" r="18" fill="#f5e663"/>
    </svg>`,
  )).png().toBuffer();
}

async function masterImage(
  width: number,
  height: number,
  accent = "#8d3f71",
): Promise<Buffer> {
  return sharp(Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#32705c"/>
      <path d="M0 ${height} L${width} 0 L${width} ${height} Z" fill="${accent}"/>
      <circle cx="${Math.floor(width * 0.31)}" cy="${Math.floor(height * 0.42)}" r="${Math.max(8, Math.floor(width * 0.11))}" fill="#e4bc42"/>
    </svg>`,
  )).png().toBuffer();
}

async function fixture(
  value: DefaultSurfaceCaptureTarget,
  mutate?: (context: {
    directory: string;
    previewPath: string;
    receipt: Record<string, unknown>;
    preview: Buffer;
    scene: Buffer;
  }) => void | Promise<void>,
  baseDirectory = tmpdir(),
): Promise<{ directory: string; previewPath: string; scene: Buffer }> {
  const directory = await mkdtemp(join(baseDirectory, "sm-surface-capture-"));
  createdDirectories.push(directory);
  const previewPath = join(directory, "official-preview.png");
  const preview = await officialPreview();
  const scene = await masterImage(value.widthCells * 256, value.heightCells * 256);
  const captureReceipt = receipt(value);
  value.sourcePreviewSha256 = createHash("sha256").update(preview).digest("hex");
  await Promise.all([
    writeFile(previewPath, preview),
    writeFile(join(directory, "scene.png"), scene),
  ]);
  await mutate?.({ directory, previewPath, receipt: captureReceipt, preview, scene });
  await writeFile(
    join(directory, "capture-receipt.json"),
    `${JSON.stringify(captureReceipt, null, 2)}\n`,
  );
  return { directory, previewPath, scene };
}

describe("verifySurfaceCapture", () => {
  it.each([
    { label: "1x1", size: 1 },
    { label: "4x4", size: 4 },
    { label: "8x8", size: 8 },
  ] as const)(
    "accepts a genuine $label full-scene master and hashes its exact PNG bytes",
    async ({ size }) => {
      const value = target(size);
      const { directory, previewPath, scene } = await fixture(value);

      const verified = await verifySurfaceCapture(value, directory, previewPath);

      expect(verified).toEqual({
        target: value,
        receipt: receipt(value),
        absolutePath: join(directory, "scene.png"),
        sha256: createHash("sha256").update(scene).digest("hex"),
        width: size * 256,
        height: size * 256,
      });
    },
  );

  it("returns an absolute scene path when the target directory is relative", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, undefined, process.cwd());

    const verified = await verifySurfaceCapture(
      value,
      relative(process.cwd(), directory),
      previewPath,
    );

    expect(isAbsolute(verified.absolutePath)).toBe(true);
    expect(verified.absolutePath).toBe(join(directory, "scene.png"));
  });

  it("rejects a missing receipt", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value);
    await rm(join(directory, "capture-receipt.json"));

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /receipt is missing/i,
    );
  });

  it("rejects a missing scene image", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value);
    await rm(join(directory, "scene.png"));

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /scene image is missing/i,
    );
  });

  it("rejects invalid receipt JSON", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value);
    await writeFile(join(directory, "capture-receipt.json"), "{not json");

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /valid official TileEditor receipt/i,
    );
  });

  it("rejects non-PNG scene bytes", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value);
    await writeFile(join(directory, "scene.png"), "not a PNG");

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /not a valid PNG/i,
    );
  });

  it.each([
    ["editor", (raw: Record<string, unknown>) => { raw.editor = "TileEditor2"; }],
    ["version", (raw: Record<string, unknown>) => { raw.editorVersion = "1.0.0.0"; }],
    ["source UUID", (raw: Record<string, unknown>) => { raw.sourceTileUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }],
    ["source relative path", (raw: Record<string, unknown>) => { raw.sourceTileRelativePath = "Survival/Test/other.tile"; }],
  ])("rejects a mismatched %s", async (_label, mutate) => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, ({ receipt: raw }) => mutate(raw));

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /valid official TileEditor receipt|capture source/i,
    );
  });

  it.each([
    ["perspective projection", (camera: Record<string, unknown>) => { camera.projection = "perspective"; }],
    ["non-north-up direction", (camera: Record<string, unknown>) => { camera.direction = "south-up"; }],
    ["density other than 256", (camera: Record<string, unknown>) => { camera.pixelsPerCell = 255; }],
  ])("rejects %s", async (_label, mutate) => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, ({ receipt: raw }) => {
      mutate(raw.camera as Record<string, unknown>);
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /valid official TileEditor receipt/i,
    );
  });

  it("rejects a receipt missing the vertical-down view direction", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, ({ receipt: raw }) => {
      delete (raw.camera as Record<string, unknown>).viewDirection;
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /valid official TileEditor receipt/i,
    );
  });

  it.each(["diagonal-down", "vertical-up"])(
    "rejects the non-vertical-down view direction '%s'",
    async (viewDirection) => {
      const value = target(1);
      const { directory, previewPath } = await fixture(value, ({ receipt: raw }) => {
        (raw.camera as Record<string, unknown>).viewDirection = viewDirection;
      });

      await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
        /valid official TileEditor receipt/i,
      );
    },
  );

  it("rejects a one-pixel dimension mismatch", async () => {
    const value = target(4);
    const { directory, previewPath } = await fixture(value, async ({ directory: path }) => {
      await writeFile(join(path, "scene.png"), await masterImage(1023, 1024));
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /wrong pixel dimensions/i,
    );
  });

  it("rejects fullScene false", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, ({ receipt: raw }) => {
      (raw.image as Record<string, unknown>).fullScene = false;
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /valid official TileEditor receipt/i,
    );
  });

  it("rejects a fully transparent output", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, async ({ directory: path }) => {
      const transparent = await sharp({
        create: {
          width: 256,
          height: 256,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png().toBuffer();
      await writeFile(join(path, "scene.png"), transparent);
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /fully transparent/i,
    );
  });

  it("rejects an opaque output whose RGB maximum is 16", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, async ({ directory: path }) => {
      const dark = await sharp({
        create: {
          width: 256,
          height: 256,
          channels: 4,
          background: { r: 16, g: 15, b: 14, alpha: 1 },
        },
      }).png().toBuffer();
      await writeFile(join(path, "scene.png"), dark);
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /implausibly dark/i,
    );
  });

  it("rejects the exact official preview file", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value, async ({ directory: path, preview }) => {
      await writeFile(join(path, "scene.png"), preview);
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /official preview derivative/i,
    );
  });

  it("rejects a resized rectified derivative of the official preview", async () => {
    const value = target(4);
    const { directory, previewPath } = await fixture(value, async ({ directory: path, preview }) => {
      const rectified = await rectifyOfficialPreview(preview, 256);
      const stretched = await sharp(rectified).resize(1024, 1024, { fit: "fill" }).png().toBuffer();
      await writeFile(join(path, "scene.png"), stretched);
    });

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /official preview derivative/i,
    );
  });

  it("rejects an official preview whose bytes do not match the inventory hash", async () => {
    const value = target(1);
    const { directory, previewPath } = await fixture(value);
    value.sourcePreviewSha256 = "f".repeat(64);

    await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
      /official source preview does not match/i,
    );
  });

  it("rejects absolute source paths without echoing them", async () => {
    const value = target(1);
    const absolute = "G:\\private\\Scrap Mechanic\\secret.tile";
    const { directory, previewPath } = await fixture(value, ({ receipt: raw }) => {
      raw.sourceTileRelativePath = absolute;
    });

    let message = "";
    try {
      await verifySurfaceCapture(value, directory, previewPath);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/capture source/i);
    expect(message).not.toContain(absolute);
    expect(message).not.toContain("G:\\");
  });

  it.each([
    "G:\\private\\Scrap Mechanic\\secret.tile",
    "Survival/Test/../secret.tile",
  ])("rejects an unsafe target source path even when the receipt matches", async (unsafePath) => {
    const value = target(1);
    value.sourceTileRelativePath = unsafePath;
    const { directory, previewPath } = await fixture(value);

    let message = "";
    try {
      await verifySurfaceCapture(value, directory, previewPath);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/capture source/i);
    expect(message).not.toContain(unsafePath);
    expect(message).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it.each(["receipt", "camera", "image"])(
    "rejects extra %s fields",
    async (level) => {
      const value = target(1);
      const { directory, previewPath } = await fixture(value, ({ receipt: raw }) => {
        const owner = level === "receipt"
          ? raw
          : raw[level] as Record<string, unknown>;
        owner.unreviewed = true;
      });

      await expect(verifySurfaceCapture(value, directory, previewPath)).rejects.toThrow(
        /valid official TileEditor receipt/i,
      );
    },
  );
});

async function writeBatchFixture(options: {
  duplicate?: boolean;
  missing?: boolean;
  editor?: "reviewed" | "missing" | "wrong";
}) {
  const root = await mkdtemp(join(tmpdir(), "sm-surface-batch-"));
  createdDirectories.push(root);
  const gameRoot = join(root, "game");
  const captureDirectory = join(root, "captures");
  const inventoryPath = join(root, "inventory.json");
  const editorPath = join(gameRoot, "Release", "TileEditor.exe");
  await mkdir(dirname(editorPath), { recursive: true });
  if (options.editor !== "missing") {
    await copyFile(
      options.editor === "wrong" ? WRONG_VERSION_EDITOR_PATH : REVIEWED_EDITOR_PATH,
      editorPath,
    );
  }
  const targets = [
    target(1, "bbbbbbbb-2222-4333-8444-555555555555"),
    target(1, "aaaaaaaa-2222-4333-8444-555555555555"),
  ];
  let sharedScene: Buffer | undefined;
  for (const [index, value] of targets.entries()) {
    const preview = await officialPreview(index === 0 ? "#d9822b" : "#28a5c7");
    value.sourcePreviewSha256 = createHash("sha256").update(preview).digest("hex");
    const previewPath = join(gameRoot, dirname(value.sourceTileRelativePath), `${value.uuid}.png`);
    const targetDirectory = join(captureDirectory, value.uuid);
    await Promise.all([mkdir(dirname(previewPath), { recursive: true }), mkdir(targetDirectory, { recursive: true })]);
    await writeFile(previewPath, preview);
    if (!options.missing) {
      const scene = options.duplicate
        ? sharedScene ??= await masterImage(256, 256)
        : await masterImage(256, 256, index === 0 ? "#8d3f71" : "#405bb1");
      await Promise.all([
        writeFile(join(targetDirectory, "scene.png"), scene),
        writeFile(join(targetDirectory, "capture-receipt.json"), `${JSON.stringify(receipt(value))}\n`),
      ]);
    }
  }
  const inventory: DefaultSurfaceCaptureInventory = {
    schemaVersion: 1,
    gameVersion: "1.0.0",
    saveSha256: "1".repeat(64),
    saveSeed: 1,
    pixelsPerCell: 256,
    targets,
    contentHash: "2".repeat(64),
  };
  await writeFile(inventoryPath, `${JSON.stringify(inventory)}\n`);
  return { gameRoot, captureDirectory, inventoryPath, inventory, targets };
}

describe("surface-verify CLI", () => {
  it.each([
    ["--game-root", ["surface-verify", "--inventory", "inventory.json", "--capture-directory", "captures"]],
    ["--inventory", ["surface-verify", "--game-root", "game", "--capture-directory", "captures"]],
    ["--capture-directory", ["surface-verify", "--game-root", "game", "--inventory", "inventory.json"]],
  ])("requires %s", async (option, args) => {
    await expect(runAuthenticMapCli(args)).rejects.toThrow(
      `Missing required option: ${option} <path>`,
    );
  });

  it("rejects a missing TileEditor executable without leaking the game root", async () => {
    const fixture = await writeBatchFixture({ editor: "missing" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    let message = "";
    try {
      await runAuthenticMapCli([
        "surface-verify",
        "--game-root", fixture.gameRoot,
        "--inventory", fixture.inventoryPath,
        "--capture-directory", fixture.captureDirectory,
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/TileEditor executable is unavailable/i);
    expect(message).not.toContain(fixture.gameRoot);
    expect(message).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("rejects a real TileEditor executable with the wrong file version", async () => {
    const fixture = await writeBatchFixture({ editor: "wrong" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    let message = "";
    try {
      await runAuthenticMapCli([
        "surface-verify",
        "--game-root", fixture.gameRoot,
        "--inventory", fixture.inventoryPath,
        "--capture-directory", fixture.captureDirectory,
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/TileEditor version is not the reviewed 1\.0 build/i);
    expect(message).not.toContain(fixture.gameRoot);
    expect(message).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it.each([
    ["occurrences", 0],
    ["usedRotations", [4]],
  ])("rejects an inventory target with invalid %s", async (field, invalid) => {
    const fixture = await writeBatchFixture({});
    const rawTarget = fixture.inventory.targets[0] as unknown as Record<string, unknown>;
    rawTarget[field] = invalid;
    await writeFile(fixture.inventoryPath, `${JSON.stringify(fixture.inventory)}\n`);

    await expect(runAuthenticMapCli([
      "surface-verify",
      "--game-root", fixture.gameRoot,
      "--inventory", fixture.inventoryPath,
      "--capture-directory", fixture.captureDirectory,
    ])).rejects.toThrow("Surface capture inventory is invalid.");
  });

  it("verifies every target and prints only portable master metadata", async () => {
    const fixture = await writeBatchFixture({});
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runAuthenticMapCli([
      "surface-verify",
      "--game-root", fixture.gameRoot,
      "--inventory", fixture.inventoryPath,
      "--capture-directory", fixture.captureDirectory,
    ]);

    expect(log).toHaveBeenCalledOnce();
    const output = String(log.mock.calls[0]?.[0]);
    const report = JSON.parse(output) as {
      targets: number;
      masters: Array<{ uuid: string; sha256: string; width: number; height: number }>;
    };
    expect(report.targets).toBe(2);
    expect(report.masters.map(({ uuid }) => uuid)).toEqual(
      fixture.targets.map(({ uuid }) => uuid).sort(),
    );
    expect(report.masters).toEqual(report.masters.map((master) => ({
      ...master,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      width: 256,
      height: 256,
    })));
    expect(output).not.toContain(fixture.gameRoot);
    expect(output).not.toContain(fixture.captureDirectory);
    expect(output).not.toContain(fixture.inventoryPath);
    expect(output).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("reports sorted UUID failures without leaking supplied directories", async () => {
    const fixture = await writeBatchFixture({ missing: true });

    let message = "";
    try {
      await runAuthenticMapCli([
        "surface-verify",
        "--game-root", fixture.gameRoot,
        "--inventory", fixture.inventoryPath,
        "--capture-directory", fixture.captureDirectory,
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message.split("\n").map((line) => line.slice(0, 36))).toEqual([
      fixture.targets[1]!.uuid,
      fixture.targets[0]!.uuid,
    ]);
    expect(message).not.toContain(fixture.gameRoot);
    expect(message).not.toContain(fixture.captureDirectory);
    expect(message).not.toContain(fixture.inventoryPath);
    expect(message).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("rejects an identical master hash assigned to different UUIDs", async () => {
    const fixture = await writeBatchFixture({ duplicate: true });

    await expect(runAuthenticMapCli([
      "surface-verify",
      "--game-root", fixture.gameRoot,
      "--inventory", fixture.inventoryPath,
      "--capture-directory", fixture.captureDirectory,
    ])).rejects.toThrow(/identical master hash/i);
  });
});
