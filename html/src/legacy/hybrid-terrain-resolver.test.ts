import { expect, it, vi } from "vitest";
import type { TerrainCell } from "../domain/map-model";
import { resolveTerrainVisuals } from "./hybrid-terrain-resolver";
import type {
  LegacyAssetBundle,
  PreloadedLegacyAsset
} from "./legacy-visual-types";

const meadowUuid = "54b1f04b-de02-4e82-bf2b-f2d7ef163356";
const mechanicUuid = "2c36976b-e008-408c-a5b5-1baaaf01df04";
const oneDotZeroUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const unknownUuid = "10000010-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const crashUuid = "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeee4";
const crashVariantUuid = "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeee5";

function asset(
  key: `tile:${number}` | `poi:${string}`
): PreloadedLegacyAsset {
  return {
    record: {
      key,
      url: `/legacy/img/${key.replace(":", "/")}.jpg`,
      width: 2,
      height: 2,
      sha256: "0".repeat(64),
      source: "the1killer/sm_overview"
    },
    image: {} as HTMLImageElement
  };
}

function bundle(): LegacyAssetBundle {
  return {
    assets: new Map([
      ["tile:1000001", asset("tile:1000001")],
      [
        "poi:mechanic_station.png",
        asset("poi:mechanic_station.png")
      ],
      ["poi:start_crashsite1.jpg", asset("poi:start_crashsite1.jpg")],
      [
        "poi:start_crashsite_-37_-39.jpg",
        asset("poi:start_crashsite_-37_-39.jpg")
      ],
      [
        "poi:start_crashsite_-37_-40.jpg",
        asset("poi:start_crashsite_-37_-40.jpg")
      ],
      [
        "poi:start_crashsite_-36_-40.jpg",
        asset("poi:start_crashsite_-36_-40.jpg")
      ],
      [
        "poi:start_crashsite_-36_-41.jpg",
        asset("poi:start_crashsite_-36_-41.jpg")
      ]
    ]),
    bridgeByUuid: new Map([
      [
        meadowUuid,
        {
          legacyId: 1000001,
          uuid: meadowUuid,
          tilePath: "Survival/Terrain/Tiles/meadow.tile",
          status: "active",
          evidence: "Survival/Scripts/terrain/meadow.lua:AddTile"
        }
      ],
      [
        mechanicUuid,
        {
          legacyId: 10901,
          uuid: mechanicUuid,
          tilePath: "Survival/Terrain/Tiles/mechanic.tile",
          status: "active",
          evidence: "Survival/Scripts/terrain/poi.lua:addPoiTileLegacy"
        }
      ],
      [
        oneDotZeroUuid,
        {
          legacyId: 9999999,
          uuid: oneDotZeroUuid,
          tilePath: "Survival/Terrain/Tiles/one-dot-zero.tile",
          status: "active",
          evidence: "Survival/Scripts/terrain/new.lua:AddTile"
        }
      ],
      [
        crashUuid,
        {
          legacyId: 10101,
          uuid: crashUuid,
          tilePath: "Survival/Terrain/Tiles/crash.tile",
          status: "active",
          evidence: "Survival/Scripts/terrain/poi.lua:addPoiTileLegacy"
        }
      ]
    ]),
    poiRules: [
      {
        kind: "multi-cell-poi",
        poiType: "POI_MECHANICSTATION_MEDIUM",
        imageKey: "poi:mechanic_station.png",
        sizeCells: 2
      },
      {
        kind: "multi-cell-poi",
        poiType: "POI_CRASHSITE_AREA",
        legacyIds: [10101],
        imageKey: "poi:start_crashsite1.jpg",
        sizeCells: 2,
        coordinate: { x: -38, y: -42 }
      },
      ...[
        [-37, -39, "poi:start_crashsite_-37_-39.jpg"],
        [-37, -40, "poi:start_crashsite_-37_-40.jpg"],
        [-36, -40, "poi:start_crashsite_-36_-40.jpg"],
        [-36, -41, "poi:start_crashsite_-36_-41.jpg"]
      ].map(([x, y, imageKey]) => ({
        kind: "coordinate-tile-override" as const,
        imageKey: imageKey as `poi:${string}`,
        coordinate: { x: x as number, y: y as number }
      }))
    ]
  };
}

