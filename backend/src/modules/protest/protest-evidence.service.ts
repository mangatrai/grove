import PDFDocument from "pdfkit";

import type { ProtestComp, ProtestStatus, StrategyJson } from "./protest-worksheet.service.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type SoldComp = {
  address: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  soldPrice: number | null;
  soldDate: string | null;
  pricePerSqft: number | null;
  listPrice: number | null;
};

export type EvidencePacketInput = {
  address: string;
  taxYear: number;
  cadAssessed: number | null;
  avm: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  hearingDate: string | null;
  worksheetStatus: ProtestStatus;
  strategy: StrategyJson | null;
  dcadComps: ProtestComp[];
  soldComps: SoldComp[];
};

// ── Layout constants ─────────────────────────────────────────────────────────

const ML = 50;        // left margin
const MR = 562;       // right margin (612 - 50)
const PW = 512;       // usable page width
const ROW_H = 18;     // table row height
const BOTTOM = 730;   // y threshold before adding a new page

// ── Colour palette ───────────────────────────────────────────────────────────

const CLR = {
  primary:   "#1c4ed8",
  primaryBg: "#eff6ff",
  dark:      "#111827",
  gray:      "#6b7280",
  lightGray: "#f9fafb",
  border:    "#e5e7eb",
  green:     "#16a34a",
  red:       "#dc2626",
  amber:     "#d97706",
  yellow:    "#fef9c3",
  white:     "#ffffff",
};

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function trunc(s: string | null | undefined, max: number): string {
  if (!s) return "—";
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

type Doc = InstanceType<typeof PDFDocument>;

function hRule(doc: Doc, y: number): void {
  doc.save().moveTo(ML, y).lineTo(MR, y).strokeColor(CLR.border).lineWidth(0.5).stroke().restore();
}

type ColDef = { label: string; w: number; align: "left" | "right" | "center" };

function tableHeader(doc: Doc, cols: ColDef[], y: number): void {
  doc.rect(ML, y, PW, ROW_H).fill(CLR.primary);
  let cx = ML;
  for (const col of cols) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(CLR.white)
      .text(col.label, cx + 3, y + 4, { width: col.w - 6, align: col.align, lineBreak: false });
    cx += col.w;
  }
}

function tableRow(
  doc: Doc,
  cols: ColDef[],
  values: Array<{ text: string; color?: string; bold?: boolean }>,
  y: number,
  bg: string
): void {
  doc.rect(ML, y, PW, ROW_H).fill(bg);
  doc.save().moveTo(ML, y + ROW_H).lineTo(MR, y + ROW_H)
    .strokeColor(CLR.border).lineWidth(0.3).stroke().restore();
  let cx = ML;
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const cell = values[i] ?? { text: "—" };
    doc.font(cell.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8).fillColor(cell.color ?? CLR.dark)
      .text(cell.text, cx + 3, y + 4, { width: col.w - 6, align: col.align, lineBreak: false });
    cx += col.w;
  }
}

// ── Section: Header (page 1) ─────────────────────────────────────────────────

function drawHeader(doc: Doc, address: string, year: number): number {
  // Blue banner
  doc.rect(0, 0, 612, 56).fill(CLR.primary);
  doc.font("Helvetica-Bold").fontSize(17).fillColor(CLR.white)
    .text("ARB Evidence Packet", ML, 12, { width: 320 });
  doc.font("Helvetica").fontSize(9).fillColor("#bfdbfe")
    .text(`Tax Year ${year}`, ML, 36);
  const genDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });
  doc.font("Helvetica").fontSize(9).fillColor("#bfdbfe")
    .text(`Generated: ${genDate}`, ML, 36, { width: PW, align: "right" });

  // Address row
  doc.font("Helvetica").fontSize(10).fillColor(CLR.gray)
    .text(address, ML, 66, { width: PW });
  return 84;
}

// ── Section: Valuation summary boxes ────────────────────────────────────────

