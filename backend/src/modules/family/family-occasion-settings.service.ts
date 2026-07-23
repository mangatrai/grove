import { qExec, qGet } from "../../db/query.js";

export type OccasionSettings = {
  householdId: string;
  enabled: boolean;
};

export async function getOccasionSettings(householdId: string): Promise<OccasionSettings> {
  const row = await qGet<{ factText: string }>(
    `SELECT fact_text AS "factText"
       FROM household_pa_preferences
      WHERE household_id = ? AND category = 'settings' AND topic_tag = 'occasion_nudges'`,
    householdId
  );
  return { householdId, enabled: row ? row.factText === "true" : true };
}

export async function setOccasionSettings(
  householdId: string,
  enabled: boolean
): Promise<OccasionSettings> {
  await qExec(
    `INSERT INTO household_pa_preferences (household_id, category, topic_tag, fact_text, source, updated_at)
     VALUES (?, 'settings', 'occasion_nudges', ?, 'manual', NOW())
     ON CONFLICT (household_id, topic_tag) WHERE category = 'settings'
     DO UPDATE SET fact_text = EXCLUDED.fact_text, updated_at = NOW()`,
    householdId,
    enabled ? "true" : "false"
  );
  return { householdId, enabled };
}