it("uses the trusted catalog POI classification when reference cells omit it", () => {
  const testBundle = bundle();
  testBundle.poiByUuid = new Map([
    [mechanicUuid, "POI_MECHANICSTATION_MEDIUM"]
  ]);
  const cells = poiRectangle(
    10,
    10,
    mechanicUuid,
    0,
    "poi",
    "POI_MECHANICSTATION_MEDIUM"
  ).map(({ poiType: _poiType, ...cellWithoutPoi }) => cellWithoutPoi);

  expect(resolveTerrainVisuals(cells, testBundle)).toMatchObject([{
    source: "legacy-poi",
    asset: { record: { key: "poi:mechanic_station.png" } },
    coveredCells: ["10,10", "11,10", "10,11", "11,11"]
  }]);
});

it("does not use an unverified official atlas sprite as terrain", () => {
  const testBundle = bundle();
  testBundle.officialByUuid = new Map([
    [oneDotZeroUuid, {
      entry: {
        uuid: oneDotZeroUuid,
        page: "official-0.webp",
        x: 256,
        y: 512,
        width: 256,
        height: 256,
        spanWidth: 2,
        spanHeight: 2,
        renderMode: "terrain"
      },
      image: {} as HTMLImageElement
    }]
  ]);
  const target = cell(4, 7, oneDotZeroUuid, 1, "forest");
  target.xOffset = 1;
  target.yOffset = 0;

  const [visual] = resolveTerrainVisuals([target], testBundle);

  expect(visual).toEqual(expect.objectContaining({
    source: "one-dot-zero-fallback",
    coveredCells: ["4,7"]
  }));
  expect(visual?.asset).toBeUndefined();
  expect(visual?.overlayAsset).toBeUndefined();
});

it("uses an official atlas sprite explicitly verified as orthographic terrain", () => {
  const testBundle = bundle();
  testBundle.officialByUuid = new Map([
    [oneDotZeroUuid, {
      entry: {
        uuid: oneDotZeroUuid,
        page: "official-0.webp",
        x: 256,
        y: 512,
        width: 256,
        height: 256,
        spanWidth: 2,
        spanHeight: 2,
        renderMode: "terrain",
        projection: "verified-orthographic"
      },
      image: {} as HTMLImageElement
    }]
  ]);
  const target = cell(4, 7, oneDotZeroUuid, 1, "forest");
  target.xOffset = 1;
  target.yOffset = 0;

  const [visual] = resolveTerrainVisuals([target], testBundle);

  expect(visual).toEqual(expect.objectContaining({
    source: "one-dot-zero-tile",
    asset: expect.objectContaining({
      sourceRect: { x: 384, y: 512, width: 128, height: 128 }
    }),
    coveredCells: ["4,7"]
  }));
});

it("uses verified official 1.0 terrain before an overlapping legacy tile", () => {
  const testBundle = bundle();
  const verifiedImage = {} as HTMLImageElement;
  testBundle.officialByUuid = new Map([[meadowUuid, {
    entry: {
      uuid: meadowUuid,
      page: "orthographic-0.webp",
      x: 32,
      y: 64,
      width: 256,
      height: 256,
      spanWidth: 1,
      spanHeight: 1,
      renderMode: "terrain",
      projection: "verified-orthographic"
    },
    image: verifiedImage
  }]]);

  const [visual] = resolveTerrainVisuals([
    cell(0, 0, meadowUuid, 0, "meadow")
  ], testBundle);

  expect(visual).toEqual(expect.objectContaining({
    source: "one-dot-zero-tile",
    asset: expect.objectContaining({
      image: verifiedImage
    })
  }));
});

it("keeps a complete isometric structure as fallback terrain with a small optional icon", () => {
  const terrainImage = {} as HTMLImageElement;
  const iconImage = {} as HTMLImageElement;
  const testBundle = bundle();
  testBundle.officialByUuid = new Map([
    [oneDotZeroUuid, {
      entry: {
        uuid: oneDotZeroUuid,
        page: "official-0.webp",
        x: 256,
        y: 512,
        width: 256,
        height: 256,
        spanWidth: 2,
        spanHeight: 2,
        renderMode: "isometric-thumbnail",
        icon: {
          page: "official-icons-0.webp",
          x: 256,
          y: 512,
          width: 256,
          height: 256
        }
      },
      image: terrainImage,
      iconImage
    }]
  ]);
  const cells = [
    cell(10, 20, oneDotZeroUuid, 1, "dungeon"),
    cell(10, 21, oneDotZeroUuid, 1, "dungeon"),
    cell(11, 20, oneDotZeroUuid, 1, "dungeon"),
    cell(11, 21, oneDotZeroUuid, 1, "dungeon")
  ];
  [
    [cells[0], 0, 1],
    [cells[1], 1, 1],
    [cells[2], 0, 0],
    [cells[3], 1, 0]
  ].forEach(([target, xOffset, yOffset]) => {
    (target as TerrainCell).xOffset = xOffset as number;
    (target as TerrainCell).yOffset = yOffset as number;
  });

  expect(resolveTerrainVisuals(cells, testBundle)).toEqual([
    expect.objectContaining({
      origin: { x: 10, y: 21 },
      span: { width: 2, height: 2 },
      rotation: 1,
      source: "one-dot-zero-fallback",
      coveredCells: ["10,20", "11,20", "10,21", "11,21"],
      overlayAsset: expect.objectContaining({
        image: iconImage,
        sourceRect: {
          page: "official-icons-0.webp",
          x: 256,
          y: 512,
          width: 256,
          height: 256
        }
      })
    })
  ]);
  expect(resolveTerrainVisuals(cells, testBundle)[0]?.asset).toBeUndefined();
});