function drawValuationSummary(doc: Doc, input: EvidencePacketInput, y: number): number {
  const { cadAssessed, avm, strategy } = input;
  const overPct =
    cadAssessed != null && avm != null && avm > 0
      ? ((cadAssessed / avm) - 1) * 100
      : null;

  type StatBox = { label: string; value: string; valueColor?: string };
  const boxes: StatBox[] = [
    { label: "CAD Assessed", value: fmtMoney(cadAssessed) },
    { label: "AVM Estimate", value: fmtMoney(avm) },
    {
      label: "Overassessment",
      value: overPct != null ? `${overPct >= 0 ? "+" : ""}${overPct.toFixed(1)}%` : "—",
      valueColor: overPct != null && overPct > 0 ? CLR.red : CLR.green
    },
    { label: "Target Value", value: fmtMoney(strategy?.targetValueUsd) }
  ];

  const bw = 116;
  const gap = (PW - boxes.length * bw) / (boxes.length - 1);
  const bh = 50;

  for (let i = 0; i < boxes.length; i++) {
    const bx = ML + i * (bw + gap);
    const box = boxes[i];
    doc.rect(bx, y, bw, bh).fill(CLR.lightGray);
    doc.save().rect(bx, y, bw, bh).strokeColor(CLR.border).lineWidth(0.5).stroke().restore();
    doc.font("Helvetica").fontSize(8).fillColor(CLR.gray)
      .text(box.label, bx + 7, y + 7, { width: bw - 14 });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(box.valueColor ?? CLR.dark)
      .text(box.value, bx + 7, y + 21, { width: bw - 14 });
  }
  return y + bh + 8;
}

// ── Section: Property facts row ──────────────────────────────────────────────

function drawPropertyFacts(doc: Doc, input: EvidencePacketInput, y: number): number {
  const facts = [
    { label: "Sqft", value: fmtNum(input.sqft) },
    { label: "Beds", value: input.beds != null ? String(input.beds) : "—" },
    { label: "Baths", value: input.baths != null ? String(input.baths) : "—" },
    { label: "Year Built", value: input.yearBuilt != null ? String(input.yearBuilt) : "—" },
    { label: "Status", value: input.worksheetStatus.replace(/_/g, " ") },
    { label: "Hearing Date", value: input.hearingDate ?? "Not set" }
  ];
  const fw = Math.floor(PW / facts.length);

  for (let i = 0; i < facts.length; i++) {
    const fx = ML + i * fw;
    const f = facts[i];
    doc.font("Helvetica").fontSize(8).fillColor(CLR.gray).text(f.label, fx, y, { width: fw });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(CLR.dark).text(f.value, fx, y + 12, { width: fw });
  }
  return y + 30;
}

// ── Section: Strategy ────────────────────────────────────────────────────────

function drawStrategy(doc: Doc, strategy: StrategyJson, y: number): number {
  hRule(doc, y);
  y += 10;

  doc.font("Helvetica-Bold").fontSize(12).fillColor(CLR.dark).text("Protest Strategy", ML, y);
  y += 18;

  // Case strength bar
  const strength = Math.max(0, Math.min(10, strategy.caseStrength));
  const barW = PW * 0.45;
  const filledW = (strength / 10) * barW;
  const barColor = strength >= 7 ? CLR.green : strength >= 4 ? CLR.amber : CLR.red;

  doc.font("Helvetica").fontSize(9).fillColor(CLR.gray)
    .text(`Case Strength: ${strength}/10`, ML, y);
  y += 13;
  doc.rect(ML, y, barW, 7).fill(CLR.border);
  doc.rect(ML, y, filledW, 7).fill(barColor);
  y += 14;

  // Primary strategy
  doc.font("Helvetica-Bold").fontSize(9).fillColor(CLR.dark).text("Primary Approach", ML, y);
  y += 12;
  doc.font("Helvetica").fontSize(9).fillColor(CLR.dark)
    .text(strategy.primaryStrategy, ML, y, { width: PW });
  y = doc.y + 8;

  // Arguments
  if (strategy.draftArguments.length > 0) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(CLR.dark).text("Key Arguments", ML, y);
    y += 12;
    for (const arg of strategy.draftArguments.slice(0, 6)) {
      doc.font("Helvetica").fontSize(9).fillColor(CLR.dark)
        .text(`• ${arg}`, ML + 8, y, { width: PW - 8 });
      y = doc.y + 3;
    }
    y += 4;
  }

  // Red flags
  if (strategy.redFlags.length > 0) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(CLR.red).text("Red Flags", ML, y);
    y += 12;
    for (const flag of strategy.redFlags.slice(0, 3)) {
      doc.font("Helvetica").fontSize(9).fillColor(CLR.red)
        .text(`⚠ ${flag}`, ML + 8, y, { width: PW - 8 });
      y = doc.y + 3;
    }
  }

  return y;
}

// ── Section: DCAD comps table ─────────────────────────────────────────────────

