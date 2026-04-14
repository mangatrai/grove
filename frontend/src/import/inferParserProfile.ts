/**
 * Infer which registered parser profile to use from the financial account + file name.
 * BOA checking vs savings CSV share the same parser implementation; we always use
 * `boa_checking_csv` for both (see backend `import-parser.service.ts`).
 */
import { normalizeInstitution } from "./institutionCatalog";

export type FinancialAccountLike = {
  /** When set, enables salary-deposit + employer onboarding hints. */
  id?: string;
  type: string;
  institution: string;
};

/** Optional household income settings from `GET /household/settings` to improve payslip PDF inference. */
export type IncomeInferenceContext = {
  salaryDepositAccountId?: string | null;
  employers?: ReadonlyArray<{
    id: string;
    parserProfileId?: string;
    salaryDepositFinancialAccountId?: string | null;
  }>;
};

export const IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID = "ibm_pay_contributions_pdf";

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i < 0) {
    return "";
  }
  return fileName.slice(i).toLowerCase();
}

/**
 * Heuristic: PDF file names that often indicate an employer payslip (IBM / SuccessFactors-style).
 * Checked before institution PDF rules so a payslip on a checking account still suggests the payslip profile.
 */
/** Avoid treating typical bank eStatement names as payslips when using salary-deposit + employer hints. */
export function filenameLooksLikeBankStatementPdf(fileName: string | null | undefined): boolean {
  if (!fileName?.trim()) {
    return false;
  }
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  const lower = base.toLowerCase().replace(/\s+/g, " ");
  if (!lower.endsWith(".pdf")) {
    return false;
  }
  const stem = lower.slice(0, -4).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return /\bestmt\b/.test(stem) || /\bstatement\b/.test(stem) || /\btransactions?\b/.test(stem);
}

export function filenameSuggestsIbmPayslipPdf(fileName: string | null | undefined): boolean {
  if (!fileName?.trim()) {
    return false;
  }
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  const lower = base.toLowerCase().replace(/\s+/g, " ");
  if (!lower.endsWith(".pdf")) {
    return false;
  }
  const stem = lower.slice(0, -4);
  // `_` counts as a "word" char in JS `\b`; normalize so `jan_payslip` matches `\bpayslip\b`.
  const stemForMatch = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const patterns: RegExp[] = [
    /\bpayslip\b/,
    /\bpay[\s_-]?stub\b/,
    /\bpaycheck\b/,
    /\bpay[\s_-]?check\b/,
    /successfactors/,
    /\bpay[\s_-]and[\s_-]?contributions?\b/,
    /\bregular[\s_-]?pay\b/,
    /\bcommission[\s_-]?pay\b/,
    /\bearnings[\s_-]?statement\b/,
    /\bemployer[\s_-]?payslip\b/
  ];
  return patterns.some((re) => re.test(stemForMatch));
}

/**
 * Returns a parser profile id, or `null` if the combination needs a manual / generic profile.
 */
export function inferParserProfile(
  account: FinancialAccountLike | undefined,
  fileName: string | null | undefined,
  income?: IncomeInferenceContext
): string | null {
  if (!account || !fileName?.trim()) {
    return null;
  }
  const ext = extensionOf(fileName);
  const inst = normalizeInstitution(account.institution);
  const t = account.type.toLowerCase();

  /**
   * `financial_account.type === payslip` — synthetic import target (not a bank account).
   * Single employer: use that employer's parser (must match import binding). Multiple employers: no auto profile
   * (user picks employer; UI syncs `parserProfileId`). With no employer list, default to IBM for backward compatibility.
   */
  if (t === "payslip" && ext === ".pdf") {
    const emps = income?.employers;
    if (emps && emps.length > 1) {
      return null;
    }
    if (emps && emps.length === 1) {
      return emps[0]?.parserProfileId ?? IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
    }
    return IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
  }

  if (ext === ".pdf" && filenameSuggestsIbmPayslipPdf(fileName)) {
    return IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
  }

  const sal = income?.salaryDepositAccountId;
  const emps = income?.employers;
  const accId = account.id;
  if (ext === ".pdf" && accId && emps && emps.length > 0 && !filenameLooksLikeBankStatementPdf(fileName)) {
    const legacySalaryMatch = Boolean(sal && accId === sal);
    const matchedEmployer = emps.find(
      (e) => e.salaryDepositFinancialAccountId != null && accId === e.salaryDepositFinancialAccountId
    );
    if (legacySalaryMatch || matchedEmployer) {
      return (matchedEmployer ?? emps[0])?.parserProfileId ?? IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
    }
  }

  // OFX / QFX / QBO — profile is always ofx_transactions regardless of account type or institution.
  if (ext === ".ofx" || ext === ".qfx" || ext === ".qbo") {
    return "ofx_transactions";
  }

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

  const instLower = account.institution.toLowerCase();

  if (instLower.includes("discover") && t === "credit_card" && ext === ".csv") {
    return "discover_card_csv";
  }

  if (instLower.includes("wealthfront") && (t === "investment" || t === "savings" || t === "checking" || t === "retirement") && ext === ".csv") {
    return "wealthfront_investment_csv";
  }

  if (instLower.includes("wealthfront") && (t === "investment" || t === "savings" || t === "checking" || t === "retirement") && ext === ".pdf") {
    return "wealthfront_investment_pdf";
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
