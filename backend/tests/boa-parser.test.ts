import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseBoaCheckingOrSavingsCsvDetailed,
  parseBoaCsvStatementBalances
} from "../src/modules/imports/profiles/boa-checking-savings-csv.js";
import {
  extractBoaEStatementBalancesFromText,
  parseBoaEStatementFromTextDetailed,
} from "../src/modules/imports/profiles/boa-estatement-pdf.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("BOA checking/savings CSV parser", () => {
  it("parses full BoA web-export sample (tail parser; hundreds of rows)", () => {
    const stmtPath = path.join(repoRoot, "data/imports/custom/stmt.csv");
    if (!fs.existsSync(stmtPath)) {
      return;
    }
    const buf = fs.readFileSync(stmtPath);
    const out = parseBoaCheckingOrSavingsCsvDetailed(buf, "boa_checking_csv");
    expect(out.rows.length).toBeGreaterThanOrEqual(650);
    expect(out.diagnostics.droppedBeginningBalance).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.csvParsedRows).toBeLessThan(100);
    expect(out.statementBalances).not.toBeNull();
    expect(out.statementBalances?.beginning).toBeCloseTo(44679.3, 2);
    expect(out.statementBalances?.ending).toBeCloseTo(19487.2, 2);
    expect(out.statementBalances?.asOfStart).toBe("2025-01-01");
    expect(out.statementBalances?.asOfEnd).toBe("2026-03-23");
  });

  it("extracts beginning and ending balance from BoA eStatement text snippet (MM/DD/YYYY format)", () => {
    const text =
      "Account summary. Beginning balance as of 01/01/2025 12,345.67 foo Ending balance as of 01/31/2025 98,765.43 trailer";
    const b = extractBoaEStatementBalancesFromText(text);
    expect(b).not.toBeNull();
    expect(b?.source).toBe("boa_estatement_pdf");
    expect(b?.beginning).toBeCloseTo(12345.67, 2);
    expect(b?.ending).toBeCloseTo(98765.43, 2);
    expect(b?.asOfStart).toBe("2025-01-01");
    expect(b?.asOfEnd).toBe("2025-01-31");
  });

  it("extracts beginning and ending balance from BoA eStatement with 'Month DD, YYYY' date format", () => {
    // Real BoA eStatement PDFs use this format (pdf-parse concatenates date and amount with no space)
    const text =
      "Account summary Beginning balance on April 21, 2026$23,547.79 Deposits and other additions19,385.48 Ending balance on May 18, 2026$24,997.22";
    const b = extractBoaEStatementBalancesFromText(text);
    expect(b).not.toBeNull();
    expect(b?.beginning).toBeCloseTo(23547.79, 2);
    expect(b?.ending).toBeCloseTo(24997.22, 2);
    expect(b?.asOfStart).toBe("2026-04-21");
    expect(b?.asOfEnd).toBe("2026-05-18");
  });

  it("extracts balances from actual BoA eStatement PDF if present", async () => {
    const pdfPath = path.join(repoRoot, "data/imports/banks/eStmt_2026-05-18.pdf");
    if (!fs.existsSync(pdfPath)) return;
    const { parseBoaEStatementFromTextDetailed } = await import("../src/modules/imports/profiles/boa-estatement-pdf.js");
    const { extractPdfText } = await import("../src/modules/imports/profiles/pdf-text.js");
    const buf = fs.readFileSync(pdfPath);
    const text = await extractPdfText(buf);
    const out = parseBoaEStatementFromTextDetailed(text);
    expect(out.statementBalances).not.toBeNull();
    expect(out.statementBalances?.beginning).toBeCloseTo(23547.79, 2);
    expect(out.statementBalances?.ending).toBeCloseTo(24997.22, 2);
    expect(out.statementBalances?.asOfStart).toBe("2026-04-21");
    expect(out.statementBalances?.asOfEnd).toBe("2026-05-18");
  });

  it("extracts summary block balances from BoA CSV preamble only", () => {
    const csv = [
      "Description,,Summary Amt.",
      'Beginning balance as of 01/01/2025,,"1,234.56"',
      'Ending balance as of 01/31/2025,,"5,678.90"',
      "",
      "Date,Description,Amount,Running Bal.",
      '01/15/2025,"COFFEE",-5.25,1000.00'
    ].join("\n");
    const b = parseBoaCsvStatementBalances(csv, "boa_checking_csv");
    expect(b).not.toBeNull();
    expect(b?.beginning).toBeCloseTo(1234.56, 2);
    expect(b?.ending).toBeCloseTo(5678.9, 2);
    expect(b?.asOfStart).toBe("2025-01-01");
    expect(b?.asOfEnd).toBe("2025-01-31");
  });

  // ── BoA eStatement PDF transaction parser ──────────────────────────────────

  it("parses flat 'Withdrawals and other subtractions' section (no ATM/Other subsections)", () => {
    // Adv Relationship Banking and some BoA account types use a flat layout
    // where all withdrawals sit directly under the section header.
    const text = [
      "Deposits and other additions",
      "Date Description Amount",
      "04/15/26 PAYROLL DIRECT DEPOSIT 2,000.00",
      "Total deposits and other additions 2,000.00",
      "Withdrawals and other subtractions",
      "Date Description Amount",
      "04/18/26 GROCERY STORE -75.00",
      "04/22/26 UTILITY BILL -120.00",
      "04/29/26 ONLINE PAYMENT -45.00",
      "Total withdrawals and other subtractions -240.00",
    ].join("\n");

    const { rows } = parseBoaEStatementFromTextDetailed(text);
    expect(rows).toHaveLength(4);

    const deposits = rows.filter(r => r.amount > 0);
    const withdrawals = rows.filter(r => r.amount < 0);
    expect(deposits).toHaveLength(1);
    expect(deposits[0]!.amount).toBeCloseTo(2000, 2);

    expect(withdrawals).toHaveLength(3);
    expect(withdrawals.map(r => r.amount).sort((a, b) => a - b))
      .toEqual([-120, -75, -45]);
  });

  it("parses nested withdrawals with ATM and Other subsections (regression)", () => {
    // Standard BoA checking layout: subsections appear inside Withdrawals
    const text = [
      "Deposits and other additions",
      "Date Description Amount",
      "05/01/26 PAYROLL DIRECT DEPOSIT 3,000.00",
      "Total deposits and other additions 3,000.00",
      "Withdrawals and other subtractions",
      "ATM and debit card subtractions",
      "Date Description Amount",
      "05/05/26 ATM CASH WITHDRAWAL -200.00",
      "05/10/26 DEBIT CARD PURCHASE -35.00",
      "Total ATM and debit card subtractions -235.00",
      "Other subtractions",
      "Date Description Amount",
      "05/15/26 ONLINE TRANSFER -500.00",
      "Total other subtractions -500.00",
      "Total withdrawals and other subtractions -735.00",
    ].join("\n");

    const { rows } = parseBoaEStatementFromTextDetailed(text);
    expect(rows).toHaveLength(4);

    const withdrawals = rows.filter(r => r.amount < 0);
    expect(withdrawals).toHaveLength(3);
    expect(withdrawals.map(r => r.amount).sort((a, b) => a - b))
      .toEqual([-500, -200, -35]);
  });

  it("parses month with only ATM subsection (no Other subtractions block)", () => {
    const text = [
      "Withdrawals and other subtractions",
      "ATM and debit card subtractions",
      "Date Description Amount",
      "06/03/26 ATM CASH WITHDRAWAL -100.00",
      "06/12/26 DEBIT CARD PURCHASE -22.50",
      "Total ATM and debit card subtractions -122.50",
      "Total withdrawals and other subtractions -122.50",
    ].join("\n");

    const { rows } = parseBoaEStatementFromTextDetailed(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.amount).toBeCloseTo(-100, 2);
    expect(rows[1]!.amount).toBeCloseTo(-22.5, 2);
  });

  it("parses eStatement from spouse BoA PDF if present", async () => {
    const pdfPath = path.join(repoRoot, "data/imports/banks/neha/eStmt_2025-05-12.pdf");
    if (!fs.existsSync(pdfPath)) return;
    const { extractPdfText } = await import("../src/modules/imports/profiles/pdf-text.js");
    const buf = fs.readFileSync(pdfPath);
    const text = await extractPdfText(buf);
    const { rows, statementBalances } = parseBoaEStatementFromTextDetailed(text);
    // 4 deposits + 7 withdrawals
    expect(rows.length).toBeGreaterThanOrEqual(11);
    const withdrawals = rows.filter(r => r.amount < 0);
    expect(withdrawals.length).toBeGreaterThanOrEqual(7);
    expect(statementBalances?.beginning).toBeCloseTo(41321.32, 2);
    expect(statementBalances?.ending).toBeCloseTo(45343.95, 2);
  });

  it("recovers malformed quoted-description rows via loose fallback parsing", () => {
    const csv = [
      "Account summary header",
      "Another summary line",
      "Date,Description,Amount,Running Bal.",
      '01/01/2026,"COFFEE SHOP",-5.25,1000.00',
      '01/02/2026,"PAYMENT FOR "CARD MEMBER"",-45.00,955.00',
      "01/03/2026,Beginning balance,955.00,955.00"
    ].join("\n");

    const out = parseBoaCheckingOrSavingsCsvDetailed(Buffer.from(csv, "utf8"), "boa_checking_csv");
    expect(out.rows.length).toBeGreaterThanOrEqual(2);
    expect(out.rows.some((r) => r.description.includes('PAYMENT FOR "CARD MEMBER"'))).toBe(true);
    expect(out.diagnostics.dataLineCount).toBe(3);
    expect(out.diagnostics.fallbackParsedRows).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.droppedLikelyMalformedCsvRows).toBeGreaterThanOrEqual(1);
  });
});

