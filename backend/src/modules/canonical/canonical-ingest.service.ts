import crypto from "node:crypto";

import { env } from "../../config/env.js";
import { isPgUniqueViolation, qAll, qBegin, qExec, qGet, sqlBind } from "../../db/query.js";
import { deleteStagingFilesForSession } from "../imports/import-session.service.js";
import type { NormalizedRawPayload } from "../imports/profiles/types.js";
import { classifyWithRules, type ClassificationResult } from "../category/category-rules.js";
import { listEnabledDbRulesForClassification } from "../category/category-rules.service.js";
import {
  computeTransactionFingerprint,
  descriptionsCompatibleForNearDuplicate,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "./transaction-fingerprint.js";

export interface CanonicalizeOutcome {
  inserted: number;
  duplicates: number;
  skipped: number;
  /** Same account/date/amount as an existing row but different fingerprint; routed to resolution queue. */
  nearDuplicates: number;
}

export type CanonicalizeFailure =
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "NO_RAW_ROWS"; message: string };

export {
  computeTransactionFingerprint,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "./transaction-fingerprint.js";

/** Visible label for transfer pairing (merchant + memo). */
function transferRowLabel(merchant: string | null, memo: string | null): string {
  const s = `${merchant ?? ""} ${memo ?? ""}`.trim();
  return s.length > 0 ? s : "";
}

function hasAnyPattern(labelUpper: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(labelUpper));
}

function transferPaymentPatternScore(debitLabel: string, creditLabel: string): number {
  const debitUpper = debitLabel.toUpperCase();
  const creditUpper = creditLabel.toUpperCase();

  const paymentTokens = [
    /\bPAYMENT\b/,
    /\bPMT\b/,
    /\bPYMT\b/,
    /\bAUTOPAY\b/,
    /\bAUTO\s*PAY\b/,
    /\bACH\b/,
    /\bE-?PAYMENT\b/,
    /\bEPAYMENT\b/,
    /\bMOBILE\s+PAYMENT\b/,
    /\bMOBILE\s+PMT\b/
  ];
  const loanTokens = [
    /\bLOAN\b/,
    /\bMORTGAGE\b/,
    /\bINSTALLMENT\b/,
    /\bAUTO\s+LOAN\b/,
    /\bSTUDENT\s+LOAN\b/,
    /\bHELOC\b/,
    /\bHOME\s+EQUITY\b/,
    /\bPERSONAL\s+LOAN\b/,
    /\bCAR\s+LOAN\b/,
    /\bAUTO\s+FINANCE\b/,
    /\bESCROW\b/,
    /\bREFI(NANCE)?\b/
  ];
  const cardTokens = [
    /\bCREDIT\s*CARD\b/,
    /\bCARDMEMBER\b/,
    /\bCARD\s+PAYMENT\b/,
    /\bCC\s+PAYMENT\b/,
    /\bPAY\s+CARD\b/,
    /\bCARD\b/,
    /\bVISA\b/,
    /\bMASTERCARD\b/,
    /\bAMEX\b/,
    /\bAMERICAN\s+EXPRESS\b/,
    /\bDISCOVER\b/,
    /\bDISCVR\b/
  ];
  const outgoingPaymentTokens = [
    /\bPAYMENT\s+TO\b/,
    /\bPAY\s+TO\b/,
    /\bACH\s+PAYMENT\b/,
    /\bONLINE\s+PAYMENT\b/,
    /\bWEB\s+(PAY|PMT)\b/,
    /\bAUTOPAY\b/,
    /\bAUTO\s*PAY\b/,
    /\bBILL\s+PAY\b/,
    // Card/loan payoff patterns that omit the directional "PAYMENT TO" phrasing.
    // We keep this fairly specific (requires PAYMENT + card/loan context elsewhere).
    /\bCARD\s*PAYMENT\b/,
    /\bHELOC\s+PAYMENT\b/,
    /\bLOAN\s+PAYMENT\b/,
    /\bMORTGAGE\s+PAYMENT\b/,
    /\bINSTALLMENT\s+PAYMENT\b/
  ];
  const incomingPaymentTokens = [
    /\bPAYMENT\s+RECEIVED\b/,
    /\bRECEIVED\s+PAYMENT\b/,
    /\bPMT\s+RECEIVED\b/,
    /\bTHANK\s+YOU\b/,
    /\bACH\s+CREDIT\b/,
    /\bCREDITED\b/,
    /\bPAYMENT\s+APPLIED\b/,
    /\bPRINCIPAL\s*(AND|&|,)?\s*INTEREST\b/
  ];

  const debitHasPayment = hasAnyPattern(debitUpper, paymentTokens);
  const creditHasPayment = hasAnyPattern(creditUpper, paymentTokens);
  const debitOutgoing = hasAnyPattern(debitUpper, outgoingPaymentTokens);
  const creditIncoming = hasAnyPattern(creditUpper, incomingPaymentTokens);
  const loanContext = hasAnyPattern(debitUpper, loanTokens) || hasAnyPattern(creditUpper, loanTokens);
  const cardContext = hasAnyPattern(debitUpper, cardTokens) || hasAnyPattern(creditUpper, cardTokens);

  /**
   * Card/loan payoff from checking: bank memo includes PAYMENT + outbound semantics + card/loan cues,
   * while the card/loan leg may only say THANK YOU / PMT RECEIVED (no literal "PAYMENT").
   * Narrow on purpose — avoids treating unrelated ACH + THANK YOU as a transfer.
   */
  if (
    debitHasPayment &&
    debitOutgoing &&
    (loanContext || cardContext) &&
    !creditHasPayment &&
    creditIncoming
  ) {
    return 88;
  }

  if (!debitHasPayment || !creditHasPayment) {
    return 0;
  }

  if (debitOutgoing && creditIncoming && (loanContext || cardContext)) {
    return 92;
  }
  if (debitOutgoing && creditIncoming) {
    return 82;
  }
  if (loanContext || cardContext) {
    return 62;
  }
  // Guardrail: "payment" words alone are too broad and can false-match.
  // Require directional complement or explicit loan/card context.
  return 0;
}

