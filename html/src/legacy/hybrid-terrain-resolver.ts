import type {
  LegacyAssetBundle,
  LegacyMultiCellPoiRule,
  LegacyPoiRule,
  ResolvedTerrainVisual,
  TerrainCell
} from "./legacy-visual-types";

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function withCatalogPoiType(
  cell: TerrainCell,
  bundle: LegacyAssetBundle
): TerrainCell {
  const poiType = cell.poiType
    ?? bundle.poiByUuid?.get(cell.uuid.toLowerCase());
  return poiType && poiType !== cell.poiType ? { ...cell, poiType } : cell;
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
        rule.coordinate?.x === cell.x &&
        rule.coordinate.y === cell.y &&
        (!rule.legacyIds || rule.legacyIds.includes(legacyId ?? Number.NaN))
    ) ??
    candidates.find(
      (rule) =>
        !rule.coordinate &&
        rule.legacyIds?.includes(legacyId ?? Number.NaN)
    ) ??
    candidates.find((rule) => !rule.coordinate && !rule.legacyIds)
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
    return candidates.find(
      (rule) => !rule.coordinate && !rule.legacyIds
    );
  }
  return (
    candidates.find((rule) => rule.legacyIds?.includes(legacyId)) ??
    candidates.find((rule) => !rule.coordinate && !rule.legacyIds)
  );
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
    originRegistrationRule !== undefined &&
    originRegistrationRule.sizeCells === originRule.sizeCells &&
    constituentRegistrationRule?.imageKey ===
      originRegistrationRule.imageKey &&
    constituentRegistrationRule.sizeCells === originRule.sizeCells
  );
}

function coveredRectangle(
  x: number,
  y: number,
  width: number,
  height: number
): string[] {
  const result: string[] = [];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      result.push(coordinateKey(column, row));
    }
  }
  return result;
}

function officialInstanceBounds(
  cell: TerrainCell,
  width: number,
  height: number
): { minX: number; minY: number; width: number; height: number } {
  if (cell.rotation === 0) {
    return {
      minX: cell.x - cell.xOffset,
      minY: cell.y - cell.yOffset,
      width,
      height
    };
  }
  if (cell.rotation === 1) {
    return {
      minX: cell.x - (height - 1 - cell.yOffset),
      minY: cell.y - cell.xOffset,
      width: height,
      height: width
    };
  }
  if (cell.rotation === 2) {
    return {
      minX: cell.x - (width - 1 - cell.xOffset),
      minY: cell.y - (height - 1 - cell.yOffset),
      width,
      height
    };
  }
  return {
    minX: cell.x - cell.yOffset,
    minY: cell.y - (width - 1 - cell.xOffset),
    width: height,
    height: width
  };
}

