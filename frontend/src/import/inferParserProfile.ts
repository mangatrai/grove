/**
 * Infer which registered parser profile to use from the financial account + file name.
 * BOA checking vs savings CSV share the same parser implementation; we always use
 * `boa_checking_csv` for both (see backend `import-parser.service.ts`).
 */
export type FinancialAccountLike = {
  type: string;
  institution: string;
};

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i < 0) {
    return "";
  }
  return fileName.slice(i).toLowerCase();
}

function normalizeInstitution(institution: string): "boa" | "chase" | "citi" | "marcus" | "other" {
  const s = institution.toLowerCase();
  if (s.includes("bank of america") || s === "boa") {
    return "boa";
  }
  if (s.includes("marcus") || s.includes("goldman")) {
    return "marcus";
  }
  if (s.includes("chase")) {
    return "chase";
  }
  if (s.includes("citi")) {
    return "citi";
  }
  return "other";
}

/**
 * Returns a parser profile id, or `null` if the combination needs a manual / generic profile.
 */
export function inferParserProfile(
  account: FinancialAccountLike | undefined,
  fileName: string | null | undefined
): string | null {
  if (!account || !fileName?.trim()) {
    return null;
  }
  const ext = extensionOf(fileName);
  const inst = normalizeInstitution(account.institution);
  const t = account.type.toLowerCase();

  if (inst === "marcus" && t === "savings" && ext === ".pdf") {
    return "marcus_online_savings_pdf";
  }

  if (inst === "boa") {
    if (t === "credit_card" && ext === ".csv") {
      return "boa_credit_card_csv";
    }
    if ((t === "checking" || t === "savings") && ext === ".csv") {
      return "boa_checking_csv";
    }
    if ((t === "checking" || t === "savings") && ext === ".pdf") {
      return "boa_estatement_pdf";
    }
  }

  if (inst === "chase" && t === "credit_card" && ext === ".csv") {
    return "chase_card_csv";
  }

  if (inst === "citi" && t === "credit_card" && ext === ".csv") {
    return "citi_card_csv";
  }

  return null;
}

/** Backend uses the same parser for BOA checking vs savings CSV; ids are interchangeable. */
export function profilesEquivalent(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const pair = new Set([a, b]);
  return pair.has("boa_checking_csv") && pair.has("boa_savings_csv");
}
