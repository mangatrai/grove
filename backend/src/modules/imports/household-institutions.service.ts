import { randomUUID } from "node:crypto";

import { db } from "../../db/sqlite.js";

export type CustomInstitutionRow = {
  id: string;
  displayName: string;
};

export function listHouseholdCustomInstitutions(householdId: string): CustomInstitutionRow[] {
  const rows = db
    .prepare(
      `SELECT id, display_name AS displayName
       FROM household_custom_institution
       WHERE household_id = ?
       ORDER BY display_name COLLATE NOCASE`
    )
    .all(householdId) as CustomInstitutionRow[];
  return rows;
}

export function createHouseholdCustomInstitution(
  householdId: string,
  displayName: string
): { ok: true; id: string } | { ok: false; code: "DUPLICATE" | "INVALID" } {
  const trimmed = displayName.trim();
  if (trimmed.length < 2 || trimmed.length > 120) {
    return { ok: false, code: "INVALID" };
  }
  const lower = trimmed.toLowerCase();
  const dup = db
    .prepare(
      `SELECT id FROM household_custom_institution
       WHERE household_id = ? AND lower(display_name) = ?`
    )
    .get(householdId, lower) as { id: string } | undefined;
  if (dup) {
    return { ok: false, code: "DUPLICATE" };
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO household_custom_institution (id, household_id, display_name)
     VALUES (?, ?, ?)`
  ).run(id, householdId, trimmed);
  return { ok: true, id };
}
