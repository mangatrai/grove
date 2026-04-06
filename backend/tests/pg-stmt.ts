import { qAll, qExec, qGet } from "../src/db/query.js";

/** Test helper: `?` placeholders + async methods (replaces former better-sqlite3 `prepare`). */
export function sqlStmt(sql: string) {
  return {
    run: (...params: unknown[]) => qExec(sql, ...params),
    get: <T extends object = Record<string, unknown>>(...params: unknown[]) => qGet<T>(sql, ...params),
    all: <T extends object = Record<string, unknown>>(...params: unknown[]) => qAll<T>(sql, ...params)
  };
}
