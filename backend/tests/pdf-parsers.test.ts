import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseBoaEStatementFromText } from "../src/modules/imports/profiles/boa-estatement-pdf.js";
import { parseMarcusOnlineSavingsFromText } from "../src/modules/imports/profiles/marcus-online-savings-pdf.js";
import {
  parseCurrentYtdPair,
  parseIbmPayslipFromText
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
