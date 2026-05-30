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
} from "docx";

import type { EvidencePacketInput, SoldComp } from "./protest-evidence.service.js";
import type { ProtestComp, StrategyJson } from "./protest-worksheet.service.js";

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

// ── Simple table helpers ──────────────────────────────────────────────────────

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { fill: "1c4ed8" },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 18 })],
      alignment: AlignmentType.CENTER,
    })],
  });
}

function dataCell(text: string, bold = false, right = false): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold, size: 18 })],
      alignment: right ? AlignmentType.END : AlignmentType.START,
    })],
  });
}

function kvRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        shading: { fill: "f9fafb" },
        children: [new Paragraph({
          children: [new TextRun({ text: label, bold: true, size: 18 })],
        })],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          children: [new TextRun({ text: value, size: 18 })],
        })],
      }),
    ],
  });
}

function heading1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

function heading2(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function body(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    spacing: { after: 120 },
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

// ── Section 1: ARB Board Packet ───────────────────────────────────────────────

function buildValuationTable(input: EvidencePacketInput): Table {
  const { cadAssessed, avm, strategy } = input;
  const overPct =
    cadAssessed != null && avm != null && avm > 0
      ? `${(((cadAssessed / avm) - 1) * 100).toFixed(1)}%`
      : "—";

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          headerCell("CAD Assessed"),
          headerCell("AVM Estimate"),
          headerCell("Overassessment"),
          headerCell("Target Value"),
        ],
      }),
      new TableRow({
        children: [
          dataCell(fmtMoney(cadAssessed), true, true),
          dataCell(fmtMoney(avm), true, true),
          dataCell(overPct, true, true),
          dataCell(fmtMoney(strategy?.targetValueUsd), true, true),
        ],
      }),
    ],
  });
}

function buildPropertyFactsTable(input: EvidencePacketInput): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          headerCell("Sqft"),
          headerCell("Beds"),
          headerCell("Baths"),
          headerCell("Year Built"),
          headerCell("Hearing Date"),
          headerCell("Status"),
        ],
      }),
      new TableRow({
        children: [
          dataCell(fmtNum(input.sqft), false, true),
          dataCell(str(input.beds), false, true),
          dataCell(str(input.baths), false, true),
          dataCell(str(input.yearBuilt), false, true),
          dataCell(input.hearingDate ?? "Not set"),
          dataCell(input.worksheetStatus.replace(/_/g, " ")),
        ],
      }),
    ],
  });
}

function buildDCADCompsTable(comps: ProtestComp[], subjectCadAssessed: number | null): Table {
  const headerRow = new TableRow({
    children: [
      headerCell("Address"),
      headerCell("City"),
      headerCell("Sqft"),
      headerCell("Bd/Ba"),
      headerCell("Year Built"),
      headerCell("Market Value"),
      headerCell("$/Sqft"),
      headerCell("vs Subject"),
    ],
  });

  const dataRows = comps.map((comp, i) => {
    const mktVal = comp.marketValueUsd;
    const perSqft = comp.perSqftUsd ?? (mktVal != null && comp.sqft != null && comp.sqft > 0
      ? mktVal / comp.sqft : null);

    let vsPct = "—";
    if (mktVal != null && subjectCadAssessed != null && subjectCadAssessed > 0) {
      const diff = ((mktVal / subjectCadAssessed) - 1) * 100;
      vsPct = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
    }

    const bedBath = comp.beds != null || comp.baths != null
      ? `${comp.beds ?? "—"}/${comp.baths ?? "—"}` : "—";

    const shade = i % 2 === 0 ? "FFFFFF" : "f9fafb";
    return new TableRow({
      children: [
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: comp.addressLine1 ?? "—", size: 16 })] })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: comp.city ?? "—", size: 16 })] })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: fmtNum(comp.sqft), size: 16 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: bedBath, size: 16 })], alignment: AlignmentType.CENTER })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: str(comp.yearBuilt), size: 16 })], alignment: AlignmentType.CENTER })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: fmtMoney(mktVal), size: 16 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: perSqft != null ? `$${Math.round(perSqft)}` : "—", size: 16 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: vsPct, size: 16 })], alignment: AlignmentType.END })] }),
      ],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

function buildSoldCompsTable(comps: SoldComp[]): Table {
  const headerRow = new TableRow({
    children: [
      headerCell("Address"),
      headerCell("Sqft"),
      headerCell("Bd/Ba"),
      headerCell("Sold Price"),
      headerCell("Sold Date"),
      headerCell("$/Sqft"),
      headerCell("List Price"),
    ],
  });

  const dataRows = comps.map((comp, i) => {
    const bedBath = comp.beds != null || comp.baths != null
      ? `${comp.beds ?? "—"}/${comp.baths ?? "—"}` : "—";
    const shade = i % 2 === 0 ? "FFFFFF" : "f9fafb";
    return new TableRow({
      children: [
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: comp.address ?? "—", size: 16 })] })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: fmtNum(comp.sqft), size: 16 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: bedBath, size: 16 })], alignment: AlignmentType.CENTER })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: fmtMoney(comp.soldPrice), size: 16 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: comp.soldDate ?? "—", size: 16 })] })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: comp.pricePerSqft != null ? `$${Math.round(comp.pricePerSqft)}` : "—", size: 16 })], alignment: AlignmentType.END })] }),
        new TableCell({ shading: { fill: shade }, children: [new Paragraph({ children: [new TextRun({ text: fmtMoney(comp.listPrice), size: 16 })], alignment: AlignmentType.END })] }),
      ],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

