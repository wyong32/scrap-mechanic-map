import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * This is deliberately an explicit review list, never a filename-number heuristic.
 * Add an entry only after comparing the old render against the named 1.0 tile source.
 */
export const legacyImageMappings: Readonly<Record<string, { uuid: string; relativeImagePath: string }>> = Object.freeze({});

export function matchLegacyImage(uuid: string, legacyAssetsRoot: string): string | undefined {
  const entry = Object.values(legacyImageMappings).find((candidate) => candidate.uuid.toLowerCase() === uuid.toLowerCase());
  if (!entry) return undefined;
  const source = resolve(legacyAssetsRoot, entry.relativeImagePath);
  return existsSync(source) ? source : undefined;
}
