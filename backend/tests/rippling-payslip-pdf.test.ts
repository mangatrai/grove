import { describe, expect, it } from "vitest";

import { parseRipplingPayslipText } from "../src/modules/payslip/profiles/rippling-payslip-pdf.js";
import { BASE_DEPOSITS, BASE_SUMMARY, BASE_TAXES, ripplingPayslipText as fixture } from "./fixtures/rippling-payslip-text.js";

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

describe("parseRipplingPayslipText — plain parsing keeps the data", () => {
  const DEDUCTION_SUMMARY = ["Gross Pay$5,000.00$10,000.00", "Deductions$300.00$600.00", "Taxes$1,282.50$2,565.00", "Net Pay$3,417.50$6,835.00"];

  it("maps unknown deduction sections to the closest line-item section", () => {
    const r = parseRipplingPayslipText(
      fixture({
        extraBody: [
          "PRE-TAX DEDUCTIONSCURRENT PERIODYTD AMOUNT",
          "401(k)$250.00$500.00",
          "POST-TAX DEDUCTIONSCURRENT PERIODYTD AMOUNT",
          "Roth 401(k)$50.00$100.00",
          "EMPLOYER BENEFITSCURRENT PERIODYTD AMOUNT",
          "Employer HSA$25.00$50.00"
        ],
        summary: DEDUCTION_SUMMARY,
        headerNet: "$3,417.50",
        deposits: ["Acct# ...111 Trace:", "000000000000001", "$3,417.50"]
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({
      preTaxDeductionsCurrent: 250,
      preTaxDeductionsYtd: 500,
      postTaxDeductionsCurrent: 50,
      postTaxDeductionsYtd: 100,
      otherInformationCurrent: 25,
      netPayCurrent: 3417.5
    });
    const extra = r.lineItems.filter((l) => !["earnings", "tax_deductions"].includes(l.section));
    expect(extra.map((l) => [l.section, l.name, l.amountCurrent, l.rawSection])).toEqual([
      ["pre_tax_deductions", "401(k)", 250, "PRE-TAX DEDUCTIONS"],
      ["post_tax_deductions", "Roth 401(k)", 50, "POST-TAX DEDUCTIONS"],
      ["other_information", "Employer HSA", 25, "EMPLOYER BENEFITS"]
    ]);
    expect(r.summary.rawExtractJson.extraSections).toEqual([
      "PRE-TAX DEDUCTIONS → pre_tax_deductions",
      "POST-TAX DEDUCTIONS → post_tax_deductions",
      "EMPLOYER BENEFITS → other_information"
    ]);
  });

  it("non-zero Deductions with no rows: buckets stay null, the total is kept in rawExtractJson", () => {
    const r = parseRipplingPayslipText(fixture({ summary: DEDUCTION_SUMMARY, headerNet: "$3,417.50" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.preTaxDeductionsCurrent).toBeNull();
    expect(r.summary.postTaxDeductionsCurrent).toBeNull();
    expect(r.summary.rawExtractJson).toMatchObject({ deductionsCurrent: 300, deductionsYtd: 600 });
  });

  it("persists totals that do not tie out, as printed", () => {
    const r = parseRipplingPayslipText(
      fixture({
        earnings: ["Salary - 40 $4,999.99 80 $9,999.99"],
        taxes: BASE_TAXES.slice(0, 2),
        deposits: ["Acct# ...111 Trace:", "000000000000001", "$3,000.00"]
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({ grossPayCurrent: 5000, employeeTaxesCurrent: 1282.5, netPayCurrent: 3717.5 });
    expect(r.lineItems.find((l) => l.section === "earnings")?.amountCurrent).toBe(4999.99);
    expect(r.lineItems.filter((l) => l.section === "tax_deductions")).toHaveLength(2);
    expect(JSON.parse(r.hybrid.paymentSummaryJson!)).toHaveLength(1);
  });

  it("records lines it cannot read and keeps parsing", () => {
    const r = parseRipplingPayslipText(
      fixture({
        earnings: ["Salary - 40 $5,000.00 80 $10,000.00", "Salary $5,000.00"],
        taxes: [...BASE_TAXES, "State Tax 12.00"],
        summary: [...BASE_SUMMARY, "Employer Contributions$10.00$10.00"],
        deposits: [...BASE_DEPOSITS, "Acct# ...333 Trace:", "000000000000003"]
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.rawExtractJson.unrecognizedLines).toEqual([
      "EARNINGS: Salary $5,000.00",
      "EMPLOYEE TAXES: State Tax 12.00",
      "SUMMARY: Employer Contributions$10.00$10.00",
      "DEPOSIT: Acct# ...333 Trace: (no amount)"
    ]);
    expect(r.lineItems.filter((l) => l.section === "tax_deductions")).toHaveLength(3);
    expect(JSON.parse(r.hybrid.paymentSummaryJson!)).toHaveLength(2);
  });

  it("falls back to the header block when SUMMARY rows are missing", () => {
    const r = parseRipplingPayslipText(fixture({ summary: [] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({ grossPayCurrent: 5000, netPayCurrent: 3717.5, grossPayYtd: null, netPayYtd: null });
    expect(r.summary.employeeTaxesCurrent).toBe(1282.5);
  });

  it("uses the period end when PAY DATE is unreadable", () => {
    const r = parseRipplingPayslipText(fixture({ payDate: "13/45/2026" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary.payDate).toBe("2026-06-15");
  });
});

describe("parseRipplingPayslipText — not a readable Rippling stub", () => {
  it("no header block", () => {
    expectFailure(fixture().replace("EARNINGS STATEMENT", "STATEMENT"), "rippling_header_missing");
  });

  it("no pay date and no pay period", () => {
    expectFailure(fixture({ payDate: "soon", payPeriod: "June" }), "rippling_no_pay_date");
  });

  it("no gross or net anywhere", () => {
    expectFailure(fixture({ summary: [], headerGross: "n/a", headerNet: "n/a" }), "rippling_no_totals");
  });
});
