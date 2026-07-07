/**
 * IBM “Pay and Contributions” / SuccessFactors-style payslips.
 * Baseline: `tests/fixtures/ibm-payslip-sample.txt` (single-line labels + amounts).
 * Real `pdf-parse` output often splits labels and amounts onto separate lines; see tests for multiline extract.
 */
import type { ParsedPayslipSummary } from "../payslip.types.js";

const MONEY = /-?[\d,]+\.\d{2}/g;

/** NBSP and odd spacing from PDF engines — normalize before matching. */
export function normalizePdfExtractText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\u2009/g, " ");
}

const ZWSP_AND_SOFT_HYPHEN = /[\u200b-\u200d\ufeff\u00ad]/g;

/**
 * True when `pdf-parse` returned many characters but no payroll-like English and no currency-shaped
 * tokens — typical of image/outline PDFs or broken font encodings (regex parsers cannot recover).
 */
export function payslipPdfExtractLooksUnusable(rawText: string): boolean {
  const compact = normalizePdfExtractText(rawText.replace(ZWSP_AND_SOFT_HYPHEN, "")).trim();
  if (compact.length < 120) {
    return false;
  }
  if (hasPayslipMoneyLikeToken(compact)) {
    return false;
  }
  if (hasPayslipEnglishHints(compact)) {
    return false;
  }
  return true;
}

function hasPayslipMoneyLikeToken(s: string): boolean {
  if (/\b\d{1,3}(?:,\d{3})+\.\d{2}\b/.test(s)) {
    return true;
  }
  if (/\b-?\d+\.\d{2}\b/.test(s)) {
    return true;
  }
  if (/\b\d{1,3}(?:\.\d{3})+,\d{2}\b/.test(s)) {
    return true;
  }
  return false;
}

function hasPayslipEnglishHints(s: string): boolean {
  return /\b(?:gross|net\s*pay|earnings|deduction|withhold|pay\s+statement|pay\s+period|pay\s+date|ytd|federal|medicare|social\s*security|w-?2|remuneration|distribution)\b/i.test(
    s
  );
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

export function normalizeUsDateToIso(mmddyyyy: string): string | null {
  const m = mmddyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return null;
  }
  const mo = m[1]!.padStart(2, "0");
  const d = m[2]!.padStart(2, "0");
  const y = m[3]!;
  return `${y}-${mo}-${d}`;
}

