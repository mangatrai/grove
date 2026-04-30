import { qAll } from "../../db/query.js";
import { EXPORT_REGISTRY, type ExportRow } from "./export-registry.js";

export type TableExport = {
  key: string;
  fileName: string;
  rows: ExportRow[];
};

/**
 * Query all export tables using EXPORT_REGISTRY.
 */
export async function queryAllExportTables(
  householdId: string,
  personProfileId?: string | null
): Promise<TableExport[]> {
  const orderedEntries = [...EXPORT_REGISTRY].sort((a, b) => a.restoreOrder - b.restoreOrder);
  const exports: TableExport[] = [];
  for (const entry of orderedEntries) {
    if (personProfileId && !entry.memberScopeInclude) {
      continue;
    }
    const where: string[] = [`${entry.householdIdColumn} = ?`];
    const params: unknown[] = [householdId];
    if (personProfileId && entry.memberScopeFilter) {
      const filter = entry.memberScopeFilter(personProfileId);
      where.push(filter.sql);
      params.push(...filter.params);
    }
    const rows = (await qAll(
      `SELECT * FROM ${entry.tableName} WHERE ${where.join(" AND ")}`,
      ...params
    )) as ExportRow[];
    exports.push({
      key: entry.tableKey,
      fileName: `${entry.tableKey}.json`,
      rows: entry.onExport ? entry.onExport(rows) : rows
    });
  }
  return exports;
}