export function resolveTerrainVisuals(
  cells: readonly TerrainCell[],
  bundle: LegacyAssetBundle
): ResolvedTerrainVisual[] {
  const cellByCoordinate = new Map(
    cells.map((cell) => [coordinateKey(cell.x, cell.y), cell])
  );
  const covered = new Set<string>();
  const bridgeByUuid = new Map(
    [...bundle.bridgeByUuid].map(([uuid, entry]) => [uuid.toLowerCase(), entry])
  );
  const rowMajor = [...cellByCoordinate.values()].sort(
    (left, right) => left.y - right.y || left.x - right.x
  );
  const visuals: ResolvedTerrainVisual[] = [];

  for (const cell of rowMajor) {
    const key = coordinateKey(cell.x, cell.y);
    if (covered.has(key)) continue;

    const classifiedCell = withCatalogPoiType(cell, bundle);

    const bridge = bridgeByUuid.get(cell.uuid.toLowerCase());
    const official = bundle.officialByUuid?.get(cell.uuid.toLowerCase());
    const officialTerrain = official?.entry.projection === "verified-orthographic"
      ? official
      : undefined;
    const officialRenderMode = official?.entry.renderMode ?? "terrain";
    const preferredOfficialTerrain = officialTerrain
      && officialRenderMode === "terrain";
    const poiRule = resolvePoiRule(
      bundle.poiRules,
      classifiedCell,
      bridge?.legacyId
    );
    const poiAsset = poiRule
      ? bundle.assets.get(poiRule.imageKey)
      : undefined;
    if (!preferredOfficialTerrain && poiRule && poiAsset) {
      const coveredCells = coveredRectangle(
        cell.x,
        cell.y,
        poiRule.sizeCells,
        poiRule.sizeCells
      );
      const hasCompatibleRectangle = coveredCells.every((coordinate) => {
        const constituent = cellByCoordinate.get(coordinate);
        const constituentBridge = constituent
          ? bridgeByUuid.get(constituent.uuid.toLowerCase())
          : undefined;
        return Boolean(
          constituent &&
            isCompatiblePoiConstituent(
              bundle.poiRules,
              poiRule,
              bridge?.legacyId,
              withCatalogPoiType(constituent, bundle),
              constituentBridge?.legacyId
            )
        );
      });
      if (hasCompatibleRectangle) {
        for (const coordinate of coveredCells) covered.add(coordinate);
        visuals.push({
          origin: { x: cell.x, y: cell.y },
          span: { width: poiRule.sizeCells, height: poiRule.sizeCells },
          rotation: cell.rotation,
          source: "legacy-poi",
          asset: poiAsset,
          terrainType: cell.terrainType,
          coveredCells
        });
        continue;
      }
    }

    const tileAsset = !preferredOfficialTerrain && bridge
      ? bundle.assets.get(`tile:${bridge.legacyId}`)
      : undefined;
    const coordinateOverride = bundle.poiRules.find(
      (rule): rule is Extract<LegacyPoiRule, { kind: "coordinate-tile-override" }> =>
        rule.kind === "coordinate-tile-override"
        && rule.coordinate.x === cell.x
        && rule.coordinate.y === cell.y
    );
    const overrideAsset = coordinateOverride
      ? bundle.assets.get(coordinateOverride.imageKey)
      : undefined;
    const overrideSize = coordinateOverride?.sizeCells ?? 1;
    if (!preferredOfficialTerrain && coordinateOverride && overrideAsset) {
      const overrideCells = coveredRectangle(
        cell.x,
        cell.y,
        overrideSize,
        overrideSize
      );
      if (overrideCells.every((coordinate) => cellByCoordinate.has(coordinate))) {
        for (const coordinate of overrideCells) covered.add(coordinate);
        visuals.push({
          origin: { x: cell.x, y: cell.y },
          span: { width: overrideSize, height: overrideSize },
          rotation: coordinateOverride.worldAligned ? 0 : cell.rotation,
          source: overrideSize === 1 ? "legacy-tile" : "legacy-poi",
          asset: overrideAsset,
          terrainType: cell.terrainType,
          coveredCells: overrideCells
        });
        continue;
      }
    }
    const ordinaryAsset = tileAsset;
    const groupedOfficial = !ordinaryAsset ? official : undefined;
    if (groupedOfficial) {
      const bounds = officialInstanceBounds(
        cell,
        groupedOfficial.entry.spanWidth,
        groupedOfficial.entry.spanHeight
      );
      const instanceCells = coveredRectangle(
        bounds.minX,
        bounds.minY,
        bounds.width,
        bounds.height
      );
      const completeInstance = instanceCells.every((coordinate) => {
        const constituent = cellByCoordinate.get(coordinate);
        if (
          !constituent
          || constituent.uuid.toLowerCase() !== cell.uuid.toLowerCase()
          || constituent.rotation !== cell.rotation
        ) {
          return false;
        }
        const constituentBounds = officialInstanceBounds(
          constituent,
          groupedOfficial.entry.spanWidth,
          groupedOfficial.entry.spanHeight
        );
        return constituentBounds.minX === bounds.minX
          && constituentBounds.minY === bounds.minY;
      });
      if (completeInstance) {
        for (const coordinate of instanceCells) covered.add(coordinate);
        const officialRecord = {
          key: `poi:official-${groupedOfficial.entry.uuid}` as `poi:${string}`,
          url: `/atlas/official/${groupedOfficial.entry.page}`,
          width: groupedOfficial.entry.width,
          height: groupedOfficial.entry.height,
          sha256: "0".repeat(64),
          source: "the1killer/sm_overview" as const
        };
        const verifiedTerrainAsset = officialTerrain
          && officialRenderMode === "terrain"
          ? {
              record: officialRecord,
              image: officialTerrain.image,
              sourceRect: {
                x: officialTerrain.entry.x,
                y: officialTerrain.entry.y,
                width: officialTerrain.entry.width,
                height: officialTerrain.entry.height
              }
            }
          : undefined;
        visuals.push({
          origin: {
            x: bounds.minX,
            y: bounds.minY + bounds.height - 1
          },
          span: { width: bounds.width, height: bounds.height },
          rotation: cell.rotation,
          source: verifiedTerrainAsset
            ? "one-dot-zero-tile"
            : "one-dot-zero-fallback",
          ...(verifiedTerrainAsset ? { asset: verifiedTerrainAsset } : {}),
          overlayAsset: groupedOfficial.iconImage && groupedOfficial.entry.icon
            ? {
                record: officialRecord,
                image: groupedOfficial.iconImage,
                sourceRect: groupedOfficial.entry.icon
              }
            : undefined,
          terrainType: cell.terrainType,
          coveredCells: instanceCells
        });
        continue;
      }
    }
    covered.add(key);
    const officialAsset = !ordinaryAsset
      && officialTerrain
      && officialRenderMode === "terrain"
      ? {
          record: {
            key: `poi:official-${officialTerrain.entry.uuid}` as `poi:${string}`,
            url: `/atlas/official/${officialTerrain.entry.page}`,
            width: officialTerrain.entry.width,
            height: officialTerrain.entry.height,
            sha256: "0".repeat(64),
            source: "the1killer/sm_overview" as const
          },
          image: officialTerrain.image,
          sourceRect: {
            x:
              officialTerrain.entry.x
              + cell.xOffset * officialTerrain.entry.width / officialTerrain.entry.spanWidth,
            y:
              officialTerrain.entry.y
              + cell.yOffset * officialTerrain.entry.height / officialTerrain.entry.spanHeight,
            width: officialTerrain.entry.width / officialTerrain.entry.spanWidth,
            height: officialTerrain.entry.height / officialTerrain.entry.spanHeight
          }
        }
      : undefined;
    const resolvedAsset = ordinaryAsset ?? officialAsset;
    visuals.push({
      origin: { x: cell.x, y: cell.y },
      span: { width: 1, height: 1 },
      rotation: cell.rotation,
      source: ordinaryAsset
        ? "legacy-tile"
        : officialAsset
          ? "one-dot-zero-tile"
          : "one-dot-zero-fallback",
      ...(resolvedAsset ? { asset: resolvedAsset } : {}),
      terrainType: cell.terrainType,
      coveredCells: [key]
    });
  }

  return visuals;
}

export function hasResolvableLegacyVisual(
  cells: readonly TerrainCell[],
  bundle: LegacyAssetBundle
): boolean {
  return resolveTerrainVisuals(cells, bundle).some(
    (visual) => visual.asset !== undefined
  );
}
