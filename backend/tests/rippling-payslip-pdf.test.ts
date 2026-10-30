import { describe, expect, it } from "vitest";

import { parseRipplingPayslipText } from "../src/modules/payslip/profiles/rippling-payslip-pdf.js";
import { BASE_SUMMARY, BASE_TAXES, ripplingPayslipText as fixture } from "./fixtures/rippling-payslip-text.js";

function expectFailure(text: string, reason: string) {
  const r = parseRipplingPayslipText(text);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe(reason);
    expect(r.detail.startsWith(`${reason}: `)).toBe(true);
  }
  return r;
}

describe("parseRipplingPayslipText — valid stubs", () => {
  it("basic: one earning, three taxes, no deductions, two deposits", () => {
    const r = parseRipplingPayslipText(fixture());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({
      payPeriodStart: "2026-06-01",
      payPeriodEnd: "2026-06-15",
      payDate: "2026-06-15",
      hoursOrDaysCurrent: "40",
      hoursOrDaysYtd: "80",
      grossPayCurrent: 5000,
      grossPayYtd: 10000,
      employeeTaxesCurrent: 1282.5,
      employeeTaxesYtd: 2565,
      preTaxDeductionsCurrent: 0,
      postTaxDeductionsCurrent: 0,
      netPayCurrent: 3717.5,
      netPayYtd: 7435
    });
    expect(r.summary.rawExtractJson).toMatchObject({ parser: "rippling_pdf_text", paystubId: "abc123def456", depositCount: 2 });
    expect(r.hybrid.employerDisplayName).toBe("Acme Corp");
    expect(r.hybrid.employeeDisplayName).toBe("Jane Doe");
    expect(JSON.parse(r.hybrid.canonicalExtractJson)).toEqual({ version: 1, source: "rippling_pdf_text" });

    const deposits = JSON.parse(r.hybrid.paymentSummaryJson!);
    expect(deposits).toEqual([
      {
        payment_type: "direct_deposit",
        bank_name: null,
        bank_location: null,
        account_or_check_number_masked: "...111",
        amount: 3217.5,
        currency: "USD",
        pay_date: "2026-06-15",
        trace: "000000000000001"
      },
      {
        payment_type: "direct_deposit",
        bank_name: null,
        bank_location: null,
        account_or_check_number_masked: "...222",
        amount: 500,
        currency: "USD",
        pay_date: "2026-06-15",
        trace: "000000000000002"
      }
    ]);

    expect(r.lineItems.map((l) => [l.section, l.sortOrder, l.name, l.amountCurrent, l.amountYtd])).toEqual([
      ["earnings", 0, "Salary", 5000, 10000],
      ["tax_deductions", 0, "Social Security Tax - Employee", 310, 620],
      ["tax_deductions", 1, "Federal Income Tax", 900, 1800],
      ["tax_deductions", 2, "Medicare Tax - Employee", 72.5, 145]
    ]);
    expect(r.lineItems[0]).toMatchObject({ rate: null, hoursOrDaysCurrent: 40, hoursOrDaysYtd: 80, rawSection: "EARNINGS" });
  });

  it("never carries SSN fragments or addresses into the result", () => {
    const r = parseRipplingPayslipText(fixture());
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("SSN");
    expect(serialized).not.toContain("...0000");
    expect(serialized).not.toContain("Test Street");
    expect(serialized).not.toContain("Example Way");
  });

  it("single deposit", () => {
    const r = parseRipplingPayslipText(fixture({ deposits: ["Acct# ...111 Trace:", "000000000000001", "$3,717.50"] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.hybrid.paymentSummaryJson!)).toHaveLength(1);
  });

  it("three deposits", () => {
    const r = parseRipplingPayslipText(
      fixture({
        deposits: [
          "Acct# ...111 Trace:",
          "000000000000001",
          "$2,717.50",
          "Acct# ...222 Trace:",
          "000000000000002",
          "$500.00",
          "Acct# ...333 Trace:",
          "000000000000003",
          "$500.00"
        ]
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = JSON.parse(r.hybrid.paymentSummaryJson!) as Array<{ account_or_check_number_masked: string; amount: number }>;
      expect(d.map((x) => [x.account_or_check_number_masked, x.amount])).toEqual([
        ["...111", 2717.5],
        ["...222", 500],
        ["...333", 500]
      ]);
    }
  });

  it("accepts a trace on the Acct# line, or no trace at all", () => {
    const r = parseRipplingPayslipText(
      fixture({ deposits: ["Acct# ...111 Trace: 000000000000001", "$3,217.50", "Acct# ...222 Trace:", "$500.00"] })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = JSON.parse(r.hybrid.paymentSummaryJson!) as Array<{ trace: string | null }>;
      expect(d.map((x) => x.trace)).toEqual(["000000000000001", null]);
    }
  });

  it("multiple earnings rows, including a YTD-only row and an hourly rate", () => {
    const r = parseRipplingPayslipText(
      fixture({
        earnings: ["Salary - 40 $4,000.00 80 $8,000.00", "Overtime $50.00 20 $1,000.00 20 $1,000.00", "Sign-on Bonus - - - - $1,000.00"],
        summary: ["Gross Pay$5,000.00$10,000.00", "Deductions$0.00$0.00", "Taxes$1,282.50$2,565.00", "Net Pay$3,717.50$7,435.00"]
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.hoursOrDaysCurrent).toBe("60");
    const earnings = r.lineItems.filter((l) => l.section === "earnings");
    expect(earnings.map((e) => [e.name, e.rate, e.amountCurrent, e.amountYtd])).toEqual([
      ["Salary", null, 4000, 8000],
      ["Overtime", 50, 1000, 1000],
      ["Sign-on Bonus", null, null, 1000]
    ]);
  });
});

describe("parseRipplingPayslipText — fail closed", () => {
  it("unknown section heading (e.g. first stub with deductions)", () => {
    const r = expectFailure(
      fixture({ extraBody: ["PRE-TAX DEDUCTIONSCURRENT PERIODYTD AMOUNT", "401(k)$250.00$250.00"] }),
      "rippling_unrecognized_section"
    );
    if (!r.ok) expect(r.detail).toContain("PRE-TAX DEDUCTIONS");
  });

  it("unexpected line shape inside a known section", () => {
    expectFailure(fixture({ taxes: [...BASE_TAXES, "State Tax 12.00"] }), "rippling_unrecognized_line");
    expectFailure(fixture({ earnings: ["Salary $5,000.00"] }), "rippling_unrecognized_line");
    expectFailure(
      fixture({ summary: [...BASE_SUMMARY, "Employer Contributions$10.00$10.00"] }),
      "rippling_unrecognized_line"
    );
  });

  it("Σ earnings ≠ Gross Pay", () => {
    expectFailure(fixture({ earnings: ["Salary - 40 $4,999.99 80 $9,999.99"] }), "rippling_earnings_mismatch");
  });

  it("Σ tax rows ≠ Taxes", () => {
    expectFailure(fixture({ taxes: BASE_TAXES.slice(0, 2) }), "rippling_taxes_mismatch");
  });

  it("Gross − Taxes − Deductions ≠ Net Pay (current and YTD)", () => {
    expectFailure(
      fixture({
        summary: ["Gross Pay$5,000.00$10,000.00", "Deductions$0.00$0.00", "Taxes$1,282.50$2,565.00", "Net Pay$3,717.51$7,435.00"],
        headerNet: "$3,717.51",
        deposits: ["Acct# ...111 Trace:", "000000000000001", "$3,717.51"]
      }),
      "rippling_net_mismatch"
    );
    expectFailure(
      fixture({
        summary: ["Gross Pay$5,000.00$10,000.00", "Deductions$0.00$0.00", "Taxes$1,282.50$2,565.00", "Net Pay$3,717.50$7,400.00"]
      }),
      "rippling_net_mismatch"
    );
  });

  it("non-zero Deductions with no deduction rows", () => {
    expectFailure(
      fixture({
        summary: ["Gross Pay$5,000.00$10,000.00", "Deductions$100.00$100.00", "Taxes$1,282.50$2,565.00", "Net Pay$3,617.50$7,335.00"],
        headerNet: "$3,617.50",
        deposits: ["Acct# ...111 Trace:", "000000000000001", "$3,617.50"]
      }),
      "rippling_deductions_without_detail"
    );
  });

  it("Σ deposits ≠ Net Pay, including no deposits", () => {
    expectFailure(fixture({ deposits: ["Acct# ...111 Trace:", "000000000000001", "$3,217.50"] }), "rippling_deposits_mismatch");
    expectFailure(fixture({ deposits: [] }), "rippling_deposits_mismatch");
  });

  it("header GROSS/NET disagree with SUMMARY", () => {
    expectFailure(fixture({ headerGross: "$5,000.01" }), "rippling_header_totals_mismatch");
  });

  it("deposit block without an amount", () => {
    expectFailure(fixture({ deposits: ["Acct# ...111 Trace:", "000000000000001"] }), "rippling_deposit_malformed");
  });

  it("missing or unparseable pay period / pay date", () => {
    expectFailure(fixture({ payPeriod: "June 1 - June 15" }), "rippling_pay_period_unparseable");
    expectFailure(fixture({ payDate: "2026-06-15" }), "rippling_pay_date_unparseable");
    expectFailure(fixture({ payDate: "13/45/2026" }), "rippling_pay_date_unparseable");
  });

  it("missing header block or summary rows", () => {
    expectFailure(fixture().replace("EARNINGS STATEMENT", "STATEMENT"), "rippling_header_missing");
    expectFailure(fixture({ summary: BASE_SUMMARY.slice(0, 3) }), "rippling_summary_incomplete");
  });

  it("no earnings rows", () => {
    expectFailure(
      fixture({
        earnings: [],
        taxes: [],
        summary: ["Gross Pay$0.00$0.00", "Deductions$0.00$0.00", "Taxes$0.00$0.00", "Net Pay$0.00$0.00"],
        headerGross: "$0.00",
        headerNet: "$0.00",
        deposits: []
      }),
      "rippling_no_earnings"
    );
  });
});
