export interface PrefabAssetInstance {
  position: [number, number, number];
  rotation: [number, number, number, number];
  size: [number, number, number];
  uuid: string;
  materialColors: Record<string, string>;
  flags: number;
}

export interface PrefabScene {
  assets: PrefabAssetInstance[];
  prefabs: PrefabReference[];
}

export interface PrefabReference {
  path: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  size: [number, number, number];
  flag: string;
}

interface SectionDescriptor {
  start: number;
  count: number;
  end: number;
}

function requireBytes(offset: number, length: number, available: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > available) throw new Error(`${label} is truncated.`);
}

function uuidAt(bytes: Uint8Array, offset: number): string {
  const hex = Array.from(bytes.subarray(offset, offset + 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hexAt(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.subarray(offset, offset + length), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function vec3(view: DataView, offset: number): [number, number, number] {
  return [view.getFloat32(offset, false), view.getFloat32(offset + 4, false), view.getFloat32(offset + 8, false)];
}

function quat(view: DataView, offset: number): [number, number, number, number] {
  return [
    view.getFloat32(offset, false),
    view.getFloat32(offset + 4, false),
    view.getFloat32(offset + 8, false),
    view.getFloat32(offset + 12, false)
  ];
}

function readSection(view: DataView, index: number, available: number): SectionDescriptor {
  const descriptor = 8 + index * 16;
  const startBits = view.getUint32(descriptor, false);
  const count = view.getUint32(descriptor + 4, false);
  const lengthBits = view.getUint32(descriptor + 12, false);
  const endBits = startBits + lengthBits;
  if (startBits % 8 !== 0 || lengthBits % 8 !== 0 || endBits / 8 > available) {
    throw new Error(`Prefab section ${index} has invalid bit offsets.`);
  }
  return { start: startBits / 8, count, end: endBits / 8 };
}

export function parsePrefabScene(bytes: Uint8Array): PrefabScene {
  requireBytes(0, 104, bytes.length, "Prefab header");
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 4)) !== "FERP") throw new Error("Prefab magic must be FERP.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, false);
  if (version !== 13) throw new Error(`Expected Prefab version 13, received ${version}.`);
  const prefabSection = readSection(view, 1, bytes.length);
  const assetSection = readSection(view, 3, bytes.length);
  const prefabs: PrefabReference[] = [];
  let prefabOffset = prefabSection.start;
  for (let prefabIndex = 0; prefabIndex < prefabSection.count; prefabIndex += 1) {
    requireBytes(prefabOffset, 4, prefabSection.end, `Nested prefab ${prefabIndex} path length`);
    const pathBytes = view.getUint32(prefabOffset, false);
    prefabOffset += 4;
    requireBytes(prefabOffset, pathBytes + 45, prefabSection.end, `Nested prefab ${prefabIndex}`);
    const path = new TextDecoder().decode(bytes.subarray(prefabOffset, prefabOffset + pathBytes));
    prefabOffset += pathBytes;
    const position = vec3(view, prefabOffset);
    const rotation = quat(view, prefabOffset + 0xc);
    const size = vec3(view, prefabOffset + 0x1c);
    prefabOffset += 0x28;
    const hasFlag = bytes[prefabOffset++] !== 0;
    let flag = "";
    if (hasFlag) {
      const flagBytes = bytes[prefabOffset++];
      requireBytes(prefabOffset, flagBytes, prefabSection.end, `Nested prefab ${prefabIndex} flag`);
      flag = new TextDecoder().decode(bytes.subarray(prefabOffset, prefabOffset + flagBytes));
      prefabOffset += flagBytes;
    }
    requireBytes(prefabOffset, 4, prefabSection.end, `Nested prefab ${prefabIndex} trailer`);
    prefabOffset += 4;
    prefabs.push({ path, position, rotation, size, flag });
  }
  if (prefabOffset !== prefabSection.end) throw new Error(`Nested prefab section has ${prefabSection.end - prefabOffset} unread bytes.`);
  const assets: PrefabAssetInstance[] = [];
  let offset = assetSection.start;
  for (let assetIndex = 0; assetIndex < assetSection.count; assetIndex += 1) {
    requireBytes(offset, 57, assetSection.end, `Prefab asset ${assetIndex}`);
    const position = vec3(view, offset);
    const rotation = quat(view, offset + 0xc);
    const size = vec3(view, offset + 0x1c);
    const uuid = uuidAt(bytes, offset + 0x28);
    offset += 0x38;
    const materialCount = bytes[offset++];
    const materialColors: Record<string, string> = {};
    for (let materialIndex = 0; materialIndex < materialCount; materialIndex += 1) {
      requireBytes(offset, 1, assetSection.end, `Prefab asset ${assetIndex} material`);
      const nameBytes = bytes[offset++];
      requireBytes(offset, nameBytes + 4, assetSection.end, `Prefab asset ${assetIndex} material`);
      const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameBytes));
      offset += nameBytes;
      materialColors[name] = hexAt(bytes, offset, 4);
      offset += 4;
    }
    requireBytes(offset, 1, assetSection.end, `Prefab asset ${assetIndex} flags`);
    const flags = bytes[offset++];
    assets.push({ position, rotation, size, uuid, materialColors, flags });
  }
  if (offset !== assetSection.end) throw new Error(`Prefab asset section has ${assetSection.end - offset} unread bytes.`);
  return { assets, prefabs };
}
