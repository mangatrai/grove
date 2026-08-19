import PDFDocument from "pdfkit";
import type { Response } from "express";

import { qAll } from "../../db/query.js";
import { SYMBOL } from "./espp-stock.service.js";
import type { EsppTaxReportRow, EsppTaxReportSummary } from "./espp.types.js";

function formatShares(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

function isLongTerm(purchaseDate: string, saleDate: string): boolean {
  const oneYearOut = new Date(`${purchaseDate}T00:00:00Z`);
  oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1);
  return new Date(`${saleDate}T00:00:00Z`) >= oneYearOut;
}

export async function getTaxReportData(
  householdId: string,
  year: number
): Promise<{ rows: EsppTaxReportRow[]; summary: EsppTaxReportSummary }> {
  const raw = await qAll<Record<string, unknown>>(
    `SELECT s.id AS sale_id, s.batch_id, s.sale_date, s.shares_sold, s.proceeds,
            s.disposition_type, s.ordinary_income, s.cap_gain_loss,
            b.offering_date, b.purchase_date, b.cost_basis_per_share,
            op.fmv_per_share AS offering_fmv
     FROM espp_sale s
     JOIN espp_batch b ON b.id = s.batch_id
     LEFT JOIN espp_offering_period op
       ON op.household_id = b.household_id AND op.offering_date = b.offering_date
     WHERE b.household_id = ? AND EXTRACT(YEAR FROM s.sale_date::date) = ?
     ORDER BY s.sale_date, b.purchase_date`,
    householdId, year
  );

  const rows: EsppTaxReportRow[] = raw.map(r => {
    const sharesSold         = parseFloat(String(r.shares_sold));
    const costBasisPerShare  = parseFloat(String(r.cost_basis_per_share));
    const brokerBasis        = parseFloat((costBasisPerShare * sharesSold).toFixed(2));
    const ordinaryIncome     = r.ordinary_income != null ? parseFloat(String(r.ordinary_income)) : null;
    const capGainLoss        = r.cap_gain_loss   != null ? parseFloat(String(r.cap_gain_loss))   : null;
    const dispositionType    = r.disposition_type as 'qualifying' | 'disqualifying';
    const purchaseDate       = r.purchase_date as string;
    const saleDate            = r.sale_date as string;

    return {
      batchId: r.batch_id as string,
      saleId: r.sale_id as string,
      description: `${formatShares(sharesSold)} sh ${SYMBOL} (ESPP)`,
      offeringDate: r.offering_date as string,
      offeringFmv: r.offering_fmv != null ? parseFloat(String(r.offering_fmv)) : null,
      dateAcquired: purchaseDate,
      dateSold: saleDate,
      term: isLongTerm(purchaseDate, saleDate) ? 'Long-term' : 'Short-term',
      dispositionType,
      sharesSold,
      proceeds: parseFloat(String(r.proceeds)),
      brokerBasis,
      ordinaryIncome,
      adjustedBasis: ordinaryIncome != null ? parseFloat((brokerBasis + ordinaryIncome).toFixed(2)) : null,
      capGainLoss,
      w2Status: dispositionType === 'disqualifying'
        ? 'Included in your W-2, Box 1'
        : 'NOT in your W-2 — self-report as additional compensation income (confirm the current-year Form 1040 line with your preparer; commonly Line 1h)',
      needsReview: ordinaryIncome == null,
    };
  });

  const summary: EsppTaxReportSummary = {
    year,
    totalProceeds: 0,
    totalBrokerBasis: 0,
    totalOrdinaryIncomeInW2: 0,
    totalOrdinaryIncomeSelfReport: 0,
    totalShortTermGainLoss: 0,
    totalLongTermGainLoss: 0,
    needsReviewCount: 0,
  };
  for (const row of rows) {
    summary.totalProceeds += row.proceeds;
    summary.totalBrokerBasis += row.brokerBasis;
    if (row.ordinaryIncome != null) {
      if (row.dispositionType === 'disqualifying') summary.totalOrdinaryIncomeInW2 += row.ordinaryIncome;
      else summary.totalOrdinaryIncomeSelfReport += row.ordinaryIncome;
    }
    if (row.capGainLoss != null) {
      if (row.term === 'Long-term') summary.totalLongTermGainLoss += row.capGainLoss;
      else summary.totalShortTermGainLoss += row.capGainLoss;
    }
    if (row.needsReview) summary.needsReviewCount += 1;
  }

  return { rows, summary };
}

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: EsppTaxReportRow[], summary: EsppTaxReportSummary): string {
  const header = [
    "Description (Form 8949 Col. a)", "Grant/Offering Date (Form 3922 Box 1)",
    "Grant FMV (Form 3922 Box 3)", "Date Acquired (Form 8949 Col. b)",
    "Date Sold (Form 8949 Col. c)", "Term", "Disposition",
    "Shares", "Proceeds (1099-B Box 1d / Form 8949 Col. d)",
    "Broker-Reported Basis (1099-B Box 1e)",
    "Ordinary Income (Compensation)", "8949 Adjustment Code (Col. f)",
    "8949 Adjustment Amount (Col. g)",
    "Adjusted Basis (Form 8949 Col. e+g)", "Capital Gain/Loss (Form 8949 Col. h)",
    "W-2 Status", "Needs Review",
  ];
  const lines = [header.map(csvField).join(",")];

  for (const r of rows) {
    lines.push([
      r.description, r.offeringDate,
      r.offeringFmv != null ? r.offeringFmv.toFixed(4) : "",
      r.dateAcquired, r.dateSold, r.term, r.dispositionType,
      formatShares(r.sharesSold), r.proceeds.toFixed(2), r.brokerBasis.toFixed(2),
      r.ordinaryIncome != null ? r.ordinaryIncome.toFixed(2) : "PENDING",
      r.ordinaryIncome != null ? "B" : "",
      r.ordinaryIncome != null ? r.ordinaryIncome.toFixed(2) : "",
      r.adjustedBasis != null ? r.adjustedBasis.toFixed(2) : "PENDING",
      r.capGainLoss != null ? r.capGainLoss.toFixed(2) : "PENDING",
      r.w2Status,
      r.needsReview ? "YES — enter offering-period FMV in ESPP settings" : "",
    ].map(csvField).join(","));
  }

  lines.push("");
  lines.push(`Summary for ${summary.year}`);
  lines.push(`Total proceeds (Form 1099-B Box 1d),${summary.totalProceeds.toFixed(2)}`);
  lines.push(`Total broker-reported basis (Form 1099-B Box 1e — unadjusted),${summary.totalBrokerBasis.toFixed(2)}`);
  lines.push(`Ordinary income already in your W-2 (Form W-2 Box 1),${summary.totalOrdinaryIncomeInW2.toFixed(2)}`);
  lines.push(`Ordinary income to self-report (not in W-2 — see per-row W-2 Status),${summary.totalOrdinaryIncomeSelfReport.toFixed(2)}`);
  lines.push(`Short-term capital gain/loss (Form 8949 Part I),${summary.totalShortTermGainLoss.toFixed(2)}`);
  lines.push(`Long-term capital gain/loss (Form 8949 Part II),${summary.totalLongTermGainLoss.toFixed(2)}`);
  if (summary.needsReviewCount > 0) {
    lines.push(`Lots pending review (missing offering-period FMV),${summary.needsReviewCount}`);
  }

  return lines.join("\n");
}