export function parsePayPeriod(text: string): { start: string | null; end: string | null } {
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

export function parsePayDate(text: string): string | null {
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

function firstLineIndexMatchingFrom(lines: string[], minIndex: number, patterns: RegExp[]): number {
  for (let i = minIndex; i < lines.length; i++) {
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
 * IBM "Net Pay" summary: take at most the **two money-only lines immediately above** the standalone
 * `Net Pay` label (stops at a non-money line so post-tax rows are not mistaken for net).
 * Walking up, `pair[0]` is closest to `Net Pay` (often Current in SuccessFactors extracts).
 */
function currentYtdBeforeNetPayLabel(lines: string[]): { current: number | null; ytd: number | null } {
  const idx = lines.findIndex((l) => /^\s*net\s+pay\s*$/i.test(l.trim()));
  if (idx <= 0) {
    return { current: null, ytd: null };
  }
  const pair: number[] = [];
  for (let i = idx - 1; i >= Math.max(0, idx - 15); i--) {
    if (pair.length >= 2) {
      break;
    }
    const t = lines[i]!.trim();
    if (!t) {
      continue;
    }
    if (/^(current|ytd|amount)$/i.test(t)) {
      continue;
    }
    const only = isMoneyOnlyLine(lines[i]!);
    if (only !== null) {
      pair.push(only);
    } else if (pair.length) {
      break;
    }
  }
  if (pair.length >= 2) {
    return { current: pair[0]!, ytd: pair[1]! };
  }
  if (pair.length === 1) {
    return { current: pair[0]!, ytd: null };
  }
  return { current: null, ytd: null };
}

export function payslipSummaryHasMinimumFields(parsed: ParsedPayslipSummary): boolean {
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
  /net\s+payment/i,
  /net\s+distribution/i,
  /net\s+wages/i,
  /net\s+amount/i,
  /take[\s-]*home(?:\s+pay)?/i
];

const PRE_TAX_PATTERNS: RegExp[] = [/pre[-\s]?tax\s+deductions?/i, /pre[-\s]?tax/i];

const EMP_TAX_PATTERNS: RegExp[] = [/employee\s+taxes?/i, /tax\s+withholdings?/i, /withholding\s+tax/i];

const POST_TAX_PATTERNS: RegExp[] = [/post[-\s]?tax\s+deductions?/i, /post[-\s]?tax/i];

/** IBM may label post-tax-style rows as "Other Deductions" instead of "Post-Tax". */
const OTHER_DEDUCTIONS_PATTERNS: RegExp[] = [/other\s+deductions?/i];

const HOURS_LINE_PATTERNS: RegExp[] = [/(?:hours|days)\s+worked/i, /hours\s*&\s*days/i, /hours\/days/i];
const TOTAL_EMPLOYEE_TAXES_PATTERNS: RegExp[] = [/total\s+employee\s+taxes?/i];
const TOTAL_PRE_TAX_PATTERNS: RegExp[] = [/total\s+pre[-\s]?tax\s+deductions?/i];
const TOTAL_POST_TAX_PATTERNS: RegExp[] = [/total\s+post[-\s]?tax\s+deductions?/i, /total\s+other\s+deductions?/i];
const TOTAL_EARNINGS_PATTERNS: RegExp[] = [/total\s+earnings/i, /total\s+gross/i];

/** Section headers for forward scans: stop before the next summary row (avoids grabbing unlabeled amounts). */
const BOUNDARY_PATTERN_GROUPS: RegExp[][] = [
  HOURS_LINE_PATTERNS,
  GROSS_LINE_PATTERNS,
  PRE_TAX_PATTERNS,
  EMP_TAX_PATTERNS,
  [...POST_TAX_PATTERNS, ...OTHER_DEDUCTIONS_PATTERNS],
  [/^\s*net\s+pay\s*$/i],
  [/^payment\s+information$/i]
];

/** Like `currentYtdAfterLineIndex` but does not read money lines beyond `endExclusive` (next section). */
function currentYtdAfterLineIndexBounded(
  lines: string[],
  labelLineIdx: number,
  endExclusive: number
): { current: number | null; ytd: number | null } {
  if (labelLineIdx === -1) {
    return { current: null, ytd: null };
  }
  const cap = Math.min(lines.length, endExclusive);
  const labelLine = lines[labelLineIdx]!;
  const onLabel = parseCurrentYtdPair(labelLine);
  if (onLabel.current !== null || onLabel.ytd !== null) {
    return onLabel;
  }
  const vals: number[] = [];
  for (let i = labelLineIdx + 1; i < Math.min(labelLineIdx + 15, cap) && vals.length < 2; i++) {
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

function nextSectionBoundaryExclusive(lines: string[], labelLineIdx: number): number {
  if (labelLineIdx < 0) {
    return lines.length;
  }
  let best = lines.length;
  for (const group of BOUNDARY_PATTERN_GROUPS) {
    const hit = firstLineIndexMatchingFrom(lines, labelLineIdx + 1, group);
    if (hit !== -1 && hit < best) {
      best = hit;
    }
  }
  return best;
}

function pairFromFirstMatchingLine(lines: string[], patterns: RegExp[]): { current: number | null; ytd: number | null } {
  const idx = firstLineIndexMatching(lines, patterns);
  if (idx === -1) {
    return { current: null, ytd: null };
  }
  return parseCurrentYtdPair(lines[idx]!);
}

function netCurrentFromPaymentInformation(text: string): number | null {
  const block = text.match(/payment\s+information[\s\S]*$/i)?.[0] ?? null;
  if (!block) {
    return null;
  }
  const m = block.match(/([\d,]+\.\d{2})\s*USD/i);
  return m ? parseMoneyToken(m[1]!) : null;
}

function netValuesNearNetPay(lines: string[]): number[] {
  const idx = lines.findIndex((l) => /^\s*net\s+pay\s*$/i.test(l.trim()));
  if (idx <= 0) {
    return [];
  }
  const out: number[] = [];
  for (let i = idx - 1; i >= Math.max(0, idx - 20); i--) {
    const t = lines[i]!.trim();
    if (!t) {
      continue;
    }
    if (/^(current|ytd|amount)$/i.test(t)) {
      continue;
    }
    const only = isMoneyOnlyLine(lines[i]!);
    if (only !== null) {
      out.push(only);
      continue;
    }
    if (/^payment\s+information$/i.test(t)) {
      break;
    }
  }
  return out;
}

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

  const grossTotalPair = pairFromFirstMatchingLine(lines, TOTAL_EARNINGS_PATTERNS);
  const grossIdx = firstLineIndexMatching(lines, GROSS_LINE_PATTERNS);
  const grossEnd = grossIdx !== -1 ? nextSectionBoundaryExclusive(lines, grossIdx) : lines.length;
  let gross = grossTotalPair;
  if (gross.current === null && gross.ytd === null) {
    gross = currentYtdAfterLineIndexBounded(lines, grossIdx, grossEnd);
  }
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
  const netCurrentFromPayment = netCurrentFromPaymentInformation(trimmed);
  if (netCurrentFromPayment != null) {
    const nearNet = netValuesNearNetPay(lines);
    net.current = netCurrentFromPayment;
    const ytdCandidate = nearNet.find((v) => Math.abs(v - netCurrentFromPayment) > 0.01) ?? null;
    net.ytd = ytdCandidate;
  }
  if (net.current === null && net.ytd === null) {
    const netIdx = firstLineIndexMatching(lines, NET_LINE_PATTERNS);
    const netEnd = netIdx !== -1 ? nextSectionBoundaryExclusive(lines, netIdx) : lines.length;
    net = currentYtdAfterLineIndexBounded(lines, netIdx, netEnd);
    if (net.current === null && net.ytd === null && netIdx !== -1) {
      net = parseCurrentYtdPair(lines[netIdx]!);
    }
  }

  const preTotalPair = pairFromFirstMatchingLine(lines, TOTAL_PRE_TAX_PATTERNS);
  const preIdx = firstLineIndexMatching(lines, PRE_TAX_PATTERNS);
  const preEnd = preIdx !== -1 ? nextSectionBoundaryExclusive(lines, preIdx) : lines.length;
  let preTax = preTotalPair;
  if (preTax.current === null && preTax.ytd === null) {
    preTax = currentYtdAfterLineIndexBounded(lines, preIdx, preEnd);
  }
  if (preTax.current === null && preTax.ytd === null && preIdx !== -1) {
    preTax = parseCurrentYtdPair(lines[preIdx]!);
  }

  const empTotalPair = pairFromFirstMatchingLine(lines, TOTAL_EMPLOYEE_TAXES_PATTERNS);
  const empIdx = firstLineIndexMatching(lines, EMP_TAX_PATTERNS);
  const empEnd = empIdx !== -1 ? nextSectionBoundaryExclusive(lines, empIdx) : lines.length;
  let empTax = empTotalPair;
  if (empTax.current === null && empTax.ytd === null) {
    empTax = currentYtdAfterLineIndexBounded(lines, empIdx, empEnd);
  }
  if (empTax.current === null && empTax.ytd === null && empIdx !== -1) {
    empTax = parseCurrentYtdPair(lines[empIdx]!);
  }

  const postTotalPair = pairFromFirstMatchingLine(lines, TOTAL_POST_TAX_PATTERNS);
  let postIdx = firstLineIndexMatching(lines, POST_TAX_PATTERNS);
  if (postIdx === -1) {
    postIdx = firstLineIndexMatching(lines, OTHER_DEDUCTIONS_PATTERNS);
  }
  const postEnd = postIdx !== -1 ? nextSectionBoundaryExclusive(lines, postIdx) : lines.length;
  let postTax = postTotalPair;
  if (postTax.current === null && postTax.ytd === null) {
    postTax = currentYtdAfterLineIndexBounded(lines, postIdx, postEnd);
  }
  if (postTax.current === null && postTax.ytd === null && postIdx !== -1) {
    postTax = parseCurrentYtdPair(lines[postIdx]!);
  }

  const hoursIdx = firstLineIndexMatching(lines, HOURS_LINE_PATTERNS);
  const hoursEnd = hoursIdx !== -1 ? nextSectionBoundaryExclusive(lines, hoursIdx) : lines.length;
  let hoursOrDaysCurrent: string | null = null;
  if (hoursIdx !== -1) {
    const hoursLineStr = lines[hoursIdx]!;
    const nums = hoursLineStr.match(MONEY);
    if (nums && nums.length >= 1) {
      hoursOrDaysCurrent = nums[0]!.replace(/,/g, "");
    } else {
      const hPair = currentYtdAfterLineIndexBounded(lines, hoursIdx, hoursEnd);
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
    },
    sourceHints: {
      gross: grossTotalPair.current != null || grossTotalPair.ytd != null ? "detail_total" : "summary_or_fallback",
      preTax: preTotalPair.current != null || preTotalPair.ytd != null ? "detail_total" : "summary_or_fallback",
      employeeTaxes: empTotalPair.current != null || empTotalPair.ytd != null ? "detail_total" : "summary_or_fallback",
      postTax: postTotalPair.current != null || postTotalPair.ytd != null ? "detail_total" : "summary_or_fallback",
      netCurrent: netCurrentFromPayment != null ? "payment_information" : "summary_or_fallback"
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
    hoursOrDaysYtd: null,
    taxableEarningsCurrent: null,
    taxableEarningsYtd: null,
    otherInformationCurrent: null,
    otherInformationYtd: null,
    rawExtractJson
  };

  if (!payslipSummaryHasMinimumFields(parsed)) {
    return null;
  }

  return parsed;
}

