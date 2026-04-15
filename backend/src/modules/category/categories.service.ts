import crypto from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";

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
  createdByUserId: string | null;
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
export async function listCategoriesForHousehold(householdId: string): Promise<CategoryRow[]> {
  const rows = await qAll<{
    id: string;
    name: string;
    parentId: string | null;
    isDefault: number;
    householdScoped: number;
  }>(
    `SELECT id, name, parent_id AS "parentId", is_default AS "isDefault",
              CASE WHEN household_id IS NOT NULL THEN 1 ELSE 0 END AS "householdScoped"
       FROM category
       WHERE household_id IS NULL OR household_id = ?
       ORDER BY COALESCE(parent_id, id), name`,
    householdId
  );

  return rows.map((r) => mapRow(r));
}

export async function categoryUsableByHousehold(categoryId: string, householdId: string): Promise<boolean> {
  const row = await qGet<{ ok: number }>(
    `SELECT 1 AS ok FROM category WHERE id = ? AND (household_id IS NULL OR household_id = ?)`,
    categoryId,
    householdId
  );
  return Boolean(row);
}

/** Default taxonomy leaf (`household_id` NULL) usable as a global built-in rule target. */
export async function categoryAssignableForGlobalBuiltin(categoryId: string): Promise<boolean> {
  const row = await qGet<{ householdId: string | null }>(
    `SELECT household_id AS "householdId" FROM category WHERE id = ?`,
    categoryId
  );
  if (!row || row.householdId !== null) {
    return false;
  }
  return !(await categoryHasChildren(categoryId));
}

async function getCategoryInternal(id: string): Promise<CategoryDbRow | undefined> {
  return qGet<CategoryDbRow>(
    `SELECT id, name, parent_id AS "parentId", household_id AS "householdId",
            is_default AS "isDefault", created_by_user_id AS "createdByUserId"
       FROM category WHERE id = ?`,
    id
  );
}

/** True if `id` has at least one child row (used for ledger filter / roll-up). */
export async function categoryHasChildren(id: string): Promise<boolean> {
  const row = await qGet<{ ok: number }>(
    `SELECT 1 AS ok FROM category WHERE parent_id = ? LIMIT 1`,
    id
  );
  return Boolean(row);
}

/**
 * Parent for a new subcategory must be a **top-level** row (`parent_id` IS NULL).
 */
async function parentAcceptsChild(parentId: string): Promise<boolean> {
  const row = await getCategoryInternal(parentId);
  return Boolean(row && row.parentId === null);
}

export type CreateCategoryFailure = { ok: false; code: "INVALID_NAME" | "INVALID_PARENT" | "MAX_DEPTH" };

export async function createHouseholdCategory(
  householdId: string,
  name: string,
  parentId: string | null,
  createdByUserId: string
): Promise<{ ok: true; data: CategoryRow } | CreateCategoryFailure> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, code: "INVALID_NAME" };
  }

  if (parentId !== null) {
    if (!(await categoryUsableByHousehold(parentId, householdId))) {
      return { ok: false, code: "INVALID_PARENT" };
    }
    if (!(await parentAcceptsChild(parentId))) {
      return { ok: false, code: "MAX_DEPTH" };
    }
  }

  const id = crypto.randomUUID();
  await qExec(
    `INSERT INTO category (id, household_id, parent_id, name, is_default, created_by_user_id) VALUES (?, ?, ?, ?, 0, ?)`,
    id,
    householdId,
    parentId,
    trimmed,
    createdByUserId
  );

  const row = await getCategoryInternal(id);
  return { ok: true, data: mapRowFromDb(row!) };
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
export async function getCategoryHouseholdId(categoryId: string): Promise<string | null | undefined> {
  const row = await getCategoryInternal(categoryId);
  if (!row) {
    return undefined;
  }
  return row.householdId;
}

/**
 * Update a global default category (`household_id` IS NULL). Installation-wide for this DB.
 * Same depth rules as household updates; cannot move a top-level group under another if it still has subcategories.
 */
export async function updateDefaultCategory(
  householdId: string,
  categoryId: string,
  updates: { name?: string; parentId?: string | null }
): Promise<{ ok: true; data: CategoryRow } | UpdateCategoryFailure> {
  const row = await getCategoryInternal(categoryId);
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
    if ((await categoryHasChildren(categoryId)) && nextParentId !== null) {
      return { ok: false, code: "INVALID_REPARENT" };
    }
    if (nextParentId !== null) {
      if (!(await categoryUsableByHousehold(nextParentId, householdId))) {
        return { ok: false, code: "INVALID_PARENT" };
      }
      if (!(await parentAcceptsChild(nextParentId))) {
        return { ok: false, code: "MAX_DEPTH" };
      }
    }
  }

  await qExec(`UPDATE category SET name = ?, parent_id = ? WHERE id = ? AND household_id IS NULL`, nextName, nextParentId, categoryId);

  const out = await getCategoryInternal(categoryId);
  return { ok: true, data: mapRowFromDb(out!) };
}

