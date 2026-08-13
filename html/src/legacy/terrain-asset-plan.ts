import { compareCanonicalStrings } from "../shared/canonical-order";
import type {
  LegacyAssetRecord,
  LegacyBridgeEntry,
  LegacyPoiRule,
  OfficialTileAtlasEntry,
  TerrainCell
} from "./legacy-visual-types";

export interface TerrainAssetPlan {
  legacyKeys: readonly string[];
  officialPages: readonly string[];
  officialUuids: readonly string[];
}

type LegacyMultiCellPoiRule = Extract<
  LegacyPoiRule,
  { kind: "multi-cell-poi" }
>;

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function coveredRectangle(
  x: number,
  y: number,
  width: number,
  height: number
): string[] {
  const coordinates: string[] = [];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      coordinates.push(coordinateKey(column, row));
    }
  }
  return coordinates;
}

function resolvePoiRule(
  rules: readonly LegacyPoiRule[],
  cell: TerrainCell,
  legacyId: number | undefined
): LegacyMultiCellPoiRule | undefined {
  if (!cell.poiType) return undefined;
  const candidates = rules.filter(
    (rule): rule is LegacyMultiCellPoiRule =>
      rule.kind === "multi-cell-poi" && rule.poiType === cell.poiType
  );
  return (
    candidates.find(
      (rule) =>
        rule.coordinate?.x === cell.x
        && rule.coordinate.y === cell.y
        && (!rule.legacyIds || rule.legacyIds.includes(legacyId ?? Number.NaN))
    )
    ?? candidates.find(
      (rule) =>
        !rule.coordinate
        && rule.legacyIds?.includes(legacyId ?? Number.NaN)
    )
    ?? candidates.find((rule) => !rule.coordinate && !rule.legacyIds)
  );
}

function resolvePoiRegistrationRule(
  rules: readonly LegacyPoiRule[],
  poiType: string,
  legacyId: number | undefined
): LegacyMultiCellPoiRule | undefined {
  const candidates = rules.filter(
    (rule): rule is LegacyMultiCellPoiRule =>
      rule.kind === "multi-cell-poi" && rule.poiType === poiType
  );
  if (legacyId === undefined) {
    return candidates.find((rule) => !rule.coordinate && !rule.legacyIds);
  }
  return (
    candidates.find((rule) => rule.legacyIds?.includes(legacyId))
    ?? candidates.find((rule) => !rule.coordinate && !rule.legacyIds)
  );
}

function cellWithCatalogPoiType(
  cell: TerrainCell,
  poiByUuid: ReadonlyMap<string, string>
): TerrainCell {
  const poiType = cell.poiType ?? poiByUuid.get(cell.uuid.toLowerCase());
  return poiType && poiType !== cell.poiType ? { ...cell, poiType } : cell;
}

function isCompatiblePoiConstituent(
  rules: readonly LegacyPoiRule[],
  originRule: LegacyMultiCellPoiRule,
  originLegacyId: number | undefined,
  cell: TerrainCell,
  legacyId: number | undefined
): boolean {
  if (cell.poiType !== originRule.poiType) return false;
  const originRegistrationRule = resolvePoiRegistrationRule(
    rules,
    originRule.poiType,
    originLegacyId
  );
  const constituentRegistrationRule = resolvePoiRegistrationRule(
    rules,
    originRule.poiType,
    legacyId
  );
  if (
    originRule.poiType === "POI_CRASHSITE_AREA"
    && legacyId === 10104
    && originRegistrationRule !== undefined
  ) {
    return true;
  }
  return (
    originRegistrationRule !== undefined
    && originRegistrationRule.sizeCells === originRule.sizeCells
    && constituentRegistrationRule?.imageKey === originRegistrationRule.imageKey
    && constituentRegistrationRule.sizeCells === originRule.sizeCells
  );
}

function lowerCaseMap<T>(entries: ReadonlyMap<string, T>): Map<string, T> {
  return new Map(
    [...entries].map(([uuid, value]) => [uuid.toLowerCase(), value])
  );
}

