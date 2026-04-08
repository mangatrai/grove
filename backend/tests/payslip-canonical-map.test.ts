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
  it("maps summary buckets and hybrid JSON strings", () => {
    const ex = minimalExtract();
    const { summary, hybrid } = mapCanonicalExtractToPersist(ex, 1234);
    expect(summary.grossPayCurrent).toBe(5000);
    expect(summary.employeeTaxesCurrent).toBe(800);
    expect(summary.netPayCurrent).toBe(4000);
    expect(hybrid.employerEinOrFein).toBe("12-3456789");
    expect(hybrid.employeeId).toBe("E1");
    expect(JSON.parse(hybrid.taxProfileJson!)).toMatchObject({ marital_status: null });
    expect(hybrid.canonicalExtractJson).toContain("Acme");
  });

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
