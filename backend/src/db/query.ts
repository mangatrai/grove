import type { Sql, TransactionSql } from "postgres";

import { log } from "../logger.js";
import { createPostgres } from "./postgres.js";
import { applyPendingPgMigrations } from "./apply-pg-migrations.js";

let sqlSingleton: Sql | null = null;
let initPromise: Promise<Sql> | null = null;

function bindPlaceholders(sqlStr: string, params: unknown[]): { text: string; values: unknown[] } {
  let i = 0;
  const text = sqlStr.replace(/\?/g, () => `$${++i}`);
  if (i !== params.length) {
    throw new Error(`SQL placeholder count (${i}) does not match params (${params.length})`);
  }
  return { text, values: params };
}

/** For use inside `qBegin`: same `?` → `$n` binding as `qExec` / `qGet`. */
export function sqlBind(sqlStr: string, params: unknown[]): { text: string; values: unknown[] } {
  return bindPlaceholders(sqlStr, params);
}

/** First call connects, applies pending PG migrations, then returns the shared client. */
export async function getSql(): Promise<Sql> {
  if (sqlSingleton) {
    return sqlSingleton;
  }
  if (!initPromise) {
    initPromise = (async () => {
      const sql = createPostgres();
      const applied = await applyPendingPgMigrations(sql);
      if (applied > 0 && process.env.NODE_ENV !== "test") {
        log.info(`Applied ${applied} pending Postgres migration(s).`);
      }
      sqlSingleton = sql;
      return sql;
    })();
  }
  return initPromise;
}

export async function qAll<T extends object = Record<string, unknown>>(
  sqlStr: string,
  ...params: unknown[]
): Promise<T[]> {
  const sql = await getSql();
  const { text, values } = bindPlaceholders(sqlStr, params);
  const rows = await sql.unsafe(text, values as never[]);
  return Array.from(rows as Iterable<T>);
}

export async function qGet<T extends object = Record<string, unknown>>(
  sqlStr: string,
  ...params: unknown[]
): Promise<T | undefined> {
  const rows = await qAll<T>(sqlStr, ...params);
  return rows[0];
}

export async function qExec(sqlStr: string, ...params: unknown[]): Promise<void> {
  const sql = await getSql();
  const { text, values } = bindPlaceholders(sqlStr, params);
  await sql.unsafe(text, values as never[]);
}

export async function qBegin<T>(fn: (tx: TransactionSql<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const sql = await getSql();
  const out = await sql.begin(fn);
  return out as T;
}

export function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    String((err as { code: unknown }).code) === "23505"
  );
}

/** Close the shared pool (Vitest global teardown; avoids 10s "close timed out" on exit). */
export async function closeSql(): Promise<void> {
  if (sqlSingleton) {
    await sqlSingleton.end({ timeout: 5 });
    sqlSingleton = null;
    initPromise = null;
  }
}
