import type {
  LegacyBridgeEntry,
  LegacyPoiRule
} from "./legacy-visual-types";
import { compareCanonicalStrings } from "../shared/canonical-order";

interface AssetLookup {
  has(key: string): boolean;
}

const statusRank: Record<LegacyBridgeEntry["status"], number> = {
  active: 0,
  remapped: 1,
  retired: 2
};

function visualRank(
  entry: LegacyBridgeEntry,
  assets: AssetLookup,
  poiRules: readonly LegacyPoiRule[]
): number {
  if (assets.has(`tile:${entry.legacyId}`)) return 0;
  if (
    poiRules.some(
      (rule) =>
        rule.kind === "multi-cell-poi"
        && rule.legacyIds?.includes(entry.legacyId)
        && assets.has(rule.imageKey)
    )
  ) {
    return 1;
  }
  return 2;
}

export function legacyBridgeHasRenderableVisual(
  entry: LegacyBridgeEntry,
  assets: AssetLookup,
  poiRules: readonly LegacyPoiRule[]
): boolean {
  return visualRank(entry, assets, poiRules) < 2;
}

/**
 * Selects one deterministic official alias without claiming an unavailable
 * visual. Status remains authoritative; renderability breaks same-status ties.
 */
export function selectLegacyBridgeCandidate(
  candidates: readonly LegacyBridgeEntry[],
  assets: AssetLookup,
  poiRules: readonly LegacyPoiRule[]
): LegacyBridgeEntry | undefined {
  return [...candidates].sort((left, right) =>
    statusRank[left.status] - statusRank[right.status]
    || visualRank(left, assets, poiRules) - visualRank(right, assets, poiRules)
    || left.legacyId - right.legacyId
    || compareCanonicalStrings(left.tilePath, right.tilePath)
  )[0];
}

export function selectLegacyBridgeByUuid(
  entries: readonly LegacyBridgeEntry[],
  assets: AssetLookup,
  poiRules: readonly LegacyPoiRule[]
): Map<string, LegacyBridgeEntry> {
  const candidates = new Map<string, LegacyBridgeEntry[]>();
  for (const entry of entries) {
    const uuid = entry.uuid.toLowerCase();
    const group = candidates.get(uuid) ?? [];
    group.push(entry);
    candidates.set(uuid, group);
  }
  return new Map(
    [...candidates].flatMap(([uuid, group]) => {
      const selected = selectLegacyBridgeCandidate(group, assets, poiRules);
      return selected ? [[uuid, selected] as const] : [];
    })
  );
}
