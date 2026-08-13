import { expect, it } from "vitest";
import type {
  LegacyAssetRecord,
  LegacyBridgeEntry,
  LegacyPoiRule,
  OfficialTileAtlasEntry,
  PreloadedLegacyAsset,
  TerrainCell
} from "./legacy-visual-types";
import { resolveTerrainVisuals } from "./hybrid-terrain-resolver";
import { planTerrainAssets } from "./terrain-asset-plan";

function cell(
  x: number,
  y: number,
  uuid: string,
  poiType?: string
): TerrainCell {
  return {
    x,
    y,
    uuid,
    rotation: 0,
    xOffset: 0,
    yOffset: 0,
    flags: 0,
    terrainType: "meadow",
    ...(poiType ? { poiType } : {})
  };
}

function record(key: LegacyAssetRecord["key"]): LegacyAssetRecord {
  return {
    key,
    url: `/legacy/img/${key}.jpg`,
    width: 1,
    height: 1,
    sha256: "0".repeat(64),
    source: "the1killer/sm_overview"
  };
}

function bridge(uuid: string, legacyId: number): LegacyBridgeEntry {
  return {
    uuid,
    legacyId,
    tilePath: `Survival/Terrain/Tiles/${legacyId}.tile`,
    status: "active",
    evidence: "test"
  };
}

function official(uuid: string, page: string): OfficialTileAtlasEntry {
  return {
    uuid,
    page,
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    spanWidth: 1,
    spanHeight: 1,
    renderMode: "terrain",
    projection: "verified-orthographic"
  };
}

it("plans verified official 1.0 terrain before an overlapping legacy tile", () => {
  expect(planTerrainAssets({
    cells: [cell(0, 0, "shared-uuid")],
    legacyRecords: [record("tile:10105")],
    bridgeByUuid: new Map([
      ["shared-uuid", bridge("shared-uuid", 10105)]
    ]),
    poiByUuid: new Map(),
    poiRules: [],
    allowLegacyFallback: false,
    officialEntries: new Map([
      ["shared-uuid", official("shared-uuid", "orthographic-2.webp")]
    ])
  })).toEqual({
    legacyKeys: [],
    officialPages: ["orthographic-2.webp"],
    officialUuids: ["shared-uuid"]
  });
});

it("does not plan an old tile when official-only mode has no verified 1.0 terrain", () => {
  expect(planTerrainAssets({
    cells: [cell(0, 0, "legacy-only-uuid")],
    legacyRecords: [record("tile:10105")],
    bridgeByUuid: new Map([
      ["legacy-only-uuid", bridge("legacy-only-uuid", 10105)]
    ]),
    poiByUuid: new Map(),
    poiRules: [],
    officialEntries: new Map(),
    allowLegacyFallback: false
  })).toEqual({
    legacyKeys: [],
    officialPages: [],
    officialUuids: []
  });
});

it("plans deduplicated legacy keys and an official fallback deterministically", () => {
  const input = {
    cells: [
      cell(0, 0, "LEGACY-TILE-UUID"),
      cell(1, 0, "legacy-tile-uuid"),
      cell(2, 0, "warehouse-uuid"),
      cell(3, 0, "official-only-uuid")
    ],
    legacyRecords: [record("tile:10105"), record("poi:warehouse")],
    bridgeByUuid: new Map([
      ["legacy-tile-uuid", bridge("legacy-tile-uuid", 10105)],
      ["warehouse-uuid", bridge("warehouse-uuid", 10901)]
    ]),
    poiByUuid: new Map([["warehouse-uuid", "warehouse"]]),
    poiRules: [{
      kind: "multi-cell-poi",
      poiType: "warehouse",
      imageKey: "poi:warehouse",
      sizeCells: 1
    }] satisfies LegacyPoiRule[],
    officialEntries: new Map([
      ["official-only-uuid", official("official-only-uuid", "orthographic-2.webp")]
    ])
  };

  expect(planTerrainAssets(input)).toEqual({
    legacyKeys: ["poi:warehouse", "tile:10105"],
    officialPages: ["orthographic-2.webp"],
    officialUuids: ["official-only-uuid"]
  });
});

it("includes a manifest-backed coordinate override", () => {
  expect(planTerrainAssets({
    cells: [cell(-37, -39, "coordinate-uuid")],
    legacyRecords: [record("poi:warehouse")],
    bridgeByUuid: new Map([["coordinate-uuid", bridge("coordinate-uuid", 99999)]]),
    poiByUuid: new Map(),
    poiRules: [{
      kind: "coordinate-tile-override",
      imageKey: "poi:warehouse",
      coordinate: { x: -37, y: -39 }
    }],
    officialEntries: new Map()
  })).toEqual({
    legacyKeys: ["poi:warehouse"],
    officialPages: [],
    officialUuids: []
  });
});