function drawCADCompsTable(
  doc: Doc,
  comps: ProtestComp[],
  subjectCadAssessed: number | null,
  subjectSqft: number | null
): void {
  let y = 50;

  doc.font("Helvetica-Bold").fontSize(13).fillColor(CLR.dark)
    .text("DCAD Comparable Properties", ML, y);
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(CLR.gray)
    .text(
      "Comparable properties from Dallas CAD public data. Green = comp market value below subject (supports protest).",
      ML, y, { width: PW }
    );
  y += 16;

  const cols: ColDef[] = [
    { label: "Address",    w: 130, align: "left"  },
    { label: "City",       w: 70,  align: "left"  },
    { label: "Sqft",       w: 45,  align: "right" },
    { label: "Bd/Ba",      w: 38,  align: "right" },
    { label: "Yr Blt",     w: 40,  align: "right" },
    { label: "Mkt Value",  w: 72,  align: "right" },
    { label: "$/sqft",     w: 46,  align: "right" },
    { label: "vs Subject", w: 71,  align: "right" }
  ];

  tableHeader(doc, cols, y);
  y += ROW_H;

  for (let i = 0; i < comps.length; i++) {
    if (y > BOTTOM) { doc.addPage(); y = 50; }
    const comp = comps[i];
    const mktVal = comp.marketValueUsd;
    const perSqft = comp.perSqftUsd ?? (mktVal != null && comp.sqft != null && comp.sqft > 0
      ? mktVal / comp.sqft : null);

    let vsPct = "—";
    let vsColor = CLR.dark;
    if (mktVal != null && subjectCadAssessed != null && subjectCadAssessed > 0) {
      const diff = ((mktVal / subjectCadAssessed) - 1) * 100;
      vsPct = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
      vsColor = diff < 0 ? CLR.green : CLR.red;
    }

    const bedBath = comp.beds != null || comp.baths != null
      ? `${comp.beds ?? "—"}/${comp.baths ?? "—"}` : "—";

    tableRow(doc, cols, [
      { text: trunc(comp.addressLine1, 22) },
      { text: trunc(comp.city, 12) },
      { text: fmtNum(comp.sqft), align: "right" } as unknown as { text: string },
      { text: bedBath },
      { text: comp.yearBuilt != null ? String(comp.yearBuilt) : "—" },
      { text: fmtMoney(mktVal) },
      { text: perSqft != null ? `$${Math.round(perSqft)}` : "—" },
      { text: vsPct, color: vsColor }
    ], y, i % 2 === 0 ? CLR.white : CLR.lightGray);
    y += ROW_H;
  }

  // Subject row (highlighted)
  if (y > BOTTOM) { doc.addPage(); y = 50; }
  const subjPerSqft = subjectCadAssessed != null && subjectSqft != null && subjectSqft > 0
    ? Math.round(subjectCadAssessed / subjectSqft) : null;

  tableRow(doc, cols, [
    { text: "SUBJECT PROPERTY", bold: true },
    { text: "—" },
    { text: fmtNum(subjectSqft), bold: true },
    { text: "—" },
    { text: "—" },
    { text: fmtMoney(subjectCadAssessed), bold: true },
    { text: subjPerSqft != null ? `$${subjPerSqft}` : "—", bold: true },
    { text: "—" }
  ], y, CLR.yellow);
  y += ROW_H + 10;

  doc.font("Helvetica").fontSize(8).fillColor(CLR.gray)
    .text("Assessed and market values reflect CAD public records. Subject row shows the property being protested.", ML, y, { width: PW });
}

// ── Section: Sold comps table ─────────────────────────────────────────────────

function drawSoldCompsTable(doc: Doc, comps: SoldComp[]): void {
  let y = 50;

  doc.font("Helvetica-Bold").fontSize(13).fillColor(CLR.dark)
    .text("Recent Comparable Sales (Redfin)", ML, y);
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(CLR.gray)
    .text(
      "Sold prices from public MLS records via Redfin. Texas is a non-disclosure state — some prices may be estimated.",
      ML, y, { width: PW }
    );
  y += 16;

  const cols: ColDef[] = [
    { label: "Address",    w: 160, align: "left"  },
    { label: "Sqft",       w: 52,  align: "right" },
    { label: "Bd/Ba",      w: 45,  align: "right" },
    { label: "Sold Price", w: 82,  align: "right" },
    { label: "Sold Date",  w: 72,  align: "right" },
    { label: "$/sqft",     w: 52,  align: "right" },
    { label: "List Price", w: 49,  align: "right" }
  ];

  tableHeader(doc, cols, y);
  y += ROW_H;

  for (let i = 0; i < comps.length; i++) {
    if (y > BOTTOM) { doc.addPage(); y = 50; }
    const comp = comps[i];
    const bedBath = comp.beds != null || comp.baths != null
      ? `${comp.beds ?? "—"}/${comp.baths ?? "—"}` : "—";

    tableRow(doc, cols, [
      { text: trunc(comp.address, 26) },
      { text: fmtNum(comp.sqft) },
      { text: bedBath },
      { text: fmtMoney(comp.soldPrice) },
      { text: comp.soldDate ?? "—" },
      { text: comp.pricePerSqft != null ? `$${Math.round(comp.pricePerSqft)}` : "—" },
      { text: fmtMoney(comp.listPrice) }
    ], y, i % 2 === 0 ? CLR.white : CLR.lightGray);
    y += ROW_H;
  }

  y += 10;
  doc.font("Helvetica").fontSize(8).fillColor(CLR.gray)
    .text("Source: Redfin API via RealtyAPI.io. Data may be delayed up to 30 days.", ML, y, { width: PW });
}

