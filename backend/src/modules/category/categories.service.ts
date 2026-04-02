import crypto from "node:crypto";

import { db } from "../../db/sqlite.js";

export interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  isDefault: boolean;
  /** True when this row is owned by the household (can be edited/deleted by household). */
  householdScoped: boolean;
}

interface CategoryDbRow {
  id: string;
  name: string;
  parentId: string | null;
  householdId: string | null;
  isDefault: number;
}

function mapRowFromDb(r: CategoryDbRow): CategoryRow {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    isDefault: r.isDefault === 1,
    householdScoped: r.householdId !== null
  };
}

function mapRow(
  r: { id: string; name: string; parentId: string | null; isDefault: number; householdScoped: number }
): CategoryRow {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    isDefault: r.isDefault === 1,
    householdScoped: r.householdScoped === 1
  };
}

/**
 * Global defaults (`household_id` NULL) plus any household-specific categories.
 */
export function listCategoriesForHousehold(householdId: string): CategoryRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, parent_id AS parentId, is_default AS isDefault,
              CASE WHEN household_id IS NOT NULL THEN 1 ELSE 0 END AS householdScoped
       FROM category
       WHERE household_id IS NULL OR household_id = ?
       ORDER BY COALESCE(parent_id, id), name`
    )
    .all(householdId) as Array<{
    id: string;
    name: string;
    parentId: string | null;
    isDefault: number;
    householdScoped: number;
  }>;

  return rows.map((r) => mapRow(r));
}

export function categoryUsableByHousehold(categoryId: string, householdId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM category WHERE id = ? AND (household_id IS NULL OR household_id = ?)`
    )
    .get(categoryId, householdId) as { ok: number } | undefined;
  return Boolean(row);
}

/** Default taxonomy leaf (`household_id` NULL) usable as a global built-in rule target. */
export function categoryAssignableForGlobalBuiltin(categoryId: string): boolean {
  const row = db
    .prepare(`SELECT household_id AS householdId FROM category WHERE id = ?`)
    .get(categoryId) as { householdId: string | null } | undefined;
  if (!row || row.householdId !== null) {
    return false;
  }
  return !categoryHasChildren(categoryId);
}

function getCategoryInternal(id: string): CategoryDbRow | undefined {
  return db
    .prepare(
      `SELECT id, name, parent_id AS parentId, household_id AS householdId, is_default AS isDefault
       FROM category WHERE id = ?`
    )
    .get(id) as CategoryDbRow | undefined;
}

/** True if `id` has at least one child row (used for ledger filter / roll-up). */
export function categoryHasChildren(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM category WHERE parent_id = ? LIMIT 1`)
    .get(id) as { ok: number } | undefined;
  return Boolean(row);
}

/**
 * Parent for a new subcategory must be a **top-level** row (`parent_id` IS NULL).
 */
function parentAcceptsChild(parentId: string): boolean {
  const row = getCategoryInternal(parentId);
  return Boolean(row && row.parentId === null);
}

export type CreateCategoryFailure = { ok: false; code: "INVALID_NAME" | "INVALID_PARENT" | "MAX_DEPTH" };

export function createHouseholdCategory(
  householdId: string,
  name: string,
  parentId: string | null
): { ok: true; data: CategoryRow } | CreateCategoryFailure {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, code: "INVALID_NAME" };
  }

  if (parentId !== null) {
    if (!categoryUsableByHousehold(parentId, householdId)) {
      return { ok: false, code: "INVALID_PARENT" };
    }
    if (!parentAcceptsChild(parentId)) {
      return { ok: false, code: "MAX_DEPTH" };
    }
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES (?, ?, ?, ?, 0)`
  ).run(id, householdId, parentId, trimmed);

  const row = getCategoryInternal(id)!;
  return { ok: true, data: mapRowFromDb(row) };
}

export type UpdateCategoryFailure =
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "FORBIDDEN"
        | "INVALID_NAME"
        | "INVALID_PARENT"
        | "MAX_DEPTH"
        | "CYCLE"
        | "INVALID_REPARENT";
    };

/** Built-in row (`household_id` NULL). Used by routes for auth branching. */
export function getCategoryHouseholdId(categoryId: string): string | null | undefined {
  const row = getCategoryInternal(categoryId);
  if (!row) {
    return undefined;
  }
  return row.householdId;
}