it("prefers a coordinate override to a manifest-backed tile", () => {
  expect(planTerrainAssets({
    cells: [cell(-37, -39, "coordinate-uuid")],
    legacyRecords: [record("poi:warehouse"), record("tile:10105")],
    bridgeByUuid: new Map([
      ["coordinate-uuid", bridge("coordinate-uuid", 10105)]
    ]),
    poiByUuid: new Map(),
    poiRules: [{
      kind: "coordinate-tile-override",
      imageKey: "poi:warehouse",
      coordinate: { x: -37, y: -39 }
    }],
    officialEntries: new Map()
  })).toEqual({
    legacyKeys: ["poi:warehouse"],
    officialPages: [],
    officialUuids: []
  });
});

it("matches the resolver's multi-cell coordinate override coverage", () => {
  const cells = [
    cell(10, 10, "override-origin"),
    cell(11, 10, "ordinary-tile"),
    cell(10, 11, "ordinary-tile"),
    cell(11, 11, "ordinary-tile")
  ];
  const tileRecord = record("tile:10105");
  const overrideRecord = record("poi:warehouse");
  const bridgeByUuid = new Map([
    ["ordinary-tile", bridge("ordinary-tile", 10105)]
  ]);
  const overrideRule = {
    kind: "coordinate-tile-override",
    imageKey: "poi:warehouse",
    coordinate: { x: 10, y: 10 },
    sizeCells: 2
  } as const satisfies LegacyPoiRule;
  const assets = new Map<string, PreloadedLegacyAsset>([
    [tileRecord.key, { record: tileRecord, image: {} as HTMLImageElement }],
    [overrideRecord.key, {
      record: overrideRecord,
      image: {} as HTMLImageElement
    }]
  ]);

  expect(planTerrainAssets({
    cells,
    legacyRecords: [tileRecord, overrideRecord],
    bridgeByUuid,
    poiByUuid: new Map(),
    poiRules: [overrideRule],
    officialEntries: new Map()
  })).toEqual({
    legacyKeys: ["poi:warehouse"],
    officialPages: [],
    officialUuids: []
  });
  expect(resolveTerrainVisuals(cells, {
    assets,
    bridgeByUuid,
    poiRules: [overrideRule]
  })).toMatchObject([{
    source: "legacy-poi",
    asset: { record: { key: "poi:warehouse" } },
    coveredCells: ["10,10", "11,10", "10,11", "11,11"]
  }]);
});

it("matches the resolver's crashsite 10104 constituent exception", () => {
  const crashsiteRule = {
    kind: "multi-cell-poi",
    poiType: "POI_CRASHSITE_AREA",
    legacyIds: [10101],
    imageKey: "poi:crashsite",
    sizeCells: 2
  } as const satisfies LegacyPoiRule;
  const cells = [
    cell(10, 10, "crash-origin"),
    cell(11, 10, "crash-constituent-a"),
    cell(10, 11, "crash-constituent-b"),
    cell(11, 11, "crash-constituent-c")
  ];
  const bridgeByUuid = new Map([
    ["crash-origin", bridge("crash-origin", 10101)],
    ["crash-constituent-a", bridge("crash-constituent-a", 10104)],
    ["crash-constituent-b", bridge("crash-constituent-b", 10104)],
    ["crash-constituent-c", bridge("crash-constituent-c", 10104)]
  ]);
  const poiByUuid = new Map(cells.map(({ uuid }) => [
    uuid,
    "POI_CRASHSITE_AREA"
  ]));
  const crashsiteRecord = record("poi:crashsite");
  const assets = new Map<string, PreloadedLegacyAsset>([[
    crashsiteRecord.key,
    { record: crashsiteRecord, image: {} as HTMLImageElement }
  ]]);

  expect(planTerrainAssets({
    cells,
    legacyRecords: [crashsiteRecord],
    bridgeByUuid,
    poiByUuid,
    poiRules: [crashsiteRule],
    officialEntries: new Map()
  })).toEqual({
    legacyKeys: ["poi:crashsite"],
    officialPages: [],
    officialUuids: []
  });
  expect(resolveTerrainVisuals(cells, {
    assets,
    bridgeByUuid,
    poiByUuid,
    poiRules: [crashsiteRule]
  })).toMatchObject([{
    source: "legacy-poi",
    asset: { record: { key: "poi:crashsite" } },
    coveredCells: ["10,10", "11,10", "10,11", "11,11"]
  }]);
});

it("deduplicates an official page shared by several UUIDs", () => {
  expect(planTerrainAssets({
    cells: [cell(0, 0, "OFFICIAL-A"), cell(1, 0, "official-b")],
    legacyRecords: [],
    bridgeByUuid: new Map(),
    poiByUuid: new Map(),
    poiRules: [],
    officialEntries: new Map([
      ["official-a", official("official-a", "orthographic-2.webp")],
      ["official-b", official("official-b", "orthographic-2.webp")]
    ])
  })).toEqual({
    legacyKeys: [],
    officialPages: ["orthographic-2.webp"],
    officialUuids: ["official-a", "official-b"]
  });
});
