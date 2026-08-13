import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { TerrainCell } from "../domain/map-model";
import { resolveTerrainVisuals } from "./hybrid-terrain-resolver";
import { LegacyAssetRepository } from "./legacy-asset-repository";

interface AssetFixture {
  key: `tile:${number}` | `poi:${string}`;
  url: string;
  bytes: Uint8Array;
}

const assets: AssetFixture[] = [
  {
    key: "tile:20301",
    url: "/legacy/img/tiles/20301.jpg",
    bytes: new Uint8Array([20, 30, 1])
  },
  {
    key: "tile:20302",
    url: "/legacy/img/tiles/20302.jpg",
    bytes: new Uint8Array([20, 30, 2])
  },
  {
    key: "tile:20303",
    url: "/legacy/img/tiles/20303.jpg",
    bytes: new Uint8Array([20, 30, 3])
  },
  {
    key: "tile:1000001",
    url: "/legacy/img/tiles/1000001.jpg",
    bytes: new Uint8Array([1, 2, 3])
  },
  {
    key: "poi:mechanic_station.png",
    url: "/legacy/img/mechanic_station.png",
    bytes: new Uint8Array([4, 5, 6])
  }
];

const officialUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const officialPages = [
  {
    name: "official-0.webp",
    bytes: new Uint8Array([10, 20, 30])
  },
  {
    name: "official-icons-0.webp",
    bytes: new Uint8Array([40, 50, 60])
  }
];
const orthographicPage = {
  name: "orthographic-0.webp",
  bytes: new Uint8Array([70, 80, 90])
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key])
        ])
    );
  }
  return value;
}

function withHash<T extends Record<string, unknown>>(value: T): T & {
  contentHash: string;
} {
  const result = { ...value, contentHash: "" };
  const { contentHash: _contentHash, ...payload } = result;
  result.contentHash = createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
  return result;
}

function fixtureDocuments(options: { manifestHash?: string } = {}) {
  const aliasUuids = [
    "20301000-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "20302000-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "20303000-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  ];
  const manifest = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: ["html/public/legacy/img"],
    assets: assets.map((asset) => ({
      key: asset.key,
      url: asset.url,
      width: 2,
      height: 2,
      sha256:
        options.manifestHash ??
        createHash("sha256").update(asset.bytes).digest("hex"),
      source: "the1killer/sm_overview"
    }))
  });
  const catalog = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    tiles: [
      {
        uuid: "54b1f04b-de02-4e82-bf2b-f2d7ef163356",
        sourceCategory: "Meadow"
      },
      {
        uuid: "2c36976b-e008-408c-a5b5-1baaaf01df04",
        sourceCategory: "Poi"
      }
    ],
    pois: [
      {
        tileUuid: "2c36976b-e008-408c-a5b5-1baaaf01df04",
        poiType: "POI_MECHANICSTATION_MEDIUM"
      }
    ],
    legacyBridge: [
      {
        legacyId: 10901,
        uuid: "2c36976b-e008-408c-a5b5-1baaaf01df04",
        tilePath: "Survival/Terrain/Tiles/poi/MechanicStation_128_01.tile",
        status: "active",
        evidence:
          "Survival/Scripts/terrain/overworld/poi.lua:addPoiTileLegacy"
      },
      ...aliasUuids.flatMap((uuid, index) => [
        {
          legacyId: 20201 + index,
          uuid,
          tilePath: `Survival/Terrain/Tiles/alias-${index + 1}.tile`,
          status: "active" as const,
          evidence: "Survival/Scripts/terrain/overworld/alias.lua:AddTile"
        },
        {
          legacyId: 20301 + index,
          uuid,
          tilePath: `Survival/Terrain/Tiles/alias-${index + 1}.tile`,
          status: "active" as const,
          evidence: "Survival/Scripts/terrain/overworld/alias.lua:AddTile"
        }
      ]).sort((left, right) => left.legacyId - right.legacyId),
      {
        legacyId: 1000001,
        uuid: "54b1f04b-de02-4e82-bf2b-f2d7ef163356",
        tilePath: "Survival/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile",
        status: "active",
        evidence:
          "Survival/Scripts/terrain/overworld/type_meadow.lua:AddTile"
      },
      {
        legacyId: 1000002,
        uuid: "54b1f04b-de02-4e82-bf2b-f2d7ef163356",
        tilePath: "Survival/Terrain/Tiles/meadow/Meadow_64(1111)_01.tile",
        status: "remapped",
        evidence:
          "Survival/Scripts/terrain/overworld/type_meadow.lua:AddTile"
      }
    ]
  });
  const manifestText = JSON.stringify(manifest);
  const catalogText = JSON.stringify(catalog);
  const build = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    generatedFrom: [],
    files: [
      {
        name: "legacy-assets.json",
        contentHash: manifest.contentHash,
        bytes: new TextEncoder().encode(manifestText).byteLength
      },
      {
        name: "tile-catalog.json",
        contentHash: catalog.contentHash,
        bytes: new TextEncoder().encode(catalogText).byteLength
      }
    ]
  });
  const officialManifest = withHash({
    schemaVersion: 1,
    gameVersion: "1.0.0",
    spriteSize: 2,
    pages: Object.fromEntries(officialPages.map((page) => [
      page.name,
      {
        width: 2,
        height: 2,
        sha256: createHash("sha256").update(page.bytes).digest("hex")
      }
    ])),
    entries: {
      [officialUuid]: {
        uuid: officialUuid,
        page: "official-0.webp",
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        spanWidth: 2,
        spanHeight: 2,
        renderMode: "terrain",
        projection: "verified-orthographic",
        icon: {
          page: "official-icons-0.webp",
          x: 0,
          y: 0,
          width: 2,
          height: 2
        }
      }
    }
  });
  return {
    "/data/generated/legacy-assets.json": manifestText,
    "/data/generated/tile-catalog.json": catalogText,
    "/data/generated/build-info.json": JSON.stringify(build),
    "/atlas/official/official-tile-atlas.json": JSON.stringify(officialManifest)
  };
}