/**
 * Update a global default category (`household_id` IS NULL). Installation-wide for this DB.
 * Same depth rules as household updates; cannot move a top-level group under another if it still has subcategories.
 */
export function updateDefaultCategory(
  householdId: string,
  categoryId: string,
  updates: { name?: string; parentId?: string | null }
): { ok: true; data: CategoryRow } | UpdateCategoryFailure {
  const row = getCategoryInternal(categoryId);
  if (!row || row.householdId !== null) {
    return { ok: false, code: row ? "FORBIDDEN" : "NOT_FOUND" };
  }

  const nextName = updates.name !== undefined ? updates.name.trim() : row.name;
  if (!nextName) {
    return { ok: false, code: "INVALID_NAME" };
  }

  let nextParentId = updates.parentId !== undefined ? updates.parentId : row.parentId;
  if (updates.parentId !== undefined) {
    if (nextParentId === categoryId) {
      return { ok: false, code: "CYCLE" };
    }
    if (categoryHasChildren(categoryId) && nextParentId !== null) {
      return { ok: false, code: "INVALID_REPARENT" };
    }
    if (nextParentId !== null) {
      if (!categoryUsableByHousehold(nextParentId, householdId)) {
        return { ok: false, code: "INVALID_PARENT" };
      }
      if (!parentAcceptsChild(nextParentId)) {
        return { ok: false, code: "MAX_DEPTH" };
      }
    }
  }

  db.prepare(`UPDATE category SET name = ?, parent_id = ? WHERE id = ? AND household_id IS NULL`).run(
    nextName,
    nextParentId,
    categoryId
  );

  const out = getCategoryInternal(categoryId)!;
  return { ok: true, data: mapRowFromDb(out) };
}

export function updateHouseholdCategory(
  householdId: string,
  categoryId: string,
  updates: { name?: string; parentId?: string | null }
): { ok: true; data: CategoryRow } | UpdateCategoryFailure {
  const row = getCategoryInternal(categoryId);
  if (!row || row.householdId !== householdId) {
    return { ok: false, code: row ? "FORBIDDEN" : "NOT_FOUND" };
  }

  const nextName = updates.name !== undefined ? updates.name.trim() : row.name;
  if (!nextName) {
    return { ok: false, code: "INVALID_NAME" };
  }

  let nextParentId = updates.parentId !== undefined ? updates.parentId : row.parentId;
  if (updates.parentId !== undefined) {
    if (nextParentId === categoryId) {
      return { ok: false, code: "CYCLE" };
    }
    if (categoryHasChildren(categoryId) && nextParentId !== null) {
      return { ok: false, code: "INVALID_REPARENT" };
    }
    if (nextParentId !== null) {
      if (!categoryUsableByHousehold(nextParentId, householdId)) {
        return { ok: false, code: "INVALID_PARENT" };
      }
      if (!parentAcceptsChild(nextParentId)) {
        return { ok: false, code: "MAX_DEPTH" };
      }
    }
  }

  db.prepare(`UPDATE category SET name = ?, parent_id = ? WHERE id = ? AND household_id = ?`).run(
    nextName,
    nextParentId,
    categoryId,
    householdId
  );

  const out = getCategoryInternal(categoryId)!;
  return { ok: true, data: mapRowFromDb(out) };
}

export type DeleteCategoryFailure =
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "HAS_CHILDREN" | "IN_USE" };

export function deleteHouseholdCategory(
  householdId: string,
  categoryId: string
): { ok: true } | DeleteCategoryFailure {
  const row = getCategoryInternal(categoryId);
  if (!row || row.householdId !== householdId) {
    return { ok: false, code: row ? "FORBIDDEN" : "NOT_FOUND" };
  }

  const child = db.prepare(`SELECT 1 FROM category WHERE parent_id = ? LIMIT 1`).get(categoryId);
  if (child) {
    return { ok: false, code: "HAS_CHILDREN" };
  }

  const inUse = db
    .prepare(`SELECT 1 FROM transaction_canonical WHERE category_id = ? LIMIT 1`)
    .get(categoryId);
  if (inUse) {
    return { ok: false, code: "IN_USE" };
  }

  db.prepare(`DELETE FROM category WHERE id = ? AND household_id = ?`).run(categoryId, householdId);
  return { ok: true };
}
