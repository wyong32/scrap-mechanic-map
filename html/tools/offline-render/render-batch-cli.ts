import { readFile } from "node:fs/promises";
import { renderTerrainBatch, type TerrainRenderCandidate } from "./render-batch.ts";

const [gameRoot, usagePath, materialDirectory, outputDirectory, pixelsPerCellText = "256"] = process.argv.slice(2);
if (!gameRoot || !usagePath || !materialDirectory || !outputDirectory) {
  throw new Error(
    "Usage: render-batch-cli <game-root> <usage.json> <material-png-directory> <output-directory> [pixels-per-cell]"
  );
}
const usage = JSON.parse(await readFile(usagePath, "utf8")) as {
  rows: TerrainRenderCandidate[];
};
const report = await renderTerrainBatch({
  gameRoot,
  materialDirectory,
  outputDirectory,
  rows: usage.rows,
  pixelsPerCell: Number(pixelsPerCellText),
  onProgress(completed, total, row) {
    if (completed === total || completed % 10 === 0) {
      console.log(`RENDER ${completed}/${total} ${row.relativePath}`);
    }
  }
});
console.log(JSON.stringify(report));
