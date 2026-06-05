import { extractPdfText } from "../imports/profiles/pdf-text.js";

export type CadSalesComp = {
  compNum: number;
  propId: string;
  address: string;
  distanceMi: number | null;
  saleDate: string | null;
  salePriceUsd: number | null;
  cadMarketValueUsd: number | null;
  cadIndValueUsd: number | null;
};

export type CadEquityComp = {
  compNum: number;
  propId: string;
  address: string;
  distanceMi: number | null;
  cadMarketValueUsd: number | null;
  cadIndValueUsd: number | null;
};

export type CadEvidenceData = {
  uploadedAt: string;
  subjectCadPropertyId: string | null;
  subjectAddress: string | null;
  assessedValueUsd: number | null;
  improvementsUsd: number | null;
  landValueUsd: number | null;
  percentGood: number | null;
  livingAreaSqft: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  salesAnalysis: {
    comps: CadSalesComp[];
    medianIndValueUsd: number | null;
    medianValuePerSqft: number | null;
  };
  equityAnalysis: {
    comps: CadEquityComp[];
    medianIndValueUsd: number | null;
    medianValuePerSqft: number | null;
  };
};

function findSection(text: string, header: string, stopHeader?: string): string {
  const idx = text.indexOf(header);
  if (idx === -1) return "";
  const slice = text.slice(idx);
  if (stopHeader) {
    const stopIdx = slice.indexOf(stopHeader);
    if (stopIdx !== -1) return slice.slice(0, stopIdx);
  }
  return slice;
}

// Denton CAD PDFs extract text column-by-column, so each section's data appears
// BEFORE its own heading in the extracted text stream. This helper returns the
// text that precedes `header` (optionally bounded by a previous marker).
function findSectionBefore(text: string, header: string, prevMarker?: string): string {
  const idx = text.indexOf(header);
  if (idx === -1) return "";
  let start = 0;
  if (prevMarker) {
    const prevIdx = text.indexOf(prevMarker);
    if (prevIdx !== -1) start = prevIdx + prevMarker.length;
  }
  return text.slice(start, idx);
}

