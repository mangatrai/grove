/**
 * Server-side mirror of `frontend/src/import/inferParserProfile.ts` for parity and future server defaults.
 */
import { normalizeInstitutionKey } from "./institution-catalog.js";

export type FinancialAccountLike = {
  id?: string;
  type: string;
  institution: string;
};

export type IncomeInferenceContext = {
  salaryDepositAccountId?: string | null;
  employers?: ReadonlyArray<{ id: string; parserProfileId?: string }>;
};

export const IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID = "ibm_pay_contributions_pdf";

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i < 0) {
    return "";
  }
  return fileName.slice(i).toLowerCase();
}

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
 * Returns a parser profile id, or `null` if the combination needs generic tabular / manual binding.
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
  const inst = normalizeInstitutionKey(account.institution);
  const t = account.type.toLowerCase();

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
  if (
    ext === ".pdf" &&
    accId &&
    sal &&
    accId === sal &&
    emps &&
    emps.length > 0 &&
    !filenameLooksLikeBankStatementPdf(fileName)
  ) {
    return emps[0]?.parserProfileId ?? IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
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

  return null;
}