it("falls back instead of fragmenting an incomplete isometric thumbnail", () => {
  const testBundle = bundle();
  testBundle.officialByUuid = new Map([
    [oneDotZeroUuid, {
      entry: {
        uuid: oneDotZeroUuid,
        page: "official-0.webp",
        x: 256,
        y: 512,
        width: 256,
        height: 256,
        spanWidth: 2,
        spanHeight: 2,
        renderMode: "isometric-thumbnail"
      },
      image: {} as HTMLImageElement
    }]
  ]);

  expect(resolveTerrainVisuals([
    cell(4, 7, oneDotZeroUuid, 0, "forest")
  ], testBundle)).toEqual([
    expect.objectContaining({
      source: "one-dot-zero-fallback",
      coveredCells: ["4,7"]
    })
  ]);
});

function cell(
  x: number,
  y: number,
  uuid: string,
  rotation: 0 | 1 | 2 | 3,
  terrainType: string,
  poiType?: string
): TerrainCell {
  return {
    x,
    y,
    uuid,
    rotation,
    xOffset: 0,
    yOffset: 0,
    flags: 0,
    terrainType,
    ...(poiType ? { poiType } : {})
  };
}

function poiRectangle(
  x: number,
  y: number,
  uuid: string,
  rotation: 0 | 1 | 2 | 3,
  terrainType: string,
  poiType: string
): TerrainCell[] {
  return [
    cell(x, y, uuid, rotation, terrainType, poiType),
    cell(x + 1, y, uuid, 0, terrainType, poiType),
    cell(x, y + 1, uuid, 0, terrainType, poiType),
    cell(x + 1, y + 1, uuid, 0, terrainType, poiType)
  ];
}

it("uses only the official UUID bridge, groups POI coverage once, and preserves coordinates and rotation", () => {
  const cells = [
    cell(30, 0, unknownUuid, 3, "desert"),
    cell(11, 11, mechanicUuid, 0, "poi", "POI_MECHANICSTATION_MEDIUM"),
    cell(0, 0, meadowUuid.toUpperCase(), 2, "meadow"),
    cell(10, 10, mechanicUuid, 1, "poi", "POI_MECHANICSTATION_MEDIUM"),
    cell(20, 0, oneDotZeroUuid, 1, "forest"),
    cell(10, 11, mechanicUuid, 0, "poi", "POI_MECHANICSTATION_MEDIUM"),
    cell(11, 10, mechanicUuid, 0, "poi", "POI_MECHANICSTATION_MEDIUM")
  ];

  const visuals = resolveTerrainVisuals(cells, bundle());

  expect(visuals).toHaveLength(4);
  expect(visuals.map((visual) => visual.origin)).toEqual([
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
    { x: 10, y: 10 }
  ]);
  expect(visuals[0]).toMatchObject({
    rotation: 2,
    source: "legacy-tile",
    terrainType: "meadow",
    coveredCells: ["0,0"],
    asset: { record: { key: "tile:1000001" } }
  });
  expect(visuals[1]).toMatchObject({
    rotation: 1,
    source: "one-dot-zero-fallback",
    terrainType: "forest",
    coveredCells: ["20,0"]
  });
  expect(visuals[2]).toMatchObject({
    rotation: 3,
    source: "one-dot-zero-fallback",
    terrainType: "desert",
    coveredCells: ["30,0"]
  });
  expect(visuals[2]?.asset).toBeUndefined();
  expect(visuals[3]).toMatchObject({
    origin: { x: 10, y: 10 },
    span: { width: 2, height: 2 },
    rotation: 1,
    source: "legacy-poi",
    terrainType: "poi",
    coveredCells: ["10,10", "11,10", "10,11", "11,11"],
    asset: { record: { key: "poi:mechanic_station.png" } }
  });
});

