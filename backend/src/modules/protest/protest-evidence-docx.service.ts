import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
} from "docx";

import type { EvidencePacketInput, SoldComp } from "./protest-evidence.service.js";
import type { ProtestComp } from "./protest-worksheet.service.js";
import type { CadSalesComp, CadEquityComp } from "./cad-evidence-parser.service.js";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function str(v: unknown): string {
  if (v == null) return "—";
  return String(v);
}

function ppsf(assessed: number | null, sqft: number | null): string {
  if (assessed == null || sqft == null || sqft === 0) return "—";
  return `$${Math.round(assessed / sqft)}/sqft`;
}

// ── Low-level docx helpers ────────────────────────────────────────────────────

function h1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

function h2(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function h3(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3 });
}

function body(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, bold })],
    spacing: { after: 120 },
  });
}

function bodySmall(text: string, italic = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 18, italics: italic })],
    spacing: { after: 80 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}

function blankLine(): Paragraph {
  return new Paragraph({ children: [new TextRun("")] });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

function hdrCell(text: string, width?: number): TableCell {
  return new TableCell({
    ...(width != null ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    shading: { fill: "1c4ed8" },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 17 })],
      alignment: AlignmentType.CENTER,
    })],
  });
}

function dataCell(text: string, opts: { bold?: boolean; right?: boolean; shade?: string; size?: number } = {}): TableCell {
  const { bold = false, right = false, shade, size = 18 } = opts;
  return new TableCell({
    ...(shade ? { shading: { fill: shade } } : {}),
    children: [new Paragraph({
      children: [new TextRun({ text, bold, size })],
      alignment: right ? AlignmentType.END : AlignmentType.START,
    })],
  });
}

function kvRow(label: string, value: string, highlightValue = false): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 35, type: WidthType.PERCENTAGE },
        shading: { fill: "f1f5f9" },
        children: [new Paragraph({
          children: [new TextRun({ text: label, bold: true, size: 18 })],
        })],
      }),
      new TableCell({
        width: { size: 65, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          children: [new TextRun({ text: value, size: 18, bold: highlightValue, color: highlightValue ? "1c4ed8" : undefined })],
        })],
      }),
    ],
  });
}

function noBorderTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0 },
      bottom: { style: BorderStyle.NONE, size: 0 },
      left: { style: BorderStyle.NONE, size: 0 },
      right: { style: BorderStyle.NONE, size: 0 },
      insideHorizontal: { style: BorderStyle.NONE, size: 0 },
      insideVertical: { style: BorderStyle.NONE, size: 0 },
    },
    rows,
  });
}

// ── Document A: Protest Filing Letter ─────────────────────────────────────────

