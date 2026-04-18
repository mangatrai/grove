import { describe, expect, it } from "vitest";

import {
  mapCanonicalExtractToPersist,
  validateCanonicalForImport
} from "../src/modules/payslip/llm-extract/payslip-canonical-map.js";
import type { PayslipLlmExtract } from "../src/modules/payslip/llm-extract/payslip-llm.schema.js";

function minimalExtract(over: Partial<PayslipLlmExtract> = {}): PayslipLlmExtract {
  const base: PayslipLlmExtract = {
    document_type: "payslip",
    source_employer: {
      name: "Acme",
      legal_entity: null,
      ein_or_fein: "12-3456789",
      address: "1 Main St"
    },
    employee: {
      name: "Jane Doe",
      employee_id: "E1",
      personnel_number: null,
      talent_id: null,
      address: null
    },
    pay_period: {
      start_date: "2026-01-01",
      end_date: "2026-01-15",
      pay_date: "2026-01-15"
    },
    employment_context: {
      rate: null,
      rate_type: null,
      cost_center: null,
      hours_or_days_worked_current: null,
      hours_or_days_worked_ytd: null
    },
    summary: {
      currency: "USD",
      gross_pay_current: 5000,
      gross_pay_ytd: 10000,
      total_earnings_current: null,
      total_earnings_ytd: null,
      taxable_earnings_current: null,
      taxable_earnings_ytd: null,
      pre_tax_deductions_current: 100,
      pre_tax_deductions_ytd: 200,
      post_tax_deductions_current: 50,
      post_tax_deductions_ytd: 100,
      tax_deductions_current: 800,
      tax_deductions_ytd: 1600,
      other_deductions_current: null,
      other_deductions_ytd: null,
      other_information_current: null,
      other_information_ytd: null,
      net_pay_current: 4000,
      net_pay_ytd: 8000
    },
    line_items: {
      earnings: [],
      pre_tax_deductions: [],
      post_tax_deductions: [],
      tax_deductions: [],
      other_deductions: [],
      other_information: [],
      taxable_earnings: []
    },
    tax_profile: {
      marital_status: null,
      federal_credits: null,
      state_credits: null,
      additional_withholding_federal: null,
      additional_withholding_state: null
    },
    payment_information: [],
    document_metadata: {
      page_count: 1,
      parser_source: "test",
      extraction_model: "test-model",
      extracted_at: new Date().toISOString()
    }
  };
  return { ...base, ...over, document_metadata: base.document_metadata };
}

