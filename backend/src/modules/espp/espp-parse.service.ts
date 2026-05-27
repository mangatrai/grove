import { extractPdfText } from "../imports/profiles/pdf-text.js";

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

function parseMonthDate(s: string): string | null {
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTH_MAP[m[1]!.toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${mo}-${m[2]!.padStart(2, '0')}`;
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

  const allocated   = text.match(/Allocated\s+([\d.]+)/i)?.[1];
  const distributed = text.match(/Distributed\s+([\d.]+)/i)?.[1];
  const costBasis   = text.match(/Cost\s+basis\s+\$?([\d,.]+)/i)?.[1]?.replace(/,/g, '');
  const fmv         = text.match(/Purchase\s+FMV\s+\$?([\d,.]+)/i)?.[1]?.replace(/,/g, '');

  // Look for purchase date — various label patterns EquatePlus uses
  const dateMatch = text.match(
    /(?:Purchase\s+(?:date|Date)|Plan\s+[Pp]eriod[^:]*)[:\s]+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/
  );
  const purchaseDate = dateMatch ? parseMonthDate(dateMatch[1]!) : null;

  return {
    purchaseDate,
    sharesGranted:       allocated   ? parseFloat(allocated)   : null,
    fmvPerShare:         fmv         ? parseFloat(fmv)         : null,
    costBasisPerShare:   costBasis   ? parseFloat(costBasis)   : null,
    sharesTransferred:   distributed ? parseFloat(distributed) : null,
  };
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
  const lines = buffer.toString('utf-8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Header: Plan, Instrument, Allocation date, Quantity, Cost basis, Cost basis (unit)
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    if (f.length < 5) continue;
    const dateStr       = (f[2] ?? '').replace(/"/g, '').trim();
    const qty           = parseFloat((f[3] ?? '').replace(/"/g, '').trim());
    const costBasis     = parseFloat((f[4] ?? '').replace(/"/g, '').trim());
    const purchaseDate  = parseMonthDate(dateStr);
    if (!purchaseDate || isNaN(qty) || isNaN(costBasis)) continue;
    rows.push({ purchaseDate, sharesTransferred: qty, costBasisPerShare: costBasis });
  }
  return rows;
}
