/**
 * IBM “Pay and Contributions” / SuccessFactors-style payslips.
 * Baseline: `tests/fixtures/ibm-payslip-sample.txt` (single-line labels + amounts).
 * Real `pdf-parse` output often splits labels and amounts onto separate lines; see tests for multiline extract.
 */
import { extractPdfText } from "../../imports/profiles/pdf-text.js";
import type { ParsedPayslipSummary } from "../payslip.types.js";

const MONEY = /-?[\d,]+\.\d{2}/g;

/** NBSP and odd spacing from PDF engines — normalize before matching. */
export function normalizePdfExtractText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\u2009/g, " ");
}

function parseMoneyToken(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Last two decimal amounts on a line → Current, YTD (IBM summary strip). */
export function parseCurrentYtdPair(line: string): { current: number | null; ytd: number | null } {
  const matches = line.match(MONEY);
  if (!matches || matches.length === 0) {
    return { current: null, ytd: null };
  }
  if (matches.length === 1) {
    const v = parseMoneyToken(matches[0]!);
    return { current: v, ytd: null };
  }
  const current = parseMoneyToken(matches[matches.length - 2]!);
  const ytd = parseMoneyToken(matches[matches.length - 1]!);
  return { current, ytd };
}

function normalizeUsDateToIso(mmddyyyy: string): string | null {
  const m = mmddyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return null;
  }
  const mo = m[1]!.padStart(2, "0");
  const d = m[2]!.padStart(2, "0");
  const y = m[3]!;
  return `${y}-${mo}-${d}`;
}

function parsePayPeriod(text: string): { start: string | null; end: string | null } {
  /** IBM SuccessFactors PDFs: pay range often appears alone on its own line, e.g. `02/16/2026-02/28/2026`. */
  const standaloneRange = text.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/
  );
  if (standaloneRange) {
    return {
      start: normalizeUsDateToIso(standaloneRange[1]!) ?? standaloneRange[1]!,
      end: normalizeUsDateToIso(standaloneRange[2]!) ?? standaloneRange[2]!
    };
  }

  const oneLine = text.replace(/\s+/g, " ");
  let m = oneLine.match(
    /Pay\s+Period:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
  );
  if (m) {
    return {
      start: normalizeUsDateToIso(m[1]!) ?? m[1]!,
      end: normalizeUsDateToIso(m[2]!) ?? m[2]!
    };
  }
  m = text.match(/Pay\s+Period\s+Beginning\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const mEnd = text.match(/Pay\s+Period\s+Ending\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (m && mEnd) {
    return {
      start: normalizeUsDateToIso(m[1]!) ?? m[1]!,
      end: normalizeUsDateToIso(mEnd[1]!) ?? mEnd[1]!
    };
  }
  const mBegin = text.match(
    /(?:Pay\s+Begin(?:ning)?|Period\s+Begin(?:ning)?)\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
  );
  const mEnd2 = text.match(
    /(?:Pay\s+End(?:ing)?|Period\s+End(?:ing)?)\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
  );
  if (mBegin && mEnd2) {
    return {
      start: normalizeUsDateToIso(mBegin[1]!) ?? mBegin[1]!,
      end: normalizeUsDateToIso(mEnd2[1]!) ?? mEnd2[1]!
    };
  }
  return { start: null, end: null };
}

function parsePayDate(text: string): string | null {
  const patterns = [
    /(?:Payment|Pay)\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Check\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Payday:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Check\s*#\s*\d+\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /** IBM: "Pay Date" header then account lines, then date then `1,234.56USD` */
    /Pay\s+Date\s*[\r\n]+[\s\S]{0,500}?(\d{1,2}\/\d{1,2}\/\d{4})\s*[\r\n]+\s*[\d,]+\.\d{2}\s*USD/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return normalizeUsDateToIso(m[1]!) ?? m[1]!;
    }
  }
  const payBlock = text.match(/Payment Information[\s\S]*$/i);
  if (payBlock) {
    const m = payBlock[0].match(
      /(\d{1,2}\/\d{1,2}\/\d{4})\s*[\r\n]+\s*[\d,]+\.\d{2}\s*USD/i
    );
    if (m) {
      return normalizeUsDateToIso(m[1]!) ?? m[1]!;
    }
  }
  return null;
}

function fallbackLineWithTwoAmounts(lines: string[], keyword: RegExp): string | null {
  for (const line of lines) {
    if (!keyword.test(line)) {
      continue;
    }
    const pair = parseCurrentYtdPair(line);
    if (pair.current !== null || pair.ytd !== null) {
      return line;
    }
  }
  return null;
}

function isMoneyOnlyLine(line: string): number | null {
  const t = line.trim();
  const m = t.match(/^\s*(-?[\d,]+\.\d{2})\s*$/);
  return m ? parseMoneyToken(m[1]!) : null;
}

/**
 * IBM PDF text often puts the label on one line and Current / YTD amounts on the following lines
 * (one dollar amount per line).
 */