class FakeImage {
  static instances: FakeImage[] = [];
  static decodeImplementations: Array<() => Promise<void>> = [];
  static decodeBySrc = new Map<string, () => Promise<void>>();
  static dimensionsBySrc = new Map<
    string,
    { width: number; height: number }
  >();
  assignedSources: string[] = [];
  private currentSrc = "";
  get src(): string {
    return this.currentSrc;
  }
  set src(value: string) {
    this.currentSrc = value;
    if (value) this.assignedSources.push(value);
  }
  naturalWidth = 2;
  naturalHeight = 2;
  decode = vi.fn(() => {
    const dimensions = FakeImage.dimensionsBySrc.get(this.src);
    if (dimensions) {
      this.naturalWidth = dimensions.width;
      this.naturalHeight = dimensions.height;
    }
    const sourceImplementation = FakeImage.decodeBySrc.get(this.src);
    if (sourceImplementation) return sourceImplementation();
    const implementation = FakeImage.decodeImplementations.shift();
    return implementation ? implementation() : Promise.resolve();
  });

  constructor() {
    FakeImage.instances.push(this);
  }
}

function installNetwork(options: {
  documents?: ReturnType<typeof fixtureDocuments>;
  missingUrl?: string;
  failOnceUrl?: string;
  alteredUrl?: string;
  delayedUrl?: string;
  delayedUntil?: Promise<void>;
  binaries?: Readonly<Record<string, Uint8Array>>;
} = {}) {
  const documents = options.documents ?? fixtureDocuments();
  const requested: string[] = [];
  let failedOnce = false;
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (options.delayedUrl === url) await options.delayedUntil;
      if (options.failOnceUrl === url && !failedOnce) {
        failedOnce = true;
        return new Response("missing", { status: 404 });
      }
      if (options.missingUrl === url) {
        return new Response("missing", { status: 404 });
      }
      const document = documents[url as keyof typeof documents];
      if (document !== undefined) return new Response(document);
      const binary = options.binaries?.[url];
      if (binary) {
        const bytes = options.alteredUrl === url
          ? new Uint8Array([9, 9, 9])
          : binary;
        return new Response(bytes.slice().buffer as ArrayBuffer);
      }
      const officialPage = [...officialPages, orthographicPage].find(
        (candidate) => `/atlas/official/${candidate.name}` === url
      );
      if (officialPage) {
        const bytes = options.alteredUrl === url
          ? new Uint8Array([9, 9, 9])
          : officialPage.bytes;
        return new Response(bytes.slice().buffer as ArrayBuffer);
      }
      const asset = assets.find((candidate) => candidate.url === url);
      if (!asset) {
        return new Response("missing", { status: 404 });
      }
      const bytes =
        options.alteredUrl === url ? new Uint8Array([9, 9, 9]) : asset.bytes;
      return new Response(bytes.slice().buffer as ArrayBuffer);
    })
  );
  return requested;
}

