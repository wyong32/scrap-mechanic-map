import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";

interface AssetSetIndex {
  assetSetList?: Array<{ assetSet: string }>;
}

interface AssetSetFile {
  assetListRenderable?: Array<{ uuid: string; name: string; renderable?: string | RendFile }>;
}

interface RendMaterial {
  material?: string;
  textureList?: string[];
}

interface RendFile {
  lodList?: Array<{
    mesh: string;
    subMeshList?: RendMaterial[];
    subMeshMap?: Record<string, RendMaterial>;
  }>;
}

export interface GameAssetDefinition {
  uuid: string;
  name: string;
  renderablePath: string | null;
  meshPath: string;
  materials: Array<{ name: string; texturePaths: string[] }>;
}

export function resolveGamePath(gameRoot: string, value: string): string {
  const tokens: Record<string, string> = {
    "$GAME_DATA": join(gameRoot, "Data"),
    "$SURVIVAL_DATA": join(gameRoot, "Survival"),
    "$CHALLENGE_DATA": join(gameRoot, "ChallengeData")
  };
  for (const [token, root] of Object.entries(tokens)) {
    if (value === token) return normalize(root);
    if (value.startsWith(`${token}/`) || value.startsWith(`${token}\\`)) {
      return normalize(join(root, value.slice(token.length + 1)));
    }
  }
  return normalize(value);
}

function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length - 1 && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    output += character;
  }
  return output;
}

function readJson<T>(path: string): T {
  return JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as T;
}

export function loadGameAssetCatalog(gameRoot: string): Map<string, GameAssetDefinition> {
  const catalog = new Map<string, GameAssetDefinition>();
  const indexPaths = [
    join(gameRoot, "Data", "Terrain", "Database", "assetsets.json"),
    join(gameRoot, "Survival", "Terrain", "Database", "assetsets.json"),
    join(gameRoot, "ChallengeData", "Terrain", "Database", "assetsets.json")
  ];
  for (const indexPath of indexPaths) {
    if (!existsSync(indexPath)) continue;
    for (const item of readJson<AssetSetIndex>(indexPath).assetSetList ?? []) {
      const assetSetPath = resolveGamePath(gameRoot, item.assetSet);
      if (!existsSync(assetSetPath)) continue;
      for (const asset of readJson<AssetSetFile>(assetSetPath).assetListRenderable ?? []) {
        if (!asset.renderable) continue;
        const renderablePath = typeof asset.renderable === "string" ? resolveGamePath(gameRoot, asset.renderable) : null;
        if (renderablePath !== null && !existsSync(renderablePath)) continue;
        const renderable: RendFile = renderablePath === null ? asset.renderable as RendFile : readJson<RendFile>(renderablePath);
        const lod = renderable.lodList?.[0];
        if (!lod?.mesh) continue;
        const materials = lod.subMeshList ?? Object.values(lod.subMeshMap ?? {});
        catalog.set(asset.uuid.toLowerCase(), {
          uuid: asset.uuid.toLowerCase(),
          name: asset.name,
          renderablePath,
          meshPath: resolveGamePath(gameRoot, lod.mesh),
          materials: materials.map((material) => ({
            name: material.material ?? "",
            texturePaths: (material.textureList ?? []).map((texture) => resolveGamePath(gameRoot, texture))
          }))
        });
      }
    }
  }
  return catalog;
}
