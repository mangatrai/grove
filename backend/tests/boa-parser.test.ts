import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseBoaCheckingOrSavingsCsvDetailed } from "../src/modules/imports/profiles/boa-checking-savings-csv.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("BOA checking/savings CSV parser", () => {
  it("parses full BoA web-export sample (tail parser; hundreds of rows)", () => {
    const stmtPath = path.join(repoRoot, "data/imports/custom/stmt.csv");
    if (!fs.existsSync(stmtPath)) {
      return;
    }
    const buf = fs.readFileSync(stmtPath);
    const out = parseBoaCheckingOrSavingsCsvDetailed(buf);
    expect(out.rows.length).toBeGreaterThanOrEqual(650);
    expect(out.diagnostics.droppedBeginningBalance).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.csvParsedRows).toBeLessThan(100);
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

    const out = parseBoaCheckingOrSavingsCsvDetailed(Buffer.from(csv, "utf8"));
    expect(out.rows.length).toBeGreaterThanOrEqual(2);
    expect(out.rows.some((r) => r.description.includes('PAYMENT FOR "CARD MEMBER"'))).toBe(true);
    expect(out.diagnostics.dataLineCount).toBe(3);
    expect(out.diagnostics.fallbackParsedRows).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.droppedLikelyMalformedCsvRows).toBeGreaterThanOrEqual(1);
  });
});