function buildFilingLetter(input: EvidencePacketInput, genDate: string): (Paragraph | Table)[] {
  const {
    address, city, state, taxYear, cadPropertyId, cadAssessed, equityMedianUsd,
    sqft, strategy, cadEvidence,
  } = input;
  const targetValue = strategy?.targetValueUsd ?? null;
  const salesMedian = cadEvidence?.salesAnalysis?.medianIndValueUsd ?? null;
  const subjectPpsf = cadAssessed != null && sqft != null && sqft > 0 ? Math.round(cadAssessed / sqft) : null;
  const targetPpsf = targetValue != null && sqft != null && sqft > 0 ? Math.round(targetValue / sqft) : null;

  const loc = [city, state].filter(Boolean).join(", ") || "Texas";
  const county = (city ?? "").length > 0 ? `${city ?? ""} County` : "County";

  const parts: (Paragraph | Table)[] = [
    body(genDate),
    blankLine(),
    body(`Appraisal Review Board`),
    body(`${county} Appraisal District`),
    body(`${loc}`),
    blankLine(),
    body(`Re: Notice of Protest — ${address}`, true),
    ...(cadPropertyId ? [body(`DCAD Property ID: ${cadPropertyId}`)] : []),
    body(`Tax Year: ${taxYear}`),
    blankLine(),
    body("To the Appraisal Review Board:"),
    blankLine(),
    body(
      `I am hereby filing a formal protest of the appraisal of my property at ${address} for tax year ${taxYear}. The property is currently assessed at ${fmtMoney(cadAssessed)}${subjectPpsf != null ? ` ($${subjectPpsf}/sqft)` : ""}. I am requesting an adjusted assessed value of ${fmtMoney(targetValue)}${targetPpsf != null ? ` ($${targetPpsf}/sqft)` : ""} based on the following grounds:`
    ),
    blankLine(),
  ];

  // §41.41 paragraph
  if (salesMedian != null || (soldCompsCount(input) > 0)) {
    parts.push(body("§41.41 — Incorrect Market Value", true));
    if (salesMedian != null && cadAssessed != null) {
      parts.push(body(
        `DCAD's own comparable sales analysis shows a median indicated value of ${fmtMoney(salesMedian)} for comparable properties in this market area. The current assessment of ${fmtMoney(cadAssessed)} is ${fmtMoney(cadAssessed - salesMedian)} above this median. The sales comps used by DCAD contain material deficiencies — including upward adjustments with no documented basis and comps with features the subject property does not have — that inflate the indicated value above actual market conditions.`
      ));
    } else {
      parts.push(body(
        `The assessed value of ${fmtMoney(cadAssessed)} exceeds the current market value of the property based on available comparable sales data in this market area.`
      ));
    }
    parts.push(blankLine());
  }

  // §41.43 paragraph
  if (equityMedianUsd != null && cadAssessed != null) {
    const equityGap = cadAssessed - equityMedianUsd;
    const equityMedianPpsf = equityMedianUsd != null && sqft != null && sqft > 0 ? Math.round(equityMedianUsd / sqft) : null;
    parts.push(body("§41.43 — Unequal Appraisal", true));
    parts.push(body(
      `DCAD's own equity comparables show a median indicated value of ${fmtMoney(equityMedianUsd)}${equityMedianPpsf != null ? ` ($${equityMedianPpsf}/sqft)` : ""} for comparable properties in this market area. The subject property is assessed at ${fmtMoney(cadAssessed)}${subjectPpsf != null ? ` ($${subjectPpsf}/sqft)` : ""} — ${fmtMoney(equityGap)} above the equity median — with no documented justification for this disparity. Every other comparable property at the same condition rating is assessed at a lower $/sqft. This constitutes unequal appraisal under Texas Tax Code §41.43.`
    ));
    parts.push(blankLine());
  } else if (input.dcadComps.length > 0) {
    parts.push(body("§41.43 — Unequal Appraisal", true));
    parts.push(body(
      `Comparable properties assessed by DCAD in the same market area are assessed at lower values on a per-square-foot basis than the subject property, with no documented justification for the disparity.`
    ));
    parts.push(blankLine());
  }

  parts.push(
    body(
      `I respectfully request the Board adjust the assessed value of this property to ${fmtMoney(targetValue)}${targetPpsf != null ? ` ($${targetPpsf}/sqft)` : ""}. A detailed evidence packet is attached for the Board's review.`
    ),
    blankLine(),
    body("Respectfully submitted,"),
    blankLine(),
    blankLine(),
    body("_________________________________"),
    body("Property Owner"),
    body(address),
    blankLine(),
    body(`Dated: ${genDate}`),
  );

  return parts;
}

function soldCompsCount(input: EvidencePacketInput): number {
  return input.soldComps.length + input.manualSoldComps.length;
}

// ── Document B Section 1: Subject Property Detail ────────────────────────────

function buildSubjectDetailTable(input: EvidencePacketInput): Table {
  const { cadPropertyId, address, city, state, sqft, beds, baths, yearBuilt,
    cadAssessed, improvementsUsd, landValueUsd, percentGood, lotSqft,
    purchasePrice, purchaseDate } = input;

  const subjectPpsf = cadAssessed != null && sqft != null && sqft > 0 ? `$${Math.round(cadAssessed / sqft)}/sqft` : "—";

  const rows: [string, string, boolean?][] = [
    ["Property Address", `${address}${city ? `, ${city}` : ""}${state ? `, ${state}` : ""}`],
    ["DCAD Property ID", cadPropertyId ?? "—"],
    ["Year Built", str(yearBuilt)],
    ["Living Area (sqft)", sqft != null ? `${sqft.toLocaleString()} sqft` : "—"],
    ["Bedrooms / Baths", (beds != null || baths != null) ? `${beds ?? "—"} bed / ${baths ?? "—"} bath` : "—"],
    ["Lot Size", lotSqft != null ? `${lotSqft.toLocaleString()} sqft` : "—"],
    ["DCAD Condition Rating", percentGood != null ? `${percentGood}% Good` : "—"],
    ["2026 DCAD Assessment", fmtMoney(cadAssessed), true],
    ["Assessed $/sqft", subjectPpsf, true],
    ["Improvements Value", fmtMoney(improvementsUsd)],
    ["Land Value", fmtMoney(landValueUsd)],
    ...(purchasePrice != null ? [["Purchase Price / Date", `${fmtMoney(purchasePrice)} (${purchaseDate ?? "—"})`] as [string, string]] : []),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v, hl]) => kvRow(k, v, hl)),
  });
}

