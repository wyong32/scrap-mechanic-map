import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata, type Stats } from "sharp";
import {
  AUTHENTIC_LAYER_IDS,
  type AuthenticCaptureJob,
  type AuthenticLayerId,
  type OfficialCaptureReceipt,
  type VerifiedCaptureSet,
} from "./authentic-map-types.ts";

const EXPECTED_EDITOR_VERSION = "1.0.1.869";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function failReceipt(): never {
  throw new Error("Capture does not contain a valid official TileEditor receipt.");
}

function failSource(): never {
  throw new Error("Capture source does not match the reviewed Grow Lab 1 tile.");
}

function parseReceipt(
  raw: unknown,
  job: AuthenticCaptureJob,
): OfficialCaptureReceipt {
  if (
    !isObject(raw)
    || raw.editor !== "TileEditor"
    || raw.editorVersion !== EXPECTED_EDITOR_VERSION
  ) {
    failReceipt();
  }

  if (
    raw.sourceTileUuid !== job.sourceTile.uuid
    || raw.sourceTileRelativePath !== job.sourceTile.relativePath
  ) {
    failSource();
  }

  const camera = raw.camera;
  if (
    !isObject(camera)
    || camera.projection !== "orthographic"
    || camera.direction !== "north-up"
    || camera.pixelsPerCell !== 128
    || camera.width !== 1280
    || camera.height !== 1280
  ) {
    failReceipt();
  }

  const layers = raw.layers;
  if (!isObject(layers)) failReceipt();
  const keys = Object.keys(layers);
  if (
    keys.length !== AUTHENTIC_LAYER_IDS.length
    || AUTHENTIC_LAYER_IDS.some((id) => !Object.hasOwn(layers, id))
  ) {
    throw new Error("Capture receipt must contain exactly seven reviewed layers.");
  }

  for (const id of AUTHENTIC_LAYER_IDS) {
    const layer = layers[id];
    if (
      !isObject(layer)
      || layer.file !== `${id}.png`
      || !Number.isSafeInteger(layer.officialInstanceCount)
      || (layer.officialInstanceCount as number) < 0
      || typeof layer.transparentAllowed !== "boolean"
    ) {
      failReceipt();
    }
  }

  return raw as unknown as OfficialCaptureReceipt;
}

export async function verifyOfficialCapture(
  job: AuthenticCaptureJob,
  captureDirectory: string,
): Promise<VerifiedCaptureSet> {
  let receiptBytes: Buffer;
  try {
    receiptBytes = await readFile(join(captureDirectory, "capture-receipt.json"));
  } catch {
    throw new Error("Capture receipt is missing.");
  }

  let rawReceipt: unknown;
  try {
    rawReceipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    failReceipt();
  }
  const receipt = parseReceipt(rawReceipt, job);
  const files = new Map<
    AuthenticLayerId,
    {
      absolutePath: string;
      sha256: string;
      width: 1280;
      height: 1280;
    }
  >();

  for (const id of AUTHENTIC_LAYER_IDS) {
    const absolutePath = join(captureDirectory, receipt.layers[id].file);
    let bytes: Buffer;
    try {
      bytes = await readFile(absolutePath);
    } catch {
      throw new Error(`Missing capture layer '${id}'.`);
    }

    let metadata: Metadata;
    let stats: Stats;
    try {
      const image = sharp(bytes, { failOn: "error" });
      [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
    } catch {
      throw new Error(`Capture layer '${id}' is not a valid PNG.`);
    }
    if (metadata.format !== "png") {
      throw new Error(`Capture layer '${id}' is not a PNG.`);
    }
    if (metadata.width !== 1280 || metadata.height !== 1280) {
      throw new Error(`Capture layer '${id}' must be exactly 1280x1280 pixels.`);
    }

    const alpha = metadata.hasAlpha ? stats.channels.at(-1) : undefined;
    const fullyTransparent = alpha?.max === 0;
    if (
      fullyTransparent
      && (
        receipt.layers[id].officialInstanceCount > 0
        || !receipt.layers[id].transparentAllowed
      )
    ) {
      throw new Error(
        `Transparent capture '${id}' contradicts the official instances receipt.`,
      );
    }

    files.set(id, {
      absolutePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: 1280,
      height: 1280,
    });
  }

  return { job, receipt, files };
}
