import { SaveParseError } from "./save-errors";

export interface SaveRecords {
  saveVersion: number;
  seed: number;
  surfaceCandidates: Uint8Array[];
}

export interface SqlDatabaseConstructor {
  new (data?: Uint8Array): {
    close(): void;
    exec(sql: string, params?: unknown[]): Array<{
      columns: string[];
      values: unknown[][];
    }>;
    prepare(sql: string): {
      bind(values?: unknown[]): boolean;
      free(): boolean;
      get(): unknown[];
      step(): boolean;
    };
  };
}

type SqlDatabase = InstanceType<SqlDatabaseConstructor>;

const MAX_SURFACE_CANDIDATES = 8;
const MAX_SURFACE_CANDIDATE_BYTES = 12 * 1024 * 1024;

function notSurvival(message: string): SaveParseError {
  return new SaveParseError("NOT_SURVIVAL_SAVE", { message });
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function readSingleGameRow(database: SqlDatabase): { saveVersion: number; seed: number } {
  const results = database.exec("SELECT savegameversion, seed FROM Game");
  const rows = results[0]?.values ?? [];
  if (results.length !== 1 || rows.length !== 1) {
    throw notSurvival("Expected exactly one Game row.");
  }

  const [saveVersion, seed] = rows[0] ?? [];
  if (!isInteger(saveVersion) || !isInteger(seed)) {
    throw notSurvival("Game version and seed must be integers.");
  }
  if (saveVersion !== 28) {
    throw new SaveParseError("UNSUPPORTED_SAVE_VERSION", {
      message: "This save version is not supported."
    });
  }
  return { saveVersion, seed };
}

function requireTables(database: SqlDatabase): void {
  const results = database.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Game', 'ScriptData')"
  );
  const names = new Set((results[0]?.values ?? []).map((row) => row[0]));
  if (!names.has("Game") || !names.has("ScriptData")) {
    throw notSurvival("Expected Game and ScriptData tables.");
  }
}

function readSurfaceCandidates(database: SqlDatabase): Uint8Array[] {
  const lengthsStatement = database.prepare(
    `SELECT length(data)
       FROM ScriptData
      WHERE worldId = ? AND length(data) > 0
      ORDER BY length(data) DESC
      LIMIT ?`
  );
  const lengths: number[] = [];
  let cumulativeBytes = 0;
  try {
    lengthsStatement.bind([1, MAX_SURFACE_CANDIDATES]);
    while (lengthsStatement.step()) {
      const value = lengthsStatement.get()[0];
      if (!isInteger(value) || value <= 0) {
        throw notSurvival("Surface ScriptData length must be a positive integer.");
      }
      if (
        lengths.length >= MAX_SURFACE_CANDIDATES
        || value > MAX_SURFACE_CANDIDATE_BYTES - cumulativeBytes
      ) {
        throw notSurvival("Surface ScriptData exceeds the safe candidate budget.");
      }
      cumulativeBytes += value;
      lengths.push(value);
    }
  } finally {
    lengthsStatement.free();
  }

  if (lengths.length === 0) {
    throw new SaveParseError("MISSING_SURFACE_DATA", {
      message: "No surface terrain data was found in this save."
    });
  }

  const statement = database.prepare(
    `SELECT data
       FROM ScriptData
      WHERE worldId = ? AND length(data) > 0
      ORDER BY length(data) DESC
      LIMIT ?`
  );
  const candidates: Uint8Array[] = [];
  try {
    statement.bind([1, MAX_SURFACE_CANDIDATES]);
    while (statement.step()) {
      if (candidates.length >= lengths.length) {
        throw notSurvival("Surface ScriptData exceeds the safe candidate count.");
      }
      const value = statement.get()[0];
      if (!(value instanceof Uint8Array)) {
        throw notSurvival("Surface ScriptData must be stored as a blob.");
      }
      if (value.byteLength !== lengths[candidates.length]) {
        throw notSurvival("Surface ScriptData length changed during the read.");
      }
      candidates.push(value);
    }
  } finally {
    statement.free();
  }

  if (candidates.length !== lengths.length) {
    throw notSurvival("Surface ScriptData rows changed during the read.");
  }
  return candidates;
}

export function readSaveRecordsWithSql(
  Database: SqlDatabaseConstructor,
  bytes: Uint8Array
): SaveRecords {
  const database = new Database(bytes);
  try {
    requireTables(database);
    const { saveVersion, seed } = readSingleGameRow(database);
    return {
      saveVersion,
      seed,
      surfaceCandidates: readSurfaceCandidates(database)
    };
  } finally {
    database.close();
  }
}
