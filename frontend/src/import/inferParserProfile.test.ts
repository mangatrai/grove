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
const payslipPlaceholder = { type: "payslip", institution: "Payslip — Acme Corp" };

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

  it("uses IBM payslip for payslip account type when filename is generic and no employer list", () => {
    expect(inferParserProfile(payslipPlaceholder, "eStmt_2026-01.pdf")).toBe(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
    expect(inferParserProfile(payslipPlaceholder, "download.pdf")).toBe(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
  });

  it("uses sole employer parser for payslip account when generic PDF name", () => {
    const income = {
      employers: [{ id: "emp-1", parserProfileId: "deloitte_payslip_pdf" }]
    };
    expect(inferParserProfile(payslipPlaceholder, "download.pdf", income)).toBe("deloitte_payslip_pdf");
  });

  it("does not auto-infer payslip parser when multiple employers are configured", () => {
    const income = {
      employers: [
        { id: "a", parserProfileId: IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID },
        { id: "b", parserProfileId: "deloitte_payslip_pdf" }
      ]
    };
    expect(inferParserProfile(payslipPlaceholder, "download.pdf", income)).toBe(null);
  });

  it("uses salary deposit + employers to infer payslip on generic PDF names (before BOA eStatement)", () => {
    const income = {
      salaryDepositAccountId: "acc-salary",
      employers: [{ id: "emp-1", parserProfileId: IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID }]
    };
    expect(inferParserProfile(boaSalaryChecking, "download.pdf", income)).toBe(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
    expect(inferParserProfile(boaSalaryChecking, "eStmt_2026-01.pdf", income)).toBe("boa_estatement_pdf");
  });

  it("matches per-employer salary deposit account when legacy household salary id is unset", () => {
    const income = {
      salaryDepositAccountId: null,
      employers: [
        { id: "a", parserProfileId: IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID, salaryDepositFinancialAccountId: "acc-a" },
        { id: "b", parserProfileId: "deloitte_payslip_pdf", salaryDepositFinancialAccountId: "acc-b" }
      ]
    };
    expect(
      inferParserProfile({ id: "acc-b", type: "checking", institution: "Bank of America" }, "download.pdf", income)
    ).toBe("deloitte_payslip_pdf");
  });

  it("does not use salary deposit inference without employers (falls through to institution PDF rules)", () => {
    const income = { salaryDepositAccountId: "acc-salary", employers: [] };
    expect(inferParserProfile(boaSalaryChecking, "download.pdf", income)).toBe("boa_estatement_pdf");
  });

  // OFX / QFX / QBO — CR-071
  it("returns ofx_transactions for .ofx extension regardless of account type", () => {
    expect(inferParserProfile({ type: "checking", institution: "Chase" }, "transactions.ofx")).toBe("ofx_transactions");
    expect(inferParserProfile({ type: "savings", institution: "Marcus" }, "export.ofx")).toBe("ofx_transactions");
  });

  it("returns ofx_transactions for .qfx extension (Chase / Quicken)", () => {
    expect(inferParserProfile({ type: "credit_card", institution: "Chase" }, "Chase4883.qfx")).toBe("ofx_transactions");
  });

  it("returns ofx_transactions for .qbo extension (QuickBooks)", () => {
    expect(inferParserProfile({ type: "checking", institution: "Bank of America" }, "export.qbo")).toBe("ofx_transactions");
  });

  it("returns ofx_transactions even when account type is unknown", () => {
    expect(inferParserProfile({ type: "", institution: "" }, "file.qfx")).toBe("ofx_transactions");
  });
});
