import type { SaveErrorCode, SerializedSaveError } from "./save-protocol";

export interface SaveParseErrorDetails {
  message: string;
  stage?: string;
  offset?: number;
}

export class SaveParseError extends Error {
  readonly code: SaveErrorCode;
  readonly stage?: string;
  readonly offset?: number;

  constructor(code: SaveErrorCode, details: SaveParseErrorDetails) {
    super(details.message);
    this.name = "SaveParseError";
    this.code = code;
    this.stage = details.stage;
    this.offset = details.offset;
  }
}

export function serializeSaveError(error: unknown): SerializedSaveError {
  if (error instanceof SaveParseError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.stage ? { stage: error.stage } : {}),
      ...(error.offset === undefined ? {} : { offset: error.offset })
    };
  }
  return { code: "NOT_SURVIVAL_SAVE", message: "Unable to read this Survival save." };
}

export function deserializeSaveError(error: SerializedSaveError): SaveParseError {
  return new SaveParseError(error.code, {
    message: error.message,
    stage: error.stage,
    offset: error.offset
  });
}

export function createCancelledSaveError(): DOMException {
  return new DOMException("Save parsing was cancelled.", "AbortError");
}