const onDemandLegacyUuid = "10105000-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const onDemandOfficialUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const onDemandLegacyBytes = new Uint8Array([10, 10, 5]);
const onDemandOfficialBytes = new Uint8Array([20, 20, 2]);

function onDemandFixture() {
  const documents = fixtureDocuments();
  const manifest = JSON.parse(
    documents["/data/generated/legacy-assets.json"]
  ) as Record<string, any>;
  manifest.assets.unshift({
    key: "tile:10105",
    url: "/legacy/img/tiles/10105.jpg",
    width: 2,
    height: 2,
    sha256: createHash("sha256").update(onDemandLegacyBytes).digest("hex"),
    source: "the1killer/sm_overview"
  });
  const manifestText = JSON.stringify(withHash(manifest));
  documents["/data/generated/legacy-assets.json"] = manifestText;

  const catalog = JSON.parse(
    documents["/data/generated/tile-catalog.json"]
  ) as Record<string, any>;
  catalog.tiles.push({
    uuid: onDemandLegacyUuid,
    sourceCategory: "Meadow"
  });
  catalog.legacyBridge.push({
    legacyId: 10105,
    uuid: onDemandLegacyUuid,
    tilePath: "Survival/Terrain/Tiles/meadow/Meadow_64(10105)_01.tile",
    status: "active",
    evidence: "Survival/Scripts/terrain/overworld/type_meadow.lua:AddTile"
  });
  catalog.legacyBridge.sort(
    (left: { legacyId: number }, right: { legacyId: number }) =>
      left.legacyId - right.legacyId
  );
  const catalogText = JSON.stringify(withHash(catalog));
  documents["/data/generated/tile-catalog.json"] = catalogText;

  const officialManifest = JSON.parse(
    documents["/atlas/official/official-tile-atlas.json"]
  ) as Record<string, any>;
  officialManifest.pages["orthographic-2.webp"] = {
    width: 2,
    height: 2,
    sha256: createHash("sha256").update(onDemandOfficialBytes).digest("hex")
  };
  officialManifest.entries[onDemandOfficialUuid] = {
    uuid: onDemandOfficialUuid,
    page: "orthographic-2.webp",
    x: 0,
    y: 0,
    width: 2,
    height: 2,
    spanWidth: 1,
    spanHeight: 1,
    renderMode: "terrain",
    projection: "verified-orthographic"
  };
  documents["/atlas/official/official-tile-atlas.json"] = JSON.stringify(
    withHash(officialManifest)
  );

  const build = JSON.parse(
    documents["/data/generated/build-info.json"]
  ) as Record<string, any>;
  const manifestEnvelope = JSON.parse(manifestText) as { contentHash: string };
  const catalogEnvelope = JSON.parse(catalogText) as { contentHash: string };
  const manifestFile = build.files.find(
    (file: { name: string }) => file.name === "legacy-assets.json"
  );
  manifestFile.contentHash = manifestEnvelope.contentHash;
  manifestFile.bytes = new TextEncoder().encode(manifestText).byteLength;
  const catalogFile = build.files.find(
    (file: { name: string }) => file.name === "tile-catalog.json"
  );
  catalogFile.contentHash = catalogEnvelope.contentHash;
  catalogFile.bytes = new TextEncoder().encode(catalogText).byteLength;
  documents["/data/generated/build-info.json"] = JSON.stringify(withHash(build));

  return {
    documents,
    binaries: {
      "/legacy/img/tiles/10105.jpg": onDemandLegacyBytes,
      "/atlas/official/orthographic-2.webp": onDemandOfficialBytes
    }
  };
}