/**
 * Debit shows money leaving; credit shows money arriving — typical internal / linked-account memos.
 * Only used when amount/date/account pairing already matches elsewhere; keeps unrelated ACH pairs at 0.
 */
function transferInternalDirectionalMemoScore(debitLabel: string, creditLabel: string): number {
  const d = debitLabel.toUpperCase();
  const c = creditLabel.toUpperCase();
  const outgoing =
    /\b(TRANSFER|XFER)\s+TO\b|\bTRANSFER\s+OUT\b|\bXFER\s+OUT\b|\bWITHDRAWAL\s+TRANSFER\b|\bTRANSFER\s+TO\s+(SAVINGS|CHK(?:ING)?|MMA|MONEY\s+MARKET)\b/i;
  const incoming =
    /\b(TRANSFER|XFER)\s+FROM\b|\bTRANSFER\s+IN\b|\bXFER\s+IN\b|\bDEPOSIT\s+TRANSFER\b|\bTRANSFER\s+FROM\s+(SAVINGS|CHK(?:ING)?|MMA|MONEY\s+MARKET)\b/i;
  if (outgoing.test(d) && incoming.test(c)) {
    return 74;
  }
  return 0;
}

/**
 * Higher score = better same-transfer hypothesis (disambiguates multiple amount/date matches).
 * Exported for unit tests (Epic 5.2).
 */
export function transferPairScore(
  debitLabel: string,
  creditLabel: string,
  debitDate: string,
  creditDate: string,
  dateDiffDays: (a: string, b: string) => number
): number {
  const na = normalizeDescriptionForFingerprint(debitLabel);
  const nb = normalizeDescriptionForFingerprint(creditLabel);
  if (na === nb && na.length > 0) {
    return 100;
  }
  const paymentPatternScore = transferPaymentPatternScore(debitLabel, creditLabel);
  if (paymentPatternScore > 0) {
    return paymentPatternScore;
  }
  const internalDirectional = transferInternalDirectionalMemoScore(debitLabel, creditLabel);
  if (internalDirectional > 0) {
    return internalDirectional;
  }
  const ud = debitLabel.toUpperCase();
  const uc = creditLabel.toUpperCase();
  const both = (re: RegExp) => re.test(ud) && re.test(uc);
  if (both(/\b(MOBILE\s+TRANSFER|MOBILE\s+XFER|APP\s+TRANSFER)\b/i)) {
    return 76;
  }
  if (both(/\b(BOOK\s+TRANSFER|E-?FT|EFT\s+(CREDIT|DEBIT|PMT|PAYMENT|TRANSFER))\b|\bEFT\s+DEP\b|\bEFT\s+WDL\b/i)) {
    return 73;
  }
  if (both(/\b(ONLINE\s+)?TRANSFER\b|\bXFER\b|ACCT\s*(TO\s*)?TRANSFER|WEB\s+(PAY|PMT)\b|TEL\s+TRANSFER/i)) {
    return 80;
  }
  if (both(/\b(BILL\s*PAY|BILLPAY|ONLINE\s+BILL\s+PAY|BILL\s+PAYMENT)\b/i)) {
    return 77;
  }
  if (both(/\bZELLE\b/)) {
    return 75;
  }
  if (both(/\b(RTP|REAL[\s-]*TIME\s+PAY)\b/i)) {
    return 72;
  }
  if (both(/\b(APPLE\s+CASH|GOOGLE\s+PAY)\b/i)) {
    return 71;
  }
  if (both(/\b(VENMO|PAYPAL|CASH\s*APP)\b/i)) {
    return 70;
  }
  if (both(/\b(WIRE|W\/T)\b/i)) {
    return 68;
  }
  const days = dateDiffDays(debitDate, creditDate);
  if (days <= 1) {
    const short = 10;
    if (ud.length >= short && uc.length >= short && (ud.includes(uc.slice(0, short)) || uc.includes(ud.slice(0, short)))) {
      // Keep this weak: shared text alone should not force transfer matching.
      return 20;
    }
  }
  return 0;
}

