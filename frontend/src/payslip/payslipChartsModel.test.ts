import { describe, expect, it } from "vitest";

import { aggregatePayrollByCalendarMonth, toPaycheckSeries } from "./payslipChartsModel";
import type { PayslipSnapshotDetail } from "./types";

const base = (): PayslipSnapshotDetail => ({
  id: "x",
  householdId: "h",
  fileName: "f.pdf",
  fileChecksum: "c",
  parserProfileId: "ibm_pay_contributions_pdf",
  employerId: null,
  ownerScope: "household",
  ownerPersonProfileId: null,
  importFileId: null,
  payPeriodStart: null,
  payPeriodEnd: null,
  payDate: null,
  grossPayCurrent: 1000,
  grossPayYtd: null,
  employeeTaxesCurrent: 200,
  employeeTaxesYtd: null,
  preTaxDeductionsCurrent: 0,
  preTaxDeductionsYtd: null,
  postTaxDeductionsCurrent: 0,
  postTaxDeductionsYtd: null,
  netPayCurrent: 800,
  netPayYtd: null,
  hoursOrDaysCurrent: null,
  hoursOrDaysYtd: null,
  taxableEarningsCurrent: null,
  taxableEarningsYtd: null,
  otherInformationCurrent: null,
  otherInformationYtd: null,
  employmentRate: null,
  employmentRateType: null,
  rawExtractJson: {},
  createdAt: "2026-01-15T12:00:00.000Z",
  confirmedDeposits: [],
  suggestedDeposits: [],
  effectiveFederalRateYtd: null,
  effectiveTotalTaxRateYtd: null,
});

describe("payslipChartsModel", () => {
  it("aggregates multiple stubs in the same calendar month", () => {
    const a = {
      ...base(),
      id: "a",
      payDate: "2026-03-10T12:00:00.000Z",
      grossPayCurrent: 3000,
      netPayCurrent: 2000,
      employeeTaxesCurrent: 500
    };
    const b = {
      ...base(),
      id: "b",
      payDate: "2026-03-24T12:00:00.000Z",
      grossPayCurrent: 3000,
      netPayCurrent: 2100,
      employeeTaxesCurrent: 500
    };
    const rows = aggregatePayrollByCalendarMonth([a, b]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gross).toBe(6000);
    expect(rows[0]?.net).toBe(4100);
    expect(rows[0]?.taxes).toBe(1000);
    expect(rows[0]?.stubCount).toBe(2);
  });

  it("orders paycheck series chronologically", () => {
    const early = { ...base(), id: "e", payDate: "2026-01-15T12:00:00.000Z" };
    const late = { ...base(), id: "l", payDate: "2026-02-15T12:00:00.000Z" };
    const s = toPaycheckSeries([late, early]);
    expect(s).toHaveLength(2);
    expect(s[0]!.sortTime).toBeLessThan(s[1]!.sortTime);
  });

  it("combines stubs on the same calendar day into one point", () => {
    const a = { ...base(), id: "a", payDate: "2026-03-10T12:00:00.000Z", grossPayCurrent: 1000 };
    const b = { ...base(), id: "b", payDate: "2026-03-10T18:00:00.000Z", grossPayCurrent: 500 };
    const s = toPaycheckSeries([b, a]);
    expect(s).toHaveLength(1);
    expect(s[0]?.gross).toBe(1500);
    expect(s[0]?.stubCount).toBe(2);
  });
});