function terrainCell(
  x: number,
  uuid: string,
  overrides: Partial<TerrainCell> = {}
): TerrainCell {
  return {
    x,
    y: 0,
    uuid,
    rotation: 0,
    xOffset: 0,
    yOffset: 0,
    flags: 0,
    terrainType: "meadow",
    ...overrides
  };
}

function imageUrls(requested: readonly string[]): string[] {
  return requested.filter(
    (url) => url.startsWith("/legacy/img/") || url.endsWith(".webp")
  );
}

afterEach(() => {
  FakeImage.instances = [];
  FakeImage.decodeImplementations = [];
  FakeImage.decodeBySrc.clear();
  FakeImage.dimensionsBySrc.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not fetch during construction", () => {
  const fixture = onDemandFixture();
  installNetwork(fixture);

  new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );

  expect(fetch).not.toHaveBeenCalled();
});

it("loads verified metadata without fetching an image for an empty cell plan", async () => {
  const fixture = onDemandFixture();
  const requested = installNetwork(fixture);
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );

  const bundle = await repository.loadForCells([]);

  expect(requested).toEqual([
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  ]);
  expect(imageUrls(requested)).toEqual([]);
  expect(bundle.assets.size).toBe(0);
  expect(bundle.officialByUuid?.size ?? 0).toBe(0);
  expect(bundle.poiByUuid?.get("2c36976b-e008-408c-a5b5-1baaaf01df04"))
    .toBe("POI_MECHANICSTATION_MEDIUM");
});

it("loads official terrain without requesting a legacy manifest", async () => {
  const fixture = onDemandFixture();
  const requested = installNetwork(fixture);
  const repository = new LegacyAssetRepository(
    undefined,
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );

  const bundle = await repository.loadForCells(
    [terrainCell(0, onDemandOfficialUuid)],
    "official-1.0-only"
  );

  expect(requested).not.toContain("/data/generated/legacy-assets.json");
  expect(imageUrls(requested)).toEqual(["/atlas/official/orthographic-2.webp"]);
  expect(bundle.assets.size).toBe(0);
  expect(bundle.officialByUuid?.has(onDemandOfficialUuid)).toBe(true);
});

it("loads only the legacy asset and deduplicated official page planned for the cells", async () => {
  const fixture = onDemandFixture();
  const requested = installNetwork(fixture);
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );
  const legacyCell = terrainCell(0, onDemandLegacyUuid);
  const officialCell = terrainCell(1, onDemandOfficialUuid);
  const duplicateOfficialCell = terrainCell(2, onDemandOfficialUuid);

  const bundle = await repository.loadForCells([
    legacyCell,
    officialCell,
    duplicateOfficialCell
  ]);

  expect(imageUrls(requested)).toEqual([
    "/legacy/img/tiles/10105.jpg",
    "/atlas/official/orthographic-2.webp"
  ]);
  expect([...bundle.assets.keys()]).toEqual(["tile:10105"]);
  expect([...bundle.officialByUuid?.keys() ?? []]).toEqual([
    onDemandOfficialUuid
  ]);
});

it("memoizes shared verified image requests across cell loads", async () => {
  const fixture = onDemandFixture();
  const requested = installNetwork(fixture);
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );
  const cells = [
    terrainCell(0, onDemandLegacyUuid),
    terrainCell(1, onDemandOfficialUuid)
  ];

  const first = await repository.loadForCells(cells);
  const second = await repository.loadForCells(cells);

  expect(imageUrls(requested)).toEqual([
    "/legacy/img/tiles/10105.jpg",
    "/atlas/official/orthographic-2.webp"
  ]);
  expect(second.assets.get("tile:10105")?.image).toBe(
    first.assets.get("tile:10105")?.image
  );
  expect(second.officialByUuid?.get(onDemandOfficialUuid)?.image).toBe(
    first.officialByUuid?.get(onDemandOfficialUuid)?.image
  );
});

