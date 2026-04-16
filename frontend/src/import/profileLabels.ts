/**
 * Profiles that are registered in the backend but not yet implemented.
 * The UI uses this to grey them out and show a tooltip instead of letting
 * the user select them and hit a server error.
 */
export const DISABLED_PROFILES: Record<string, string> = {
  capital_one_card_csv: "Capital One CSV is not yet supported — not available for import",
  adp_payslip_pdf: "ADP payslip parsing is not yet supported — not available for import"
};

/** Short, user-facing labels — avoid internal profile ids in the default UI. */
const FRIENDLY: Record<string, string> = {
  generic_tabular: "Spreadsheet (CSV or Excel)",
  chase_card_csv: "Chase card (CSV)",
  citi_card_csv: "Citi card (CSV)",
  boa_checking_csv: "Bank of America deposit account (CSV)",
  boa_savings_csv: "Bank of America deposit account (CSV)",
  boa_credit_card_csv: "Bank of America card (CSV)",
  boa_estatement_pdf: "Bank of America statement (PDF)",
  marcus_online_savings_pdf: "Marcus savings (PDF)",
  ibm_pay_contributions_pdf: "Employer payslip — IBM Pay & Contributions (PDF)",
  deloitte_payslip_pdf: "Employer payslip — Deloitte Pay Statement (PDF)",
  adp_payslip_pdf: "Employer payslip — ADP (PDF, not parsed yet)",
  ofx_transactions: "OFX / QFX / QBO (auto-detected)",
  discover_card_csv: "Discover card (CSV)",
  wealthfront_investment_csv: "Wealthfront savings / investment (CSV)",
  wealthfront_investment_pdf: "Wealthfront savings / investment (PDF)"
};

export function friendlyParserLabel(profileId: string): string {
  return FRIENDLY[profileId] ?? profileId.replace(/_/g, " ");
}
