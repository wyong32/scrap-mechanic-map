import { describe, expect, it } from "vitest";

import { parseAsciiFbxMesh, writeObj } from "./ascii-fbx";

const fixture = `
Geometry: 1, "Geometry::", "Mesh" {
  Vertices: *12 {
    a: 0,0,0, 1,0,0, 1,1,0, 0,1,0
  }
  PolygonVertexIndex: *4 {
    a: 0,1,2,-4
  }
  LayerElementUV: 0 {
    UV: *8 {
      a: 0,0, 1,0, 1,1, 0,1
    }
    UVIndex: *4 {
      a: 0,1,2,3
    }
  }
  LayerElementMaterial: 0 {
    Materials: *1 {
      a: 2
    }
  }
}
`;

describe("ASCII FBX conversion", () => {
  it("triangulates an FBX polygon while preserving UV and material indices", () => {
    const mesh = parseAsciiFbxMesh(fixture);

    expect(mesh.triangles).toEqual([
      { vertices: [0, 1, 2], uvs: [0, 1, 2], material: 2 },
      { vertices: [0, 2, 3], uvs: [0, 2, 3], material: 2 }
    ]);
    expect(writeObj(mesh)).toContain("v 0.01 0 0");
    expect(writeObj(mesh)).toContain("usemtl material_2\nf 1/1 2/2 3/3\nf 1/1 3/3 4/4");
  });
});