it("rejects corrupt bytes for a planned asset", async () => {
  const fixture = onDemandFixture();
  const corruptRequested = installNetwork({
    ...fixture,
    alteredUrl: "/legacy/img/tiles/10105.jpg"
  });
  const corruptRepository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json"
  );

  await expect(corruptRepository.loadForCells([
    terrainCell(0, onDemandLegacyUuid)
  ])).rejects.toThrow(/tile:10105.*hash check/i);
  expect(imageUrls(corruptRequested)).toEqual([
    "/legacy/img/tiles/10105.jpg"
  ]);
});

it("retries a failed image request on the next cell load", async () => {
  const fixture = onDemandFixture();
  const retryRequested = installNetwork({
    ...fixture,
    failOnceUrl: "/legacy/img/tiles/10105.jpg"
  });
  const retryRepository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json"
  );
  const cells = [terrainCell(0, onDemandLegacyUuid)];
  await expect(retryRepository.loadForCells(cells)).rejects.toThrow(
    /tile:10105.*missing/i
  );
  await expect(retryRepository.loadForCells(cells)).resolves.toMatchObject({
    assets: expect.objectContaining({ size: 1 })
  });
  expect(imageUrls(retryRequested)).toEqual([
    "/legacy/img/tiles/10105.jpg",
    "/legacy/img/tiles/10105.jpg"
  ]);
});

it("revokes retained object URLs when destroyed", async () => {
  const fixture = onDemandFixture();
  installNetwork(fixture);
  const createObjectURL = vi.fn(() => "blob:terrain-asset");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json"
  );

  await repository.loadForCells([terrainCell(0, onDemandLegacyUuid)]);
  expect(revokeObjectURL).not.toHaveBeenCalled();

  repository.destroy();

  expect(revokeObjectURL).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:terrain-asset");
  expect(FakeImage.instances[0]?.src).toBe("");
});

it("rejects and revokes an image that finishes decoding after destroy", async () => {
  const fixture = onDemandFixture();
  const requested = installNetwork(fixture);
  let releaseDecode!: () => void;
  FakeImage.decodeImplementations = [
    () => new Promise<void>((resolve) => (releaseDecode = resolve))
  ];
  const createObjectURL = vi.fn()
    .mockReturnValueOnce("blob:stale-terrain-asset")
    .mockReturnValueOnce("blob:fresh-terrain-asset");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json"
  );
  const cells = [terrainCell(0, onDemandLegacyUuid)];

  const staleLoad = repository.loadForCells(cells);
  await vi.waitFor(() => expect(FakeImage.instances).toHaveLength(1));
  repository.destroy();
  releaseDecode();

  await expect(staleLoad).rejects.toThrow(/destroyed/i);
  expect(FakeImage.instances[0]?.src).toBe("");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:stale-terrain-asset");

  const freshBundle = await repository.loadForCells(cells);
  expect(freshBundle.assets.get("tile:10105")?.image.src).toBe(
    "blob:fresh-terrain-asset"
  );
  expect(imageUrls(requested)).toEqual([
    "/legacy/img/tiles/10105.jpg",
    "/legacy/img/tiles/10105.jpg"
  ]);
});

