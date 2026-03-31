import { describe, expect, it } from "vitest";

import {
  filenameSuggestsIbmPayslipPdf,
  IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID,
  inferParserProfile
} from "./inferParserProfile";

const boaChecking = { type: "checking", institution: "Bank of America" };
const boaSalaryChecking = {
  id: "acc-salary",
  type: "checking",
  institution: "Bank of America"
};
const payslipPlaceholder = { type: "payslip", institution: "Employer payslip (IBM) — placeholder" };

describe("filenameSuggestsIbmPayslipPdf", () => {
  it("matches common payslip filename tokens", () => {
    expect(filenameSuggestsIbmPayslipPdf("Jan_payslip.pdf")).toBe(true);
    expect(filenameSuggestsIbmPayslipPdf("my-pay-stub.pdf")).toBe(true);
    expect(filenameSuggestsIbmPayslipPdf("Paycheck_2026.pdf")).toBe(true);
    expect(filenameSuggestsIbmPayslipPdf("Feb_SuccessFactors_export.pdf")).toBe(true);
    expect(filenameSuggestsIbmPayslipPdf("Pay and Contributions.pdf")).toBe(true);
    expect(filenameSuggestsIbmPayslipPdf("regular_pay.pdf")).toBe(true);
    expect(filenameSuggestsIbmPayslipPdf("path/to/commission_pay.pdf")).toBe(true);
  });

  it("rejects non-pdf and generic statement names", () => {
    expect(filenameSuggestsIbmPayslipPdf("statement.csv")).toBe(false);
    expect(filenameSuggestsIbmPayslipPdf("eStmt_2026.pdf")).toBe(false);
    expect(filenameSuggestsIbmPayslipPdf("boa_checking.pdf")).toBe(false);
    expect(filenameSuggestsIbmPayslipPdf("")).toBe(false);
    expect(filenameSuggestsIbmPayslipPdf(null)).toBe(false);
  });
});

describe("inferParserProfile", () => {
  it("suggests IBM payslip before BOA eStatement for matching PDF names", () => {
    expect(inferParserProfile(boaChecking, "March_payslip.pdf")).toBe(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
  });

  it("still uses BOA eStatement for generic PDF names", () => {
    expect(inferParserProfile(boaChecking, "eStmt_2026-01.pdf")).toBe("boa_estatement_pdf");
  });

  it("uses IBM payslip for payslip account type even when filename is generic", () => {
    expect(inferParserProfile(payslipPlaceholder, "eStmt_2026-01.pdf")).toBe(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
    expect(inferParserProfile(payslipPlaceholder, "download.pdf")).toBe(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
  });

  it("uses salary deposit + employers to infer payslip on generic PDF names (before BOA eStatement)", () => {
    const income = {
      salaryDepositAccountId: "acc-salary",
      employers: [{ id: "emp-1", parserProfileId: IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID }]
    };
    expect(inferParserProfile(boaSalaryChecking, "download.pdf", income)).toBe(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
    expect(inferParserProfile(boaSalaryChecking, "eStmt_2026-01.pdf", income)).toBe("boa_estatement_pdf");
  });

  it("does not use salary deposit inference without employers (falls through to institution PDF rules)", () => {
    const income = { salaryDepositAccountId: "acc-salary", employers: [] };
    expect(inferParserProfile(boaSalaryChecking, "download.pdf", income)).toBe("boa_estatement_pdf");
  });
});
