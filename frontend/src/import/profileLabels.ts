/** Short, user-facing labels — avoid internal profile ids in the default UI. */
const FRIENDLY: Record<string, string> = {
  generic_tabular: "Spreadsheet (CSV or Excel)",
  chase_card_csv: "Chase card (CSV)",
  citi_card_csv: "Citi card (CSV)",
  boa_checking_csv: "Bank of America deposit account (CSV)",
  boa_savings_csv: "Bank of America deposit account (CSV)",
  boa_credit_card_csv: "Bank of America card (CSV)",
  boa_estatement_pdf: "Bank of America statement (PDF)",
  marcus_online_savings_pdf: "Marcus savings (PDF)"
};

export function friendlyParserLabel(profileId: string): string {
  return FRIENDLY[profileId] ?? profileId.replace(/_/g, " ");
}
