import { describe, expect, it } from "vitest";

import { parsePrefabScene } from "./prefab-v13-reader";

function uuidBytes(uuid: string): Uint8Array {
  return Uint8Array.from(uuid.replaceAll("-", "").match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

describe("parsePrefabScene", () => {
  it("uses the version 13 asset section offset instead of reading after the descriptors", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const material = new TextEncoder().encode("Color01");
    const record = new Uint8Array(40 + 16 + 1 + 1 + material.length + 4 + 1);
    const recordView = new DataView(record.buffer);
    recordView.setFloat32(0, 12, false);
    recordView.setFloat32(4, 34, false);
    recordView.setFloat32(8, 5, false);
    recordView.setFloat32(24, 1, false);
    recordView.setFloat32(28, 2, false);
    recordView.setFloat32(32, 3, false);
    recordView.setFloat32(36, 4, false);
    record.set(uuidBytes(uuid), 40);
    let offset = 56;
    record[offset++] = 1;
    record[offset++] = material.length;
    record.set(material, offset);
    offset += material.length;
    record.set([0x11, 0x22, 0x33, 0xff], offset);
    offset += 4;
    record[offset] = 0x2a;

    const dataOffset = 160;
    const prefab = new Uint8Array(dataOffset + record.length);
    const view = new DataView(prefab.buffer);
    prefab.set(new TextEncoder().encode("FERP"), 0);
    view.setUint32(4, 13, false);
    for (let section = 0; section < 6; section += 1) {
      const descriptor = 8 + section * 16;
      view.setUint32(descriptor, (section <= 3 ? dataOffset : dataOffset + record.length) * 8, false);
      view.setUint32(descriptor + 4, section === 3 ? 1 : 0, false);
      view.setUint32(descriptor + 12, section === 3 ? record.length * 8 : 0, false);
    }
    prefab.set(record, dataOffset);

    expect(parsePrefabScene(prefab).assets).toEqual([
      {
        position: [12, 34, 5],
        rotation: [0, 0, 0, 1],
        size: [2, 3, 4],
        uuid,
        materialColors: { Color01: "112233ff" },
        flags: 0x2a
      }
    ]);
  });

  it("parses a nested version 13 prefab reference", () => {
    const path = "test.prefab";
    const pathBytes = new TextEncoder().encode(path);
    const flagBytes = new TextEncoder().encode("GAME");
    const record = new Uint8Array(4 + pathBytes.length + 40 + 1 + 1 + flagBytes.length + 4);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, pathBytes.length, false);
    record.set(pathBytes, 4);
    let offset = 4 + pathBytes.length;
    recordView.setFloat32(offset, -7, false);
    recordView.setFloat32(offset + 4, 8, false);
    recordView.setFloat32(offset + 8, 9, false);
    recordView.setFloat32(offset + 24, 1, false);
    recordView.setFloat32(offset + 28, 1.5, false);
    recordView.setFloat32(offset + 32, 2.5, false);
    recordView.setFloat32(offset + 36, 3.5, false);
    offset += 40;
    record[offset++] = 1;
    record[offset++] = flagBytes.length;
    record.set(flagBytes, offset);

    const dataOffset = 160;
    const prefab = new Uint8Array(dataOffset + record.length);
    const view = new DataView(prefab.buffer);
    prefab.set(new TextEncoder().encode("FERP"), 0);
    view.setUint32(4, 13, false);
    for (let section = 0; section < 6; section += 1) {
      const descriptor = 8 + section * 16;
      view.setUint32(descriptor, (section <= 1 ? dataOffset : dataOffset + record.length) * 8, false);
      view.setUint32(descriptor + 4, section === 1 ? 1 : 0, false);
      view.setUint32(descriptor + 12, section === 1 ? record.length * 8 : 0, false);
    }
    prefab.set(record, dataOffset);

    expect(parsePrefabScene(prefab).prefabs).toEqual([
      {
        path,
        position: [-7, 8, 9],
        rotation: [0, 0, 0, 1],
        size: [1.5, 2.5, 3.5],
        flag: "GAME"
      }
    ]);
  });
});
