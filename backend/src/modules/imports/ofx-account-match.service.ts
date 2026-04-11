/**
 * CR-071: Given OFX account metadata, find a matching financial_account
 * by account_mask (last-4 digits).
 */

import { qAll } from "../../db/query.js";

export interface OfxAccountSuggestion {
  /** Matching financial_account.id when exactly one account has the same last-4. */
  matchedAccountId: string | null;
  matchedAccountLabel: string | null;
  /** Last-4 digits from OFX ACCTID. */
  acctIdLast4: string | null;
  /** Normalized account type from OFX (checking | savings | credit_card | etc.). */
  normalizedAcctType: string | null;
  /** Institution name from OFX FI/ORG. */
  institution: string | null;
}

/** Map OFX ACCTTYPE to our financial_account.type enum values. */
function normalizeOfxAcctType(ofxType: string | null): string | null {
  if (!ofxType) {
    return null;
  }
  const t = ofxType.trim().toUpperCase();
  if (t === "CHECKING" || t === "CHECKING_ACCOUNT") {
    return "checking";
  }
  if (t === "SAVINGS" || t === "MONEYMRKT" || t === "CD") {
    return "savings";
  }
  if (t === "CREDITLINE" || t === "CREDIT") {
    return "credit_card";
  }
  return null;
}

export async function suggestAccountForOfx(
  householdId: string,
  acctId: string | null,
  acctType: string | null,
  institution: string | null
): Promise<OfxAccountSuggestion> {
  const last4 = acctId ? acctId.replace(/\s/g, "").slice(-4) : null;
  const normalizedAcctType = normalizeOfxAcctType(acctType);

  const suggestion: OfxAccountSuggestion = {
    matchedAccountId: null,
    matchedAccountLabel: null,
    acctIdLast4: last4,
    normalizedAcctType,
    institution: institution?.trim() || null
  };

  if (!last4) {
    return suggestion;
  }

  const accounts = await qAll<{
    id: string;
    institution: string;
    type: string;
    account_mask: string | null;
  }>(
    `SELECT id, institution, type, account_mask
       FROM financial_account
       WHERE household_id = ? AND account_mask = ? AND type != 'payslip'`,
    householdId,
    last4
  );

  if (accounts.length === 1) {
    const a = accounts[0]!;
    suggestion.matchedAccountId = a.id;
    suggestion.matchedAccountLabel = [
      a.institution,
      a.type,
      a.account_mask ? `(...${a.account_mask})` : null
    ]
      .filter(Boolean)
      .join(" ");
  }

  return suggestion;
}
