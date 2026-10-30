import { describe, expect, it } from "vitest";

import { accountSuffixFromMask, getPayslipDepositLines } from "../src/modules/payslip/payslip-deposit-lines.js";

/** Row shapes as stored by each parser path; fictional values only. */
const llmRow = (over: Record<string, unknown>) => ({
  payment_type: null,
  bank_name: null,
  bank_location: null,
  account_or_check_number_masked: "*****1111",
  amount: 3000,
  currency: "USD",
  pay_date: "2026-06-15",
  ...over
});

describe("accountSuffixFromMask", () => {
  it("keeps the trailing digits of every mask style", () => {
    expect(accountSuffixFromMask("*****1111")).toBe("1111");
    expect(accountSuffixFromMask("XXXXXX2222")).toBe("2222");
    expect(accountSuffixFromMask("...333")).toBe("333");
    expect(accountSuffixFromMask("Acct 4444 (checking)")).toBe("4444");
  });

  it("returns null when no digits are printed", () => {
    expect(accountSuffixFromMask(null)).toBeNull();
    expect(accountSuffixFromMask("XXXX")).toBeNull();
    expect(accountSuffixFromMask(42)).toBeNull();
  });
});

describe("getPayslipDepositLines", () => {
  it("reads Rippling parser output, including the ACH trace", () => {
    const json = JSON.stringify([
      { ...llmRow({ account_or_check_number_masked: "...111", amount: 2500, payment_type: "direct_deposit" }), trace: "000000000000001" },
      { ...llmRow({ account_or_check_number_masked: "...222", amount: 500, payment_type: "direct_deposit" }), trace: "000000000000002" }
    ]);
    expect(getPayslipDepositLines(json)).toEqual([
      { accountSuffix: "111", amount: 2500, trace: "000000000000001" },
      { accountSuffix: "222", amount: 500, trace: "000000000000002" }
    ]);
  });

  it("reads LLM rows whatever payment_type says, ignoring routing numbers in bank fields", () => {
    const rows = [
      llmRow({ bank_name: "000000001" }),
      llmRow({ payment_type: "Direct Deposit", bank_location: "000000002", account_or_check_number_masked: "XXXXXX2222", amount: 1234.567 })
    ];
    expect(getPayslipDepositLines(rows)).toEqual([
      { accountSuffix: "1111", amount: 3000, trace: null },
      { accountSuffix: "2222", amount: 1234.57, trace: null }
    ]);
  });

  it("keeps a deposit whose account number was not printed (amount-only line)", () => {
    expect(getPayslipDepositLines([llmRow({ account_or_check_number_masked: null, pay_date: null })])).toEqual([
      { accountSuffix: null, amount: 3000, trace: null }
    ]);
  });

  it("drops zero / missing amounts and checks", () => {
    const rows = [
      llmRow({ amount: 0 }),
      llmRow({ amount: null }),
      llmRow({ amount: "3000" }),
      llmRow({ payment_type: "Check", account_or_check_number_masked: "1005" }),
      llmRow({ payment_type: "Paper cheque" })
    ];
    expect(getPayslipDepositLines(rows)).toEqual([]);
  });

  it("returns [] for empty or malformed input", () => {
    expect(getPayslipDepositLines(null)).toEqual([]);
    expect(getPayslipDepositLines("")).toEqual([]);
    expect(getPayslipDepositLines("{not json")).toEqual([]);
    expect(getPayslipDepositLines(JSON.stringify({ amount: 1 }))).toEqual([]);
    expect(getPayslipDepositLines([null, "x", 3])).toEqual([]);
  });
});
