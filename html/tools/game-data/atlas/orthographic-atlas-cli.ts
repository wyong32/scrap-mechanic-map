import { buildOrthographicAtlasOverlay } from "./orthographic-atlas.ts";

const [manifestPath, inputDirectory, outputDirectory, pixelsPerCellText = "256", pageSizeText = "4096"] = process.argv.slice(2);
if (!manifestPath || !inputDirectory || !outputDirectory) {
  throw new Error(
    "Usage: orthographic-atlas-cli <manifest.json> <input-directory> <output-directory> [pixels-per-cell] [page-size]"
  );
}
console.log(JSON.stringify(await buildOrthographicAtlasOverlay({
  manifestPath,
  inputDirectory,
  outputDirectory,
  pixelsPerCell: Number(pixelsPerCellText),
  pageSize: Number(pageSizeText)
})));
