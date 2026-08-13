/** Absolute source paths kept at runtime only; do not write these into data bundles. */
export interface GamePaths {
  gameRoot: string;
  survivalRoot: string;
  terrainRoot: string;
  worldsRoot: string;
  scriptsRoot: string;
  tileDatabasePath: string;
}

export interface InventoryFile {
  /** POSIX path relative to the game root, suitable for reproducible data bundles. */
  relativePath: string;
  bytes: number;
  sha256: string;
}

/**
 * Runtime-only source inventory. Consumers that serialize application data must
 * remove `gameRoot` and keep only `InventoryFile` records.
 */
export interface GameInventory {
  gameRoot: string;
  tileFiles: InventoryFile[];
  worldFiles: InventoryFile[];
  luaFiles: InventoryFile[];
}