export function planTerrainAssets(input: {
  cells: readonly TerrainCell[];
  legacyRecords: readonly LegacyAssetRecord[];
  bridgeByUuid: ReadonlyMap<string, LegacyBridgeEntry>;
  poiByUuid: ReadonlyMap<string, string>;
  poiRules: readonly LegacyPoiRule[];
  officialEntries: ReadonlyMap<string, OfficialTileAtlasEntry>;
  allowLegacyFallback?: boolean;
}): TerrainAssetPlan {
  const legacyKeys = new Set(input.legacyRecords.map((record) => record.key));
  const bridgeByUuid = lowerCaseMap(input.bridgeByUuid);
  const poiByUuid = lowerCaseMap(input.poiByUuid);
  const officialEntries = lowerCaseMap(input.officialEntries);
  const cellByCoordinate = new Map(
    input.cells.map((cell) => [coordinateKey(cell.x, cell.y), cell])
  );
  const selectedLegacyKeys = new Set<string>();
  const officialPages = new Set<string>();
  const officialUuids = new Set<string>();
  const covered = new Set<string>();
  const rowMajorCells = [...cellByCoordinate.values()].sort(
    (left, right) => left.y - right.y || left.x - right.x
  );

  for (const originalCell of rowMajorCells) {
    const key = coordinateKey(originalCell.x, originalCell.y);
    if (covered.has(key)) continue;

    const cell = cellWithCatalogPoiType(originalCell, poiByUuid);
    const uuid = cell.uuid.toLowerCase();
    const bridge = bridgeByUuid.get(uuid);
    const official = officialEntries.get(uuid);
    const preferredOfficialTerrain = official?.projection === "verified-orthographic"
      && official.renderMode === "terrain"
      ? official
      : undefined;
    if (preferredOfficialTerrain) {
      officialUuids.add(uuid);
      officialPages.add(preferredOfficialTerrain.page);
      covered.add(key);
      continue;
    }
    if (input.allowLegacyFallback === false) {
      if (official) {
        officialUuids.add(uuid);
        officialPages.add(official.page);
      }
      covered.add(key);
      continue;
    }
    const poiRule = resolvePoiRule(input.poiRules, cell, bridge?.legacyId);
    if (poiRule && legacyKeys.has(poiRule.imageKey)) {
      const poiCells = coveredRectangle(
        cell.x,
        cell.y,
        poiRule.sizeCells,
        poiRule.sizeCells
      );
      const isComplete = poiCells.every((coordinate) => {
        const constituent = cellByCoordinate.get(coordinate);
        const constituentBridge = constituent
          ? bridgeByUuid.get(constituent.uuid.toLowerCase())
          : undefined;
        return Boolean(
          constituent
          && isCompatiblePoiConstituent(
            input.poiRules,
            poiRule,
            bridge?.legacyId,
            cellWithCatalogPoiType(constituent, poiByUuid),
            constituentBridge?.legacyId
          )
        );
      });
      if (isComplete) {
        selectedLegacyKeys.add(poiRule.imageKey);
        for (const coordinate of poiCells) covered.add(coordinate);
        continue;
      }
    }

    const coordinateOverride = input.poiRules.find(
      (rule): rule is Extract<LegacyPoiRule, { kind: "coordinate-tile-override" }> =>
        rule.kind === "coordinate-tile-override"
        && rule.coordinate.x === cell.x
        && rule.coordinate.y === cell.y
    );
    if (coordinateOverride && legacyKeys.has(coordinateOverride.imageKey)) {
      const size = coordinateOverride.sizeCells ?? 1;
      const overrideCells = coveredRectangle(cell.x, cell.y, size, size);
      if (overrideCells.every((coordinate) => cellByCoordinate.has(coordinate))) {
        selectedLegacyKeys.add(coordinateOverride.imageKey);
        for (const coordinate of overrideCells) covered.add(coordinate);
        continue;
      }
    }

    const tileKey: LegacyAssetRecord["key"] | undefined = bridge
      ? `tile:${bridge.legacyId}`
      : undefined;
    if (tileKey && legacyKeys.has(tileKey)) {
      selectedLegacyKeys.add(tileKey);
      covered.add(key);
      continue;
    }

    if (official) {
      officialUuids.add(uuid);
      officialPages.add(official.page);
    }
    covered.add(key);
  }

  return {
    legacyKeys: [...selectedLegacyKeys].sort(compareCanonicalStrings),
    officialPages: [...officialPages].sort(compareCanonicalStrings),
    officialUuids: [...officialUuids].sort(compareCanonicalStrings)
  };
}