// ── Document B Section 2: Requested Value ─────────────────────────────────────

function buildRequestedValueSection(input: EvidencePacketInput, subjectPpsf: number | null): (Paragraph | Table)[] {
  const { strategy, dcadComps, soldComps, manualSoldComps, sqft, cadAssessed, equityMedianUsd } = input;
  const targetValue = strategy?.targetValueUsd ?? null;
  const targetPpsf = targetValue != null && sqft != null && sqft > 0 ? Math.round(targetValue / sqft) : null;

  const parts: (Paragraph | Table)[] = [
    h2("Section 2 — Taxpayer's Requested Value"),
    body(`Requested Value: ${fmtMoney(targetValue)}${targetPpsf != null ? ` ($${targetPpsf}/sqft)` : ""}`, true),
    body("This request is supported by the following independent, verifiable data points:"),
    blankLine(),
  ];

  // Build a table of evidence points
  const evidenceRows: TableRow[] = [
    new TableRow({
      children: [
        hdrCell("Evidence", 55),
        hdrCell("$/sqft", 20),
        hdrCell("Implied Value", 25),
      ],
    }),
  ];

  let idx = 0;
  for (const c of dcadComps.slice(0, 5)) {
    if (c.assessedValueUsd == null) continue;
    const compPpsf = c.perSqftUsd ?? (c.assessedValueUsd != null && c.sqft != null && c.sqft > 0 ? Math.round(c.assessedValueUsd / c.sqft) : null);
    const shade = idx++ % 2 === 0 ? "FFFFFF" : "f9fafb";
    evidenceRows.push(new TableRow({
      children: [
        dataCell(`${c.addressLine1 ?? "—"} — DCAD assessment`, { shade }),
        dataCell(compPpsf != null ? `$${compPpsf}` : "—", { right: true, shade }),
        dataCell(fmtMoney(c.assessedValueUsd), { right: true, shade }),
      ],
    }));
  }
  for (const c of [...soldComps, ...manualSoldComps].slice(0, 3)) {
    const addr = "address" in c ? c.address : (c as { address: string }).address;
    const price = "soldPrice" in c ? (c as SoldComp).soldPrice : (c as { soldPrice: number | null }).soldPrice;
    const compSqft = "sqft" in c ? c.sqft : null;
    if (price == null) continue;
    const compPpsf = compSqft != null && compSqft > 0 ? Math.round(price / compSqft) : null;
    const shade = idx++ % 2 === 0 ? "FFFFFF" : "f9fafb";
    evidenceRows.push(new TableRow({
      children: [
        dataCell(`${addr ?? "—"} — market sale`, { shade }),
        dataCell(compPpsf != null ? `$${compPpsf}` : "—", { right: true, shade }),
        dataCell(fmtMoney(price), { right: true, shade }),
      ],
    }));
  }
  if (equityMedianUsd != null) {
    const medPpsf = sqft != null && sqft > 0 ? Math.round(equityMedianUsd / sqft) : null;
    const shade = idx++ % 2 === 0 ? "FFFFFF" : "f9fafb";
    evidenceRows.push(new TableRow({
      children: [
        dataCell("DCAD's own equity analysis — median indicated value", { shade }),
        dataCell(medPpsf != null ? `$${medPpsf}` : "—", { right: true, shade }),
        dataCell(fmtMoney(equityMedianUsd), { right: true, shade }),
      ],
    }));
  }

  if (evidenceRows.length > 1) {
    parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: evidenceRows }));
    parts.push(blankLine());
  }

  if (cadAssessed != null && targetValue != null) {
    const reduction = cadAssessed - targetValue;
    const reductionPct = ((reduction / cadAssessed) * 100).toFixed(1);
    parts.push(bodySmall(
      `Requested reduction: ${fmtMoney(reduction)} (${reductionPct}%). ${
        subjectPpsf != null && targetPpsf != null
          ? `Current $/sqft: $${subjectPpsf}. Requested $/sqft: $${targetPpsf}. `
          : ""
      }This request is conservative and supported by multiple independent data points including DCAD's own equity analysis.`
    ));
  }

  return parts;
}

