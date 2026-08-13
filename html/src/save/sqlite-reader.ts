import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { SaveParseError } from "./save-errors";
import { readSaveRecordsWithSql, type SaveRecords, type SqlDatabaseConstructor } from "./sqlite-records";

export type { SaveRecords } from "./sqlite-records";

interface SqlJs {
  Database: SqlDatabaseConstructor;
}

let sqlPromise: Promise<SqlJs> | undefined;

function locateWasm(): string {
  if (wasmUrl.startsWith("/") && import.meta.url.startsWith("file:")) {
    const modulePath = decodeURIComponent(new URL(import.meta.url).pathname);
    const sourceMarker = "/src/save/";
    const htmlRoot = modulePath.slice(0, modulePath.indexOf(sourceMarker));
    return `${htmlRoot}${wasmUrl}`.replace(/^\/([A-Za-z]:\/)/, "$1");
  }
  return wasmUrl;
}

function getSql(): Promise<SqlJs> {
  sqlPromise ??= initSqlJs({ locateFile: locateWasm }) as unknown as Promise<SqlJs>;
  return sqlPromise;
}

function notSurvival(message: string): SaveParseError {
  return new SaveParseError("NOT_SURVIVAL_SAVE", { message });
}

export async function readSaveRecords(bytes: Uint8Array): Promise<SaveRecords> {
  try {
    const SQL = await getSql();
    return readSaveRecordsWithSql(SQL.Database, bytes);
  } catch (error) {
    if (error instanceof SaveParseError) {
      throw error;
    }
    throw notSurvival("Unable to read this Survival save.");
  }
}