it.each(["hash", "dimensions"] as const)(
  "rejects repeated legacy URLs with conflicting %s descriptors",
  async (conflict) => {
  const fixture = onDemandFixture();
  const manifest = JSON.parse(
    fixture.documents["/data/generated/legacy-assets.json"]
  ) as Record<string, any>;
  const repeatedRecord = manifest.assets.find(
    (record: { key: string }) => record.key === "tile:20301"
  );
  const originalRecord = manifest.assets.find(
    (record: { key: string }) => record.key === "tile:10105"
  );
  repeatedRecord.url = originalRecord.url;
  if (conflict === "dimensions") {
    repeatedRecord.sha256 = originalRecord.sha256;
    repeatedRecord.width = originalRecord.width + 1;
  }
  const manifestText = JSON.stringify(withHash(manifest));
  fixture.documents["/data/generated/legacy-assets.json"] = manifestText;
  const build = JSON.parse(
    fixture.documents["/data/generated/build-info.json"]
  ) as Record<string, any>;
  const manifestFile = build.files.find(
    (file: { name: string }) => file.name === "legacy-assets.json"
  );
  manifestFile.contentHash = (JSON.parse(manifestText) as { contentHash: string })
    .contentHash;
  manifestFile.bytes = new TextEncoder().encode(manifestText).byteLength;
  fixture.documents["/data/generated/build-info.json"] = JSON.stringify(
    withHash(build)
  );
  const requested = installNetwork(fixture);
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json"
  );

  await expect(repository.loadForCells([])).rejects.toThrow(
    /repeated url.*integrity descriptor/i
  );
  expect(imageUrls(requested)).toEqual([]);
  }
);

it("validates icon page membership and geometry before loading official pages", async () => {
  for (const icon of [
    {
      page: "missing-icons.webp",
      x: 0,
      y: 0,
      width: 2,
      height: 2
    },
    {
      page: "official-icons-0.webp",
      x: 1,
      y: 0,
      width: 2,
      height: 2
    },
    {
      page: "official-0.webp",
      x: 0,
      y: 0,
      width: 2,
      height: 2
    }
  ]) {
    const documents = fixtureDocuments();
    const manifest = JSON.parse(
      documents["/atlas/official/official-tile-atlas.json"]
    ) as Record<string, any>;
    manifest.entries[officialUuid].icon = icon;
    documents["/atlas/official/official-tile-atlas.json"] = JSON.stringify(
      withHash(manifest)
    );
    const requested = installNetwork({ documents });
    const repository = new LegacyAssetRepository(
      "/data/generated/legacy-assets.json",
      "/data/generated/tile-catalog.json",
      "/data/generated/build-info.json",
      "/atlas/official/official-tile-atlas.json"
    );

    await expect(repository.loadForCells([
      terrainCell(0, officialUuid)
    ])).rejects.toThrow(/official tile atlas.*malformed/i);
    expect(requested.filter((url) => url.endsWith(".webp"))).toEqual([]);
  }
});

it("loads only the planned official terrain page for a structure entry", async () => {
  const requested = installNetwork();
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );

  const bundle = await repository.loadForCells([terrainCell(0, officialUuid)]);
  const official = bundle.officialByUuid?.get(officialUuid);

  expect(requested.filter((url) => url.endsWith(".webp"))).toEqual([
    "/atlas/official/official-0.webp"
  ]);
  expect(official?.image).toBe(FakeImage.instances.find(
    (image) => image.assignedSources.includes(
      "/atlas/official/official-0.webp"
    )
  ));
  expect(official?.iconImage).toBeUndefined();
});

it("loads a planned generated orthographic terrain page", async () => {
  const documents = fixtureDocuments();
  const manifest = JSON.parse(
    documents["/atlas/official/official-tile-atlas.json"]
  ) as Record<string, any>;
  delete manifest.pages["official-0.webp"];
  manifest.pages["orthographic-0.webp"] = {
    width: 2,
    height: 2,
    sha256: createHash("sha256")
      .update(orthographicPage.bytes)
      .digest("hex")
  };
  manifest.entries[officialUuid].page = "orthographic-0.webp";
  documents["/atlas/official/official-tile-atlas.json"] = JSON.stringify(
    withHash(manifest)
  );
  const requested = installNetwork({ documents });
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );

  const bundle = await repository.loadForCells([terrainCell(0, officialUuid)]);

  expect(bundle.officialByUuid?.get(officialUuid)?.image).toBeDefined();
  expect(requested).toContain("/atlas/official/orthographic-0.webp");
});

