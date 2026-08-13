import type { DecodedSave, SaveStage } from "../save/save-protocol";
import type { TileCatalog } from "../terrain/normalize-terrain";

export interface SaveParser {
  parseSave(
    file: File,
    onProgress: (stage: SaveStage) => void,
    catalog: TileCatalog
  ): Promise<DecodedSave>;
  cancel(): void;
  dispose(): void;
}

export { isSaveImportEnabled } from "./save-import-mode";

export async function createSaveParser(): Promise<SaveParser> {
  const { SaveClient } = await import("../save/save-client");
  return new SaveClient();
}
