import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseBoaCheckingOrSavingsCsvDetailed,
  parseBoaCsvStatementBalances
} from "../src/modules/imports/profiles/boa-checking-savings-csv.js";
import { extractBoaEStatementBalancesFromText } from "../src/modules/imports/profiles/boa-estatement-pdf.js";

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

