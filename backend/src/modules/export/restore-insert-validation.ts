/** Keys from backup JSON must be safe Postgres identifiers (snake_case); never interpolate untrusted names into SQL. */
const RESTORE_COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;

export function assertRestoreInsertColumnNames(tableName: string, row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (!RESTORE_COLUMN_NAME.test(key)) {
      throw new Error(
        `Invalid column name in backup for table "${tableName}": "${key}". Only lowercase snake_case identifiers are accepted.`
      );
    }
  }
}
