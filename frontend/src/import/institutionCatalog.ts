/**
 * Curated U.S. institution labels — keep in sync with
 * `backend/src/modules/imports/institution-catalog.ts`.
 */
export const US_INSTITUTION_LABELS: readonly string[] = [
  "Ally Bank",
  "American Express",
  "Bank of America",
  "Capital One",
  "Charles Schwab",
  "Chase",
  "Citibank",
  "Discover Bank",
  "Fidelity",
  "Goldman Sachs",
  "HSBC Bank USA",
  "JPMorgan Chase",
  "Marcus by Goldman Sachs",
  "Morgan Stanley",
  "Navy Federal Credit Union",
  "PNC Bank",
  "State Employees' Credit Union",
  "TD Bank",
  "Truist",
  "U.S. Bank",
  "USAA",
  "Wells Fargo"
];

/** Maps stored institution string to parser heuristics (must match backend `institution-catalog.ts`). */
export function normalizeInstitution(institution: string): "boa" | "chase" | "citi" | "marcus" | "other" {
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