it("uses a generic original POI image when the 1.0 UUID has no legacy bridge", () => {
  const cells = poiRectangle(
    10,
    10,
    unknownUuid,
    0,
    "meadow",
    "POI_MECHANICSTATION_MEDIUM"
  );

  expect(resolveTerrainVisuals(cells, bundle())).toEqual([
    expect.objectContaining({
      origin: { x: 10, y: 10 },
      span: { width: 2, height: 2 },
      source: "legacy-poi",
      coveredCells: ["10,10", "11,10", "10,11", "11,11"],
      asset: expect.objectContaining({
        record: expect.objectContaining({ key: "poi:mechanic_station.png" })
      })
    })
  ]);
});

it.each([
  [-38, -42, "poi:start_crashsite1.jpg", "legacy-poi", 2],
  [-37, -39, "poi:start_crashsite_-37_-39.jpg", "legacy-tile", 1],
  [-37, -40, "poi:start_crashsite_-37_-40.jpg", "legacy-tile", 1],
  [-36, -40, "poi:start_crashsite_-36_-40.jpg", "legacy-tile", 1],
  [-36, -41, "poi:start_crashsite_-36_-41.jpg", "legacy-tile", 1]
] as const)(
  "selects the original crash-site image with authoritative coverage at %i,%i",
  (x, y, imageKey, source, span) => {
    const [visual] = resolveTerrainVisuals(
      poiRectangle(
        x,
        y,
        crashUuid,
        3,
        "crash-site",
        "POI_CRASHSITE_AREA"
      ),
      bundle()
    );

    expect(visual).toMatchObject({
      origin: { x, y },
      span: { width: span, height: span },
      rotation: 3,
      source,
      coveredCells: span === 1
        ? [`${x},${y}`]
        : [`${x},${y}`, `${x + 1},${y}`, `${x},${y + 1}`, `${x + 1},${y + 1}`],
      asset: { record: { key: imageKey } }
    });
  }
);

it("does not let adjacent crash-site single-cell overrides swallow their neighbors", () => {
  const visuals = resolveTerrainVisuals(
    [
      cell(-37, -40, crashUuid, 0, "crash-site", "POI_CRASHSITE_AREA"),
      cell(-36, -40, crashUuid, 1, "crash-site", "POI_CRASHSITE_AREA"),
      cell(-35, -40, crashUuid, 2, "crash-site", "POI_CRASHSITE_AREA"),
      cell(-37, -39, crashUuid, 3, "crash-site", "POI_CRASHSITE_AREA"),
      cell(-36, -39, crashUuid, 0, "crash-site", "POI_CRASHSITE_AREA")
    ],
    bundle()
  );

  expect(
    visuals.map((visual) => ({
      origin: visual.origin,
      span: visual.span,
      source: visual.source,
      image: visual.asset?.record.key
    }))
  ).toEqual([
    {
      origin: { x: -37, y: -40 },
      span: { width: 1, height: 1 },
      source: "legacy-tile",
      image: "poi:start_crashsite_-37_-40.jpg"
    },
    {
      origin: { x: -36, y: -40 },
      span: { width: 1, height: 1 },
      source: "legacy-tile",
      image: "poi:start_crashsite_-36_-40.jpg"
    },
    {
      origin: { x: -35, y: -40 },
      span: { width: 1, height: 1 },
      source: "one-dot-zero-fallback",
      image: undefined
    },
    {
      origin: { x: -37, y: -39 },
      span: { width: 1, height: 1 },
      source: "legacy-tile",
      image: "poi:start_crashsite_-37_-39.jpg"
    },
    {
      origin: { x: -36, y: -39 },
      span: { width: 1, height: 1 },
      source: "one-dot-zero-fallback",
      image: undefined
    }
  ]);
});

it("uses the ordinary fallback path next to a crash-site coordinate exception", () => {
  const [visual] = resolveTerrainVisuals(
    [
      cell(
        -35,
        -41,
        crashUuid,
        2,
        "crash-site",
        "POI_CRASHSITE_AREA"
      )
    ],
    bundle()
  );

  expect(visual).toMatchObject({
    origin: { x: -35, y: -41 },
    span: { width: 1, height: 1 },
    rotation: 2,
    source: "one-dot-zero-fallback",
    terrainType: "crash-site",
    coveredCells: ["-35,-41"]
  });
  expect(visual?.asset).toBeUndefined();
});

