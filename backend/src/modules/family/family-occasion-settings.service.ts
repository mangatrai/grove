import { qExec, qGet } from "../../db/query.js";

export type OccasionSettings = {
  householdId: string;
  enabled: boolean;
};

export async function getOccasionSettings(householdId: string): Promise<OccasionSettings> {
  const row = await qGet<{ enabled: boolean }>(
    `SELECT enabled FROM family_occasion_settings WHERE household_id = ?`,
    householdId
  );
  return { householdId, enabled: row?.enabled ?? true };
}

export async function setOccasionSettings(
  householdId: string,
  enabled: boolean
): Promise<OccasionSettings> {
  await qExec(
    `INSERT INTO family_occasion_settings (household_id, enabled, updated_at)
     VALUES (?, ?, NOW())
     ON CONFLICT (household_id)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    householdId,
    enabled
  );
  return { householdId, enabled };
}
