import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorldMap } from "../../../src/domain/map-model.ts";
import { atlasKey, type AtlasSourceCell } from "./atlas-manifest.ts";
import { renderInputName } from "./pack-atlas.ts";

export interface AtlasIntake { cells: AtlasSourceCell[]; uniqueInputs: string[]; requiredKeys: string[]; missing: string[]; }
/** Derives required rotations from worlds; callers never hand-assemble AtlasSourceCell. */
export async function deriveAtlasIntake(worlds: WorldMap[], inputDirectory: string, logicalSize = 256): Promise<AtlasIntake> {
  const inputRotations = new Map<string, Set<0 | 1 | 2 | 3>>();
  for (const world of worlds) for (const cell of world.cells) { const name = renderInputName(cell.uuid.toLowerCase(), cell.xOffset, cell.yOffset); const rotations = inputRotations.get(name) ?? new Set<0 | 1 | 2 | 3>(); rotations.add(cell.rotation); inputRotations.set(name, rotations); }
  const missing: string[] = [], cells: AtlasSourceCell[] = [], requiredKeys: string[] = [];
  for (const [name, rotations] of [...inputRotations].sort(([a], [b]) => a.localeCompare(b))) { const imagePath = join(inputDirectory, name); const [uuid, x, y] = name.replace(/\.png$/, "").split("__"); for (const rotation of rotations) requiredKeys.push(atlasKey(uuid, Number(x), Number(y), rotation)); try { await access(imagePath); } catch { missing.push(name); continue; } const sourceHash = createHash("sha256").update(await readFile(imagePath)).digest("hex"); for (const rotation of rotations) cells.push({ key: atlasKey(uuid, Number(x), Number(y), rotation), imagePath, logicalSize, sourceHash }); }
  return { cells, uniqueInputs: [...inputRotations.keys()].sort(), requiredKeys: requiredKeys.sort(), missing };
}