export async function updateHouseholdCategory(
  householdId: string,
  categoryId: string,
  updates: { name?: string; parentId?: string | null },
  caller: { userId: string; role: string }
): Promise<{ ok: true; data: CategoryRow } | UpdateCategoryFailure> {
  const row = await getCategoryInternal(categoryId);
  if (!row || row.householdId !== householdId) {
    return { ok: false, code: row ? "FORBIDDEN" : "NOT_FOUND" };
  }
  if (caller.role === "member" && row.createdByUserId !== caller.userId) {
    return { ok: false, code: "FORBIDDEN" };
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
    if ((await categoryHasChildren(categoryId)) && nextParentId !== null) {
      return { ok: false, code: "INVALID_REPARENT" };
    }
    if (nextParentId !== null) {
      if (!(await categoryUsableByHousehold(nextParentId, householdId))) {
        return { ok: false, code: "INVALID_PARENT" };
      }
      if (!(await parentAcceptsChild(nextParentId))) {
        return { ok: false, code: "MAX_DEPTH" };
      }
    }
  }

  await qExec(`UPDATE category SET name = ?, parent_id = ? WHERE id = ? AND household_id = ?`, nextName, nextParentId, categoryId, householdId);

  const out = await getCategoryInternal(categoryId);
  return { ok: true, data: mapRowFromDb(out!) };
}

export type DeleteCategoryFailure =
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "HAS_CHILDREN" | "IN_USE" };

function nameEqualsInsensitive(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type ResolveLeafCategoryFailureCode =
  | "MISSING_INPUT"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "NOT_LEAF";

/**
 * Resolve a household-assignable **leaf** category from `categoryId` and/or `categoryPath`
 * (`Parent > Child` or `Parent | Child`, case-insensitive names).
 * If `categoryId` is present and valid, it wins. Otherwise `categoryPath` is parsed.
 */
export async function resolveLeafCategoryIdForHousehold(
  householdId: string,
  input: { categoryId?: string | null; categoryPath?: string | null }
): Promise<{ ok: true; id: string } | { ok: false; code: ResolveLeafCategoryFailureCode }> {
  const idIn = input.categoryId?.trim();
  const pathIn = input.categoryPath?.trim();

  if (idIn) {
    if (!(await categoryUsableByHousehold(idIn, householdId))) {
      return { ok: false, code: "NOT_FOUND" };
    }
    if (await categoryHasChildren(idIn)) {
      return { ok: false, code: "NOT_LEAF" };
    }
    return { ok: true, id: idIn };
  }

  if (!pathIn) {
    return { ok: false, code: "MISSING_INPUT" };
  }

  const segments = pathIn
    .split(/[>|]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { ok: false, code: "MISSING_INPUT" };
  }

  const all = await listCategoriesForHousehold(householdId);
  const usableLeaf = async (cid: string) =>
    (await categoryUsableByHousehold(cid, householdId)) && !(await categoryHasChildren(cid));

  if (segments.length === 1) {
    const name = segments[0]!;
    const matches = [];
    for (const c of all) {
      if ((await usableLeaf(c.id)) && nameEqualsInsensitive(c.name, name)) {
        matches.push(c);
      }
    }
    if (matches.length === 0) {
      return { ok: false, code: "NOT_FOUND" };
    }
    if (matches.length > 1) {
      return { ok: false, code: "AMBIGUOUS" };
    }
    return { ok: true, id: matches[0]!.id };
  }

  if (segments.length > 2) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const parentName = segments[0]!;
  const leafName = segments[1]!;
  const topParents = all.filter((c) => c.parentId === null && nameEqualsInsensitive(c.name, parentName));
  if (topParents.length === 0) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (topParents.length > 1) {
    return { ok: false, code: "AMBIGUOUS" };
  }
  const parentId = topParents[0]!.id;
  const children = [];
  for (const c of all) {
    if (
      c.parentId === parentId &&
      nameEqualsInsensitive(c.name, leafName) &&
      (await usableLeaf(c.id))
    ) {
      children.push(c);
    }
  }
  if (children.length === 0) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (children.length > 1) {
    return { ok: false, code: "AMBIGUOUS" };
  }
  return { ok: true, id: children[0]!.id };
}

export async function deleteHouseholdCategory(
  householdId: string,
  categoryId: string,
  caller: { userId: string; role: string }
): Promise<{ ok: true } | DeleteCategoryFailure> {
  const row = await getCategoryInternal(categoryId);
  if (!row || row.householdId !== householdId) {
    return { ok: false, code: row ? "FORBIDDEN" : "NOT_FOUND" };
  }
  if (caller.role === "member" && row.createdByUserId !== caller.userId) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const child = await qGet(`SELECT 1 FROM category WHERE parent_id = ? LIMIT 1`, categoryId);
  if (child) {
    return { ok: false, code: "HAS_CHILDREN" };
  }

  const inUse = await qGet(`SELECT 1 FROM transaction_canonical WHERE category_id = ? LIMIT 1`, categoryId);
  if (inUse) {
    return { ok: false, code: "IN_USE" };
  }

  await qExec(`DELETE FROM category WHERE id = ? AND household_id = ?`, categoryId, householdId);
  return { ok: true };
}
