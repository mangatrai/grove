import { extractPdfText } from "../../imports/profiles/pdf-text.js";
import type { ParsedPayslipSummary } from "../payslip.types.js";

const MONEY = /-?[\d,]+\.\d{2}/g;

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
  return { start: null, end: null };
}

function parsePayDate(text: string): string | null {
  const patterns = [
    /(?:Payment|Pay)\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Check\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return normalizeUsDateToIso(m[1]!) ?? m[1]!;
    }
  }
  return null;
}

function firstMatchingLine(lines: string[], label: RegExp): string | null {
  for (const line of lines) {
    if (label.test(line)) {
      return line;
    }
  }
  return null;
}

function hasMinimumSignal(parsed: ParsedPayslipSummary): boolean {
  return (
    (parsed.payPeriodStart !== null && parsed.payPeriodEnd !== null) ||
    parsed.grossPayCurrent !== null ||
    parsed.grossPayYtd !== null ||
    parsed.netPayCurrent !== null
  );
}

/**
 * Parse IBM-style Pay and Contributions summary text (regex on Current / YTD columns).
 * Exported for unit tests with golden text fixtures.
 */
export function parseIbmPayslipFromText(text: string): ParsedPayslipSummary | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trimEnd());
  const period = parsePayPeriod(trimmed);
  const payDate = parsePayDate(trimmed);

  const grossLine = firstMatchingLine(lines, /gross\s+pay/i);
  const preTaxLine = firstMatchingLine(lines, /pre[-\s]?tax\s+deductions?/i);
  const empTaxLine = firstMatchingLine(lines, /employee\s+taxes?/i);
  const postTaxLine = firstMatchingLine(lines, /post[-\s]?tax\s+deductions?/i);
  const netLine = firstMatchingLine(lines, /net\s+pay/i);
  const hoursLine = firstMatchingLine(lines, /hours|days\s+worked/i);

  const gross = grossLine ? parseCurrentYtdPair(grossLine) : { current: null, ytd: null };
  const preTax = preTaxLine ? parseCurrentYtdPair(preTaxLine) : { current: null, ytd: null };
  const empTax = empTaxLine ? parseCurrentYtdPair(empTaxLine) : { current: null, ytd: null };
  const postTax = postTaxLine ? parseCurrentYtdPair(postTaxLine) : { current: null, ytd: null };
  const net = netLine ? parseCurrentYtdPair(netLine) : { current: null, ytd: null };

  let hoursOrDaysCurrent: string | null = null;
  if (hoursLine) {
    const pair = parseCurrentYtdPair(hoursLine);
    const nums = hoursLine.match(MONEY);
    if (nums && nums.length >= 1) {
      hoursOrDaysCurrent = nums[0]!.replace(/,/g, "");
    } else if (pair.current !== null) {
      hoursOrDaysCurrent = String(pair.current);
    }
  }

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

export async function parseIbmPayslipPdf(buffer: Buffer): Promise<ParsedPayslipSummary | null> {
  let text: string;
  try {
    text = await extractPdfText(buffer);
  } catch {
    return null;
  }
  return parseIbmPayslipFromText(text);
}
