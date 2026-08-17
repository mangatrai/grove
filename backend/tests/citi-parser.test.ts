import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractCitiCreditCardBalancesFromText,
  parseCitiCreditCardPdfFromText
} from "../src/modules/imports/profiles/citi-credit-card-pdf.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Citi credit card PDF parser", () => {
  it("extracts previous/new balance and billing period from an Account Summary text snippet", () => {
    const text = [
      "Billing Period: 07/07/26-08/06/26",
      "New balance as of 08/06/26: $37.87",
      "Account Summary",
      "Previous balance $105.40",
      "Payments-$105.40",
      "Credits-$0.00",
      "Purchases +$37.87",
      "New balance $37.87"
    ].join("\n");
    const b = extractCitiCreditCardBalancesFromText(text);
    expect(b).not.toBeNull();
    expect(b?.source).toBe("citi_credit_card_pdf");
    expect(b?.beginning).toBeCloseTo(105.4, 2);
    expect(b?.ending).toBeCloseTo(37.87, 2);
    expect(b?.asOfStart).toBe("2026-07-07");
    expect(b?.asOfEnd).toBe("2026-08-06");
  });

  it("parses a payment and a purchase from an ACCOUNT SUMMARY activity table snippet", () => {
    const text = [
      "Billing Period: 07/07/26-08/06/26",
      "New balance as of 08/06/26: $37.87",
      "ACCOUNT SUMMARY",
      "Sale",
      " Date",
      "Post",
      " Date",
      "DescriptionAmount",
      "Payments, Credits and Adjustments",
      "07/28AUTOPAY 220823101349931RAUTOPAY AUTO-PMT-$105.40",
      "NEHA GUPTA",
      "Standard Purchases",
      "07/2607/26UBER   *EATS           8005928996    CA $37.87",
      "Fees Charged",
      "TOTAL FEES FOR THIS PERIOD $0.00",
      "2026 totals year-to-date"
    ].join("\n");
    const { rows, statementBalances } = parseCitiCreditCardPdfFromText(text);
    expect(rows).toHaveLength(2);

    expect(rows[0]!.txn_date).toBe("2026-07-28");
    expect(rows[0]!.posting_date).toBe("2026-07-28");
    expect(rows[0]!.amount).toBeCloseTo(105.4, 2);
    expect(rows[0]!.description).toContain("AUTOPAY");

    expect(rows[1]!.txn_date).toBe("2026-07-26");
    expect(rows[1]!.posting_date).toBe("2026-07-26");
    expect(rows[1]!.amount).toBeCloseTo(-37.87, 2);
    expect(rows[1]!.description).toContain("UBER");

    expect(statementBalances?.ending).toBeCloseTo(37.87, 2);
  });

  it("attributes a December transaction to the prior year when the billing period spans a year boundary", () => {
    const text = [
      "Billing Period: 12/06/25-01/05/26",
      "New balance as of 01/05/26: $50.00",
      "ACCOUNT SUMMARY",
      "Sale Date Post Date DescriptionAmount",
      "Standard Purchases",
      "12/2812/28SOME MERCHANT TX $50.00",
      "2026 totals year-to-date"
    ].join("\n");
    const { rows } = parseCitiCreditCardPdfFromText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.txn_date).toBe("2025-12-28");
  });

  it("parses each real sample Citi credit card PDF when fixtures exist", async () => {
    const dir = path.join(repoRoot, "data/imports/creditcard/citibank");
    if (!fs.existsSync(dir)) {
      return;
    }
    const { extractPdfText } = await import("../src/modules/imports/profiles/pdf-text.js");
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const buf = fs.readFileSync(path.join(dir, file));
      const text = await extractPdfText(buf);
      const { rows, statementBalances } = parseCitiCreditCardPdfFromText(text);

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.txn_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row.posting_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isFinite(row.amount)).toBe(true);
      }

      expect(statementBalances).not.toBeNull();
      expect(statementBalances?.ending).not.toBeNull();
      expect(statementBalances?.asOfEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Our sign convention: payments/credits are positive (reduce what's owed), charges
      // are negative (increase what's owed) — so balance owed moves opposite the net sum.
      if (statementBalances?.beginning != null && statementBalances?.ending != null) {
        const net = rows.reduce((sum, r) => sum + r.amount, 0);
        expect(statementBalances.beginning - net).toBeCloseTo(statementBalances.ending, 2);
      }
    }
  });
});