type RawPayloadWithAccount = NormalizedRawPayload & { financial_account_id: string };

type CanonicalFileDiagnostics = {
  inserted: number;
  duplicateFingerprint: number;
  nearDuplicate: number;
  invalidJson: number;
  invalidPayloadShape: number;
  invalidAccount: number;
  invalidAmount: number;
};

function isRawPayload(value: unknown): value is RawPayloadWithAccount {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.txn_date === "string" &&
    typeof v.description === "string" &&
    typeof v.amount === "number" &&
    Number.isFinite(v.amount) &&
    typeof v.financial_account_id === "string" &&
    v.financial_account_id.length > 0
  );
}

function existingDescriptionFingerprint(merchant: string | null, memo: string | null): string {
  const s = (merchant || memo || "").trim();
  return normalizeDescriptionForFingerprint(s);
}

/**
 * Map `transaction_raw` rows for a session into `transaction_canonical` with strict fingerprint dedupe
 * (`uq_transaction_canonical_fingerprint` on household_id + fingerprint).
 * Near-duplicate rows (same account/date/amount, compatible description text, different fingerprint) are
 * skipped and recorded in `resolution_item` (type `duplicate_ambiguity`).
 */
export async function canonicalizeImportSession(
  sessionId: string,
  householdId: string
): Promise<{ ok: true; data: CanonicalizeOutcome } | CanonicalizeFailure> {
  const session = await qGet<{ id: string }>(
    `SELECT id FROM import_session WHERE id = ? AND household_id = ?`,
    sessionId,
    householdId
  );
  if (!session) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  const rawRows = await qAll<{
    raw_id: string;
    file_id: string;
    payload_json: string;
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
  }>(
    `SELECT tr.id AS raw_id, tr.file_id AS file_id, tr.extracted_payload_json AS payload_json,
              f.owner_scope AS owner_scope, f.owner_person_profile_id AS owner_person_profile_id
       FROM transaction_raw tr
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ?`,
    sessionId
  );

  if (rawRows.length === 0) {
    const payslipLinked = await qGet<{ ok: number }>(
      `SELECT 1 AS ok FROM payslip_snapshot ps
         INNER JOIN import_file f ON f.id = ps.import_file_id
         WHERE f.session_id = ?
         LIMIT 1`,
      sessionId
    );
    if (payslipLinked) {
      await deleteStagingFilesForSession(sessionId);
      return {
        ok: true,
        data: { inserted: 0, duplicates: 0, skipped: 0, nearDuplicates: 0 }
      };
    }
    return {
      ok: false,
      code: "NO_RAW_ROWS",
      message: "No transaction_raw rows for this session; run parse first"
    };
  }

  const insertedCanonicalRows: Array<{ id: string; txnDate: string }> = [];

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  function isoToUtcMidnightMs(isoDate: string): number {
    const t = isoDate.trim().slice(0, 10);
    const [y, m, d] = t.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return new Date(`${t}T00:00:00Z`).getTime();
    }
    return Date.UTC(y, m - 1, d);
  }
  function addDaysIso(isoDate: string, days: number): string {
    const ms = isoToUtcMidnightMs(isoDate) + days * MS_PER_DAY;
    return new Date(ms).toISOString().slice(0, 10);
  }
  function dateDiffDays(aIso: string, bIso: string): number {
    return Math.abs(isoToUtcMidnightMs(aIso) - isoToUtcMidnightMs(bIso)) / MS_PER_DAY;
  }

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;
  let nearDuplicates = 0;
  const dbRules = await listEnabledDbRulesForClassification(householdId);
  const fileDiagnostics = new Map<string, CanonicalFileDiagnostics>();
  const ensureFileDiag = (fileId: string): CanonicalFileDiagnostics => {
    const existing = fileDiagnostics.get(fileId);
    if (existing) {
      return existing;
    }
    const next: CanonicalFileDiagnostics = {
      inserted: 0,
      duplicateFingerprint: 0,
      nearDuplicate: 0,
      invalidJson: 0,
      invalidPayloadShape: 0,
      invalidAccount: 0,
      invalidAmount: 0
    };
    fileDiagnostics.set(fileId, next);
    return next;
  };

  const seenFingerprintsThisRun = new Set<string>();
  /** Fingerprints already queued in `ops` but not yet inserted (dedupe within same import run). */
  const fingerprintsAwaitingInsert = new Set<string>();
  /** reference_ids (FITID) already queued or inserted this run — avoids redundant DB check per row. */
  const seenReferenceIdsThisRun = new Set<string>();
  /** Same-session rows queued before DB insert — used so near-duplicate detection matches deferred canonicalize. */
  const pendingNearRows: Array<{
    accountId: string;
    normDate: string;
    rounded: number;
    fingerprint: string;
    merchant: string;
    memo: string | null;
  }> = [];
  type PendingCanonInsert = {
    row: (typeof rawRows)[number];
    parsed: RawPayloadWithAccount;
    normDate: string;
    normDesc: string;
    rounded: number;
    fingerprint: string;
    referenceId: string | null;
    classification: ClassificationResult;
    merchant: string;
    memo: string | null;
    direction: "credit" | "debit";
    diag: CanonicalFileDiagnostics;
  };
  const ops: PendingCanonInsert[] = [];

  async function insertCanonicalRow(p: PendingCanonInsert): Promise<void> {
    const { row, parsed, normDate, rounded, fingerprint, referenceId, classification, merchant, memo, direction, diag } = p;
    const categoryId = classification.categoryId;
    const classificationMeta = JSON.stringify({
      source: classification.source,
      ruleId: classification.ruleId,
      confidence: classification.confidence,
      reason: classification.reason
    });

    const canonicalId = crypto.randomUUID();
    const accountId = parsed.financial_account_id;

    try {
      await qExec(
        `INSERT INTO transaction_canonical (
       id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
       merchant, memo, transfer_group_id, fingerprint, reference_id, source_ref, status, classification_meta,
       owner_scope, owner_person_profile_id
     ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'posted', ?, ?, ?)`,
        canonicalId,
        householdId,
        accountId,
        categoryId,
        normDate,
        rounded,
        direction,
        merchant,
        memo,
        fingerprint,
        referenceId ?? null,
        `raw:${row.raw_id}`,
        classificationMeta,
        row.owner_scope ?? "household",
        row.owner_scope === "person" ? row.owner_person_profile_id : null
      );
      inserted += 1;
      diag.inserted += 1;
      insertedCanonicalRows.push({ id: canonicalId, txnDate: normDate });
      seenFingerprintsThisRun.add(fingerprint);
      if (referenceId) seenReferenceIdsThisRun.add(`${accountId}:${referenceId}`);
      {
        const pi = pendingNearRows.findIndex((r) => r.fingerprint === fingerprint);
        if (pi >= 0) {
          pendingNearRows.splice(pi, 1);
        }
      }
      // Uncategorized rows appear in Needs Review via category_id IS NULL — no resolution_item needed.
    } catch (err: unknown) {
      if (isPgUniqueViolation(err)) {
        duplicates += 1;
        diag.duplicateFingerprint += 1;
      } else {
        throw err;
      }
    } finally {
      fingerprintsAwaitingInsert.delete(fingerprint);
    }
  }

  async function drainOpsQueue(): Promise<void> {
    for (const p of ops) {
      await insertCanonicalRow(p);
    }
  }

  for (const row of rawRows) {
    const diag = ensureFileDiag(row.file_id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json) as unknown;
    } catch {
      skipped += 1;
      diag.invalidJson += 1;
      continue;
    }

    if (!isRawPayload(parsed)) {
      skipped += 1;
      diag.invalidPayloadShape += 1;
      continue;
    }

    const accountId = parsed.financial_account_id;
    const acctOk = await qGet<{ ok: number }>(
      `SELECT 1 AS ok FROM financial_account WHERE id = ? AND household_id = ?`,
      accountId,
      householdId
    );
    if (!acctOk) {
      skipped += 1;
      diag.invalidAccount += 1;
      continue;
    }

    const normDate = normalizeTxnDateForFingerprint(parsed.txn_date);
    const normDesc = normalizeDescriptionForFingerprint(parsed.description);
    const amount = parsed.amount;
    const rounded = normalizeAmountForFingerprint(amount);
    if (!Number.isFinite(rounded)) {
      skipped += 1;
      diag.invalidAmount += 1;
      continue;
    }

    // FITID / reference_id check — stronger than fingerprint for OFX imports.
    // Check this first so re-importing the same OFX file is always a no-op even
    // if description normalisation has changed.
    const referenceId: string | null = (parsed as { reference_id?: string | null }).reference_id?.trim() || null;
    if (referenceId) {
      const refKey = `${accountId}:${referenceId}`;
      if (seenReferenceIdsThisRun.has(refKey)) {
        duplicates += 1;
        diag.duplicateFingerprint += 1;
        continue;
      }
      const existsRef = await qGet<{ ok: number }>(
        `SELECT 1 AS ok FROM transaction_canonical WHERE account_id = ? AND reference_id = ?`,
        accountId,
        referenceId
      );
      if (existsRef) {
        duplicates += 1;
        diag.duplicateFingerprint += 1;
        continue;
      }
    }

    const fingerprint = computeTransactionFingerprint({
      householdId,
      accountId,
      txnDate: normDate,
      amount: rounded,
      normalizedDescription: normDesc
    });

    const existsFp = await qGet<{ ok: number }>(
      `SELECT 1 AS ok FROM transaction_canonical WHERE household_id = ? AND fingerprint = ?`,
      householdId,
      fingerprint
    );
    if (
      existsFp ||
      seenFingerprintsThisRun.has(fingerprint) ||
      fingerprintsAwaitingInsert.has(fingerprint)
    ) {
      duplicates += 1;
      diag.duplicateFingerprint += 1;
      continue;
    }

    const nearCandidates = await qAll<{
      id: string;
      fingerprint: string;
      merchant: string | null;
      memo: string | null;
      amount: number;
    }>(
      `SELECT id, fingerprint, merchant, memo, amount
     FROM transaction_canonical
     WHERE household_id = ? AND account_id = ? AND txn_date = ?
       AND ABS(CAST(amount AS DOUBLE PRECISION) - CAST(? AS DOUBLE PRECISION)) < 0.0001
       AND fingerprint != ?`,
      householdId,
      accountId,
      normDate,
      rounded,
      fingerprint
    );

    let isNear = false;
    for (const c of nearCandidates) {
      const existingNorm = existingDescriptionFingerprint(c.merchant, c.memo);
      if (descriptionsCompatibleForNearDuplicate(normDesc, existingNorm)) {
        isNear = true;
        await qExec(
          `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
     VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`,
          crypto.randomUUID(),
          householdId,
          row.raw_id,
          JSON.stringify({
            kind: "near_duplicate",
            existingCanonicalId: c.id,
            rawId: row.raw_id,
            message:
              "Same account, date, and amount as an existing ledger row with a similar but non-identical description fingerprint."
          })
        );
        break;
      }
    }

    if (!isNear) {
      for (const pr of pendingNearRows) {
        if (
          pr.accountId !== accountId ||
          pr.normDate !== normDate ||
          Math.abs(pr.rounded - rounded) >= 0.0001 ||
          pr.fingerprint === fingerprint
        ) {
          continue;
        }
        const existingNorm = existingDescriptionFingerprint(pr.merchant, pr.memo);
        if (descriptionsCompatibleForNearDuplicate(normDesc, existingNorm)) {
          isNear = true;
          await qExec(
            `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
     VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`,
            crypto.randomUUID(),
            householdId,
            row.raw_id,
            JSON.stringify({
              kind: "near_duplicate",
              existingCanonicalId: null,
              rawId: row.raw_id,
              message:
                "Same account, date, and amount as another row in this import with a similar but non-identical description fingerprint (pending insert)."
            })
          );
          break;
        }
      }
    }

    if (isNear) {
      nearDuplicates += 1;
      diag.nearDuplicate += 1;
      continue;
    }

    const direction = rounded >= 0 ? "credit" : "debit";
    const desc = parsed.description.trim();
    const merchant = desc.length > 120 ? desc.slice(0, 120) : desc;
    const memo = desc.length > 120 ? desc : null;

    const classification = classifyWithRules(normDesc, rounded, dbRules);
    const pending: PendingCanonInsert = {
      row,
      parsed,
      normDate,
      normDesc,
      rounded,
      fingerprint,
      classification,
      merchant,
      memo,
      direction,
      diag
    };

    fingerprintsAwaitingInsert.add(fingerprint);
    pendingNearRows.push({
      accountId,
      normDate,
      rounded,
      fingerprint,
      merchant,
      memo
    });
    ops.push(pending);
  }

  await drainOpsQueue();

  if (fileDiagnostics.size > 0) {
    const fileRows = await qAll<{ id: string; confidence_summary: string | null }>(
      `SELECT id, confidence_summary FROM import_file WHERE session_id = ?`,
      sessionId
    );
    for (const f of fileRows) {
      const canonical = fileDiagnostics.get(f.id);
      if (!canonical) {
        continue;
      }
      let base: Record<string, unknown> = {};
      if (f.confidence_summary) {
        try {
          const parsed = JSON.parse(f.confidence_summary) as unknown;
          if (parsed && typeof parsed === "object") {
            base = parsed as Record<string, unknown>;
          }
        } catch {
          base = {};
        }
      }
      const next = {
        ...base,
        canonicalize: {
          inserted: canonical.inserted,
          duplicateFingerprint: canonical.duplicateFingerprint,
          nearDuplicate: canonical.nearDuplicate,
          invalidJson: canonical.invalidJson,
          invalidPayloadShape: canonical.invalidPayloadShape,
          invalidAccount: canonical.invalidAccount,
          invalidAmount: canonical.invalidAmount
        }
      };
      await qExec(`UPDATE import_file SET confidence_summary = ? WHERE id = ?`, JSON.stringify(next), f.id);
    }
  }

  // Minimal transfer matcher:
  // - unambiguously set transfer_group_id for one-to-one debit/credit pairs between different accounts
  // - otherwise create resolution_item(type='transfer_ambiguity', status='open') for involved rows
  if (insertedCanonicalRows.length > 0) {
    const insertedDates = insertedCanonicalRows.map((r) => r.txnDate).sort();
    const windowStart = addDaysIso(insertedDates[0]!, -2);
    const windowEnd = addDaysIso(insertedDates[insertedDates.length - 1]!, 2);

    const candidates = await qAll<{
      id: string;
      accountId: string;
      txnDate: string;
      amount: number;
      merchant: string | null;
      memo: string | null;
    }>(
      `SELECT id, account_id AS "accountId", txn_date AS "txnDate", amount AS amount,
            merchant AS merchant, memo AS memo
     FROM transaction_canonical
     WHERE household_id = ?
       AND status = 'posted'
       AND transfer_group_id IS NULL
       AND txn_date >= ? AND txn_date <= ?`,
      householdId,
      windowStart,
      windowEnd
    );

    const debitRows: Array<{
      id: string;
      accountId: string;
      txnDate: string;
      centsAbs: number;
      label: string;
    }> = [];
    const creditRows: Array<{
      id: string;
      accountId: string;
      txnDate: string;
      centsAbs: number;
      label: string;
    }> = [];

    for (const r of candidates) {
      const centsSigned = Math.round(Number(r.amount) * 100);
      const centsAbs = Math.abs(centsSigned);
      if (!Number.isFinite(centsAbs) || centsAbs === 0) {
        continue;
      }
      const label = transferRowLabel(r.merchant, r.memo);
      if (centsSigned < 0) {
        debitRows.push({ id: r.id, accountId: r.accountId, txnDate: r.txnDate, centsAbs, label });
      } else {
        creditRows.push({ id: r.id, accountId: r.accountId, txnDate: r.txnDate, centsAbs, label });
      }
    }

    // Stable order for deterministic matching/resolution.
    debitRows.sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.id.localeCompare(b.id));
    creditRows.sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.id.localeCompare(b.id));

    const matched = new Set<string>();
    const insertedAmbiguityTargets = new Set<string>();

    await qBegin(async (tx) => {
      const txGet = async <T extends object>(sqlStr: string, ...params: unknown[]): Promise<T | undefined> => {
        const { text, values } = sqlBind(sqlStr, params);
        const rows = await tx.unsafe(text, values as never[]);
        return Array.from(rows as Iterable<T>)[0];
      };
      const txExec = async (sqlStr: string, ...params: unknown[]): Promise<void> => {
        const { text, values } = sqlBind(sqlStr, params);
        await tx.unsafe(text, values as never[]);
      };
      for (const debit of debitRows) {
        if (matched.has(debit.id)) continue;

        let matchingCredits = creditRows.filter((c) => {
          if (matched.has(c.id)) return false;
          if (c.accountId === debit.accountId) return false;
          if (c.centsAbs !== debit.centsAbs) return false;
          return dateDiffDays(debit.txnDate, c.txnDate) <= 2;
        });

        if (matchingCredits.length > 1) {
          const scored = matchingCredits
            .map((c) => ({
              c,
              score: transferPairScore(debit.label, c.label, debit.txnDate, c.txnDate, dateDiffDays)
            }))
            .sort((a, b) => b.score - a.score);
          const best = scored[0]!;
          const second = scored[1];
          if (
            best.score >= env.TRANSFER_DISAMBIG_STRONG_MIN_SCORE &&
            (!second || second.score < best.score - env.TRANSFER_DISAMBIG_STRONG_GAP)
          ) {
            matchingCredits = [best.c];
          } else if (
            best.score >= env.TRANSFER_DISAMBIG_WEAK_MIN_SCORE &&
            (!second || second.score < env.TRANSFER_DISAMBIG_WEAK_MAX_SECOND_SCORE)
          ) {
            matchingCredits = [best.c];
          }
        }

        if (matchingCredits.length === 0) continue;

        if (matchingCredits.length !== 1) {
          // Ambiguous: this debit matches multiple credit candidates.
          const candidateScores = matchingCredits
            .map((c) => ({
              creditId: c.id,
              score: transferPairScore(debit.label, c.label, debit.txnDate, c.txnDate, dateDiffDays)
            }))
            .sort((a, b) => b.score - a.score);
          const involvedTargetIds = new Set<string>([debit.id, ...matchingCredits.map((c) => c.id)]);
          const reason = JSON.stringify({
            kind: "transfer_ambiguity",
            debitId: debit.id,
            creditCandidateIds: matchingCredits.map((c) => c.id),
            dateWindow: { start: windowStart, end: windowEnd },
            closeDateToleranceDays: 2,
            matcherTelemetry: {
              phase: "debit_to_credits",
              debitLabel: debit.label,
              candidateScores
            }
          });

          for (const targetId of involvedTargetIds) {
            if (insertedAmbiguityTargets.has(targetId)) continue;
            const exists = await txGet<{ ok: number }>(
              `SELECT 1 AS ok
     FROM resolution_item
     WHERE household_id = ?
       AND type = 'transfer_ambiguity'
       AND status IN ('open', 'in_review')
       AND target_id = ?
     LIMIT 1`,
              householdId,
              targetId
            );
            if (exists) continue;
            await txExec(
              `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
     VALUES (?, ?, 'transfer_ambiguity', ?, ?, 'open')`,
              crypto.randomUUID(),
              householdId,
              targetId,
              reason
            );
            insertedAmbiguityTargets.add(targetId);
          }
          continue;
        }

        const credit = matchingCredits[0]!;
        let matchingDebitsForCredit = debitRows.filter((d) => {
          if (matched.has(d.id)) return false;
          if (d.accountId === credit.accountId) return false;
          if (d.centsAbs !== credit.centsAbs) return false;
          return dateDiffDays(d.txnDate, credit.txnDate) <= 2;
        });

        if (matchingDebitsForCredit.length > 1) {
          const scored = matchingDebitsForCredit
            .map((d) => ({
              d,
              score: transferPairScore(d.label, credit.label, d.txnDate, credit.txnDate, dateDiffDays)
            }))
            .sort((a, b) => b.score - a.score);
          const best = scored[0]!;
          const second = scored[1];
          if (
            best.score >= env.TRANSFER_DISAMBIG_STRONG_MIN_SCORE &&
            (!second || second.score < best.score - env.TRANSFER_DISAMBIG_STRONG_GAP)
          ) {
            matchingDebitsForCredit = [best.d];
          } else if (
            best.score >= env.TRANSFER_DISAMBIG_WEAK_MIN_SCORE &&
            (!second || second.score < env.TRANSFER_DISAMBIG_WEAK_MAX_SECOND_SCORE)
          ) {
            matchingDebitsForCredit = [best.d];
          }
        }

        if (matchingDebitsForCredit.length === 1) {
          const pairScore = transferPairScore(
            debit.label,
            credit.label,
            debit.txnDate,
            credit.txnDate,
            dateDiffDays
          );
          if (pairScore < env.TRANSFER_MIN_AUTO_PAIR_SCORE) {
            // Amount/date/account pairing alone is not enough — avoids false positives when memos are unrelated.
            const reason = JSON.stringify({
              kind: "transfer_ambiguity",
              phase: "low_pair_score",
              debitId: debit.id,
              creditId: credit.id,
              pairScore,
              minAutoScore: env.TRANSFER_MIN_AUTO_PAIR_SCORE,
              debitLabel: debit.label,
              creditLabel: credit.label,
              dateWindow: { start: windowStart, end: windowEnd },
              closeDateToleranceDays: 2,
              matcherTelemetry: {
                message:
                  "One-to-one amount/date match across accounts, but description pairing score is below the auto-match threshold."
              }
            });
            for (const targetId of [debit.id, credit.id] as const) {
              if (insertedAmbiguityTargets.has(targetId)) continue;
              const exists = await txGet<{ ok: number }>(
                `SELECT 1 AS ok
     FROM resolution_item
     WHERE household_id = ?
       AND type = 'transfer_ambiguity'
       AND status IN ('open', 'in_review')
       AND target_id = ?
     LIMIT 1`,
                householdId,
                targetId
              );
              if (exists) continue;
              await txExec(
                `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
     VALUES (?, ?, 'transfer_ambiguity', ?, ?, 'open')`,
                crypto.randomUUID(),
                householdId,
                targetId,
                reason
              );
              insertedAmbiguityTargets.add(targetId);
            }
            continue;
          }
          // Unambiguous mutual match: assign one transfer_group_id for both rows.
          const groupId = crypto.randomUUID();
          await txExec(
            `UPDATE transaction_canonical
     SET transfer_group_id = ?
     WHERE id = ? AND transfer_group_id IS NULL`,
            groupId,
            debit.id
          );
          await txExec(
            `UPDATE transaction_canonical
     SET transfer_group_id = ?
     WHERE id = ? AND transfer_group_id IS NULL`,
            groupId,
            credit.id
          );
          matched.add(debit.id);
          matched.add(credit.id);
          continue;
        }

        // Ambiguous: this credit matches multiple debits (mutual one-to-one requirement failed).
        const candidateScores = matchingDebitsForCredit
          .map((d) => ({
            debitId: d.id,
            score: transferPairScore(d.label, credit.label, d.txnDate, credit.txnDate, dateDiffDays)
          }))
          .sort((a, b) => b.score - a.score);
        const involvedTargetIds = new Set<string>([
          credit.id,
          ...matchingDebitsForCredit.map((d) => d.id)
        ]);
        const reason = JSON.stringify({
          kind: "transfer_ambiguity",
          creditId: credit.id,
          debitCandidateIds: matchingDebitsForCredit.map((d) => d.id),
          dateWindow: { start: windowStart, end: windowEnd },
          closeDateToleranceDays: 2,
          matcherTelemetry: {
            phase: "credit_to_debits",
            creditLabel: credit.label,
            candidateScores
          }
        });

        for (const targetId of involvedTargetIds) {
          if (insertedAmbiguityTargets.has(targetId)) continue;
          const exists = await txGet<{ ok: number }>(
            `SELECT 1 AS ok
     FROM resolution_item
     WHERE household_id = ?
       AND type = 'transfer_ambiguity'
       AND status IN ('open', 'in_review')
       AND target_id = ?
     LIMIT 1`,
            householdId,
            targetId
          );
          if (exists) continue;
          await txExec(
            `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
     VALUES (?, ?, 'transfer_ambiguity', ?, ?, 'open')`,
            crypto.randomUUID(),
            householdId,
            targetId,
            reason
          );
          insertedAmbiguityTargets.add(targetId);
        }
      }
    });
  }

  await deleteStagingFilesForSession(sessionId);

  return { ok: true, data: { inserted, duplicates, skipped, nearDuplicates } };
}