// ── Section 2: Protestor Reference ───────────────────────────────────────────

function buildNegotiationTable(): Table {
  const headerRow = new TableRow({
    children: [headerCell("CAD Offer"), headerCell("Your Counter"), headerCell("Notes")],
  });
  const emptyRows = Array.from({ length: 5 }, () =>
    new TableRow({
      height: { value: 600, rule: "exact" },
      children: [
        new TableCell({ children: [new Paragraph("")] }),
        new TableCell({ children: [new Paragraph("")] }),
        new TableCell({ children: [new Paragraph("")] }),
      ],
    })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...emptyRows],
  });
}

function buildQuickRefTable(input: EvidencePacketInput, strategy: StrategyJson): Table {
  const rows: [string, string][] = [
    ["CAD Assessed", fmtMoney(input.cadAssessed)],
    ["AVM Estimate", fmtMoney(input.avm)],
    ["Target Value", fmtMoney(strategy.targetValueUsd)],
    ["Case Strength", `${strategy.caseStrength}/10`],
    ["Hearing Date", input.hearingDate ?? "Not set"],
    ["Red Flags", strategy.redFlags.length > 0 ? strategy.redFlags.join("; ") : "None"],
  ];
  return new Table({
    width: { size: 60, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => kvRow(k, v)),
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateEvidenceDOCX(input: EvidencePacketInput): Promise<Buffer> {
  const { address, taxYear, strategy, dcadComps, soldComps, cadAssessed } = input;
  const genDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ── Section 1: ARB Board Packet ─────────────────────────────────────────────
  const section1: (Paragraph | Table)[] = [
    heading1(`Property Tax Protest — ARB Evidence Packet`),
    body(`${address} · Tax Year ${taxYear} · Generated ${genDate}`),
    blankLine(),
    heading2("Valuation Summary"),
    buildValuationTable(input),
    blankLine(),
    heading2("Property Details"),
    buildPropertyFactsTable(input),
  ];

  if (strategy) {
    section1.push(
      blankLine(),
      heading2("Protest Strategy"),
      body(`Case Strength: ${strategy.caseStrength}/10`),
      body(`Primary Approach: ${strategy.primaryStrategy}`),
    );
    if (strategy.draftArguments.length > 0) {
      section1.push(heading2("Key Arguments"));
      strategy.draftArguments.forEach((arg) => section1.push(bullet(arg)));
    }
    if (strategy.redFlags.length > 0) {
      section1.push(heading2("Red Flags"));
      strategy.redFlags.forEach((flag) => section1.push(bullet(flag)));
    }
  }

  if (dcadComps.length > 0) {
    section1.push(
      blankLine(),
      heading2("Unequal Appraisal Evidence — DCAD Comparables"),
      body("Comparable properties from Dallas CAD public data. Properties with lower market values support your unequal appraisal argument."),
      buildDCADCompsTable(dcadComps, cadAssessed),
    );
  }

  if (soldComps.length > 0) {
    section1.push(
      blankLine(),
      heading2("Market Value Evidence — Recent Sales"),
      body("Recent sold prices from public MLS records via Redfin. Texas is a non-disclosure state — some prices may be estimated."),
      buildSoldCompsTable(soldComps),
    );
  }

  // ── Section 2: Protestor Reference ─────────────────────────────────────────
  const section2: (Paragraph | Table)[] = [
    new Paragraph({ children: [new PageBreak()] }),
    heading1("Protestor Reference Sheet"),
    body("Keep this section for yourself — do not submit to the ARB panel."),
  ];

  if (strategy) {
    section2.push(
      blankLine(),
      heading2("Oral Script"),
      body("Use these talking points when presenting your case:"),
    );
    const sentences = strategy.primaryStrategy
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim().length > 0);
    sentences.forEach((s, i) => section2.push(
      new Paragraph({
        children: [new TextRun({ text: `${i + 1}. ${s}`, size: 20 })],
        spacing: { after: 120 },
      })
    ));
    if (strategy.draftArguments.length > 0) {
      section2.push(blankLine());
      strategy.draftArguments.forEach((arg) => section2.push(bullet(arg)));
    }

    section2.push(
      blankLine(),
      heading2("Negotiation Table"),
      body("Use this table to track offers and counters during the informal hearing:"),
      buildNegotiationTable(),
      blankLine(),
      heading2("Quick-Reference Card"),
      buildQuickRefTable(input, strategy),
    );
  } else {
    section2.push(
      blankLine(),
      body("No strategy has been generated yet. Use the AI protest assistant to generate a strategy before the hearing."),
      blankLine(),
      heading2("Negotiation Table"),
      buildNegotiationTable(),
    );
  }

  const doc = new Document({
    sections: [
      {
        children: [...section1, ...section2],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
