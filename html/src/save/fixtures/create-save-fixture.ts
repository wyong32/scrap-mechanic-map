import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

interface FixtureDatabase {
  close(): void;
  export(): Uint8Array;
  prepare(sql: string): FixtureStatement;
  run(sql: string, params?: unknown[]): void;
}

interface FixtureStatement {
  bind(values?: unknown[]): boolean;
  free(): boolean;
  reset(): void;
  step(): boolean;
}

interface FixtureSqlJs {
  Database: new () => FixtureDatabase;
}

export interface SaveFixtureOptions {
  createGameTable?: boolean;
  createScriptDataTable?: boolean;
  gameRows?: Array<{ saveVersion: number | string; seed: number | string }>;
  scriptRows?: Array<{ worldId: number; data: Uint8Array | string }>;
  repeatedScriptRow?: {
    count: number;
    worldId: number;
    data: Uint8Array | string;
  };
}

const DEFAULT_GAME_ROWS = [{ saveVersion: 28, seed: 360160198 }];
const DEFAULT_SCRIPT_ROWS = [
  { worldId: 1, data: new Uint8Array([1, 2, 3, 4]) },
  { worldId: 1, data: new Uint8Array([9, 8]) },
  { worldId: 65534, data: new Uint8Array([7, 7, 7, 7, 7]) }
];

function locateWasm(): string {
  if (wasmUrl.startsWith("/") && import.meta.url.startsWith("file:")) {
    const modulePath = decodeURIComponent(new URL(import.meta.url).pathname);
    const sourceMarker = "/src/save/";
    const htmlRoot = modulePath.slice(0, modulePath.indexOf(sourceMarker));
    return `${htmlRoot}${wasmUrl}`.replace(/^\/([A-Za-z]:\/)/, "$1");
  }
  return wasmUrl;
}

export async function createSaveFixture(options: SaveFixtureOptions = {}): Promise<Uint8Array> {
  const SQL = (await initSqlJs({ locateFile: locateWasm })) as unknown as FixtureSqlJs;
  const database = new SQL.Database();

  try {
    if (options.createGameTable !== false) {
      database.run("CREATE TABLE Game (savegameversion INTEGER NOT NULL, seed INTEGER NOT NULL)");
      for (const row of options.gameRows ?? DEFAULT_GAME_ROWS) {
        database.run("INSERT INTO Game VALUES (?, ?)", [row.saveVersion, row.seed]);
      }
    }

    if (options.createScriptDataTable !== false) {
      database.run("CREATE TABLE ScriptData (worldId INTEGER NOT NULL, data BLOB NOT NULL)");
      const rows =
        options.scriptRows
        ?? (options.repeatedScriptRow ? [] : DEFAULT_SCRIPT_ROWS);
      const statement = database.prepare("INSERT INTO ScriptData VALUES (?, ?)");
      database.run("BEGIN");
      try {
        for (const row of rows) {
          statement.bind([row.worldId, row.data]);
          statement.step();
          statement.reset();
        }
        const repeated = options.repeatedScriptRow;
        if (repeated) {
          for (let index = 0; index < repeated.count; index += 1) {
            statement.bind([repeated.worldId, repeated.data]);
            statement.step();
            statement.reset();
          }
        }
        database.run("COMMIT");
      } catch (error) {
        database.run("ROLLBACK");
        throw error;
      } finally {
        statement.free();
      }
    }

    return database.export().slice();
  } finally {
    database.close();
  }
}