it("rejects unsafe or malformed official atlas page records before image requests", async () => {
  const validPage = {
    width: 2,
    height: 2,
    sha256: "0".repeat(64)
  };
  for (const [pageName, pageRecord] of [
    ["../official-99.webp", validPage],
    ["unexpected.webp", validPage],
    ["official-99.webp", { ...validPage, width: 0 }],
    ["official-99.webp", { ...validPage, height: 2.5 }],
    ["official-99.webp", { ...validPage, sha256: "A".repeat(64) }]
  ] as const) {
    const documents = fixtureDocuments();
    const manifest = JSON.parse(
      documents["/atlas/official/official-tile-atlas.json"]
    ) as {
      pages: Record<string, unknown>;
    };
    manifest.pages[pageName] = pageRecord;
    documents["/atlas/official/official-tile-atlas.json"] = JSON.stringify(
      withHash(manifest)
    );
    const requested = installNetwork({ documents });
    const repository = new LegacyAssetRepository(
      "/data/generated/legacy-assets.json",
      "/data/generated/tile-catalog.json",
      "/data/generated/build-info.json",
      "/atlas/official/official-tile-atlas.json"
    );

    await expect(repository.loadForCells([
      terrainCell(0, officialUuid)
    ])).rejects.toThrow(
      /official tile atlas.*malformed/i
    );
    expect(requested.filter((url) => url.endsWith(".webp"))).toEqual([]);
  }
});

it("rejects an unknown official atlas projection before image requests", async () => {
  const documents = fixtureDocuments();
  const manifest = JSON.parse(
    documents["/atlas/official/official-tile-atlas.json"]
  ) as Record<string, any>;
  manifest.entries[officialUuid].projection = "perspective";
  documents["/atlas/official/official-tile-atlas.json"] = JSON.stringify(
    withHash(manifest)
  );
  const requested = installNetwork({ documents });
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );

  await expect(repository.loadForCells([
    terrainCell(0, officialUuid)
  ])).rejects.toThrow(
    /official tile atlas.*malformed/i
  );
  expect(requested.filter((url) => url.endsWith(".webp"))).toEqual([]);
});

it.each([
  ["404", { missingUrl: "/atlas/official/official-icons-0.webp" }],
  ["hash", { alteredUrl: "/atlas/official/official-icons-0.webp" }],
  ["decode", {}],
  ["dimensions", {}]
] as const)(
  "keeps optional official terrain loadable without requesting an unplanned icon page (%s fixture)",
  async (failure, networkOptions) => {
    const iconUrl = "/atlas/official/official-icons-0.webp";
    if (failure === "decode") {
      FakeImage.decodeBySrc.set(
        iconUrl,
        () => Promise.reject(new Error("icon decode failed"))
      );
    }
    if (failure === "dimensions") {
      FakeImage.dimensionsBySrc.set(iconUrl, { width: 3, height: 2 });
    }
    const requested = installNetwork(networkOptions);
    const repository = new LegacyAssetRepository(
      "/data/generated/legacy-assets.json",
      "/data/generated/tile-catalog.json",
      "/data/generated/build-info.json",
      "/atlas/official/official-tile-atlas.json"
    );

    const cells = [
      { x: 0, y: 0, xOffset: 0, yOffset: 0 },
      { x: 1, y: 0, xOffset: 1, yOffset: 0 },
      { x: 0, y: 1, xOffset: 0, yOffset: 1 },
      { x: 1, y: 1, xOffset: 1, yOffset: 1 }
    ].map((cell): TerrainCell => ({
      ...cell,
      uuid: officialUuid,
      rotation: 0,
      flags: 0,
      terrainType: "poi"
    }));
    const bundle = await repository.loadForCells(cells);
    const official = bundle.officialByUuid?.get(officialUuid);
    const [visual] = resolveTerrainVisuals(cells, bundle);

    expect(official?.image).toBeDefined();
    expect(official?.iconImage).toBeUndefined();
    expect(visual?.asset).toBeDefined();
    expect(visual?.overlayAsset).toBeUndefined();
    expect(requested).not.toContain(iconUrl);
  }
);

