import PDFDocument from "pdfkit";
import type { Response } from "express";

import { qAll } from "../../../db/query.js";
import type { StaffProfile } from "../staff.types.js";
import type { PaySummary } from "../pay.types.js";
import type { TimesheetPeriodStatus } from "../timesheet.types.js";

export type HoursReportEntry = {
  workDate: string;
  hoursWorked: number;
  note: string | null;
  periodStatus: TimesheetPeriodStatus;
};

export async function listHoursReportEntries(
  householdId: string,
  staffProfileId: string,
  from: string,
  to: string
): Promise<HoursReportEntry[]> {
  const rows = await qAll<{
    work_date: string;
    hours_worked: string;
    note: string | null;
    status: TimesheetPeriodStatus;
  }>(
    `SELECT te.work_date, te.hours_worked, te.note, tp.status
     FROM timesheet_entry te
     JOIN timesheet_period tp ON tp.id = te.timesheet_period_id
     WHERE tp.household_id = ? AND tp.staff_profile_id = ? AND te.work_date BETWEEN ? AND ?
     ORDER BY te.work_date`,
    householdId,
    staffProfileId,
    from,
    to
  );
  return rows.map((r) => ({
    workDate: r.work_date,
    hoursWorked: Number(r.hours_worked),
    note: r.note,
    periodStatus: r.status
  }));
}

function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fileSafeName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, "-").toLowerCase();
}

function renderHeader(doc: PDFKit.PDFDocument, title: string, staff: StaffProfile, from: string, to: string): void {
  doc.fontSize(18).font("Helvetica-Bold").text(title);
  doc.moveDown(0.3);
  doc.fontSize(11).font("Helvetica").fillColor("#555555").text(staff.fullName);
  doc.text(`${from} to ${to}`);
  doc.fillColor("#000000");
  doc.moveDown(1);
}

export function renderHoursReportPdf(
  res: Response,
  staff: StaffProfile,
  from: string,
  to: string,
  entries: HoursReportEntry[]
): void {
  const doc = new PDFDocument({ margin: 50, size: "letter" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="hours-report-${fileSafeName(staff.fullName)}-${from}-to-${to}.pdf"`
  );
  doc.pipe(res);

  renderHeader(doc, "Hours Report", staff, from, to);

  const colX = [doc.x, doc.x + 90, doc.x + 160, doc.x + 250];
  const colWidths = [90, 70, 90, 210];

  function row(cells: string[], bold: boolean): void {
    if (doc.y > 700) {
      doc.addPage();
    }
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    cells.forEach((cell, i) => doc.text(cell, colX[i], y, { width: colWidths[i] }));
    doc.moveDown(0.6);
  }

  row(["Date", "Hours", "Status", "Note"], true);
  let totalHours = 0;
  for (const e of entries) {
    totalHours += e.hoursWorked;
    row([e.workDate, e.hoursWorked.toFixed(2), e.periodStatus, e.note ?? ""], false);
  }
  if (entries.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#555555").text("No timesheet entries in this date range.");
    doc.fillColor("#000000");
  }
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).text(`Total hours: ${totalHours.toFixed(2)}`);

  doc.end();
}

export function renderPaymentReportPdf(res: Response, staff: StaffProfile, summary: PaySummary): void {
  const doc = new PDFDocument({ margin: 50, size: "letter" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="payment-report-${fileSafeName(staff.fullName)}-${summary.from}-to-${summary.to}.pdf"`
  );
  doc.pipe(res);

  renderHeader(doc, "Payment Report", staff, summary.from, summary.to);

  doc.fontSize(13).font("Helvetica-Bold").text("Earned");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica");
  doc.text(`Timesheet hours: ${formatUsd(summary.earned.timesheetCents)}`);
  doc.text(`Approved expenses: ${formatUsd(summary.earned.expenseCents)}`);
  doc.font("Helvetica-Bold").text(`Total earned: ${formatUsd(summary.earned.totalCents)}`);
  doc.moveDown(1);

  doc.fontSize(13).font("Helvetica-Bold").text("Paid");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica");
  doc.text(`Salary: ${formatUsd(summary.paid.salaryCents)}`);
  doc.text(`Bonus: ${formatUsd(summary.paid.bonusCents)}`);
  doc.text(`Reimbursement: ${formatUsd(summary.paid.reimbursementCents)}`);
  doc.font("Helvetica-Bold").text(`Total paid: ${formatUsd(summary.paid.totalCents)}`);
  doc.moveDown(1);

  doc.fontSize(13).font("Helvetica-Bold").text(`Balance due: ${formatUsd(summary.balanceDueCents)}`);

  doc.end();
}
