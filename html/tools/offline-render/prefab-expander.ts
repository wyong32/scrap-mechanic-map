import type { PrefabAssetInstance, PrefabReference, PrefabScene } from "./prefab-v13-reader";

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

function multiplyVec3(left: Vec3, right: Vec3): Vec3 {
  return [left[0] * right[0], left[1] * right[1], left[2] * right[2]];
}

function rotateVector(rotation: Quat, value: Vec3): Vec3 {
  const [qx, qy, qz, qw] = rotation;
  const [vx, vy, vz] = value;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx)
  ];
}

function multiplyQuaternion(parent: Quat, child: Quat): Quat {
  const [ax, ay, az, aw] = parent;
  const [bx, by, bz, bw] = child;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

function composeReference(parent: PrefabReference, child: PrefabReference): PrefabReference {
  const translated = rotateVector(parent.rotation, multiplyVec3(child.position, parent.size));
  return {
    ...child,
    position: [parent.position[0] + translated[0], parent.position[1] + translated[1], parent.position[2] + translated[2]],
    rotation: multiplyQuaternion(parent.rotation, child.rotation),
    size: multiplyVec3(parent.size, child.size)
  };
}

function composeAsset(parent: PrefabReference, child: PrefabAssetInstance): PrefabAssetInstance {
  const translated = rotateVector(parent.rotation, multiplyVec3(child.position, parent.size));
  return {
    ...child,
    position: [parent.position[0] + translated[0], parent.position[1] + translated[1], parent.position[2] + translated[2]],
    rotation: multiplyQuaternion(parent.rotation, child.rotation),
    size: multiplyVec3(parent.size, child.size)
  };
}

export function expandPrefabReferences(
  references: readonly PrefabReference[],
  loadScene: (path: string) => PrefabScene
): PrefabAssetInstance[] {
  const assets: PrefabAssetInstance[] = [];
  const expand = (reference: PrefabReference, ancestors: ReadonlySet<string>): void => {
    if (ancestors.has(reference.path)) throw new Error(`Prefab cycle detected at ${reference.path}.`);
    const scene = loadScene(reference.path);
    const nextAncestors = new Set(ancestors).add(reference.path);
    assets.push(...scene.assets.map((asset) => composeAsset(reference, asset)));
    for (const child of scene.prefabs) expand(composeReference(reference, child), nextAncestors);
  };
  for (const reference of references) expand(reference, new Set());
  return assets;
}
