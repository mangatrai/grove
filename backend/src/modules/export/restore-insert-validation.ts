/** Keys from backup JSON must be safe Postgres identifiers (snake_case); never interpolate untrusted names into SQL. */
const RESTORE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function assertRestoreInsertColumnNames(tableName: string, row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (!RESTORE_IDENTIFIER.test(key)) {
      throw new Error(
        `Invalid column name in backup for table "${tableName}": "${key}". Only lowercase snake_case identifiers are accepted.`
      );
    }
  }
}

/**
 * Defense-in-depth: tableName always comes from the hardcoded EXPORT_REGISTRY today, never from
 * the uploaded backup file, so this can't currently be attacker-influenced. Validated anyway so a
 * future EXPORT_REGISTRY change can't silently reopen SQL identifier interpolation (SEC #187).
 */
export function assertRestoreTableName(tableName: string, knownTableNames: ReadonlySet<string>): void {
  if (!RESTORE_IDENTIFIER.test(tableName) || !knownTableNames.has(tableName)) {
    throw new Error(`Invalid table name in restore path: "${tableName}".`);
  }
}
