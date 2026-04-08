import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseBoaEStatementFromText } from "../src/modules/imports/profiles/boa-estatement-pdf.js";
import { parseMarcusOnlineSavingsFromText } from "../src/modules/imports/profiles/marcus-online-savings-pdf.js";
import {
  parseCurrentYtdPair,
  parseIbmPayslipFromText,
  payslipPdfExtractLooksUnusable
} from "../src/modules/payslip/profiles/ibm-payslip-pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("BoA eStatement PDF text parser", () => {
  it("extracts deposits, ATM, and other subtractions", () => {
    const snippet = `
Deposits and other additions
Date \tDescription \tAmount
02/27/26 \tWealthfront \tDES:EDI PYMNTS
120,000.00
03/19/26 \tInterest Earned \t0.39
Total deposits and other additions \t$181,545.97

ATM and debit card subtractions
Date \tDescription \tAmount
03/02/26 \tCHECKCARD 0228 TMOBILE \t-205.09
Total ATM and debit card subtractions \t-$205.09

Other subtractions
Date \tDescription \tAmount
03/02/26 \tGOLDMAN SACHS BA DES:TRANSFER \t-110,000.00
Total other subtractions \t-$179,712.15
`;
    const rows = parseBoaEStatementFromText(snippet);
    expect(rows.length).toBe(4);
    expect(rows[0]!.amount).toBe(120000);
    expect(rows[0]!.description).toContain("Wealthfront");
    expect(rows[1]!.amount).toBe(0.39);
    expect(rows[2]!.amount).toBe(-205.09);
    expect(rows[3]!.amount).toBe(-110000);
  });
});

describe("IBM payslip PDF text parser (Pay and Contributions summary)", () => {
  it("marks long non-semantic pdf-parse output as unusable (no money, no payroll words)", () => {
    const garbage = `${"@\u0007\u0001".repeat(80)}BIB8@BIB9`;
    expect(garbage.length).toBeGreaterThan(120);
    expect(payslipPdfExtractLooksUnusable(garbage)).toBe(true);
  });

  it("parses Current and YTD from fixture text", () => {
    const text = readFileSync(path.join(__dirname, "fixtures", "ibm-payslip-sample.txt"), "utf8");
    const parsed = parseIbmPayslipFromText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.payPeriodStart).toBe("2025-01-01");
    expect(parsed!.payPeriodEnd).toBe("2025-01-15");
    expect(parsed!.payDate).toBe("2025-01-16");
    expect(parsed!.hoursOrDaysCurrent).toBe("80.00");
    expect(parsed!.grossPayCurrent).toBe(5000);
    expect(parsed!.grossPayYtd).toBe(10000);
    expect(parsed!.preTaxDeductionsCurrent).toBe(500);
    expect(parsed!.employeeTaxesCurrent).toBe(1200);
    expect(parsed!.postTaxDeductionsCurrent).toBe(100);
    expect(parsed!.netPayCurrent).toBe(3200);
    expect(parsed!.netPayYtd).toBe(6400);
  });

  it("parseCurrentYtdPair reads last two money columns on a line", () => {
    expect(parseCurrentYtdPair("Gross Pay    1,234.56    9,876.54")).toEqual({
      current: 1234.56,
      ytd: 9876.54
    });
  });

  it("parses golden Feb-style IBM summary (section-bounded Current/YTD)", () => {
    const text = readFileSync(path.join(__dirname, "fixtures", "ibm-payslip-feb-regular.txt"), "utf8");
    const parsed = parseIbmPayslipFromText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.payPeriodStart).toBe("2026-02-16");
    expect(parsed!.payPeriodEnd).toBe("2026-02-28");
    expect(parsed!.payDate).toBe("2026-02-27");
    expect(parsed!.hoursOrDaysCurrent).toBe("80.00");
    expect(parsed!.grossPayCurrent).toBe(9588.75);
    expect(parsed!.grossPayYtd).toBe(48313.79);
    expect(parsed!.preTaxDeductionsCurrent).toBe(1096.42);
    expect(parsed!.preTaxDeductionsYtd).toBe(18200.21);
    expect(parsed!.employeeTaxesCurrent).toBe(3175.4);
    expect(parsed!.employeeTaxesYtd).toBe(15225.21);
    expect(parsed!.postTaxDeductionsCurrent).toBe(250);
    expect(parsed!.postTaxDeductionsYtd).toBe(1200);
    expect(parsed!.netPayCurrent).toBe(4350.17);
    expect(parsed!.netPayYtd).toBe(8700.34);
  });

  it("parses IBM SuccessFactors PDF extract (label line separate from Current/YTD amounts)", () => {
    const text = `
Employee Name:
02/16/2026-02/28/2026
Pay and Contributions Statement
INTERNATIONAL BUSINESS MACHINES CORPORATION
Net Payment:
Pay Period:
4,350.17
Current
YTD
Hours/Days Worked
80.00
336.00
Gross Pay
9,588.75
48,313.79
Post Tax Deductions
1,096.42
18,200.21
4,350.17
8,700.34
Net Pay
Payment Information
Pay Date
02/27/2026
4,350.17USD
`;
    const parsed = parseIbmPayslipFromText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.payPeriodStart).toBe("2026-02-16");
    expect(parsed!.payPeriodEnd).toBe("2026-02-28");
    expect(parsed!.payDate).toBe("2026-02-27");
    expect(parsed!.grossPayCurrent).toBe(9588.75);
    expect(parsed!.grossPayYtd).toBe(48313.79);
    expect(parsed!.netPayCurrent).toBe(4350.17);
  });

  it("maps Other Deductions to post-tax when Post-Tax label is absent", () => {
    const text = `
01/01/2026-01/15/2026
Gross Pay
5,000.00
10,000.00
Other Deductions
50.00
100.00
4,000.00
8,000.00
Net Pay
`;
    const parsed = parseIbmPayslipFromText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.postTaxDeductionsCurrent).toBe(50);
    expect(parsed!.postTaxDeductionsYtd).toBe(100);
  });

  it("accepts alternate labels (total earnings, pay begin / end dates)", () => {
    const text = `
Pay Begin Date: 01/01/2025
Pay End Date: 01/15/2025
Payment Date: 01/16/2025
Current    YTD
Total Earnings    5,000.00    10,000.00
Net Pay    3,200.00    6,400.00
`;
    const parsed = parseIbmPayslipFromText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.payPeriodStart).toBe("2025-01-01");
    expect(parsed!.payPeriodEnd).toBe("2025-01-15");
    expect(parsed!.payDate).toBe("2025-01-16");
    expect(parsed!.grossPayCurrent).toBe(5000);
    expect(parsed!.netPayCurrent).toBe(3200);
  });
});

describe("Marcus online savings PDF text parser", () => {
  it("parses ACCOUNT ACTIVITY rows with debits and interest", () => {
    const snippet = `
ACCOUNT ACTIVITY
Date \tDescription \tCredits \tDebits \tBalance
02/01/2026 \tBeginning Balance \t$6,253.16
02/02/2026 \tACH Withdrawal PENNYMAC CASH \t$465.23 \t$5,787.93
02/28/2026 \tInterest Paid \t$11.49 \t$4,077.55
Streamline your savings growth
`;
    const rows = parseMarcusOnlineSavingsFromText(snippet);
    expect(rows.length).toBe(2);
    expect(rows[0]!.amount).toBe(-465.23);
    expect(rows[1]!.amount).toBe(11.49);
  });
});
