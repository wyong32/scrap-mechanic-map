import { readFile, writeFile } from "node:fs/promises";

import { parseAsciiFbxMesh, writeObj } from "./ascii-fbx";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: convert-fbx-cli <input.fbx> <output.obj>");
}

const mesh = parseAsciiFbxMesh(await readFile(inputPath, "utf8"));
await writeFile(outputPath, writeObj(mesh));
console.log(JSON.stringify({
  inputPath,
  outputPath,
  vertices: mesh.vertices.length,
  triangles: mesh.triangles.length
}));
