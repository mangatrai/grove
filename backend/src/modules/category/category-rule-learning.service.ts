import { qAll, qGet } from "../../db/query.js";
import { normalizeAmountForFingerprint, normalizeDescriptionForFingerprint } from "../canonical/transaction-fingerprint.js";
import { classifyWithRules, type ClassificationResult } from "./category-rules.js";
import { listEnabledDbRulesForClassification } from "./category-rules.service.js";
import type { NormalizedRawPayload } from "../imports/profiles/types.js";

function isPayload(v: unknown): v is NormalizedRawPayload {
  if (!v || typeof v !== "object") {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o.txn_date === "string" &&
    typeof o.description === "string" &&
    typeof o.amount === "number" &&
    Number.isFinite(o.amount)
  );
}

export type RuleLearningRow = {
  rawId: string;
  fileId: string;
  rowIndex: number;
  txnDate: string;
  amount: number;
  description: string;
  normalizedDescription: string;
  classification: ClassificationResult;
};

/**
 * Parsed raw rows for an import session (after parse), with preview classification.
 */
export async function listRuleLearningPreviewForSession(
  sessionId: string,
  householdId: string
): Promise<{ ok: true; rows: RuleLearningRow[] } | { ok: false; code: "NOT_FOUND" }> {
  const sessionOk = await qGet<{ ok: number }>(
    `SELECT 1 AS ok FROM import_session WHERE id = ? AND household_id = ?`,
    sessionId,
    householdId
  );
  if (!sessionOk) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const dbRules = await listEnabledDbRulesForClassification(householdId);
  const rawRows = await qAll<{
    rawId: string;
    fileId: string;
    rowIndex: number;
    payloadJson: string;
  }>(
    `SELECT tr.id AS "rawId", tr.file_id AS "fileId", tr.row_index AS "rowIndex", tr.extracted_payload_json AS "payloadJson"
       FROM transaction_raw tr
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ?
       ORDER BY f.id ASC, tr.row_index ASC`,
    sessionId
  );

  const out: RuleLearningRow[] = [];
  for (const rr of rawRows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rr.payloadJson) as unknown;
    } catch {
      continue;
    }
    if (!isPayload(parsed)) {
      continue;
    }
    const normDesc = normalizeDescriptionForFingerprint(parsed.description);
    const rounded = normalizeAmountForFingerprint(parsed.amount);
    const classification = classifyWithRules(normDesc, rounded, dbRules);
    out.push({
      rawId: rr.rawId,
      fileId: rr.fileId,
      rowIndex: rr.rowIndex,
      txnDate: parsed.txn_date,
      amount: rounded,
      description: parsed.description,
      normalizedDescription: normDesc,
      classification
    });
  }

  return { ok: true, rows: out };
}