it("does not emit a POI visual when one rectangular constituent cell is missing", () => {
  const incomplete = poiRectangle(
    10,
    10,
    mechanicUuid,
    1,
    "poi",
    "POI_MECHANICSTATION_MEDIUM"
  ).slice(0, 3);

  const visuals = resolveTerrainVisuals(incomplete, bundle());

  expect(visuals).toHaveLength(3);
  expect(visuals.every((visual) => visual.source !== "legacy-poi")).toBe(true);
  expect(visuals.map((visual) => visual.origin)).toEqual([
    { x: 10, y: 10 },
    { x: 11, y: 10 },
    { x: 10, y: 11 }
  ]);
});

it("does not suppress an unrelated terrain cell inside a claimed POI rectangle", () => {
  const mixed = poiRectangle(
    10,
    10,
    mechanicUuid,
    1,
    "poi",
    "POI_MECHANICSTATION_MEDIUM"
  );
  mixed[1] = cell(11, 10, meadowUuid, 2, "meadow");

  const visuals = resolveTerrainVisuals(mixed, bundle());

  expect(visuals).toHaveLength(4);
  expect(visuals.every((visual) => visual.source !== "legacy-poi")).toBe(true);
  expect(visuals.find((visual) => visual.origin.x === 11 && visual.origin.y === 10)).toMatchObject({
    source: "legacy-tile",
    rotation: 2,
    terrainType: "meadow",
    asset: { record: { key: "tile:1000001" } }
  });
});

it("rejects a same-type constituent whose official legacy registration selects a different POI rule", () => {
  const shared = bundle();
  shared.poiRules = [
    {
      kind: "multi-cell-poi",
      poiType: "POI_MECHANICSTATION_MEDIUM",
      legacyIds: [1000001],
      imageKey: "poi:start_crashsite1.jpg",
      sizeCells: 2
    },
    ...shared.poiRules
  ];
  const mixed = poiRectangle(
    10,
    10,
    mechanicUuid,
    1,
    "poi",
    "POI_MECHANICSTATION_MEDIUM"
  );
  mixed[1] = cell(
    11,
    10,
    meadowUuid,
    2,
    "poi",
    "POI_MECHANICSTATION_MEDIUM"
  );

  const visuals = resolveTerrainVisuals(mixed, shared);

  expect(visuals).toHaveLength(4);
  expect(visuals.every((visual) => visual.source !== "legacy-poi")).toBe(true);
  expect(
    visuals.find(
      (visual) => visual.origin.x === 11 && visual.origin.y === 10
    )
  ).toMatchObject({
    source: "legacy-tile",
    asset: { record: { key: "tile:1000001" } }
  });
});

it("does not let a coordinate-specific POI suppress a constituent whose official registration selects a different image", () => {
  const shared = bundle();
  shared.bridgeByUuid = new Map([
    ...shared.bridgeByUuid,
    [
      crashVariantUuid,
      {
        legacyId: 10102,
        uuid: crashVariantUuid,
        tilePath: "Survival/Terrain/Tiles/crash-variant.tile",
        status: "active",
        evidence: "Survival/Scripts/terrain/poi.lua:addPoiTileLegacy"
      }
    ]
  ]);
  const mixed = poiRectangle(
    -37,
    -39,
    crashUuid,
    3,
    "crash-site",
    "POI_CRASHSITE_AREA"
  );
  mixed[1] = cell(
    -36,
    -39,
    crashVariantUuid,
    2,
    "crash-site",
    "POI_CRASHSITE_AREA"
  );

  const visuals = resolveTerrainVisuals(mixed, shared);

  expect(visuals).toHaveLength(4);
  expect(visuals.every((visual) => visual.source !== "legacy-poi")).toBe(true);
  expect(
    visuals.find(
      (visual) => visual.origin.x === -36 && visual.origin.y === -39
    )
  ).toMatchObject({
    source: "one-dot-zero-fallback",
    rotation: 2,
    terrainType: "crash-site",
    coveredCells: ["-36,-39"]
  });
});

it("resolves different layouts after one preload without issuing any request", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const shared = bundle();

  resolveTerrainVisuals(
    [cell(0, 0, meadowUuid, 0, "meadow")],
    shared
  );
  resolveTerrainVisuals(
    [cell(99, -20, unknownUuid, 1, "forest")],
    shared
  );

  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
