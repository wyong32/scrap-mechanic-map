export interface CellBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface TileResolution { uuid: string; width: number; height: number; relativePath?: string }
export interface TerrainCell { x: number; y: number; relativePath: string; tileUuid: string; offsetX: number; offsetY: number; rotation: number }
export interface EmptyTerrainCell { x: number; y: number }
export interface WorldConnection { id: number; fromZone: number; toZone: number }
export interface FixedWorldDefinition { id: string; nameKey: string; group: string; relativePath: string; bounds: CellBounds; cells: TerrainCell[]; emptyCells: EmptyTerrainCell[]; connections: WorldConnection[] }

type RawCell = { x?: unknown; y?: unknown; path?: unknown; offsetX?: unknown; offsetY?: unknown; rotation?: unknown };
type RawWorld = { cellData?: RawCell[]; portalData?: Array<{ id?: unknown; zoneA?: unknown; zoneB?: unknown }> };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export function normalizeWorldContentPath(path: string): string {
  if (!path.startsWith("$SURVIVAL_DATA/")) throw new Error(`unsupported world cell content root '${path}'`);
  return `Survival/${path.slice("$SURVIVAL_DATA/".length)}`;
}

export function readFixedWorld(
  source: string,
  identity: Pick<FixedWorldDefinition, "id" | "nameKey" | "group"> & Partial<Pick<FixedWorldDefinition, "relativePath">>,
  resolveTile: (relativePath: string) => TileResolution | undefined,
): FixedWorldDefinition {
  const raw = JSON.parse(source) as RawWorld;
  const sourceCells = raw.cellData ?? [];
  const coordinates = new Set<string>();
  const cells: TerrainCell[] = [];
  const emptyCells: EmptyTerrainCell[] = [];
  for (const [index, cell] of sourceCells.entries()) {
    if (!integer(cell.x) || !integer(cell.y)) throw new Error(`${identity.id}: cell ${index} coordinates must be integers`);
    const key = `${cell.x},${cell.y}`;
    if (coordinates.has(key)) throw new Error(`${identity.id}: duplicate cell coordinate ${key}`);
    coordinates.add(key);
    if (cell.path === "") { emptyCells.push({ x: cell.x, y: cell.y }); continue; }
    if (typeof cell.path !== "string") throw new Error(`${identity.id}: cell ${index} path must be a string`);
    const offsetX = cell.offsetX ?? 0; const offsetY = cell.offsetY ?? 0; const rotation = cell.rotation ?? 0;
    if (!integer(offsetX) || !integer(offsetY) || !integer(rotation)) throw new Error(`${identity.id}: cell ${index} offsets and rotation must be integers`);
    const relativePath = normalizeWorldContentPath(cell.path);
    const tile = resolveTile(relativePath);
    if (!tile) throw new Error(`${identity.id}: unknown tile path '${relativePath}'`);
    if (rotation < 0 || rotation > 3) throw new Error(`${identity.id}: cell ${index} rotation must be 0..3`);
    if (offsetX < 0 || offsetX >= tile.width || offsetY < 0 || offsetY >= tile.height) throw new Error(`${identity.id}: cell ${index} offset is outside tile dimensions`);
    cells.push({ x: cell.x, y: cell.y, relativePath: tile.relativePath ?? relativePath, tileUuid: tile.uuid, offsetX, offsetY, rotation });
  }
  const coordinatesList = [...cells, ...emptyCells];
  const bounds = coordinatesList.length === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : {
    minX: Math.min(...coordinatesList.map((cell) => cell.x)), minY: Math.min(...coordinatesList.map((cell) => cell.y)),
    maxX: Math.max(...coordinatesList.map((cell) => cell.x)), maxY: Math.max(...coordinatesList.map((cell) => cell.y)),
  };
  const seenPortals = new Set<number>();
  const connections = (raw.portalData ?? []).map((portal, index): WorldConnection => {
    const id = portal.id; const fromZone = portal.zoneA; const toZone = portal.zoneB;
    if (!integer(id) || !integer(fromZone) || !integer(toZone)) throw new Error(`${identity.id}: portal ${index} must use integer id/zones`);
    if (seenPortals.has(id)) throw new Error(`${identity.id}: duplicate portal id ${id}`);
    seenPortals.add(id); return { id, fromZone, toZone };
  }).sort((a, b) => a.id - b.id || a.fromZone - b.fromZone || a.toZone - b.toZone);
  return {
    ...identity, relativePath: identity.relativePath ?? `fixtures/${identity.id}.world`, bounds,
    cells: cells.sort((a, b) => a.x - b.x || a.y - b.y || compare(a.relativePath, b.relativePath)),
    emptyCells: emptyCells.sort((a, b) => a.x - b.x || a.y - b.y), connections,
  };
}
