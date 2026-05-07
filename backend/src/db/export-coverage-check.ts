import { log } from "../logger.js";
import { qAll } from "./query.js";
import { EXPORT_EPHEMERAL_TABLES, EXPORT_REGISTRY } from "../modules/export/export-registry.js";

export async function checkExportCoverage(): Promise<void> {
  try {
    const rows = await qAll<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'`
    );
    const covered = new Set<string>([
      ...EXPORT_REGISTRY.map((entry) => entry.tableName),
      ...EXPORT_EPHEMERAL_TABLES
    ]);
    for (const row of rows) {
      const tableName = row.table_name;
      if (!covered.has(tableName)) {
        log.warn(
          `[export-coverage] Table "${tableName}" exists in DB but is not registered in EXPORT_REGISTRY or EXPORT_EPHEMERAL_TABLES. It will not be included in backups.`
        );
      }
    }
  } catch (err: unknown) {
    log.warn(
      `[export-coverage] Coverage check skipped: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
