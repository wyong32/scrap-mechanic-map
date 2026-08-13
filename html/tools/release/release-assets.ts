import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

export interface ReleaseAssetPolicy {
  includePersonalMapAssets: boolean;
  outDir: "dist" | "dist-save-import";
}

export interface ReleasePublicAsset {
  fileName: string;
  source: Uint8Array;
}

const localOnlyPublicPath = (path: string): boolean =>
  path === "data/default-save.db";

const enabledOnlyPublicPath = (path: string): boolean =>
  path === "data/generated/default-surface-orthographic-inventory.json"
  || path === "data/generated/tile-catalog.json"
  || path.startsWith("atlas/official/")
  || path.startsWith("legacy/img/");

export function createReleaseAssetPolicy(
  saveImportEnabled: boolean
): ReleaseAssetPolicy {
  return {
    includePersonalMapAssets: saveImportEnabled,
    outDir: saveImportEnabled ? "dist-save-import" : "dist"
  };
}

export async function collectReleasePublicAssets(
  publicRoot: string,
  policy: ReleaseAssetPolicy
): Promise<ReleasePublicAsset[]> {
  const canonicalRoot = await validateTrustedDirectory(
    publicRoot,
    "Release assets require a regular non-symbolic public root."
  );
  const absolutePaths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    await validateTrustedDirectory(
      directory,
      `Unsupported public release entry: ${directory}`
    );
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        throw new Error(`Unsupported public release entry: ${path}`);
      }
      if (stats.isDirectory()) await visit(path);
      else if (stats.isFile()) absolutePaths.push(path);
      else throw new Error(`Unsupported public release entry: ${path}`);
    }
  };
  await visit(publicRoot);

  const fileNames = absolutePaths
    .map((path) => ({
      absolutePath: path,
      fileName: relative(publicRoot, path).split(sep).join("/")
    }))
    .filter(({ fileName }) => !localOnlyPublicPath(fileName))
    .filter(({ fileName }) =>
      policy.includePersonalMapAssets || !enabledOnlyPublicPath(fileName)
    )
    .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));

  return Promise.all(fileNames.map(async ({ absolutePath, fileName }) => ({
    fileName,
    source: await readVerifiedRegularFile(
      canonicalRoot,
      absolutePath,
      `Unsupported public release entry: ${absolutePath}`
    )
  })));
}

export async function collectLocalSaveAsset(
  trustedLocalRoot: string,
  localSavePath: string
): Promise<ReleasePublicAsset | undefined> {
  try {
    const message = "Enabled save asset must be a regular non-symbolic file inside the trusted local-assets root.";
    const canonicalRoot = await validateTrustedDirectory(trustedLocalRoot, message);
    return {
      fileName: "data/default-save.db",
      source: await readVerifiedRegularFile(canonicalRoot, localSavePath, message)
    };
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return undefined;
    }
    if (error instanceof Error && error.message.includes("trusted local-assets root")) {
      throw error;
    }
    throw new Error(
      "Enabled save asset must be a regular non-symbolic file inside the trusted local-assets root.",
      { cause: error }
    );
  }
}

async function validateTrustedDirectory(path: string, message: string): Promise<string> {
  const [stats, canonicalPath] = await Promise.all([lstat(path), realpath(path)]);
  if (
    stats.isSymbolicLink()
    || !stats.isDirectory()
    || comparablePath(canonicalPath) !== comparablePath(resolve(path))
  ) {
    throw new Error(message);
  }
  return canonicalPath;
}

function sameFileIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode;
}

async function readVerifiedRegularFile(
  canonicalRoot: string,
  path: string,
  message: string
): Promise<Uint8Array> {
  const [before, canonicalPath, canonicalParent] = await Promise.all([
    lstat(path),
    realpath(path),
    realpath(dirname(path))
  ]);
  const difference = relative(canonicalRoot, canonicalPath);
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || !difference
    || difference === ".."
    || difference.startsWith(`..${sep}`)
    || isAbsolute(difference)
    || comparablePath(canonicalPath) !== comparablePath(resolve(path))
    || comparablePath(canonicalParent) !== comparablePath(resolve(dirname(path)))
  ) {
    throw new Error(message);
  }

  const handle = await open(canonicalPath, "r");
  try {
    const opened = await handle.stat();
    const [after, afterCanonicalPath] = await Promise.all([
      lstat(path),
      realpath(path)
    ]);
    if (
      !opened.isFile()
      || after.isSymbolicLink()
      || !after.isFile()
      || !sameFileIdentity(before, opened)
      || !sameFileIdentity(after, opened)
      || comparablePath(afterCanonicalPath) !== comparablePath(canonicalPath)
    ) {
      throw new Error(message);
    }
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export async function collectReleaseAssets(
  publicRoot: string,
  trustedLocalRoot: string,
  localSavePath: string,
  policy: ReleaseAssetPolicy
): Promise<ReleasePublicAsset[]> {
  const assets = await collectReleasePublicAssets(publicRoot, policy);
  if (policy.includePersonalMapAssets) {
    const localSave = await collectLocalSaveAsset(trustedLocalRoot, localSavePath);
    if (localSave) assets.push(localSave);
  }
  return assets.sort((left, right) =>
    left.fileName.localeCompare(right.fileName, "en")
  );
}

export function releasePublicAssetsPlugin(
  publicRoot: string,
  trustedLocalRoot: string,
  localSavePath: string,
  policy: ReleaseAssetPolicy
): Plugin {
  return {
    name: "release-public-assets",
    apply: "build",
    async generateBundle() {
      for (const asset of await collectReleaseAssets(
        publicRoot,
        trustedLocalRoot,
        localSavePath,
        policy
      )) {
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: asset.source
        });
      }
    }
  };
}