function currentYtdAfterLineIndex(
  lines: string[],
  labelLineIdx: number
): { current: number | null; ytd: number | null } {
  if (labelLineIdx === -1) {
    return { current: null, ytd: null };
  }
  const labelLine = lines[labelLineIdx]!;
  /** Same-line layout (fixture / some PDFs): `Gross Pay    1,234.56    9,876.54` */
  const onLabel = parseCurrentYtdPair(labelLine);
  if (onLabel.current !== null || onLabel.ytd !== null) {
    return onLabel;
  }
  const vals: number[] = [];
  for (let i = labelLineIdx + 1; i < Math.min(labelLineIdx + 15, lines.length) && vals.length < 2; i++) {
    const t = lines[i]!.trim();
    if (!t) {
      continue;
    }
    if (/^(current|ytd|amount)$/i.test(t)) {
      continue;
    }
    const only = isMoneyOnlyLine(lines[i]!);
    if (only !== null) {
      vals.push(only);
      continue;
    }
    const pair = parseCurrentYtdPair(lines[i]!);
    if (pair.current !== null || pair.ytd !== null) {
      return pair;
    }
    if (vals.length) {
      break;
    }
  }
  if (vals.length >= 2) {
    return { current: vals[0]!, ytd: vals[1]! };
  }
  if (vals.length === 1) {
    return { current: vals[0]!, ytd: null };
  }
  return { current: null, ytd: null };
}

