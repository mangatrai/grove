/**
 * Curated U.S. institution display labels for Connected accounts (Settings).
 * Parsers are inferred from institution + account type + file extension — see `infer-parser-profile.ts`.
 * Keep labels aligned with `normalizeInstitutionKey` so imports map to the right parser.
 */
export const US_INSTITUTION_LABELS: readonly string[] = [
  "Cash & Wallet",
  "Ally Bank",
  "American Express",
  "Bank of America",
  "Betterment",
  "Capital One",
  "Charles Schwab",
  "Chase",
  "Citibank",
  "Coinbase",
  "Discover Bank",
  "E*TRADE",
  "Fidelity",
  "Fundrise",
  "Goldman Sachs",
  "HSBC Bank USA",
  "JPMorgan Chase",
  "Marcus by Goldman Sachs",
  "Morgan Stanley",
  "Navy Federal Credit Union",
  "PNC Bank",
  "Robinhood",
  "State Employees' Credit Union",
  "T. Rowe Price",
  "TD Bank",
  "Truist",
  "U.S. Bank",
  "USAA",
  "Vanguard",
  "Wealthfront",
  "Wells Fargo"
];

export function listUsInstitutionLabels(): string[] {
  return [...US_INSTITUTION_LABELS];
}

/** Maps stored institution string to parser heuristics (must match frontend `institutionCatalog.ts`). */
export function normalizeInstitutionKey(institution: string): "boa" | "chase" | "citi" | "marcus" | "other" {
  const s = institution.toLowerCase();
  if (s.includes("bank of america") || s === "boa") {
    return "boa";
  }
  if (s.includes("marcus") || s.includes("goldman")) {
    return "marcus";
  }
  if (s.includes("chase") || s.includes("jpmorgan")) {
    return "chase";
  }
  if (s.includes("citi")) {
    return "citi";
  }
  return "other";
}
