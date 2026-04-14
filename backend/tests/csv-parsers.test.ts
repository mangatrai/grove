/**
 * Unit tests for CR-076 CSV parsers: Discover card and Wealthfront investment.
 */

import { describe, expect, it } from "vitest";

import { parseBoaCreditCardCsv } from "../src/modules/imports/profiles/boa-credit-card-csv.js";
import { parseDiscoverCardCsv } from "../src/modules/imports/profiles/discover-card-csv.js";
import { parseWealthfrontInvestmentCsv } from "../src/modules/imports/profiles/wealthfront-investment-csv.js";

// ---------------------------------------------------------------------------
// Discover card CSV fixture
// ---------------------------------------------------------------------------
const DISCOVER_CSV = `Trans. Date,Post Date,Description,Amount,Category
04/15/2024,04/15/2024,"INDIA BAZAAR LEWISVILLE TX",1.29,"Supermarkets"
04/17/2024,04/17/2024,"PATEL BROTHERS FRISCO TX",35.67,"Supermarkets"
04/04/2026,04/04/2026,"DIRECTPAY FULL BALANCE SEE DETAILS",-80.05,"Payments and Credits"
`;

// ---------------------------------------------------------------------------
// Wealthfront CSV fixture
// ---------------------------------------------------------------------------
const WEALTHFRONT_CSV = `Transaction date,Description,Type,Amount
4/2/2026,Bank of America (Account ****3560),Deposit,200.00
3/27/2026,"BANK OF AMERICA, N.A. (Account ****3560)",Withdrawal,-10000.00
3/1/2026,March interest,Interest payment,446.86
`;

// ---------------------------------------------------------------------------
// Discover tests
// ---------------------------------------------------------------------------

describe("Discover card CSV parser", () => {
  const buf = Buffer.from(DISCOVER_CSV, "utf-8");

  it("parses all 3 rows", () => {
    expect(parseDiscoverCardCsv(buf)).toHaveLength(3);
  });

  it("negates positive charge amounts (debit convention)", () => {
    const rows = parseDiscoverCardCsv(buf);
    expect(rows[0]!.amount).toBe(-1.29);
    expect(rows[1]!.amount).toBe(-35.67);
  });

  it("negates negative payment amounts (payment becomes positive)", () => {
    const rows = parseDiscoverCardCsv(buf);
    // -80.05 in CSV → negated → +80.05 in canonical
    expect(rows[2]!.amount).toBe(80.05);
  });

  it("converts MM/DD/YYYY to ISO date", () => {
    const rows = parseDiscoverCardCsv(buf);
    expect(rows[0]!.txn_date).toBe("2024-04-15");
    expect(rows[2]!.txn_date).toBe("2026-04-04");
  });

  it("uses posting_date from Post Date column", () => {
    const rows = parseDiscoverCardCsv(buf);
    expect(rows[0]!.posting_date).toBe("2024-04-15");
  });

  it("maps description correctly", () => {
    const rows = parseDiscoverCardCsv(buf);
    expect(rows[0]!.description).toBe("INDIA BAZAAR LEWISVILLE TX");
    expect(rows[2]!.description).toBe("DIRECTPAY FULL BALANCE SEE DETAILS");
  });

  it("preserves Discover category in source_row", () => {
    const rows = parseDiscoverCardCsv(buf);
    expect(rows[0]!.source_row["Category"]).toBe("Supermarkets");
    expect(rows[2]!.source_row["Category"]).toBe("Payments and Credits");
  });
});

// ---------------------------------------------------------------------------
// Wealthfront tests
// ---------------------------------------------------------------------------

describe("Wealthfront investment CSV parser", () => {
  const buf = Buffer.from(WEALTHFRONT_CSV, "utf-8");

  it("parses all 3 rows", () => {
    expect(parseWealthfrontInvestmentCsv(buf)).toHaveLength(3);
  });

  it("preserves positive deposit amounts as-is", () => {
    const rows = parseWealthfrontInvestmentCsv(buf);
    expect(rows[0]!.amount).toBe(200.0);
  });

  it("preserves negative withdrawal amounts as-is", () => {
    const rows = parseWealthfrontInvestmentCsv(buf);
    expect(rows[1]!.amount).toBe(-10000.0);
  });

  it("converts M/D/YYYY to ISO date (single-digit month/day)", () => {
    const rows = parseWealthfrontInvestmentCsv(buf);
    expect(rows[0]!.txn_date).toBe("2026-04-02");
    expect(rows[2]!.txn_date).toBe("2026-03-01");
  });

  it("maps description correctly", () => {
    const rows = parseWealthfrontInvestmentCsv(buf);
    expect(rows[0]!.description).toBe("Bank of America (Account ****3560)");
    expect(rows[2]!.description).toBe("March interest");
  });

  it("uses txn_date as posting_date (Wealthfront has no separate post date)", () => {
    const rows = parseWealthfrontInvestmentCsv(buf);
    expect(rows[0]!.posting_date).toBe(rows[0]!.txn_date);
  });
});

// ---------------------------------------------------------------------------
// BoA credit card CSV tests
// ---------------------------------------------------------------------------

const BOA_CC_CSV = `Posted Date,Reference Number,Payee,Address,Amount
11/08/2025,31286000000379455331189,"CASH REWARDS STATEMENT CREDIT","",55.16
12/01/2025,00123000000512345678901,"AMAZON.COM*AB1CD2EF3","SEATTLE WA",-42.99
12/15/2025,00456000000987654321012,"WHOLE FOODS MARKET #123","FRISCO TX",-87.50
`;

describe("BoA credit card CSV parser", () => {
  const buf = Buffer.from(BOA_CC_CSV, "utf-8");

  it("parses all 3 rows", () => {
    expect(parseBoaCreditCardCsv(buf)).toHaveLength(3);
  });

  it("converts MM/DD/YYYY to ISO date", () => {
    const rows = parseBoaCreditCardCsv(buf);
    expect(rows[0]!.txn_date).toBe("2025-11-08");
    expect(rows[1]!.txn_date).toBe("2025-12-01");
    expect(rows[2]!.txn_date).toBe("2025-12-15");
  });

  it("uses payee as description", () => {
    const rows = parseBoaCreditCardCsv(buf);
    expect(rows[0]!.description).toBe("CASH REWARDS STATEMENT CREDIT");
    expect(rows[1]!.description).toBe("AMAZON.COM*AB1CD2EF3");
  });

  it("preserves reference number as reference_id", () => {
    const rows = parseBoaCreditCardCsv(buf);
    expect(rows[0]!.reference_id).toBe("31286000000379455331189");
  });

  it("preserves amount sign (positive = credit, negative = charge)", () => {
    const rows = parseBoaCreditCardCsv(buf);
    expect(rows[0]!.amount).toBe(55.16);  // cash rewards credit
    expect(rows[1]!.amount).toBe(-42.99); // purchase
  });
});
