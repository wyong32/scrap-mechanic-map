import { describe, expect, it } from "vitest";
import { SaveParseError } from "./save-errors";
import { readSaveRecordsWithSql, type SqlDatabaseConstructor } from "./sqlite-records";

type GameRow = { saveVersion: unknown; seed: unknown };
type ScriptRow = { worldId: number; data: unknown };

interface FakeScenario {
  gameTable?: boolean;
  scriptDataTable?: boolean;
  gameRows?: GameRow[];
  scriptRows?: ScriptRow[];
  ignoreCandidateLimit?: boolean;
}

const sqliteBytes = new Uint8Array([1]);
const largeBlob = new Uint8Array([4, 3, 2, 1]);
const smallBlob = new Uint8Array([9, 8]);

class FakeDatabase {
  private readonly scenario: FakeScenario;

  constructor(bytes?: Uint8Array) {
    this.scenario = scenarios.get(bytes?.[0] ?? -1) ?? {};
  }

  close(): void {}

  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }> {
    if (sql.includes("sqlite_master")) {
      const values: unknown[][] = [];
      if (this.scenario.gameTable !== false) values.push(["Game"]);
      if (this.scenario.scriptDataTable !== false) values.push(["ScriptData"]);
      return [{ columns: ["name"], values }];
    }
    if (sql.includes("FROM Game")) {
      return [{
        columns: ["savegameversion", "seed"],
        values: (this.scenario.gameRows ?? [{ saveVersion: 28, seed: 306160198 }]).map(
          ({ saveVersion, seed }) => [saveVersion, seed]
        )
      }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  prepare(sql: string): {
    bind(values?: unknown[]): boolean;
    free(): boolean;
    get(): unknown[];
    step(): boolean;
  } {
    const rows = (this.scenario.scriptRows ?? [
      { worldId: 1, data: smallBlob },
      { worldId: 1, data: largeBlob },
      { worldId: 2, data: new Uint8Array([7, 7, 7, 7, 7]) }
    ])
      .filter((row) => row.worldId === 1 && byteLength(row.data) > 0)
      .sort((left, right) => byteLength(right.data) - byteLength(left.data));
    const values = sql.includes("SELECT length(data)")
      ? rows.map((row) => [byteLength(row.data)])
      : rows.map((row) => [row.data]);
    let cursor = -1;
    let limit = Infinity;

    return {
      bind: (parameters = []) => {
        limit = this.scenario.ignoreCandidateLimit ? Infinity : Number(parameters[1]);
        return true;
      },
      free: () => true,
      get: () => values[cursor] ?? [],
      step: () => {
        if (cursor + 1 >= Math.min(values.length, limit)) return false;
        cursor += 1;
        return true;
      }
    };
  }
}

const scenarios = new Map<number, FakeScenario>([
  [1, {}],
  [2, { gameTable: false }],
  [3, { scriptDataTable: false }],
  [4, { gameRows: [{ saveVersion: 28, seed: 1 }, { saveVersion: 28, seed: 2 }] }],
  [5, { gameRows: [{ saveVersion: 27, seed: 306160198 }] }],
  [6, {
    scriptRows: Array.from({ length: 9 }, (_, index) => ({
      worldId: 1,
      data: new Uint8Array(index + 1)
    })),
    ignoreCandidateLimit: true
  }],
  [7, {
    scriptRows: Array.from({ length: 8 }, (_, index) => ({
      worldId: 1,
      data: new Uint8Array(1536 * 1024 + (index === 0 ? 1 : 0))
    }))
  }]
]);

function byteLength(value: unknown): number {
  return value instanceof Uint8Array ? value.byteLength : 1;
}

function expectCode(code: SaveParseError["code"]): { code: SaveParseError["code"] } {
  return { code };
}

describe("readSaveRecordsWithSql", () => {
  it("returns the one v28 seed and longest-first world-1 blobs", () => {
    const records = readSaveRecordsWithSql(FakeDatabase as SqlDatabaseConstructor, sqliteBytes);

    expect(records).toEqual({
      saveVersion: 28,
      seed: 306160198,
      surfaceCandidates: [largeBlob, smallBlob]
    });
  });

  it.each([
    [new Uint8Array([2]), "missing Game table"],
    [new Uint8Array([3]), "missing ScriptData table"],
    [new Uint8Array([4]), "multiple Game rows"],
    [new Uint8Array([6]), "more than eight candidates"],
    [new Uint8Array([7]), "more than 12 MiB of retained candidate data"]
  ])("rejects %s", (bytes) => {
    expect(() => readSaveRecordsWithSql(FakeDatabase as SqlDatabaseConstructor, bytes)).toThrowError(
      expect.objectContaining(expectCode("NOT_SURVIVAL_SAVE"))
    );
  });

  it("rejects a non-v28 save distinctly", () => {
    expect(() => readSaveRecordsWithSql(FakeDatabase as SqlDatabaseConstructor, new Uint8Array([5]))).toThrowError(
      expect.objectContaining(expectCode("UNSUPPORTED_SAVE_VERSION"))
    );
  });
});