function parseMedianSection(sectionText: string): { medianIndValueUsd: number | null; medianValuePerSqft: number | null } {
  const m = sectionText.match(/Summary of (?:Indicated|Equity Indicated) Values([\s\S]{0,400})/);
  if (!m) return { medianIndValueUsd: null, medianValuePerSqft: null };
  const chunk = m[1];
  const amounts = [...chunk.matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map(x => parseFloat(x[1].replace(/,/g, "")));
  const medianUsd = amounts.find(a => a >= 100_000) ?? null;
  const perSqft = amounts.find(a => a > 0 && a < 10_000) ?? null;
  return {
    medianIndValueUsd: medianUsd != null ? Math.round(medianUsd) : null,
    medianValuePerSqft: perSqft ?? null,
  };
}

function parseSalesMapComps(mapText: string): Array<{ compNum: number; propId: string; distanceMi: number | null; salePriceUsd: number | null; address: string }> {
  const results: Array<{ compNum: number; propId: string; distanceMi: number | null; salePriceUsd: number | null; address: string }> = [];
  const re = /Comp\s+(\d+)\s+(\d+)\s+([\d.]+)\s+\$([\d,]+)\s+/g;
  const matches = [...mapText.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startIdx = match.index! + match[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : mapText.length;
    const address = mapText.slice(startIdx, endIdx).trim().replace(/\n/g, " ");
    results.push({
      compNum: parseInt(match[1], 10),
      propId: match[2],
      distanceMi: parseFloat(match[3]),
      salePriceUsd: parseInt(match[4].replace(/,/g, ""), 10),
      address,
    });
  }
  return results;
}

function parseEquityMapComps(mapText: string): Array<{ compNum: number; propId: string; distanceMi: number | null; address: string }> {
  const results: Array<{ compNum: number; propId: string; distanceMi: number | null; address: string }> = [];
  // Equity map: "Comp N propId distance address..." (no sale price)
  // Stop before any line that starts a new section
  const re = /Comp\s+(\d+)\s+(\d+)\s+([\d.]+)\s+/g;
  const matches = [...mapText.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startIdx = match.index! + match[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : mapText.length;
    const address = mapText.slice(startIdx, endIdx).trim().replace(/\n/g, " ");
    results.push({
      compNum: parseInt(match[1], 10),
      propId: match[2],
      distanceMi: parseFloat(match[3]),
      address,
    });
  }
  return results;
}

function extractCompValues(
  analysisText: string,
  compCount: number,
  isSales: boolean
): Array<{ saleDate: string | null; cadMarketValueUsd: number | null; cadIndValueUsd: number | null }> {
  const results: Array<{ saleDate: string | null; cadMarketValueUsd: number | null; cadIndValueUsd: number | null }> = [];

  for (let n = 1; n <= compCount; n++) {
    const labelRe = new RegExp(`\\bComp\\s+${n}\\b`);
    const labelMatch = analysisText.match(labelRe);
    if (!labelMatch || labelMatch.index == null) {
      results.push({ saleDate: null, cadMarketValueUsd: null, cadIndValueUsd: null });
      continue;
    }
    const labelIdx = labelMatch.index;

    // Indicated value = last large dollar before "Comp N" label
    const beforeText = analysisText.slice(Math.max(0, labelIdx - 300), labelIdx);
    const beforeDollars = [...beforeText.matchAll(/\$([\d,]+)/g)]
      .map(m => parseInt(m[1].replace(/,/g, ""), 10))
      .filter(d => d >= 100_000);
    const cadIndValueUsd = beforeDollars.at(-1) ?? null;

    // After "Comp N" label: look for sale date and market value
    const nextLabelRe = new RegExp(`\\bComp\\s+${n + 1}\\b`);
    const nextOffset = analysisText.slice(labelIdx + 10).match(nextLabelRe);
    const endIdx = nextOffset?.index != null ? labelIdx + 10 + nextOffset.index : labelIdx + 500;
    const afterText = analysisText.slice(labelIdx, endIdx);

    const saleDate = isSales ? (afterText.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null;

    // Large dollar amounts > 500k after the label (property values, not adjustments)
    const afterLarge = [...afterText.matchAll(/\$([\d,]+)/g)]
      .map(m => parseInt(m[1].replace(/,/g, ""), 10))
      .filter(d => d >= 500_000);

    // Sales: skip sale price (first), market value is second
    // Equity: market value is first
    const cadMarketValueUsd = isSales ? (afterLarge[1] ?? null) : (afterLarge[0] ?? null);

    results.push({ saleDate, cadMarketValueUsd, cadIndValueUsd });
  }

  return results;
}

function parseSubjectFromAnalysis(analysisText: string): {
  subjectCadPropertyId: string | null;
  subjectAddress: string | null;
  assessedValueUsd: number | null;
  landValueUsd: number | null;
  livingAreaSqft: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  percentGood: number | null;
} {
  const subjectIdx = analysisText.indexOf("Subject\n");
  if (subjectIdx === -1) {
    return { subjectCadPropertyId: null, subjectAddress: null, assessedValueUsd: null, landValueUsd: null, livingAreaSqft: null, lotSqft: null, yearBuilt: null, percentGood: null };
  }
  const chunk = analysisText.slice(subjectIdx, subjectIdx + 700);

  const yearBuiltMatch = chunk.match(/\b(20\d{2})\s*\/\s*\d{4}\b/);
  const yearBuilt = yearBuiltMatch ? parseInt(yearBuiltMatch[1], 10) : null;

  // Lot sqft: integer 5000–30000
  const lotMatch = chunk.match(/\b([5-9]\d{3}|[12]\d{4})\b/);
  const lotSqft = lotMatch ? parseInt(lotMatch[1], 10) : null;

  // Living area: decimal like "4008.8"
  const livingMatch = chunk.match(/\b(\d{3,4}\.\d)\b/);
  const livingAreaSqft = livingMatch ? parseFloat(livingMatch[1]) : null;

  // Percent good: two-digit float like "92.0"
  const pctMatch = chunk.match(/\b(\d{2,3}\.\d)\b/);
  const percentGood = pctMatch ? parseFloat(pctMatch[1]) : null;

  // Land value: dollar 50k–500k
  const landDollar = [...chunk.matchAll(/\$([\d,]+)/g)]
    .map(m => parseInt(m[1].replace(/,/g, ""), 10))
    .find(d => d >= 50_000 && d <= 500_000) ?? null;

  // Assessed value: first dollar >= 500k
  const assessedValueUsd = [...chunk.matchAll(/\$([\d,]+)/g)]
    .map(m => parseInt(m[1].replace(/,/g, ""), 10))
    .find(d => d >= 500_000) ?? null;

  // Property ID: 6-digit number after "Subject\n"
  const propIdMatch = chunk.match(/\b(\d{6})\b/);
  const subjectCadPropertyId = propIdMatch ? propIdMatch[1] : null;

  // Street address
  const addrMatch = chunk.match(/\b(\d+\s+[A-Z][A-Z\d\s]+(?:RD|DR|ST|AVE|LN|CT|BLVD|WAY|TRL|PKWY|PKW|CIR|PL)\b)/);
  const subjectAddress = addrMatch ? addrMatch[1].trim() : null;

  return { subjectCadPropertyId, subjectAddress, assessedValueUsd, landValueUsd: landDollar, livingAreaSqft, lotSqft, yearBuilt, percentGood };
}

function parseImprovementsFromPublicCard(cardText: string): number | null {
  // "IMPROVEMENTS\n817,120" pattern
  const m = cardText.match(/IMPROVEMENTS\s*[\n\r]+\s*([\d,]+)/);
  if (m) return parseInt(m[1].replace(/,/g, ""), 10);
  return null;
}

export async function parseCadEvidencePdf(buffer: Buffer): Promise<CadEvidenceData> {
  const text = await extractPdfText(buffer);

  // Denton CAD column-order extraction: section heading appears at the END of each
  // section's raw text, not the beginning. Data is BEFORE its heading, summary is AFTER.
  //
  // salesCompDataText  : comp column values from page 2 (before "COMPARABLE SALES ANALYSIS")
  // salesAnalysisText  : summary + median from page 2 tail (after "COMPARABLE SALES ANALYSIS")
  // salesMapText       : map comp table from page 3 (between the two headings)
  // equityCompDataText : comp column values from page 4 (before "SUBJECT EQUITY ANALYSIS")
  // equityAnalysisText : summary + median from page 4 tail (after "SUBJECT EQUITY ANALYSIS")
  // equityMapText      : map comp table from page 5 (between the two headings)
  const salesCompDataText  = findSectionBefore(text, "COMPARABLE SALES ANALYSIS");
  const salesAnalysisText  = findSection(text, "COMPARABLE SALES ANALYSIS", "MARKET COMPARABLE SALES MAP");
  const salesMapText       = findSectionBefore(text, "MARKET COMPARABLE SALES MAP", "COMPARABLE SALES ANALYSIS");
  const equityCompDataText = findSectionBefore(text, "SUBJECT EQUITY ANALYSIS", "MARKET COMPARABLE SALES MAP");
  const equityAnalysisText = findSection(text, "SUBJECT EQUITY ANALYSIS", "EQUITY COMPARABLES MAP");
  const equityMapText      = findSectionBefore(text, "EQUITY COMPARABLES MAP", "SUBJECT EQUITY ANALYSIS");
  const publicCardText     = findSection(text, "PUBLIC CARD WITH SKETCH");

  const salesMapComps   = parseSalesMapComps(salesMapText);
  const equityMapComps  = parseEquityMapComps(equityMapText);

  const salesValues  = extractCompValues(salesCompDataText, salesMapComps.length, true);
  const equityValues = extractCompValues(equityCompDataText, equityMapComps.length, false);

  const salesComps: CadSalesComp[] = salesMapComps.map((c, i) => ({
    compNum: c.compNum,
    propId: c.propId,
    address: c.address,
    distanceMi: c.distanceMi,
    saleDate: salesValues[i]?.saleDate ?? null,
    salePriceUsd: c.salePriceUsd,
    cadMarketValueUsd: salesValues[i]?.cadMarketValueUsd ?? null,
    cadIndValueUsd: salesValues[i]?.cadIndValueUsd ?? null,
  }));

  const equityComps: CadEquityComp[] = equityMapComps.map((c, i) => ({
    compNum: c.compNum,
    propId: c.propId,
    address: c.address,
    distanceMi: c.distanceMi,
    cadMarketValueUsd: equityValues[i]?.cadMarketValueUsd ?? null,
    cadIndValueUsd: equityValues[i]?.cadIndValueUsd ?? null,
  }));

  const salesMedian = parseMedianSection(salesAnalysisText);
  const equityMedian = parseMedianSection(equityAnalysisText);
  const subject = parseSubjectFromAnalysis(salesCompDataText);
  const improvementsUsd = parseImprovementsFromPublicCard(publicCardText);

  return {
    uploadedAt: new Date().toISOString(),
    subjectCadPropertyId: subject.subjectCadPropertyId,
    subjectAddress: subject.subjectAddress,
    assessedValueUsd: subject.assessedValueUsd,
    improvementsUsd,
    landValueUsd: subject.landValueUsd,
    percentGood: subject.percentGood,
    livingAreaSqft: subject.livingAreaSqft,
    lotSqft: subject.lotSqft,
    yearBuilt: subject.yearBuilt,
    salesAnalysis: {
      comps: salesComps,
      medianIndValueUsd: salesMedian.medianIndValueUsd,
      medianValuePerSqft: salesMedian.medianValuePerSqft,
    },
    equityAnalysis: {
      comps: equityComps,
      medianIndValueUsd: equityMedian.medianIndValueUsd,
      medianValuePerSqft: equityMedian.medianValuePerSqft,
    },
  };
}