function firstLineIndexMatching(lines: string[], patterns: RegExp[]): number {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t) {
      continue;
    }
    for (const re of patterns) {
      if (re.test(t)) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * IBM "Net Pay" summary often lists Current / YTD dollar amounts on the lines **above** the `Net Pay` label.
 */
function currentYtdBeforeNetPayLabel(lines: string[]): { current: number | null; ytd: number | null } {
  const idx = lines.findIndex((l) => /^\s*net\s+pay\s*$/i.test(l.trim()));
  if (idx <= 0) {
    return { current: null, ytd: null };
  }
  const vals: number[] = [];
  for (let i = idx - 1; i >= Math.max(0, idx - 15); i--) {
    const t = lines[i]!.trim();
    if (!t) {
      continue;
    }
    if (/^(current|ytd|amount)$/i.test(t)) {
      continue;
    }
    const only = isMoneyOnlyLine(lines[i]!);
    if (only !== null) {
      vals.unshift(only);
    } else if (vals.length) {
      break;
    }
  }
  if (vals.length >= 2) {
    return { current: vals[vals.length - 1]!, ytd: vals[vals.length - 2]! };
  }
  if (vals.length === 1) {
    return { current: vals[0]!, ytd: null };
  }
  return { current: null, ytd: null };
}

function hasMinimumSignal(parsed: ParsedPayslipSummary): boolean {
  return (
    (parsed.payPeriodStart !== null && parsed.payPeriodEnd !== null) ||
    parsed.grossPayCurrent !== null ||
    parsed.grossPayYtd !== null ||
    parsed.netPayCurrent !== null
  );
}

/** Labels vary by payroll vendor; try several before giving up. */
const GROSS_LINE_PATTERNS: RegExp[] = [
  /gross\s+pay/i,
  /total\s+earnings/i,
  /total\s+gross/i,
  /gross\s+earnings/i,
  /regular\s+gross/i,
  /total\s+comp(?:ensation)?/i
];

const NET_LINE_PATTERNS: RegExp[] = [
  /net\s+pay/i,
  /net\s+wages/i,
  /net\s+amount/i,
  /take[\s-]*home(?:\s+pay)?/i
];

const PRE_TAX_PATTERNS: RegExp[] = [/pre[-\s]?tax\s+deductions?/i, /pre[-\s]?tax/i];

const EMP_TAX_PATTERNS: RegExp[] = [/employee\s+taxes?/i, /tax\s+withholdings?/i, /withholding\s+tax/i];

const POST_TAX_PATTERNS: RegExp[] = [/post[-\s]?tax\s+deductions?/i, /post[-\s]?tax/i];

const HOURS_LINE_PATTERNS: RegExp[] = [/(?:hours|days)\s+worked/i, /hours\s*&\s*days/i, /hours\/days/i];

/**
 * Parse IBM-style Pay and Contributions summary text (regex on Current / YTD columns).
 * Exported for unit tests with golden text fixtures.
 */
export function parseIbmPayslipFromText(text: string): ParsedPayslipSummary | null {
  const trimmed = normalizePdfExtractText(text).trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trimEnd());
  const period = parsePayPeriod(trimmed);
  const payDate = parsePayDate(trimmed);

  const grossIdx = firstLineIndexMatching(lines, GROSS_LINE_PATTERNS);
  let gross = currentYtdAfterLineIndex(lines, grossIdx);
  if (gross.current === null && gross.ytd === null && grossIdx !== -1) {
    gross = parseCurrentYtdPair(lines[grossIdx]!);
  }
  if (gross.current === null && gross.ytd === null) {
    const alt = fallbackLineWithTwoAmounts(lines, /\b(?:gross|total\s+earnings|total\s+gross)\b/i);
    if (alt) {
      gross = parseCurrentYtdPair(alt);
    }
  }

  let net = currentYtdBeforeNetPayLabel(lines);
  if (net.current === null && net.ytd === null) {
    const netIdx = firstLineIndexMatching(lines, NET_LINE_PATTERNS);
    net = currentYtdAfterLineIndex(lines, netIdx);
    if (net.current === null && net.ytd === null && netIdx !== -1) {
      net = parseCurrentYtdPair(lines[netIdx]!);
    }
  }

  const preIdx = firstLineIndexMatching(lines, PRE_TAX_PATTERNS);
  let preTax = currentYtdAfterLineIndex(lines, preIdx);
  if (preTax.current === null && preTax.ytd === null && preIdx !== -1) {
    preTax = parseCurrentYtdPair(lines[preIdx]!);
  }

  const empIdx = firstLineIndexMatching(lines, EMP_TAX_PATTERNS);
  let empTax = currentYtdAfterLineIndex(lines, empIdx);
  if (empTax.current === null && empTax.ytd === null && empIdx !== -1) {
    empTax = parseCurrentYtdPair(lines[empIdx]!);
  }

  const postIdx = firstLineIndexMatching(lines, POST_TAX_PATTERNS);
  let postTax = currentYtdAfterLineIndex(lines, postIdx);
  if (postTax.current === null && postTax.ytd === null && postIdx !== -1) {
    postTax = parseCurrentYtdPair(lines[postIdx]!);
  }

  const hoursIdx = firstLineIndexMatching(lines, HOURS_LINE_PATTERNS);
  let hoursOrDaysCurrent: string | null = null;
  if (hoursIdx !== -1) {
    const hoursLineStr = lines[hoursIdx]!;
    const nums = hoursLineStr.match(MONEY);
    if (nums && nums.length >= 1) {
      hoursOrDaysCurrent = nums[0]!.replace(/,/g, "");
    } else {
      const hPair = currentYtdAfterLineIndex(lines, hoursIdx);
      if (hPair.current !== null) {
        hoursOrDaysCurrent = hPair.current.toFixed(2);
      }
    }
  }

  const grossLine = grossIdx !== -1 ? lines[grossIdx]! : null;
  const preTaxLine = preIdx !== -1 ? lines[preIdx]! : null;
  const empTaxLine = empIdx !== -1 ? lines[empIdx]! : null;
  const postTaxLine = postIdx !== -1 ? lines[postIdx]! : null;
  const netLine = lines.find((l) => /^\s*net\s+pay\s*$/i.test(l.trim())) ?? null;
  const hoursLine = hoursIdx !== -1 ? lines[hoursIdx]! : null;

  const rawExtractJson: Record<string, unknown> = {
    matchedLines: {
      grossPay: grossLine ?? null,
      preTaxDeductions: preTaxLine ?? null,
      employeeTaxes: empTaxLine ?? null,
      postTaxDeductions: postTaxLine ?? null,
      netPay: netLine ?? null,
      hoursDays: hoursLine ?? null
    }
  };

  const parsed: ParsedPayslipSummary = {
    payPeriodStart: period.start,
    payPeriodEnd: period.end,
    payDate,
    hoursOrDaysCurrent,
    grossPayCurrent: gross.current,
    grossPayYtd: gross.ytd,
    employeeTaxesCurrent: empTax.current,
    employeeTaxesYtd: empTax.ytd,
    preTaxDeductionsCurrent: preTax.current,
    preTaxDeductionsYtd: preTax.ytd,
    postTaxDeductionsCurrent: postTax.current,
    postTaxDeductionsYtd: postTax.ytd,
    netPayCurrent: net.current,
    netPayYtd: net.ytd,
    rawExtractJson
  };

  if (!hasMinimumSignal(parsed)) {
    return null;
  }

  return parsed;
}

export type PayslipPdfParseFailureReason = "empty_pdf_text" | "no_summary_fields" | "pdf_read_error";

export type PayslipPdfParseResult =
  | { ok: true; summary: ParsedPayslipSummary }
  | { ok: false; reason: PayslipPdfParseFailureReason };

export async function parseIbmPayslipPdf(buffer: Buffer): Promise<PayslipPdfParseResult> {
  let text: string;
  try {
    text = await extractPdfText(buffer);
  } catch {
    return { ok: false, reason: "pdf_read_error" };
  }
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return { ok: false, reason: "empty_pdf_text" };
  }
  const summary = parseIbmPayslipFromText(normalized);
  if (!summary) {
    return { ok: false, reason: "no_summary_fields" };
  }
  return { ok: true, summary };
}
