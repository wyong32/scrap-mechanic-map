export type LegacyRegistrationStatus = "active" | "retired" | "remapped";

export interface LegacyBridgeEntry {
  legacyId: number;
  uuid: string;
  tilePath: string;
  status: LegacyRegistrationStatus;
  evidence: string;
}

interface LuaSource { relativePath: string; text: string }

const contentPath = (value: string) =>
  value.replace(/^\$SURVIVAL_DATA\//, "Survival/");
const constantPattern = /^\s*(POI_[A-Z0-9_]+)\s*=\s*(\d+)\b/gm;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Removes Lua comments without treating comment markers inside quoted strings as comments. */
function withoutLuaComments(text: string): string {
  let result = "";
  for (let index = 0; index < text.length;) {
    const character = text[index]!;
    if (character === "\"" || character === "'") {
      const quote = character;
      result += character;
      index += 1;
      while (index < text.length) {
        const value = text[index]!;
        result += value;
        index += 1;
        if (value === "\\" && index < text.length) { result += text[index]!; index += 1; continue; }
        if (value === quote) break;
      }
      continue;
    }
    if (character !== "-" || text[index + 1] !== "-") { result += character; index += 1; continue; }
    const longComment = /^--\[(=*)\[/.exec(text.slice(index));
    if (longComment) {
      const end = `]${longComment[1]}]`;
      const closing = text.indexOf(end, index + longComment[0].length);
      const finish = closing < 0 ? text.length : closing + end.length;
      result += text.slice(index, finish).replace(/[^\r\n]/g, " ");
      index = finish;
      continue;
    }
    const finish = text.indexOf("\n", index);
    const end = finish < 0 ? text.length : finish;
    result += text.slice(index, end).replace(/[^\r\n]/g, " ");
    index = end;
  }
  return result;
}

function tilePathsByUuid(tileUuidByPath: ReadonlyMap<string, string>): {
  byFoldedPath: Map<string, { path: string; uuid: string }>;
  byUuid: Map<string, { path: string; uuid: string }>;
} {
  const byFoldedPath = new Map<string, { path: string; uuid: string }>();
  const byUuid = new Map<string, { path: string; uuid: string }>();
  for (const [path, uuid] of tileUuidByPath) {
    const foldedPath = path.toLowerCase();
    const normalizedUuid = uuid.toLowerCase();
    if (byFoldedPath.has(foldedPath)) throw new Error(`duplicate tile path '${path}'`);
    if (byUuid.has(normalizedUuid)) throw new Error(`duplicate tile UUID '${uuid}'`);
    byFoldedPath.set(foldedPath, { path, uuid });
    byUuid.set(normalizedUuid, { path, uuid });
  }
  return { byFoldedPath, byUuid };
}

function resolvePath(path: string, byFoldedPath: ReadonlyMap<string, { path: string; uuid: string }>): { path: string; uuid: string } {
  const resolved = byFoldedPath.get(contentPath(path).toLowerCase());
  if (!resolved) throw new Error(`legacy registration references unknown tile '${contentPath(path)}'`);
  return resolved;
}

function addEntry(entries: LegacyBridgeEntry[], entry: LegacyBridgeEntry): void {
  if (!Number.isSafeInteger(entry.legacyId)) throw new Error(`invalid legacy ID '${entry.legacyId}'`);
  entries.push(entry);
}

function legacyExpression(value: string, constants: ReadonlyMap<string, number>): number | undefined {
  const direct = /^\s*(\d+)\s*$/.exec(value);
  if (direct) return Number(direct[1]);
  const poi = /^\s*(POI_[A-Z0-9_]+)\s*\*\s*100\s*\+\s*(\d+)\s*$/.exec(value);
  if (!poi) return undefined;
  const poiType = constants.get(poi[1]);
  if (poiType === undefined) throw new Error(`unknown POI constant '${poi[1]}'`);
  return poiType * 100 + Number(poi[2]);
}

/** Reads only static, official legacy registrations and resolves every UUID via tile headers. */
export function readLegacyBridge(
  luaSources: Array<LuaSource>,
  tileUuidByPath: ReadonlyMap<string, string>
): LegacyBridgeEntry[] {
  const constants = new Map<string, number>();
  const sources = luaSources.map((source) => ({ ...source, text: withoutLuaComments(source.text) }));
  for (const source of sources) for (const match of source.text.matchAll(constantPattern)) constants.set(match[1], Number(match[2]));
  const { byFoldedPath, byUuid } = tilePathsByUuid(tileUuidByPath);
  const entries: LegacyBridgeEntry[] = [];

  for (const source of sources) {
    for (const match of source.text.matchAll(/\bAddTile\s*\(\s*(\d+)\s*,\s*["'](\$SURVIVAL_DATA\/[^"']+\.tile)["']\s*(?:,\s*(?:nil|\d+)\s*){0,2}\)/g)) {
      const tile = resolvePath(match[2], byFoldedPath);
      addEntry(entries, { legacyId: Number(match[1]), uuid: tile.uuid, tilePath: tile.path, status: "active", evidence: `${source.relativePath}:AddTile` });
    }
    for (const match of source.text.matchAll(/\b(addPoiTileLegacy|addPoiTileRetired)\s*\(\s*(POI_[A-Z0-9_]+)\s*,\s*(\d+)\s*,\s*["'](\$SURVIVAL_DATA\/[^"']+\.tile)["']\s*(?:,\s*(?:nil|\d+)\s*)?\)/g)) {
      const poiType = constants.get(match[2]);
      if (poiType === undefined) throw new Error(`unknown POI constant '${match[2]}'`);
      const tile = resolvePath(match[4], byFoldedPath);
      addEntry(entries, { legacyId: poiType * 100 + Number(match[3]), uuid: tile.uuid, tilePath: tile.path, status: match[1] === "addPoiTileRetired" ? "retired" : "active", evidence: `${source.relativePath}:${match[1]}` });
    }
    for (const match of source.text.matchAll(/\bAddLegacyUpgrade\s*\(\s*([^,()]+(?:\*\s*100\s*\+\s*\d+)?)\s*,\s*(?:sm\.uuid\.new\s*\(\s*)?["']([0-9a-f-]{36})["']\s*\)?\s*\)/gi)) {
      const legacyId = legacyExpression(match[1], constants);
      if (legacyId === undefined || !uuidPattern.test(match[2])) continue;
      const tile = byUuid.get(match[2].toLowerCase());
      if (!tile) throw new Error(`legacy remap references unknown tile UUID '${match[2]}'`);
      addEntry(entries, { legacyId, uuid: tile.uuid, tilePath: tile.path, status: "remapped", evidence: `${source.relativePath}:AddLegacyUpgrade` });
    }
  }

  const byLegacyId = new Map<number, LegacyBridgeEntry>();
  const precedence: Record<LegacyRegistrationStatus, number> = { retired: 0, active: 1, remapped: 2 };
  for (const entry of entries) {
    const current = byLegacyId.get(entry.legacyId);
    if (!current) { byLegacyId.set(entry.legacyId, entry); continue; }
    if (current.uuid.toLowerCase() !== entry.uuid.toLowerCase()) throw new Error(`legacy ID '${entry.legacyId}' resolves to multiple UUIDs`);
    if (precedence[entry.status] > precedence[current.status] || (precedence[entry.status] === precedence[current.status] && compare(entry.evidence, current.evidence) < 0)) byLegacyId.set(entry.legacyId, entry);
  }
  return [...byLegacyId.values()].sort((left, right) => left.legacyId - right.legacyId || compare(left.status, right.status) || compare(left.tilePath, right.tilePath));
}