it("keeps terrain page failures fatal", async () => {
  installNetwork({ missingUrl: "/atlas/official/official-0.webp" });
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );

  await expect(repository.loadForCells([
    terrainCell(0, officialUuid)
  ])).rejects.toThrow(
    /official atlas page.*missing/i
  );
});

it("settles every metadata loader before failure cleanup and same-instance retry", async () => {
  let releaseCatalog!: () => void;
  const catalogDelay = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  const requested = installNetwork({
    missingUrl: "/data/generated/legacy-assets.json",
    delayedUrl: "/data/generated/tile-catalog.json",
    delayedUntil: catalogDelay
  });
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json",
    "/atlas/official/official-tile-atlas.json"
  );
  let settled = false;
  const pending = repository.loadForCells([]).then(
    () => {
      settled = true;
      return { status: "fulfilled" as const };
    },
    (reason: unknown) => {
      settled = true;
      return { status: "rejected" as const, reason };
    }
  );

  await vi.waitFor(() => expect(requested).toContain(
    "/data/generated/tile-catalog.json"
  ));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);

  releaseCatalog();
  const outcome = await pending;
  expect(outcome.status).toBe("rejected");
  expect(outcome).toMatchObject({
    reason: expect.objectContaining({
      message: expect.stringMatching(/unable to load legacy asset manifest/i)
    })
  });

  installNetwork();
  const retried = await repository.loadForCells([]);
  expect(retried.assets.size).toBe(0);
});

it("rejects missing or hash-mismatched planned assets", async () => {
  for (const [failure, uuid] of [
    [
      { missingUrl: assets[0]!.url },
      "20301000-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    ],
    [
      { alteredUrl: assets[1]!.url },
      "20302000-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    ]
  ] as const) {
    FakeImage.instances = [];
    const repository = new LegacyAssetRepository(
      "/data/generated/legacy-assets.json",
      "/data/generated/tile-catalog.json",
      "/data/generated/build-info.json"
    );
    installNetwork(failure);

    await expect(repository.loadForCells([
      terrainCell(0, uuid)
    ])).rejects.toThrow(/legacy asset/i);
    expect(
      FakeImage.instances.every((image) => image.src === "")
    ).toBe(true);
  }
});

it("rejects a build-info mismatch before starting any legacy image request", async () => {
  const documents = fixtureDocuments();
  const manifest = JSON.parse(
    documents["/data/generated/legacy-assets.json"]
  ) as Record<string, unknown>;
  documents["/data/generated/legacy-assets.json"] = JSON.stringify(
    withHash({ ...manifest, gameVersion: "1.0.1" })
  );
  const requested = installNetwork({ documents });
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json"
  );

  await expect(repository.loadForCells([])).rejects.toThrow(
    /integrity|build-info|mismatched game version/i
  );

  expect(requested.filter((url) => url.startsWith("/legacy/"))).toEqual([]);
});

it("waits for every planned image decode and clears the failed image source", async () => {
  installNetwork();
  let releaseFirst!: () => void;
  let rejectSecond!: (error: Error) => void;
  FakeImage.decodeImplementations = [
    () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    () =>
      new Promise<void>((_resolve, reject) => (rejectSecond = reject))
  ];
  const repository = new LegacyAssetRepository(
    "/data/generated/legacy-assets.json",
    "/data/generated/tile-catalog.json",
    "/data/generated/build-info.json"
  );

  const pending = repository.loadForCells([
    terrainCell(0, "20301000-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
    terrainCell(1, "20302000-bbbb-4ccc-8ddd-eeeeeeeeeeee")
  ]);
  await vi.waitFor(() =>
    expect(FakeImage.instances).toHaveLength(2)
  );
  rejectSecond(new Error("decode failed"));
  releaseFirst();
  await expect(pending).rejects.toThrow(/legacy asset/i);

  expect(FakeImage.instances[0]?.src).not.toBe("");
  expect(FakeImage.instances[1]?.src).toBe("");
});