describe("payslip-canonical-map", () => {
  it("maps summary buckets and hybrid JSON strings (no line items → use summary)", () => {
    const ex = minimalExtract();
    const { summary, hybrid } = mapCanonicalExtractToPersist(ex, 1234);
    expect(summary.grossPayCurrent).toBe(5000);
    expect(summary.employeeTaxesCurrent).toBe(800);
    expect(summary.netPayCurrent).toBe(4000);
    // No line items → summary pre/post-tax values used as-is
    expect(summary.preTaxDeductionsCurrent).toBe(100);
    expect(summary.preTaxDeductionsYtd).toBe(200);
    expect(summary.postTaxDeductionsCurrent).toBe(50);
    expect(summary.postTaxDeductionsYtd).toBe(100);
    expect(summary.hoursOrDaysCurrent).toBe("80");
    expect(summary.rawExtractJson.hoursDefaultBiweekly80).toBe(true);
    expect(summary.rawExtractJson.preTaxFilledFromLineItems).toBeUndefined();
    expect(summary.rawExtractJson.postTaxFilledFromLineItems).toBeUndefined();
    expect(hybrid.employerEinOrFein).toBe("12-3456789");
    expect(hybrid.employeeId).toBe("E1");
    expect(JSON.parse(hybrid.taxProfileJson!)).toMatchObject({ marital_status: null });
    expect(hybrid.canonicalExtractJson).toContain("Acme");
  });

  it("uses explicit hours when model provides them (no biweekly default)", () => {
    const ex = minimalExtract({
      employment_context: {
        ...minimalExtract().employment_context,
        hours_or_days_worked_current: 86.67
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.hoursOrDaysCurrent).toBe("86.67");
    expect(summary.rawExtractJson.hoursDefaultBiweekly80).toBeUndefined();
  });

  it("fills employee taxes from line_items.tax_deductions when summary tax fields are null", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        tax_deductions_current: null,
        tax_deductions_ytd: null
      },
      line_items: {
        ...minimalExtract().line_items,
        tax_deductions: [
          {
            name: "Fed",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 1000,
            amount_ytd: 5000,
            raw_section: "TAX DEDUCTION(S)"
          },
          {
            name: "SS",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 175.44,
            amount_ytd: 441.41,
            raw_section: "TAX DEDUCTION(S)"
          }
        ]
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.employeeTaxesCurrent).toBeCloseTo(1175.44, 2);
    expect(summary.employeeTaxesYtd).toBeCloseTo(5441.41, 2);
    expect(summary.rawExtractJson.taxDeductionsFilledFromLineItems).toEqual({ current: true, ytd: true });
  });

  // ---- Pre-tax: line items preferred over summary ----

  it("prefers line item sum over summary for pre-tax when both exist (Deloitte bug: 401k-only header total)", () => {
    // Real bug: LLM extracts summary.pre_tax_deductions_ytd=7332.50 (only 401k from PDF header)
    // but line items correctly have 401k+FlexHealth+FlexDep. Mapper must prefer line item sum.
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        pre_tax_deductions_current: 2007.11,
        pre_tax_deductions_ytd: 7332.50   // wrong — only 401k YTD
      },
      line_items: {
        ...minimalExtract().line_items,
        pre_tax_deductions: [
          {
            name: "401(k) Contribution",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 1853.27,
            amount_ytd: 7332.50,
            raw_section: "PRE-TAX DEDUCTION(S)"
          },
          {
            name: "Flex Spending (Healt)",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 96.15,
            amount_ytd: 384.60,
            raw_section: "PRE-TAX DEDUCTION(S)"
          },
          {
            name: "Flex Spending (Dep C)",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 57.69,
            amount_ytd: 230.76,
            raw_section: "PRE-TAX DEDUCTION(S)"
          }
        ]
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    // Line item sums: current=2007.11, ytd=7332.50+384.60+230.76=7947.86
    expect(summary.preTaxDeductionsCurrent).toBeCloseTo(2007.11, 2);
    expect(summary.preTaxDeductionsYtd).toBeCloseTo(7947.86, 2);
    expect(summary.rawExtractJson.preTaxFilledFromLineItems).toEqual({ current: true, ytd: true });
  });

  it("fills pre-tax from line_items.pre_tax_deductions when summary pre-tax fields are null", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        pre_tax_deductions_current: null,
        pre_tax_deductions_ytd: null
      },
      line_items: {
        ...minimalExtract().line_items,
        pre_tax_deductions: [
          {
            name: "401k",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 1853.27,
            amount_ytd: 5479.23,
            raw_section: "PRE-TAX DEDUCTION(S)"
          },
          {
            name: "Flex Spending (Health)",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 96.15,
            amount_ytd: 288.45,
            raw_section: "PRE-TAX DEDUCTION(S)"
          },
          {
            name: "Flex Spending (Dep Care)",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 57.69,
            amount_ytd: 173.07,
            raw_section: "PRE-TAX DEDUCTION(S)"
          }
        ]
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.preTaxDeductionsCurrent).toBeCloseTo(2007.11, 2);
    expect(summary.preTaxDeductionsYtd).toBeCloseTo(5940.75, 2);
    expect(summary.rawExtractJson.preTaxFilledFromLineItems).toEqual({ current: true, ytd: true });
  });

  it("falls back to summary for pre-tax when line items are empty", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        pre_tax_deductions_current: 300,
        pre_tax_deductions_ytd: 1200
      }
      // line_items.pre_tax_deductions defaults to []
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.preTaxDeductionsCurrent).toBe(300);
    expect(summary.preTaxDeductionsYtd).toBe(1200);
    expect(summary.rawExtractJson.preTaxFilledFromLineItems).toBeUndefined();
  });

  // ---- Post-tax: line items + other_deductions always combined ----

  it("combines post_tax_deductions + other_deductions line items into post-tax total", () => {
    // Realistic Deloitte scenario: After-Tax Ded in post_tax_deductions; Tax Advance / Award Received /
    // Imp Inc Core Life / Imp Inc Core LTD in other_deductions. All are semantically post-tax.
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        post_tax_deductions_current: 17.13,  // only After-Tax Ded (incomplete — missing other_deductions)
        post_tax_deductions_ytd: null
      },
      line_items: {
        ...minimalExtract().line_items,
        post_tax_deductions: [
          {
            name: "After-Tax Ded",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 17.13,
            amount_ytd: null,
            raw_section: null
          }
        ],
        other_deductions: [
          {
            name: "Tax Advance",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: null,
            amount_ytd: 152.68,
            raw_section: "OTHER DEDUCTION(S)"
          },
          {
            name: "Award Received",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: null,
            amount_ytd: 250.00,
            raw_section: "OTHER DEDUCTION(S)"
          },
          {
            name: "Imp Inc Core Life",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: "2026-02-21", raw: "02/21" },
            hours_or_days: { current: 6.65, ytd: null },
            rate: null,
            amount_current: 26.60,
            amount_ytd: null,
            raw_section: "OTHER DEDUCTION(S)"
          },
          {
            name: "Imp Inc Core LTD",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: "2026-02-21", raw: "02/21" },
            hours_or_days: { current: 10.48, ytd: null },
            rate: null,
            amount_current: 41.92,
            amount_ytd: null,
            raw_section: "OTHER DEDUCTION(S)"
          }
        ]
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    // current: 17.13 + 26.60 + 41.92 = 85.65
    expect(summary.postTaxDeductionsCurrent).toBeCloseTo(85.65, 2);
    // ytd: 152.68 + 250.00 = 402.68
    expect(summary.postTaxDeductionsYtd).toBeCloseTo(402.68, 2);
    expect(summary.rawExtractJson.postTaxFilledFromLineItems).toEqual({ current: true, ytd: true });
    expect(summary.rawExtractJson.otherDeductionsFoldedIntoPostTax).toBe(true);
  });

  it("fills post-tax from line_items.post_tax_deductions when post_tax summary is null", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        post_tax_deductions_current: null,
        post_tax_deductions_ytd: null
      },
      line_items: {
        ...minimalExtract().line_items,
        post_tax_deductions: [
          {
            name: "Row A",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 10,
            amount_ytd: 20,
            raw_section: "POST-TAX DEDUCTION(S)"
          },
          {
            name: "Row B",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 32,
            amount_ytd: 79,
            raw_section: "POST-TAX DEDUCTION(S)"
          }
        ]
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.postTaxDeductionsCurrent).toBe(42);
    expect(summary.postTaxDeductionsYtd).toBe(99);
    expect(summary.rawExtractJson.postTaxFilledFromLineItems).toEqual({ current: true, ytd: true });
  });

  it("fills post-tax from line_items.post_tax_deductions only (Deloitte OTHER DEDUCTION rows modeled as post-tax lines)", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        post_tax_deductions_current: null,
        post_tax_deductions_ytd: null,
        other_deductions_current: null,
        other_deductions_ytd: null
      },
      line_items: {
        ...minimalExtract().line_items,
        post_tax_deductions: [
          {
            name: "Award Received",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 250,
            amount_ytd: 250,
            raw_section: "OTHER DEDUCTION(S)"
          },
          {
            name: "Imp Inc Core Life",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 6.65,
            amount_ytd: 19.95,
            raw_section: "OTHER DEDUCTION(S)"
          },
          {
            name: "Imp Inc Core LTD",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 10.48,
            amount_ytd: 31.44,
            raw_section: "OTHER DEDUCTION(S)"
          }
        ]
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.postTaxDeductionsCurrent).toBeCloseTo(267.13, 2);
    expect(summary.postTaxDeductionsYtd).toBeCloseTo(301.39, 2);
    expect(summary.rawExtractJson.postTaxFilledFromLineItems).toEqual({
      current: true,
      ytd: true
    });
  });

  it("uses other_deductions rows as post-tax even when raw_section is null", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        post_tax_deductions_current: null,
        post_tax_deductions_ytd: null,
        other_deductions_current: null,
        other_deductions_ytd: null
      },
      line_items: {
        ...minimalExtract().line_items,
        other_deductions: [
          {
            name: "Other deduction — parking",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: 25,
            amount_ytd: 100,
            raw_section: null
          }
        ]
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.postTaxDeductionsCurrent).toBe(25);
    expect(summary.postTaxDeductionsYtd).toBe(100);
    expect(summary.rawExtractJson.postTaxFilledFromLineItems).toEqual({ current: true, ytd: true });
    expect(summary.rawExtractJson.otherDeductionsFoldedIntoPostTax).toBe(true);
  });

  it("falls back to summary for post-tax when all line items are empty", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        post_tax_deductions_current: 77,
        post_tax_deductions_ytd: 308
      }
      // all line_items empty
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.postTaxDeductionsCurrent).toBe(77);
    expect(summary.postTaxDeductionsYtd).toBe(308);
    expect(summary.rawExtractJson.postTaxFilledFromLineItems).toBeUndefined();
  });

  // ---- IBM pay date fallback ----

  it("falls back to payment_information pay_date when pay_period.pay_date is null (IBM layout)", () => {
    // IBM does not print a standalone pay date on the stub — it appears only in Payment Information.
    const ex = minimalExtract({
      pay_period: {
        start_date: "2026-02-16",
        end_date: "2026-02-28",
        pay_date: null
      },
      payment_information: [
        {
          payment_type: null,
          bank_name: null,
          bank_location: null,
          account_or_check_number_masked: "*****3560",
          amount: 4350.17,
          currency: "USD",
          pay_date: "2026-02-27"
        }
      ]
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.payDate).toBe("2026-02-27");
  });

  it("uses pay_period.pay_date when present, ignoring payment_information", () => {
    const ex = minimalExtract({
      pay_period: {
        start_date: "2026-02-08",
        end_date: "2026-02-21",
        pay_date: "2026-02-20"
      },
      payment_information: [
        {
          payment_type: "Direct Deposit",
          bank_name: null,
          bank_location: null,
          account_or_check_number_masked: "XXXX6335",
          amount: 4370.19,
          currency: "USD",
          pay_date: "2026-02-19"  // different — should be ignored
        }
      ]
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.payDate).toBe("2026-02-20");
  });

  it("payDate is null when both pay_period.pay_date and payment_information are empty", () => {
    const ex = minimalExtract({
      pay_period: { start_date: "2026-01-01", end_date: "2026-01-15", pay_date: null },
      payment_information: []
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.payDate).toBeNull();
  });

  // ---- Hours and rate fields ----

  it("maps hoursOrDaysYtd from employment_context.hours_or_days_worked_ytd", () => {
    const ex = minimalExtract({
      employment_context: {
        ...minimalExtract().employment_context,
        hours_or_days_worked_current: 80,
        hours_or_days_worked_ytd: 480
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.hoursOrDaysYtd).toBe("480");
    expect(summary.hoursOrDaysCurrent).toBe("80");
  });

  it("hoursOrDaysYtd is null when employment_context.hours_or_days_worked_ytd is null", () => {
    const ex = minimalExtract();
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.hoursOrDaysYtd).toBeNull();
  });

  it("maps taxableEarningsCurrent and taxableEarningsYtd from summary", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        taxable_earnings_current: 4500,
        taxable_earnings_ytd: 9000
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.taxableEarningsCurrent).toBe(4500);
    expect(summary.taxableEarningsYtd).toBe(9000);
  });

  it("taxableEarningsCurrent and taxableEarningsYtd are null when absent in summary", () => {
    const ex = minimalExtract();
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.taxableEarningsCurrent).toBeNull();
    expect(summary.taxableEarningsYtd).toBeNull();
  });

  it("maps otherInformationCurrent and otherInformationYtd from summary", () => {
    const ex = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        other_information_current: 250,
        other_information_ytd: 1000
      }
    });
    const { summary } = mapCanonicalExtractToPersist(ex);
    expect(summary.otherInformationCurrent).toBe(250);
    expect(summary.otherInformationYtd).toBe(1000);
  });

  it("maps employmentRate and employmentRateType from employment_context into hybrid", () => {
    const ex = minimalExtract({
      employment_context: {
        ...minimalExtract().employment_context,
        rate: 180000,
        rate_type: "annual"
      }
    });
    const { hybrid } = mapCanonicalExtractToPersist(ex);
    expect(hybrid.employmentRate).toBe(180000);
    expect(hybrid.employmentRateType).toBe("annual");
  });

  it("employmentRate and employmentRateType are null when employment_context has no rate", () => {
    const ex = minimalExtract();
    const { hybrid } = mapCanonicalExtractToPersist(ex);
    expect(hybrid.employmentRate).toBeNull();
    expect(hybrid.employmentRateType).toBeNull();
  });

  // ---- flattenLineItems ----

  it("flattenLineItems returns one row per item with correct section and sort_order", () => {
    const earningsRow = {
      name: "Regular Salary",
      authority: null,
      description: null,
      dates: { start_date: "2026-02-16", end_date: "2026-02-28", raw: "02/16-02/28" },
      hours_or_days: { current: 80, ytd: 336 },
      rate: 9588.75,
      amount_current: 9588.75,
      amount_ytd: 38355,
      raw_section: "EARNINGS"
    };
    const taxRow = {
      name: "Federal Withholding",
      authority: null,
      description: null,
      dates: { start_date: null, end_date: null, raw: null },
      hours_or_days: { current: null, ytd: null },
      rate: null,
      amount_current: 2488.96,
      amount_ytd: 11708.63,
      raw_section: "TAX DEDUCTION(S)"
    };
    const preTaxRow1 = {
      name: "401k PreTax Base Pay",
      authority: null,
      description: null,
      dates: { start_date: null, end_date: null, raw: null },
      hours_or_days: { current: null, ytd: null },
      rate: null,
      amount_current: 479.44,
      amount_ytd: 2684.85,
      raw_section: "PRE-TAX DEDUCTION(S)"
    };
    const preTaxRow2 = {
      name: "Employee HSA",
      authority: null,
      description: null,
      dates: { start_date: null, end_date: null, raw: null },
      hours_or_days: { current: null, ytd: null },
      rate: null,
      amount_current: 297.92,
      amount_ytd: 1191.68,
      raw_section: "PRE-TAX DEDUCTION(S)"
    };
    const ex = minimalExtract({
      line_items: {
        ...minimalExtract().line_items,
        earnings: [earningsRow],
        tax_deductions: [taxRow],
        pre_tax_deductions: [preTaxRow1, preTaxRow2]
      }
    });
    const { lineItems } = mapCanonicalExtractToPersist(ex);
    // 1 earning + 2 pre-tax + 1 tax = 4 total (other sections empty)
    expect(lineItems.length).toBe(4);

    const earningItem = lineItems.find((l) => l.section === "earnings");
    expect(earningItem).toBeDefined();
    expect(earningItem!.sortOrder).toBe(0);
    expect(earningItem!.name).toBe("Regular Salary");
    expect(earningItem!.amountCurrent).toBe(9588.75);
    expect(earningItem!.hoursOrDaysCurrent).toBe(80);
    expect(earningItem!.rawSection).toBe("EARNINGS");

    const preTaxItems = lineItems.filter((l) => l.section === "pre_tax_deductions");
    expect(preTaxItems.length).toBe(2);
    expect(preTaxItems[0].sortOrder).toBe(0);
    expect(preTaxItems[0].name).toBe("401k PreTax Base Pay");
    expect(preTaxItems[1].sortOrder).toBe(1);
    expect(preTaxItems[1].name).toBe("Employee HSA");

    const taxItem = lineItems.find((l) => l.section === "tax_deductions");
    expect(taxItem!.name).toBe("Federal Withholding");
    expect(taxItem!.amountYtd).toBe(11708.63);
  });

  it("flattenLineItems stores other_deductions with section=other_deductions (merged in UI, not DB)", () => {
    const ex = minimalExtract({
      line_items: {
        ...minimalExtract().line_items,
        other_deductions: [
          {
            name: "Tax Advance",
            authority: null,
            description: null,
            dates: { start_date: null, end_date: null, raw: null },
            hours_or_days: { current: null, ytd: null },
            rate: null,
            amount_current: null,
            amount_ytd: 152.68,
            raw_section: "OTHER DEDUCTION(S)"
          }
        ]
      }
    });
    const { lineItems } = mapCanonicalExtractToPersist(ex);
    const otherItem = lineItems.find((l) => l.section === "other_deductions");
    expect(otherItem).toBeDefined();
    expect(otherItem!.name).toBe("Tax Advance");
  });

  it("flattenLineItems returns empty array when all sections are empty", () => {
    const ex = minimalExtract();
    const { lineItems } = mapCanonicalExtractToPersist(ex);
    expect(lineItems).toEqual([]);
  });

  // ---- Validation ----

  it("validateCanonicalForImport passes for minimal good extract", () => {
    expect(validateCanonicalForImport(minimalExtract())).toEqual({ ok: true });
  });

  it("validateCanonicalForImport fails when totals and dates missing", () => {
    const bad = minimalExtract({
      summary: {
        ...minimalExtract().summary,
        gross_pay_current: null,
        net_pay_current: null
      },
      pay_period: { start_date: null, end_date: null, pay_date: null }
    });
    const v = validateCanonicalForImport(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasons.length).toBeGreaterThan(0);
    }
  });
});
