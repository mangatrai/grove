import { qAll, qExec } from "../../db/query.js";
import { normalizeDescriptionForFingerprint } from "../canonical/transaction-fingerprint.js";
import { classifyWithRules, type ClassificationResult } from "./category-rules.js";
import { listEnabledDbRulesForClassification } from "./category-rules.service.js";

function ledgerNormDesc(merchant: string | null, memo: string | null): string {
  const s = `${merchant ?? ""} ${memo ?? ""}`.trim();
  return normalizeDescriptionForFingerprint(s);
}

export type RecategorizeMode = "uncategorized_only" | "all";

/**
 * Re-run DB + built-in rules over existing posted canonical rows.
 * Does not change rows that still classify to null (unknown).
 */
export async function recategorizeHouseholdTransactions(
  householdId: string,
  mode: RecategorizeMode
): Promise<{ ok: true; examined: number; updated: number }> {
  const dbRules = await listEnabledDbRulesForClassification(householdId);
  const where =
    mode === "uncategorized_only"
      ? "tc.household_id = ? AND tc.status = 'posted' AND tc.category_id IS NULL"
      : "tc.household_id = ? AND tc.status = 'posted'";

  const rows = await qAll<{
    id: string;
    amount: number;
    merchant: string | null;
    memo: string | null;
    category_id: string | null;
  }>(
    `SELECT tc.id AS id, tc.amount AS amount, tc.merchant AS merchant, tc.memo AS memo, tc.category_id AS category_id
       FROM transaction_canonical tc
       WHERE ${where}`,
    householdId
  );

  let updated = 0;
  for (const r of rows) {
    const rounded = typeof r.amount === "number" ? r.amount : Number(r.amount);
    const norm = ledgerNormDesc(r.merchant, r.memo);
    const classification: ClassificationResult = classifyWithRules(norm, rounded, dbRules);
    const next = classification.categoryId;
    if (next !== null && next !== r.category_id) {
      await qExec(
        `UPDATE transaction_canonical SET category_id = ? WHERE id = ? AND household_id = ?`,
        next,
        r.id,
        householdId
      );
      updated += 1;
    }
  }

  return { ok: true, examined: rows.length, updated };
}
