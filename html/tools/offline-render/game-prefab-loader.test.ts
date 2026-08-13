import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { expandGamePrefabReferences } from "./game-prefab-loader";

const roots: string[] = [];
const identity: [number, number, number, number] = [0, 0, 0, 1];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function uuidBytes(uuid: string): Uint8Array {
  return Uint8Array.from(uuid.replaceAll("-", "").match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

function makeAssetPrefab(uuid: string): Uint8Array {
  const record = new Uint8Array(40 + 16 + 1 + 1);
  const recordView = new DataView(record.buffer);
  recordView.setFloat32(0, 2, false);
  recordView.setFloat32(24, 1, false);
  recordView.setFloat32(28, 1, false);
  recordView.setFloat32(32, 1, false);
  recordView.setFloat32(36, 1, false);
  record.set(uuidBytes(uuid), 40);
  const dataOffset = 160;
  const prefab = new Uint8Array(dataOffset + record.length);
  const view = new DataView(prefab.buffer);
  prefab.set(new TextEncoder().encode("FERP"));
  view.setUint32(4, 13, false);
  for (let section = 0; section < 6; section += 1) {
    const descriptor = 8 + section * 16;
    view.setUint32(descriptor, (section <= 3 ? dataOffset : dataOffset + record.length) * 8, false);
    view.setUint32(descriptor + 4, section === 3 ? 1 : 0, false);
    view.setUint32(descriptor + 12, section === 3 ? record.length * 8 : 0, false);
  }
  prefab.set(record, dataOffset);
  return prefab;
}

describe("expandGamePrefabReferences", () => {
  it("loads tokenized official prefab paths and applies the tile transform", () => {
    const root = mkdtempSync(join(tmpdir(), "sm-prefabs-"));
    roots.push(root);
    const prefabDirectory = join(root, "Survival", "Prefabs");
    mkdirSync(prefabDirectory, { recursive: true });
    const uuid = "11111111-2222-3333-4444-555555555555";
    writeFileSync(join(prefabDirectory, "test.prefab"), makeAssetPrefab(uuid));

    const result = expandGamePrefabReferences(root, [{
      path: "$SURVIVAL_DATA/Prefabs/test.prefab",
      position: [10, 0, 0],
      rotation: identity,
      size: [2, 2, 2],
      flag: ""
    }]);

    expect(result.assets).toEqual([
      expect.objectContaining({ uuid, position: [14, 0, 0], size: [2, 2, 2] })
    ]);
    expect(result.prefabFiles).toEqual([join(prefabDirectory, "test.prefab")]);
  });
});