// ── Section: Market value bar chart ──────────────────────────────────────────

function drawBarChart(doc: Doc, input: EvidencePacketInput): void {
  const { dcadComps, cadAssessed, avm, address } = input;
  let y = 50;

  doc.font("Helvetica-Bold").fontSize(13).fillColor(CLR.dark)
    .text("Market Value Comparison", ML, y);
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(CLR.gray)
    .text(
      "Subject AVM vs DCAD comparable market values. Green bars are below subject (support your protest argument).",
      ML, y, { width: PW }
    );
  y += 20;

  // Subject value: prefer AVM (market-based), fallback to CAD assessed
  const subjectVal = avm ?? cadAssessed;

  type Bar = { label: string; value: number | null; isSubject: boolean };
  const bars: Bar[] = [
    { label: `${trunc(address, 35)} (Subject)`, value: subjectVal, isSubject: true },
    ...dcadComps.slice(0, 9).map((c) => ({
      label: trunc(c.addressLine1, 35),
      value: c.marketValueUsd,
      isSubject: false
    }))
  ];

  const maxVal = bars.reduce((m, b) => (b.value != null && b.value > m ? b.value : m), 0);
  if (maxVal === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(CLR.gray)
      .text("No market value data available for chart.", ML, y);
    return;
  }

  const labelW = 200;
  const chartX = ML + labelW + 6;
  const chartW = MR - chartX - 70; // leave room for value label
  const barH = 18;
  const barGap = 7;

  for (const bar of bars) {
    if (y > BOTTOM) break;

    // Label
    doc.font(bar.isSubject ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8)
      .fillColor(bar.isSubject ? CLR.primary : CLR.dark)
      .text(bar.label, ML, y + 4, { width: labelW, align: "right", lineBreak: false });

    if (bar.value != null && bar.value > 0) {
      const bw = Math.max(3, (bar.value / maxVal) * chartW);
      let barColor: string;
      if (bar.isSubject) {
        barColor = CLR.primary;
      } else {
        barColor = bar.value < (subjectVal ?? Infinity) ? CLR.green : CLR.red;
      }
      doc.rect(chartX, y, bw, barH).fill(barColor);
      doc.font("Helvetica").fontSize(8).fillColor(CLR.dark)
        .text(fmtMoney(bar.value), chartX + bw + 4, y + 4, { width: 70, lineBreak: false });
    } else {
      doc.font("Helvetica").fontSize(8).fillColor(CLR.gray)
        .text("—", chartX + 4, y + 4, { lineBreak: false });
    }

    y += barH + barGap;
  }

  // Vertical axis line
  doc.save().moveTo(chartX, 86).lineTo(chartX, y + 2)
    .strokeColor(CLR.border).lineWidth(0.5).stroke().restore();

  // Legend
  y += 16;
  const legendItems: Array<{ color: string; label: string }> = [
    { color: CLR.primary, label: "Subject property" },
    { color: CLR.green,   label: "Comp lower (supports protest)" },
    { color: CLR.red,     label: "Comp higher" }
  ];
  let lx = ML;
  for (const item of legendItems) {
    doc.rect(lx, y, 10, 10).fill(item.color);
    doc.font("Helvetica").fontSize(8).fillColor(CLR.dark)
      .text(item.label, lx + 13, y + 1, { lineBreak: false });
    lx += 170;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateEvidencePDF(input: EvidencePacketInput): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: "letter", margin: 0, autoFirstPage: true });

  // Page 1: cover + valuation + strategy
  let y = drawHeader(doc, input.address, input.taxYear);
  y = drawValuationSummary(doc, input, y);
  y = drawPropertyFacts(doc, input, y + 12);
  if (input.strategy) {
    drawStrategy(doc, input.strategy, y + 14);
  }

  // DCAD comps table
  if (input.dcadComps.length > 0) {
    doc.addPage();
    drawCADCompsTable(doc, input.dcadComps, input.cadAssessed, input.sqft);
  }

  // Redfin sold comps table
  if (input.soldComps.length > 0) {
    doc.addPage();
    drawSoldCompsTable(doc, input.soldComps);
  }

  // Bar chart
  if (input.dcadComps.length > 0) {
    doc.addPage();
    drawBarChart(doc, input);
  }

  doc.end();
  return doc;
}