function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function renderTaxReportPdf(
  res: Response,
  year: number,
  rows: EsppTaxReportRow[],
  summary: EsppTaxReportSummary
): void {
  const doc = new PDFDocument({ margin: 50, size: "letter" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="espp-tax-report-${year}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).font("Helvetica-Bold").text(`ESPP Tax Report — ${year}`);
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#555555")
    .text(`${SYMBOL} Employee Stock Purchase Plan (ESPP) — sales realized in this calendar year. Prepared for tax filing; verify against your Form 1099-B and W-2.`);
  doc.fillColor("#000000");
  doc.moveDown(1);

  doc.fontSize(13).font("Helvetica-Bold").text("Summary");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica");
  doc.text(`Total proceeds (Form 1099-B, Box 1d): ${formatUsd(summary.totalProceeds)}`);
  doc.text(`Total broker-reported basis, unadjusted (Form 1099-B, Box 1e): ${formatUsd(summary.totalBrokerBasis)}`);
  doc.text(`Ordinary income already included in your W-2 — disqualifying dispositions (Form W-2, Box 1): ${formatUsd(summary.totalOrdinaryIncomeInW2)}`);
  doc.font("Helvetica-Bold").text(`Ordinary income to self-report — NOT in your W-2 — qualifying dispositions (additional compensation income; confirm current-year Form 1040 line with your preparer): ${formatUsd(summary.totalOrdinaryIncomeSelfReport)}`);
  doc.font("Helvetica").text(`Short-term capital gain/loss (Form 8949, Part I): ${formatUsd(summary.totalShortTermGainLoss)}`);
  doc.text(`Long-term capital gain/loss (Form 8949, Part II): ${formatUsd(summary.totalLongTermGainLoss)}`);
  doc.moveDown(1);

  if (summary.needsReviewCount > 0) {
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#b45309")
      .text(`⚠ ${summary.needsReviewCount} lot(s) below are pending review — the offering-period FMV (Form 3922, Box 3) hasn't been entered yet, so ordinary income/capital gain for those qualifying-disposition sales cannot be computed. Enter it in the ESPP page's Offering Periods panel, then re-download this report.`, { width: 512 });
    doc.fillColor("#000000");
    doc.moveDown(1);
  }

  doc.fontSize(13).font("Helvetica-Bold").text("Sale Detail");
  doc.moveDown(0.3);

  const cols = [
    { label: "Acquired", width: 45 },
    { label: "Grant Date", width: 45 },
    { label: "Grant FMV", width: 45 },
    { label: "Sold", width: 45 },
    { label: "Term", width: 40 },
    { label: "Shares", width: 40 },
    { label: "Proceeds", width: 50 },
    { label: "Adj. Basis", width: 50 },
    { label: "Ord. Income", width: 50 },
    { label: "Cap G/L", width: 50 },
  ];
  const colX: number[] = [];
  {
    let x = doc.x;
    for (const c of cols) { colX.push(x); x += c.width; }
  }

  function row(cells: string[], bold: boolean): void {
    if (doc.y > 700) {
      doc.addPage();
    }
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    cells.forEach((cell, i) => doc.text(cell, colX[i], y, { width: cols[i].width }));
    doc.moveDown(0.6);
  }

  row(cols.map(c => c.label), true);
  for (const r of rows) {
    row([
      r.dateAcquired, r.offeringDate, r.offeringFmv != null ? formatUsd(r.offeringFmv) : "—",
      r.dateSold, r.term, formatShares(r.sharesSold),
      formatUsd(r.proceeds),
      r.adjustedBasis != null ? formatUsd(r.adjustedBasis) : "PENDING*",
      r.ordinaryIncome != null ? formatUsd(r.ordinaryIncome) : "PENDING*",
      r.capGainLoss != null ? formatUsd(r.capGainLoss) : "PENDING*",
    ], false);
  }
  if (rows.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#555555").text("No ESPP sales in this calendar year.");
    doc.fillColor("#000000");
  }
  if (rows.some(r => r.needsReview)) {
    doc.moveDown(0.5);
    doc.fontSize(8).font("Helvetica").fillColor("#555555").text("* Pending — see summary note above.");
    doc.fillColor("#000000");
  }

  doc.end();
}