// ── Document B Section 3: Problems with DCAD's Evidence ───────────────────────

function buildDcadProblemsSection(input: EvidencePacketInput, subjectPpsf: number | null): (Paragraph | Table)[] {
  const { cadEvidence, sqft } = input;
  if (!cadEvidence) return [];

  const parts: (Paragraph | Table)[] = [h2("Section 3 — Problems with DCAD's Evidence")];

  // 3A: Sales Analysis
  if (cadEvidence.salesAnalysis.comps.length > 0) {
    const salesMedian = cadEvidence.salesAnalysis.medianIndValueUsd;
    parts.push(h3("3A — Market Sales Analysis"));
    parts.push(bodySmall(
      `DCAD submitted ${cadEvidence.salesAnalysis.comps.length} comparable sale(s). ` +
      (salesMedian != null ? `DCAD's own median indicated value is ${fmtMoney(salesMedian)}. ` : "") +
      "The comps below contain material problems that undermine the assessed value."
    ));
    parts.push(blankLine());

    const rows: TableRow[] = [
      new TableRow({
        children: [
          hdrCell("DCAD Comp", 30),
          hdrCell("Sale Price", 15),
          hdrCell("DCAD Ind.", 15),
          hdrCell("Adj.", 12),
          hdrCell("Dist.", 8),
          hdrCell("Issues", 20),
        ],
      }),
    ];

    for (let i = 0; i < cadEvidence.salesAnalysis.comps.length; i++) {
      const c = cadEvidence.salesAnalysis.comps[i];
      const issues = identifySalesCompIssues(c);
      const shade = i % 2 === 0 ? "FFFFFF" : "f9fafb";
      const adjustment = c.cadIndValueUsd != null && c.salePriceUsd != null ? c.cadIndValueUsd - c.salePriceUsd : null;
      rows.push(new TableRow({
        children: [
          dataCell(`Comp ${c.compNum}: ${c.address}`, { shade }),
          dataCell(fmtMoney(c.salePriceUsd), { right: true, shade }),
          dataCell(fmtMoney(c.cadIndValueUsd), { right: true, shade }),
          dataCell(adjustment != null ? `${adjustment > 0 ? "+" : ""}${fmtMoney(adjustment)}` : "—", { right: true, shade, bold: adjustment != null && adjustment > 0 }),
          dataCell(c.distanceMi != null ? `${c.distanceMi} mi` : "—", { right: true, shade }),
          dataCell(issues, { shade }),
        ],
      }));
    }

    parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    parts.push(blankLine());
  }

  // 3B: Equity Analysis
  if (cadEvidence.equityAnalysis.comps.length > 0) {
    const equityMedian = cadEvidence.equityAnalysis.medianIndValueUsd;
    const equityMedianPpsf = equityMedian != null && sqft != null && sqft > 0 ? Math.round(equityMedian / sqft) : null;
    parts.push(h3("3B — Equity Analysis: DCAD's Own Data Shows Over-Assessment"));
    parts.push(bodySmall(
      `DCAD identified ${cadEvidence.equityAnalysis.comps.length} comparable properties in its equity analysis. ` +
      `The subject property's value is the highest in the set with no documented justification.`
    ));
    if (equityMedian != null) {
      parts.push(bodySmall(
        `Equity median: ${fmtMoney(equityMedian)}${equityMedianPpsf != null ? ` (est. $${equityMedianPpsf}/sqft)` : ""}. ` +
        `Subject assessed: ${fmtMoney(input.cadAssessed)}${subjectPpsf != null ? ` ($${subjectPpsf}/sqft)` : ""}. ` +
        (input.cadAssessed != null && equityMedian != null ? `Over-assessment: ${fmtMoney(input.cadAssessed - equityMedian)}.` : "")
      ));
    }
    parts.push(blankLine());

    const rows: TableRow[] = [
      new TableRow({
        children: [
          hdrCell("Address", 40),
          hdrCell("DCAD Indicated Value", 25),
          hdrCell("Est. $/sqft", 18),
          hdrCell("Gap vs Subject", 17),
        ],
      }),
    ];

    for (let i = 0; i < cadEvidence.equityAnalysis.comps.length; i++) {
      const c = cadEvidence.equityAnalysis.comps[i];
      const compPpsf = c.cadIndValueUsd != null && sqft != null && sqft > 0 ? Math.round(c.cadIndValueUsd / sqft) : null;
      const gap = input.cadAssessed != null && c.cadIndValueUsd != null ? input.cadAssessed - c.cadIndValueUsd : null;
      const shade = i % 2 === 0 ? "FFFFFF" : "f9fafb";
      rows.push(new TableRow({
        children: [
          dataCell(`Comp ${c.compNum}: ${c.address}`, { shade }),
          dataCell(fmtMoney(c.cadIndValueUsd), { right: true, shade }),
          dataCell(compPpsf != null ? `$${compPpsf}` : "—", { right: true, shade }),
          dataCell(gap != null ? `Subject $${Math.round(gap / 1000)}k higher` : "—", { shade, bold: gap != null && gap > 0 }),
        ],
      }));
    }

    // Add subject row for comparison
    const equityPpsf = equityMedian != null && sqft != null && sqft > 0 ? Math.round(equityMedian / sqft) : null;
    rows.push(new TableRow({
      children: [
        new TableCell({ shading: { fill: "dbeafe" }, children: [new Paragraph({ children: [new TextRun({ text: `Subject — ${input.address}`, bold: true, size: 18 })] })] }),
        new TableCell({ shading: { fill: "dbeafe" }, children: [new Paragraph({ children: [new TextRun({ text: fmtMoney(input.cadAssessed), bold: true, size: 18 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: "dbeafe" }, children: [new Paragraph({ children: [new TextRun({ text: subjectPpsf != null ? `$${subjectPpsf}` : "—", bold: true, size: 18 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: "dbeafe" }, children: [new Paragraph({ children: [new TextRun({ text: equityPpsf != null && subjectPpsf != null ? `$${subjectPpsf - equityPpsf}/sqft above median` : "—", bold: true, size: 18 })] })] }),
      ],
    }));

    parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    parts.push(blankLine());
  }

  return parts;
}

function identifySalesCompIssues(c: CadSalesComp): string {
  const issues: string[] = [];
  if (c.cadIndValueUsd != null && c.salePriceUsd != null && c.cadIndValueUsd > c.salePriceUsd) {
    issues.push(`Upward adj. +${fmtMoney(c.cadIndValueUsd - c.salePriceUsd)} — unexplained`);
  }
  if (c.distanceMi != null && c.distanceMi > 1.5) {
    issues.push(`${c.distanceMi} mi away`);
  }
  if (c.saleDate) {
    const monthsAgo = Math.floor((Date.now() - new Date(c.saleDate).getTime()) / (1000 * 60 * 60 * 24 * 30));
    if (monthsAgo > 12) issues.push(`Sale ${monthsAgo}mo ago`);
  }
  return issues.length > 0 ? issues.join("; ") : "—";
}

// ── Document B Section 4: Taxpayer's Supporting Evidence ──────────────────────

function buildTaxpayerEvidenceSection(input: EvidencePacketInput, subjectPpsf: number | null): (Paragraph | Table)[] {
  const { dcadComps, soldComps, manualSoldComps } = input;
  const parts: (Paragraph | Table)[] = [h2("Section 4 — Taxpayer's Supporting Evidence")];

  // 4A: Equity comps (DCAD-verified)
  if (dcadComps.length > 0) {
    parts.push(h3("4A — Comparable Properties (DCAD-Assessed)"));
    parts.push(bodySmall("All values below are from DCAD's own assessment records."));
    parts.push(blankLine());

    const rows: TableRow[] = [
      new TableRow({
        children: [
          hdrCell("Address", 30),
          hdrCell("City", 15),
          hdrCell("Sqft", 10),
          hdrCell("Bd/Ba", 10),
          hdrCell("Year Built", 10),
          hdrCell("CAD Assessed", 15),
          hdrCell("$/sqft", 10),
        ],
      }),
    ];

    for (let i = 0; i < dcadComps.length; i++) {
      const c = dcadComps[i];
      const compPpsf = c.perSqftUsd ?? (c.assessedValueUsd != null && c.sqft != null && c.sqft > 0 ? Math.round(c.assessedValueUsd / c.sqft) : null);
      const shade = i % 2 === 0 ? "FFFFFF" : "f9fafb";
      const below = compPpsf != null && subjectPpsf != null && compPpsf < subjectPpsf;
      rows.push(new TableRow({
        children: [
          dataCell(c.addressLine1 ?? "—", { shade }),
          dataCell(c.city ?? "—", { shade }),
          dataCell(fmtNum(c.sqft), { right: true, shade }),
          dataCell((c.beds != null || c.baths != null) ? `${c.beds ?? "—"}/${c.baths ?? "—"}` : "—", { shade }),
          dataCell(str(c.yearBuilt), { shade }),
          dataCell(fmtMoney(c.assessedValueUsd), { right: true, shade }),
          dataCell(compPpsf != null ? `$${compPpsf}` : "—", { right: true, shade, bold: below }),
        ],
      }));
      if (c.notes) {
        rows.push(new TableRow({
          children: [
            new TableCell({ columnSpan: 7, shading: { fill: "fef9c3" }, children: [new Paragraph({ children: [new TextRun({ text: `Note: ${c.notes}`, italics: true, size: 16 })] })] }),
          ],
        }));
      }
    }

    parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    parts.push(blankLine());
  }

  // 4B: Market sales
  const allSoldComps = [...soldComps, ...manualSoldComps.map((mc) => ({
    address: mc.address,
    city: mc.city ?? null,
    sqft: mc.sqft,
    beds: mc.beds,
    baths: mc.baths,
    soldPrice: mc.soldPrice,
    soldDate: mc.soldDate,
    pricePerSqft: mc.soldPrice != null && mc.sqft != null && mc.sqft > 0 ? Math.round(mc.soldPrice / mc.sqft) : null,
    listPrice: null,
    cadAssessedValueUsd: mc.assessedValueUsd,
  }))];

  if (allSoldComps.length > 0) {
    parts.push(h3("4B — Recent Market Sales"));
    parts.push(bodySmall("Recent arm's-length sales in the market area. Texas is a non-disclosure state — some prices may be estimated."));
    parts.push(blankLine());

    const rows: TableRow[] = [
      new TableRow({
        children: [
          hdrCell("Address", 30),
          hdrCell("Sqft", 8),
          hdrCell("Bd/Ba", 8),
          hdrCell("Sold Price", 14),
          hdrCell("Date", 10),
          hdrCell("$/sqft", 10),
          hdrCell("CAD Assessed", 12),
          hdrCell("Ratio", 8),
        ],
      }),
    ];

    for (let i = 0; i < allSoldComps.length; i++) {
      const c = allSoldComps[i];
      const shade = i % 2 === 0 ? "FFFFFF" : "f9fafb";
      const addr = c.address ?? "—";
      const ratio = c.cadAssessedValueUsd != null && c.soldPrice != null && c.soldPrice > 0
        ? `${((c.cadAssessedValueUsd / c.soldPrice) * 100).toFixed(0)}%` : "—";
      const pps = "pricePerSqft" in c ? (c as SoldComp).pricePerSqft : (c as { pricePerSqft: number | null }).pricePerSqft;
      rows.push(new TableRow({
        children: [
          dataCell(addr, { shade }),
          dataCell(fmtNum(c.sqft), { right: true, shade }),
          dataCell((c.beds != null || c.baths != null) ? `${c.beds ?? "—"}/${c.baths ?? "—"}` : "—", { shade }),
          dataCell(fmtMoney(c.soldPrice), { right: true, shade }),
          dataCell(c.soldDate ?? "—", { shade }),
          dataCell(pps != null ? `$${pps}` : "—", { right: true, shade }),
          dataCell(fmtMoney(c.cadAssessedValueUsd), { right: true, shade }),
          dataCell(ratio, { right: true, shade }),
        ],
      }));
    }

    parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    parts.push(blankLine());
  }

  return parts;
}

// ── Document B Section 5: Assessment Comparison Summary ───────────────────────

function buildAssessmentSummary(input: EvidencePacketInput, subjectPpsf: number | null): (Paragraph | Table)[] {
  if (input.dcadComps.length === 0) return [];

  const parts: (Paragraph | Table)[] = [
    h2("Section 5 — Assessment Comparison Summary"),
    bodySmall("All comparable properties sorted by assessed $/sqft. Subject property highlighted."),
    blankLine(),
  ];

  type Row = { addr: string; assessed: number | null; ppsf: number | null; sqft: number | null; isSubject?: boolean };
  const compRows: Row[] = input.dcadComps
    .filter((c) => c.assessedValueUsd != null)
    .map((c) => ({
      addr: c.addressLine1 ?? "—",
      assessed: c.assessedValueUsd,
      ppsf: c.perSqftUsd ?? (c.assessedValueUsd != null && c.sqft != null && c.sqft > 0 ? Math.round(c.assessedValueUsd / c.sqft) : null),
      sqft: c.sqft,
    }));

  if (input.cadAssessed != null) {
    compRows.push({
      addr: input.address,
      assessed: input.cadAssessed,
      ppsf: subjectPpsf,
      sqft: input.sqft,
      isSubject: true,
    });
  }
  compRows.sort((a, b) => (a.ppsf ?? 0) - (b.ppsf ?? 0));

  const rows: TableRow[] = [
    new TableRow({
      children: [
        hdrCell("Address", 45),
        hdrCell("Sqft", 12),
        hdrCell("CAD Assessed", 20),
        hdrCell("$/sqft", 13),
        hdrCell("vs Subject", 10),
      ],
    }),
  ];

  for (let i = 0; i < compRows.length; i++) {
    const c = compRows[i];
    const shade = c.isSubject ? "dbeafe" : (i % 2 === 0 ? "FFFFFF" : "f9fafb");
    const vsSubject = subjectPpsf != null && c.ppsf != null && !c.isSubject
      ? `${c.ppsf < subjectPpsf ? "-" : "+"}$${Math.abs(subjectPpsf - c.ppsf)}/sqft`
      : (c.isSubject ? "← Subject" : "—");
    rows.push(new TableRow({
      children: [
        dataCell(c.isSubject ? `★ ${c.addr}` : c.addr, { shade, bold: c.isSubject }),
        dataCell(fmtNum(c.sqft), { right: true, shade }),
        dataCell(fmtMoney(c.assessed), { right: true, shade, bold: c.isSubject }),
        dataCell(c.ppsf != null ? `$${c.ppsf}` : "—", { right: true, shade, bold: c.isSubject }),
        dataCell(vsSubject, { shade, bold: c.isSubject }),
      ],
    }));
  }

  parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  return parts;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateEvidenceDOCX(input: EvidencePacketInput): Promise<Buffer> {
  const genDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const subjectPpsf = input.cadAssessed != null && input.sqft != null && input.sqft > 0
    ? Math.round(input.cadAssessed / input.sqft)
    : null;

  // ── Document A: Protest Filing Letter ─────────────────────────────────────
  const letterParts = buildFilingLetter(input, genDate);

  // ── Document B: ARB Hearing Packet ────────────────────────────────────────
  const packetHeader: (Paragraph | Table)[] = [
    h1("PROPERTY TAX PROTEST — ARB HEARING PACKET"),
    body(`${input.address} · Tax Year ${input.taxYear}${input.cadPropertyId ? ` · DCAD ID: ${input.cadPropertyId}` : ""}`),
    body(`Generated: ${genDate}`),
    body(
      `Grounds: §41.41 — Incorrect Market Value${input.equityMedianUsd != null || input.dcadComps.length > 0 ? " | §41.43 — Unequal Appraisal" : ""}`,
      true
    ),
    blankLine(),
    h2("Section 1 — Subject Property"),
    buildSubjectDetailTable(input),
    blankLine(),
  ];

  const section2 = buildRequestedValueSection(input, subjectPpsf);
  const section3 = buildDcadProblemsSection(input, subjectPpsf);
  const section4 = buildTaxpayerEvidenceSection(input, subjectPpsf);
  const section5 = buildAssessmentSummary(input, subjectPpsf);

  // Negotiation table for informal hearing
  const negotiationSection: (Paragraph | Table)[] = [
    blankLine(),
    h2("Negotiation Tracker"),
    bodySmall("Keep this section for yourself during the hearing."),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [hdrCell("CAD Offer"), hdrCell("Your Counter"), hdrCell("Notes")] }),
        ...Array.from({ length: 5 }, () =>
          new TableRow({
            height: { value: 600, rule: "exact" },
            children: [new TableCell({ children: [new Paragraph("")] }), new TableCell({ children: [new Paragraph("")] }), new TableCell({ children: [new Paragraph("")] })],
          })
        ),
      ],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          ...letterParts,
          pageBreak(),
          ...packetHeader,
          ...section2,
          ...(section3.length > 0 ? section3 : []),
          ...(section4.length > 0 ? section4 : []),
          ...(section5.length > 0 ? section5 : []),
          ...negotiationSection,
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
