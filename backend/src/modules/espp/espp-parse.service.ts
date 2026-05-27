import { log } from "../../logger.js";
import { extractPdfText } from "../imports/profiles/pdf-text.js";

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

function parseMonthDate(s: string): string | null {
  // "Jan 15, 2026" / "January 15 2026"
  let m = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m) {
    const mo = MONTH_MAP[m[1]!.toLowerCase()];
    if (!mo) return null;
    return `${m[3]}-${mo}-${m[2]!.padStart(2, '0')}`;
  }
  // "15-Jan-26" / "15-Jan-2026" (EquatePlus allocation CSV format)
  m = s.match(/(\d{1,2})-([A-Za-z]+)-(\d{2,4})/);
  if (m) {
    const mo = MONTH_MAP[m[2]!.toLowerCase()];
    if (!mo) return null;
    const yr = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${yr}-${mo}-${m[1]!.padStart(2, '0')}`;
  }
  return null;
}

export type PdfParseResult = {
  purchaseDate: string | null;
  sharesGranted: number | null;
  fmvPerShare: number | null;
  costBasisPerShare: number | null;
  sharesTransferred: number | null;
};

export async function parseEsppPdf(buffer: Buffer): Promise<PdfParseResult> {
  const text = await extractPdfText(buffer);

  // Log first 800 chars so we can see the actual EquatePlus PDF format
  log.debug({ snippet: text.slice(0, 800) }, 'espp:pdf raw text (first 800 chars)');

  // EquatePlus PDFs concatenate labels and values with no whitespace:
  //   "Allocated4.06578"   "Distributed3.0955"
  //   "Cost basis$ 203.68"  "Purchase FMV$ 239.62"
  //   "Allocation dateMar 31, 2026"
  // Regexes use \s* (zero or more spaces) where EquatePlus omits the separator.
  const allocated   = text.match(/Allocated\s*([\d.]+)/i)?.[1];
  const distributed = text.match(/Distributed\s*([\d.]+)/i)?.[1];
  const costBasis   = text.match(/Cost\s+basis\s*\$?\s*([\d,.]+)/i)?.[1]?.replace(/,/g, '');
  const fmv         = text.match(/Purchase\s+FMV\s*\$?\s*([\d,.]+)/i)?.[1]?.replace(/,/g, '');

  // Purchase date — "Allocation dateMar 31, 2026" or "Purchase date: March 31, 2026"
  const dateMatch =
    text.match(/Allocation\s+date\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i) ??
    text.match(/Purchase\s+[Dd]ate\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i) ??
    text.match(/Purchase\s+[Dd]ate\s*[:\-]?\s*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i) ??
    text.match(/Plan\s+[Pp]eriod[^:\n]*[:\-]\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
  const purchaseDate = dateMatch ? parseMonthDate(dateMatch[1]!) : null;

  const result: PdfParseResult = {
    purchaseDate,
    sharesGranted:     allocated   ? parseFloat(allocated)   : null,
    fmvPerShare:       fmv         ? parseFloat(fmv)         : null,
    costBasisPerShare: costBasis   ? parseFloat(costBasis)   : null,
    sharesTransferred: distributed ? parseFloat(distributed) : null,
  };

  log.debug(result, 'espp:pdf extracted fields');

  if (!purchaseDate) {
    log.warn({ dateMatchRaw: dateMatch?.[1] ?? null }, 'espp:pdf could not parse purchase date — check PDF format against regex');
  }

  return result;
}

export type CsvRow = {
  purchaseDate: string;
  sharesTransferred: number;
  costBasisPerShare: number;
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      const j = line.indexOf('"', i + 1);
      fields.push(j === -1 ? line.slice(i + 1) : line.slice(i + 1, j));
      i = j === -1 ? line.length : j + 2;
    } else {
      const j = line.indexOf(',', i);
      if (j === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return fields;
}

export function parseEsppCsv(buffer: Buffer): CsvRow[] {
  const raw = buffer.toString('utf-8');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  log.debug({ header: lines[0] ?? '(empty)', lineCount: lines.length }, 'espp:csv raw header + line count');

  if (lines.length < 2) {
    log.warn('espp:csv file has no data rows (header-only or empty)');
    return [];
  }

  // Header: Plan, Instrument, Allocation date, Quantity, Cost basis, Cost basis (unit)
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    if (f.length < 5) {
      log.debug({ line, fieldCount: f.length }, 'espp:csv skipping row — too few fields');
      continue;
    }
    const dateStr      = (f[2] ?? '').replace(/"/g, '').trim();
    const qty          = parseFloat((f[3] ?? '').replace(/"/g, '').trim());
    const costBasis    = parseFloat((f[4] ?? '').replace(/"/g, '').trim());
    const purchaseDate = parseMonthDate(dateStr);
    if (!purchaseDate || isNaN(qty) || isNaN(costBasis)) {
      log.debug({ dateStr, qty, costBasis, purchaseDate }, 'espp:csv skipping row — unparseable date/qty/costBasis');
      continue;
    }
    rows.push({ purchaseDate, sharesTransferred: qty, costBasisPerShare: costBasis });
  }

  log.debug({ rowCount: rows.length, rows }, 'espp:csv parsed rows');
  return rows;
}
