import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectReleaseAssets,
  collectReleasePublicAssets,
  collectLocalSaveAsset,
  createReleaseAssetPolicy
} from "./release-assets";

const fixtureRoots: string[] = [];

async function createPublicFixture(paths: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-assets-"));
  fixtureRoots.push(root);
  await Promise.all(paths.map(async (path) => {
    const absolutePath = join(root, ...path.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, path);
  }));
  return root;
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("release public asset policy", () => {
  it("excludes personal-save data from the default production artifact", async () => {
    const publicRoot = await createPublicFixture([
      "assets/reference-surface-1.0.webp",
      "atlas/official/official-tile-atlas.json",
      "data/default-save.db",
      "data/generated/default-surface-orthographic-inventory.json",
      "data/generated/regions.json",
      "data/generated/tile-catalog.json",
      "legacy/img/tiles/10105.jpg"
    ]);

    const assets = await collectReleasePublicAssets(
      publicRoot,
      createReleaseAssetPolicy(false)
    );

    expect(assets.map((asset) => asset.fileName)).toEqual([
      "assets/reference-surface-1.0.webp",
      "data/generated/regions.json"
    ]);
  });

  it("retains local save-import assets only in the explicitly enabled artifact", async () => {
    const paths = [
      "assets/reference-surface-1.0.webp",
      "atlas/official/official-tile-atlas.json",
      "data/default-save.db",
      "data/generated/default-surface-orthographic-inventory.json",
      "data/generated/regions.json",
      "data/generated/tile-catalog.json",
      "legacy/img/tiles/10105.jpg"
    ];
    const publicRoot = await createPublicFixture(paths);

    const assets = await collectReleasePublicAssets(
      publicRoot,
      createReleaseAssetPolicy(true)
    );

    expect(assets.map((asset) => asset.fileName)).toEqual(
      paths.filter((path) => path !== "data/default-save.db").sort()
    );
  });

  it("never collects a save DB from the public source tree", async () => {
    const publicRoot = await createPublicFixture([
      "data/default-save.db",
      "data/generated/regions.json"
    ]);

    const assets = await collectReleasePublicAssets(
      publicRoot,
      createReleaseAssetPolicy(true)
    );

    expect(assets.map((asset) => asset.fileName)).toEqual([
      "data/generated/regions.json"
    ]);
  });

  it("rejects a symbolic public root instead of following it", async () => {
    const actualRoot = await createPublicFixture(["data/generated/regions.json"]);
    const linkParent = await createPublicFixture([]);
    const linkedRoot = join(linkParent, "public");
    await symlink(actualRoot, linkedRoot, "junction");

    await expect(collectReleasePublicAssets(
      linkedRoot,
      createReleaseAssetPolicy(false)
    )).rejects.toThrow("regular non-symbolic public root");
  });

  it("optionally injects the ignored local save with byte-for-byte identity", async () => {
    const localRoot = await createPublicFixture(["default-save.db"]);
    const localPath = join(localRoot, "default-save.db");

    const asset = await collectLocalSaveAsset(localRoot, localPath);

    expect(asset).toEqual({
      fileName: "data/default-save.db",
      source: new Uint8Array(await readFile(localPath))
    });
  });

  it("omits the optional local save when no trusted file exists", async () => {
    const publicRoot = await createPublicFixture(["data/generated/regions.json"]);
    const localRoot = await createPublicFixture([]);

    await expect(collectReleaseAssets(
      publicRoot,
      localRoot,
      join(localRoot, "missing.db"),
      createReleaseAssetPolicy(true)
    )).resolves.toMatchObject([{
      fileName: "data/generated/regions.json"
    }]);
  });

  it("injects the trusted local save only for enabled release policy", async () => {
    const publicRoot = await createPublicFixture(["data/generated/regions.json"]);
    const localRoot = await createPublicFixture(["default-save.db"]);
    const localPath = join(localRoot, "default-save.db");

    const defaultAssets = await collectReleaseAssets(
      publicRoot,
      localRoot,
      localPath,
      createReleaseAssetPolicy(false)
    );
    const enabledAssets = await collectReleaseAssets(
      publicRoot,
      localRoot,
      localPath,
      createReleaseAssetPolicy(true)
    );

    expect(defaultAssets.map((asset) => asset.fileName)).toEqual([
      "data/generated/regions.json"
    ]);
    expect(enabledAssets.map((asset) => asset.fileName)).toEqual([
      "data/default-save.db",
      "data/generated/regions.json"
    ]);
    expect(enabledAssets[0]?.source).toEqual(new Uint8Array(await readFile(localPath)));
  });

  it("rejects a local save path outside the trusted local-assets root", async () => {
    const trustedRoot = await createPublicFixture([]);
    const outsideRoot = await createPublicFixture(["outside.db"]);

    await expect(collectLocalSaveAsset(
      trustedRoot,
      join(outsideRoot, "outside.db")
    )).rejects.toThrow("regular non-symbolic file inside the trusted local-assets root");
  });

  it("rejects a symbolic local save instead of following its target", async () => {
    const trustedRoot = await createPublicFixture([]);
    const outsideRoot = await createPublicFixture(["escaped/default-save.db"]);
    const localDirectory = join(trustedRoot, "linked");
    await symlink(join(outsideRoot, "escaped"), localDirectory, "junction");
    const localPath = join(localDirectory, "default-save.db");

    await expect(collectLocalSaveAsset(trustedRoot, localPath))
      .rejects.toThrow("regular non-symbolic file inside the trusted local-assets root");
  });

  it("rejects an in-root junction instead of trusting an intermediate reparse point", async () => {
    const trustedRoot = await createPublicFixture(["actual/default-save.db"]);
    const linkedDirectory = join(trustedRoot, "linked");
    await symlink(join(trustedRoot, "actual"), linkedDirectory, "junction");

    await expect(collectLocalSaveAsset(
      trustedRoot,
      join(linkedDirectory, "default-save.db")
    )).rejects.toThrow("regular non-symbolic file inside the trusted local-assets root");
  });

  it("uses an isolated output directory for an enabled build", () => {
    expect(createReleaseAssetPolicy(false).outDir).toBe("dist");
    expect(createReleaseAssetPolicy(true).outDir).toBe("dist-save-import");
  });
});
