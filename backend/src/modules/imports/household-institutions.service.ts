import { randomUUID } from "node:crypto";

import { isPgUniqueViolation, qAll, qExec, qGet } from "../../db/query.js";

export type CustomInstitutionRow = {
  id: string;
  displayName: string;
};

export async function listHouseholdCustomInstitutions(householdId: string): Promise<CustomInstitutionRow[]> {
  return qAll<CustomInstitutionRow>(
    `SELECT id, display_name AS "displayName"
       FROM household_custom_institution
       WHERE household_id = ?
       ORDER BY LOWER(display_name)`,
    householdId
  );
}

export async function createHouseholdCustomInstitution(
  householdId: string,
  displayName: string
): Promise<{ ok: true; id: string } | { ok: false; code: "DUPLICATE" | "INVALID" }> {
  const trimmed = displayName.trim();
  if (trimmed.length < 2 || trimmed.length > 120) {
    return { ok: false, code: "INVALID" };
  }
  const lower = trimmed.toLowerCase();
  const dup = await qGet<{ id: string }>(
    `SELECT id FROM household_custom_institution
       WHERE household_id = ? AND LOWER(display_name) = ?`,
    householdId,
    lower
  );
  if (dup) {
    return { ok: false, code: "DUPLICATE" };
  }
  const id = randomUUID();
  try {
    await qExec(
      `INSERT INTO household_custom_institution (id, household_id, display_name)
     VALUES (?, ?, ?)`,
      id,
      householdId,
      trimmed
    );
  } catch (e) {
    if (isPgUniqueViolation(e)) {
      return { ok: false, code: "DUPLICATE" };
    }
    throw e;
  }
  return { ok: true, id };
}
