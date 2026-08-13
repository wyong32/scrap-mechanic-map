export interface AsciiFbxTriangle {
  vertices: [number, number, number];
  uvs: [number, number, number];
  material: number;
}

export interface AsciiFbxMesh {
  vertices: Array<[number, number, number]>;
  uvs: Array<[number, number]>;
  triangles: AsciiFbxTriangle[];
}

function extractArray(source: string, name: string): string {
  const expression = new RegExp(`\\b${name}:\\s*\\*\\d+\\s*\\{\\s*a:\\s*([\\s\\S]*?)\\s*\\}`, "m");
  const match = source.match(expression);
  if (!match) throw new Error(`ASCII FBX is missing ${name}.`);
  return match[1];
}

function numbers(source: string): number[] {
  return source
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number);
}

export function parseAsciiFbxMesh(source: string): AsciiFbxMesh {
  if (!source.startsWith("; FBX") && !source.includes("Geometry:")) {
    throw new Error("Input is not an ASCII FBX mesh.");
  }
  const vertexValues = numbers(extractArray(source, "Vertices"));
  const polygonIndices = numbers(extractArray(source, "PolygonVertexIndex"));
  const uvValues = numbers(extractArray(source, "UV"));
  const uvIndices = numbers(extractArray(source, "UVIndex"));
  const materialIndices = numbers(extractArray(source, "Materials"));
  if (vertexValues.length % 3 !== 0 || uvValues.length % 2 !== 0) {
    throw new Error("ASCII FBX vertex or UV array has an invalid length.");
  }
  if (uvIndices.length !== polygonIndices.length) {
    throw new Error("ASCII FBX UV indices do not match polygon vertices.");
  }

  const vertices = Array.from({ length: vertexValues.length / 3 }, (_, index) => [
    vertexValues[index * 3],
    vertexValues[index * 3 + 1],
    vertexValues[index * 3 + 2]
  ] as [number, number, number]);
  const uvs = Array.from({ length: uvValues.length / 2 }, (_, index) => [
    uvValues[index * 2],
    uvValues[index * 2 + 1]
  ] as [number, number]);

  const triangles: AsciiFbxTriangle[] = [];
  let polygonVertices: number[] = [];
  let polygonUvs: number[] = [];
  let polygonIndex = 0;
  for (let index = 0; index < polygonIndices.length; index += 1) {
    const encodedVertex = polygonIndices[index];
    const isLast = encodedVertex < 0;
    polygonVertices.push(isLast ? -encodedVertex - 1 : encodedVertex);
    polygonUvs.push(uvIndices[index]);
    if (!isLast) continue;
    if (polygonVertices.length < 3) throw new Error("ASCII FBX polygon has fewer than three vertices.");
    const material = materialIndices[polygonIndex] ?? 0;
    for (let triangleIndex = 1; triangleIndex < polygonVertices.length - 1; triangleIndex += 1) {
      triangles.push({
        vertices: [polygonVertices[0], polygonVertices[triangleIndex], polygonVertices[triangleIndex + 1]],
        uvs: [polygonUvs[0], polygonUvs[triangleIndex], polygonUvs[triangleIndex + 1]],
        material
      });
    }
    polygonVertices = [];
    polygonUvs = [];
    polygonIndex += 1;
  }
  if (polygonVertices.length !== 0) throw new Error("ASCII FBX ends inside a polygon.");
  return { vertices, uvs, triangles };
}

export function writeObj(mesh: AsciiFbxMesh): string {
  const lines: string[] = [];
  const centimetersToMeters = 0.01;
  for (const [x, y, z] of mesh.vertices) {
    lines.push(`v ${x * centimetersToMeters} ${-z * centimetersToMeters} ${y * centimetersToMeters}`);
  }
  for (const [u, v] of mesh.uvs) lines.push(`vt ${u} ${1 - v}`);
  let activeMaterial = -1;
  for (const triangle of mesh.triangles) {
    if (triangle.material !== activeMaterial) {
      activeMaterial = triangle.material;
      lines.push(`usemtl material_${activeMaterial}`);
    }
    lines.push(`f ${triangle.vertices.map((vertex, index) =>
      `${vertex + 1}/${triangle.uvs[index] + 1}`
    ).join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}
