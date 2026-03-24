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
  "marcus_online_savings_pdf"
] as const;

export type ParserProfileId = (typeof PARSER_PROFILE_IDS)[number];

export function isParserProfileId(value: string): value is ParserProfileId {
  return (PARSER_PROFILE_IDS as readonly string[]).includes(value);
}
