import { qAll, qExec, qGet } from "../../db/query.js";
import type { RecurringOverride } from "./recurring.types.js";

type RecurringOverrideDbRow = {
  id: string;
  householdId: string;
  merchantKey: string;
  displayName: string | null;
  verdict: "confirmed" | "dismissed";
  amountAnchor: string | null;
  amountTolerancePct: string;
  taggedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type UpsertRecurringOverrideInput = {
  merchantKey: string;
  displayName?: string;
  verdict: "confirmed" | "dismissed";
  amountAnchor?: number;
  amountTolerancePct?: number;
};

function mapOverride(row: RecurringOverrideDbRow): RecurringOverride {
  return {
    id: row.id,
    householdId: row.householdId,
    merchantKey: row.merchantKey,
    displayName: row.displayName,
    verdict: row.verdict,
    amountAnchor: row.amountAnchor == null ? null : Number(row.amountAnchor),
    amountTolerancePct: Number(row.amountTolerancePct),
    taggedByUserId: row.taggedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function listOverrides(householdId: string): Promise<RecurringOverride[]> {
  const rows = await qAll<RecurringOverrideDbRow>(
    `SELECT
       id,
       household_id AS "householdId",
       merchant_key AS "merchantKey",
       display_name AS "displayName",
       verdict,
       amount_anchor AS "amountAnchor",
       amount_tolerance_pct AS "amountTolerancePct",
       tagged_by_user_id AS "taggedByUserId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM recurring_merchant_override
     WHERE household_id = ?
     ORDER BY
       CASE verdict WHEN 'confirmed' THEN 0 ELSE 1 END,
       updated_at DESC`,
    householdId
  );
  return rows.map(mapOverride);
}

export async function upsertOverride(
  householdId: string,
  userId: string,
  input: UpsertRecurringOverrideInput
): Promise<RecurringOverride> {
  const merchantKey = input.merchantKey.trim().toLowerCase();
  const displayName = input.displayName?.trim() ? input.displayName.trim() : null;
  const amountAnchor = input.amountAnchor ?? null;
  const amountTolerancePct = input.amountTolerancePct ?? 15;

  await qExec(
    `INSERT INTO recurring_merchant_override
       (household_id, merchant_key, display_name, verdict, amount_anchor, amount_tolerance_pct, tagged_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (household_id, merchant_key)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       verdict = EXCLUDED.verdict,
       amount_anchor = EXCLUDED.amount_anchor,
       amount_tolerance_pct = EXCLUDED.amount_tolerance_pct,
       tagged_by_user_id = EXCLUDED.tagged_by_user_id,
       updated_at = NOW()`,
    householdId,
    merchantKey,
    displayName,
    input.verdict,
    amountAnchor,
    amountTolerancePct,
    userId
  );

  const row = await qGet<RecurringOverrideDbRow>(
    `SELECT
       id,
       household_id AS "householdId",
       merchant_key AS "merchantKey",
       display_name AS "displayName",
       verdict,
       amount_anchor AS "amountAnchor",
       amount_tolerance_pct AS "amountTolerancePct",
       tagged_by_user_id AS "taggedByUserId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM recurring_merchant_override
     WHERE household_id = ? AND merchant_key = ?`,
    householdId,
    merchantKey
  );
  if (!row) {
    throw new Error("Failed to load recurring override after upsert");
  }
  return mapOverride(row);
}

export async function deleteOverride(householdId: string, id: string): Promise<{ found: boolean }> {
  const row = await qGet<{ id: string }>(
    `SELECT id FROM recurring_merchant_override WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  if (!row) {
    return { found: false };
  }
  await qExec(`DELETE FROM recurring_merchant_override WHERE id = ? AND household_id = ?`, id, householdId);
  return { found: true };
}
