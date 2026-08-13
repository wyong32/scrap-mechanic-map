import type { TileCatalog } from "./normalize-terrain";

interface PublicTileCatalog {
  schemaVersion: 1;
  contentHash: string;
  gameVersion: string;
  tiles: Array<{
    uuid: string;
    sourceCategory: string;
    terrainType?: string | number;
  }>;
  pois: Array<{ tileUuid: string; poiType: string }>;
  legacyBridge: LegacyBridgeEntry[];
}

export interface LegacyBridgeEntry {
  legacyId: number;
  uuid: string;
  tilePath: string;
  status: "active" | "retired" | "remapped";
  evidence: string;
}

interface BuildInfo {
  schemaVersion: 1;
  gameVersion: string;
  contentHash: string;
  files: Array<{ name: string; contentHash: string; bytes: number }>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

async function verifySelfHash(
  value: { schemaVersion: number; contentHash: string } & Record<string, unknown>
): Promise<void> {
  if (value.schemaVersion !== 1) throw new Error("Unsupported generated catalog schema.");
  const { contentHash, ...payload } = value;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonicalize(payload)))
  );
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== contentHash) throw new Error("Generated tile catalog failed its integrity check.");
}

export async function loadTileCatalog(
  basePath = "/data/generated"
): Promise<TileCatalog & { legacyBridge: LegacyBridgeEntry[] }> {
  const [buildResponse, catalogResponse] = await Promise.all([
    fetch(`${basePath}/build-info.json`),
    fetch(`${basePath}/tile-catalog.json`)
  ]);
  if (!buildResponse.ok || !catalogResponse.ok) {
    throw new Error("Unable to load the trusted tile catalog.");
  }
  const buildText = await buildResponse.text();
  const catalogText = await catalogResponse.text();
  return parseTileCatalogDocuments(buildText, catalogText);
}

export async function parseTileCatalogDocuments(
  buildText: string,
  catalogText: string
): Promise<TileCatalog & { legacyBridge: LegacyBridgeEntry[] }> {
  const build = JSON.parse(buildText) as BuildInfo;
  const source = JSON.parse(catalogText) as PublicTileCatalog;
  await Promise.all([
    verifySelfHash(build as BuildInfo & Record<string, unknown>),
    verifySelfHash(source as PublicTileCatalog & Record<string, unknown>)
  ]);
  const listed = build.files.find((file) => file.name === "tile-catalog.json");
  if (
    !listed
    || listed.contentHash !== source.contentHash
    || build.gameVersion !== source.gameVersion
    || listed.bytes !== new TextEncoder().encode(
      catalogText.replace(/\r\n/g, "\n")
    ).byteLength
  ) {
    throw new Error("Generated tile catalog does not match build-info.");
  }
  validateLegacyBridge(source.legacyBridge);
  const pois = new Map(
    source.pois.map((poi) => [poi.tileUuid.toLowerCase(), poi.poiType])
  );
  return {
    gameVersion: source.gameVersion,
    legacyBridge: source.legacyBridge,
    tiles: Object.fromEntries(
      source.tiles.map((tile) => {
        const uuid = tile.uuid.toLowerCase();
        const poiType = pois.get(uuid);
        return [
          uuid,
          {
            terrainType: String(tile.terrainType ?? tile.sourceCategory),
            ...(poiType ? { poiType } : {})
          }
        ];
      })
    )
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statuses = new Set<LegacyBridgeEntry["status"]>(["active", "retired", "remapped"]);

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relativeContentPath(value: string): boolean {
  return value.startsWith("Survival/") && !value.includes("\\") && !value.includes("..") && !/^[A-Za-z]:/.test(value);
}

function validateLegacyBridge(entries: unknown): asserts entries is LegacyBridgeEntry[] {
  if (!Array.isArray(entries)) throw new Error("Generated tile catalog has an invalid legacy bridge.");
  let previous: LegacyBridgeEntry | undefined;
  const ids = new Set<number>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Generated tile catalog has an invalid legacy bridge.");
    const value = entry as LegacyBridgeEntry;
    if (!Number.isSafeInteger(value.legacyId) || ids.has(value.legacyId) || typeof value.uuid !== "string" || !UUID_PATTERN.test(value.uuid) || typeof value.tilePath !== "string" || !relativeContentPath(value.tilePath) || !statuses.has(value.status) || typeof value.evidence !== "string" || !relativeContentPath(value.evidence.split(":", 1)[0] ?? "")) throw new Error("Generated tile catalog has an invalid legacy bridge.");
    if (previous && (value.legacyId < previous.legacyId || (value.legacyId === previous.legacyId && (compare(value.status, previous.status) < 0 || (value.status === previous.status && compare(value.tilePath, previous.tilePath) < 0))))) throw new Error("Generated tile catalog has an unsorted legacy bridge.");
    ids.add(value.legacyId);
    previous = value;
  }
}
