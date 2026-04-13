/** Known parser profiles (Epic 2.3). Extend per institution/format. */
export const PARSER_PROFILE_IDS = [
  "generic_tabular",
  "chase_card_csv",
  "citi_card_csv",
  "boa_checking_csv",
  "boa_savings_csv",
  "boa_credit_card_csv",
  /** Epic 3 — text-based PDF eStatements */
  "boa_estatement_pdf",
  "marcus_online_savings_pdf",
  /** Epic 3.3 — employer payslip (summary only; stored in payslip_snapshot, not ledger) */
  "ibm_pay_contributions_pdf",
  /** Deloitte Pay Statement PDF — v1 uses same Current/YTD summary heuristics as IBM where text matches */
  "deloitte_payslip_pdf",
  /** Registered for onboarding; parse not implemented yet — use IBM or wait for ADP adapter */
  "adp_payslip_pdf",
  /** CR-071: OFX / QFX / QBO bank statement import */
  "ofx_transactions",
  /** CR-076: Discover card activity CSV */
  "discover_card_csv",
  /** CR-076: Wealthfront savings / investment account CSV */
  "wealthfront_investment_csv",
  /** Wealthfront savings / investment account PDF statement — stub, parser not yet implemented */
  "wealthfront_investment_pdf",
  /** Capital One card activity CSV — stub, format TBD */
  "capital_one_card_csv"
] as const;

export type ParserProfileId = (typeof PARSER_PROFILE_IDS)[number];

export function isParserProfileId(value: string): value is ParserProfileId {
  return (PARSER_PROFILE_IDS as readonly string[]).includes(value);
}
