import { db } from "../../db/sqlite.js";

export interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  isDefault: boolean;
}

/**
 * Global defaults (`household_id` NULL) plus any household-specific categories.
 */
export function listCategoriesForHousehold(householdId: string): CategoryRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, parent_id AS parentId, is_default AS isDefault
       FROM category
       WHERE household_id IS NULL OR household_id = ?
       ORDER BY is_default DESC, name`
    )
    .all(householdId) as Array<{
    id: string;
    name: string;
    parentId: string | null;
    isDefault: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    isDefault: r.isDefault === 1
  }));
}

export function categoryUsableByHousehold(categoryId: string, householdId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM category WHERE id = ? AND (household_id IS NULL OR household_id = ?)`
    )
    .get(categoryId, householdId) as { ok: number } | undefined;
  return Boolean(row);
}
