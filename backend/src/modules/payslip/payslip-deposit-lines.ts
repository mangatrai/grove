/**
 * Deposit lines from `payslip_snapshot.payment_summary_json` — one reader for every parser profile:
 * LLM `payment_information[]` (IBM, Deloitte) and the Rippling text parser (same keys plus `trace`).
 *
 * LLM rows are inconsistent in practice: masks vary (`*****1234`, `XXXXXX1234`, `...234`), the account
 * number is sometimes null (off-cycle / bonus stubs), `payment_type` is null or free text, and routing
 * numbers land in `bank_name` / `bank_location`. Only the mask digits, amount, and trace are read.
 */

export type PayslipDepositLine = {
  /** Trailing digits of the printed account mask (`*****1234` → `1234`, `...234` → `234`); null when not printed. */
  accountSuffix: string | null;
  amount: number;
  /** ACH trace number when the payslip prints one (Rippling). */
  trace: string | null;
};

function parseRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Last run of digits in the mask; `null` when the mask has none. */
export function accountSuffixFromMask(mask: unknown): string | null {
  if (typeof mask !== "string") return null;
  const m = /(\d+)\D*$/.exec(mask);
  return m ? m[1]! : null;
}

/**
 * Deposits only: rows with a positive amount that are not checks. Accepts the stored JSON string or the
 * already-parsed value (`PayslipSnapshotRow.paymentSummaryJson`); anything malformed yields `[]`.
 */
export function getPayslipDepositLines(paymentSummaryJson: unknown): PayslipDepositLine[] {
  const lines: PayslipDepositLine[] = [];
  for (const row of parseRows(paymentSummaryJson)) {
    if (row == null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount <= 0) continue;
    if (typeof r.payment_type === "string" && /\bche(ck|que)\b/i.test(r.payment_type)) continue;
    lines.push({
      accountSuffix: accountSuffixFromMask(r.account_or_check_number_masked),
      amount: Math.round(r.amount * 100) / 100,
      trace: typeof r.trace === "string" && /^\d+$/.test(r.trace) ? r.trace : null
    });
  }
  return lines;
}
