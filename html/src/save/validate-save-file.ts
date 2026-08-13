import { SaveParseError } from "./save-errors";

export const MAX_SAVE_FILE_BYTES = 256 * 1024 * 1024;
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");

export interface BrowserCapabilities {
  worker: boolean;
  webAssembly: boolean;
  canvas: boolean;
}

function hasCanvas2dContext(): boolean {
  if (typeof document === "undefined" || typeof HTMLCanvasElement === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    return canvas instanceof HTMLCanvasElement && canvas.getContext("2d") !== null;
  } catch {
    return false;
  }
}

export function detectBrowserCapabilities(): BrowserCapabilities {
  return {
    worker: typeof Worker !== "undefined",
    webAssembly: typeof WebAssembly !== "undefined",
    canvas: hasCanvas2dContext()
  };
}

export function validateSaveFileEnvironment(
  capabilities: BrowserCapabilities = detectBrowserCapabilities()
): void {
  if (!capabilities.worker || !capabilities.webAssembly || !capabilities.canvas) {
    throw new SaveParseError("UNSUPPORTED_BROWSER", {
      message: "This browser cannot safely render a local Survival save."
    });
  }
}

export function validateSaveFileMetadata(
  file: Pick<File, "size">,
  capabilities: BrowserCapabilities = detectBrowserCapabilities()
): void {
  validateSaveFileEnvironment(capabilities);
  if (file.size === 0) {
    throw new SaveParseError("EMPTY_FILE", { message: "The selected save file is empty." });
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_SAVE_FILE_BYTES) {
    throw new SaveParseError("FILE_TOO_LARGE", {
      message: "The selected save file exceeds the 256 MB limit."
    });
  }
}

export function validateSqliteHeader(header: Uint8Array): void {
  if (
    header.byteLength !== SQLITE_HEADER.byteLength ||
    !SQLITE_HEADER.every((value, index) => header[index] === value)
  ) {
    throw new SaveParseError("NOT_SQLITE", {
      message: "The selected file is not a SQLite save database."
    });
  }
}

export async function readAndValidateSaveFile(
  file: File,
  capabilities: BrowserCapabilities = detectBrowserCapabilities()
): Promise<Uint8Array> {
  const validatedSize = file.size;
  validateSaveFileMetadata({ size: validatedSize }, capabilities);
  const header = new Uint8Array(await file.slice(0, SQLITE_HEADER.byteLength).arrayBuffer());
  validateSqliteHeader(header);
  const fullBuffer = await file.slice(0, validatedSize).arrayBuffer();
  if (fullBuffer.byteLength !== validatedSize) {
    throw new SaveParseError("NOT_SQLITE", {
      message: "The selected save changed while it was being read."
    });
  }
  const bytes = new Uint8Array(fullBuffer);
  validateSqliteHeader(bytes.subarray(0, SQLITE_HEADER.byteLength));
  return bytes;
}
