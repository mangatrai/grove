import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseBoaEStatementFromText } from "../src/modules/imports/profiles/boa-estatement-pdf.js";
import { parseMarcusOnlineSavingsFromText } from "../src/modules/imports/profiles/marcus-online-savings-pdf.js";
import { parseWealthfrontFromText } from "../src/modules/imports/profiles/wealthfront-investment-pdf.js";
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
    expect(parsed!.postTaxDeductionsCurrent).toBe(966.76);
    expect(parsed!.postTaxDeductionsYtd).toBe(8482.42);
    expect(parsed!.netPayCurrent).toBe(4350.17);
    expect(parsed!.netPayYtd).toBe(18200.21);
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
  const snippet = `
ACCOUNT ACTIVITY
Date \tDescription \tCredits \tDebits \tBalance
02/01/2026 \tBeginning Balance \t$6,253.16
02/02/2026 \tACH Withdrawal PENNYMAC CASH \t$465.23 \t$5,787.93
02/28/2026 \tInterest Paid \t$11.49 \t$4,077.55
02/28/2026 \tEnding Balance \t$4,077.55
Streamline your savings growth
`;

  it("parses ACCOUNT ACTIVITY rows with debits and interest", () => {
    const { rows } = parseMarcusOnlineSavingsFromText(snippet);
    expect(rows.length).toBe(2);
    expect(rows[0]!.amount).toBe(-465.23);
    expect(rows[1]!.amount).toBe(11.49);
  });

  it("outputs ISO dates (YYYY-MM-DD), not MM/DD/YYYY", () => {
    const { rows } = parseMarcusOnlineSavingsFromText(snippet);
    expect(rows[0]!.txn_date).toBe("2026-02-02");
    expect(rows[1]!.txn_date).toBe("2026-02-28");
  });

  it("extracts ending balance for balance snapshot", () => {
    const { statementBalances } = parseMarcusOnlineSavingsFromText(snippet);
    expect(statementBalances).not.toBeNull();
    expect(statementBalances!.ending).toBe(4077.55);
    expect(statementBalances!.asOfEnd).toBe("2026-02-28");
  });

  it("does not emit a row for Ending Balance or Beginning Balance", () => {
    const { rows } = parseMarcusOnlineSavingsFromText(snippet);
    const descs = rows.map((r) => r.description);
    expect(descs.every((d) => !/balance/i.test(d))).toBe(true);
  });

  // pdf-parse does not understand columnar layout. When an ACH deposit description
  // wraps within its cell, pdf-parse emits the date+partial-desc on one line and
  // the amounts on the next line — with no amounts on the first line.
  // This simulates the actual pdf-parse output for a Marcus statement with two
  // ACH deposits whose descriptions wrap, plus a single-line Interest Paid row.
  const wrappedSnippet = `
Statement Period 03/01/2026 to 03/31/2026
Beginning Balance $476.38
Ending Balance $8,480.98

ACCOUNT ACTIVITY
DateDescriptionCreditsDebitsBalance
03/31/2026 Interest Paid $4.60 $8,480.98
03/23/2026 ACH Deposit Internet transfer from BANK OF AMERICA, N.A. DDA
$3,000.00 $3,476.38
account ****************3560
03/10/2026 ACH Deposit Internet transfer from BANK OF AMERICA, N.A. DDA
$5,000.00 $476.38
account ****************3560
03/31/2026 Ending Balance $8,480.98
Streamline your savings growth
`;

  it("parses ACH deposits whose descriptions wrap onto the next line", () => {
    const { rows } = parseMarcusOnlineSavingsFromText(wrappedSnippet);
    expect(rows.length).toBe(3);
    const achRows = rows.filter((r) => /ACH Deposit/i.test(r.description));
    expect(achRows.length).toBe(2);
    expect(achRows[0]!.amount).toBe(3000);
    expect(achRows[0]!.txn_date).toBe("2026-03-23");
    expect(achRows[1]!.amount).toBe(5000);
    expect(achRows[1]!.txn_date).toBe("2026-03-10");
  });

  it("parses interest paid alongside wrapped ACH deposits", () => {
    const { rows } = parseMarcusOnlineSavingsFromText(wrappedSnippet);
    const interest = rows.find((r) => /Interest Paid/i.test(r.description));
    expect(interest).toBeDefined();
    expect(interest!.amount).toBe(4.6);
    expect(interest!.txn_date).toBe("2026-03-31");
  });

  it("extracts ending balance and period dates from the SUMMARY block (no date prefix)", () => {
    const { statementBalances } = parseMarcusOnlineSavingsFromText(wrappedSnippet);
    expect(statementBalances).not.toBeNull();
    expect(statementBalances!.ending).toBe(8480.98);
    expect(statementBalances!.beginning).toBe(476.38);
    expect(statementBalances!.asOfEnd).toBe("2026-03-31");
    expect(statementBalances!.asOfStart).toBe("2026-03-01");
  });

  it("does not emit rows for wrapped Beginning Balance or Ending Balance lines", () => {
    const { rows } = parseMarcusOnlineSavingsFromText(wrappedSnippet);
    const descs = rows.map((r) => r.description);
    expect(descs.every((d) => !/balance/i.test(d))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wealthfront Cash Account PDF parser
// ---------------------------------------------------------------------------

// Representative text from a real February 2026 statement (personal data redacted).
// Structure mirrors actual pdf-parse output: sections separated by headers, amounts already signed.
const WEALTHFRONT_FEB_TEXT = `ACCOUNT INFORMATIONTest UserIndividual Cash Account - TOD
ACCOUNT NUMBERSWealthfront: XXXXXXXX
Monthly Statement for February 1 - 28, 2026Real Estate Savings Account
I. HoldingsII. Account Activity
February 1, 2026
Starting Balance
$329,441.04
February 28, 2026
Ending Balance
$210,746.55

II. Account Activity Deposits/Credits to Wealthfront Brokerage Withdrawals/Debits from Wealthfront Brokerage Transfer between Wealthfront and Program Banks
3

Date
Method
Status
Amount
2/3/2026
ACH
Received
$200.00
2/18/2026
ACH
Received
$200.00
Total
$400.00
Date
Method
Status
Amount
2/27/2026
ACH
Disbursed
-$120,000.00
Total
-$120,000.00
Date
Method
Amount
2/3/2026
Transfer to Program Banks
-$200.00
2/18/2026
Transfer to Program Banks
-$200.00
2/27/2026
Transfer from Program Banks
$120,000.00
INTEREST
4

Date
Method
Amount
Total
$119,600.00
Date
Interest Period
Amount
2/1/2026
January 2026
$905.51
Total
$905.51
Balance and Interest Rate Details
Date
Amount
APR
APY
1/1/2026
$349,041.04
3.20%
3.25%
`;

// Representative text from a real March 2026 statement (with RTP/FedNow + footnote mid-row).
const WEALTHFRONT_MAR_TEXT = `Monthly Statement for March 1 - 31, 2026Real Estate Savings Account
I. HoldingsII. Account Activity
March 1, 2026
Starting Balance
$210,746.55
March 31, 2026
Ending Balance
$151,949.71

II. Account Activity Deposits/Credits to Wealthfront Brokerage Withdrawals/Debits from Wealthfront Brokerage Transfer between Wealthfront and Program Banks
4

Date
Method
Status
Amount
3/3/2026
ACH
Received
$200.00
3/17/2026
ACH
Received
$200.00
Total
$400.00
Date
Method
Status
Amount
3/2/2026
RTP/FedNow
3
Disbursed
-$50,000.00
3/27/2026
RTP/FedNow
Disbursed
-$10,000.00
Total
-$60,000.00
Date
Method
Amount
3/2/2026
Transfer from Program Banks
$50,000.00
3/3/2026
Transfer to Program Banks
-$200.00
3/17/2026
Transfer to Program Banks
-$200.00
3/27/2026
Transfer from Program Banks
$10,000.00
INTEREST
5

Date
Method
Amount
3/17/2026
Transfer to Program Banks
-$200.00
3/27/2026
Transfer from Program Banks
$10,000.00
Total
$59,600.00
Date
Interest Period
Amount
3/1/2026
February 2026
$803.16
Total
$803.16
Balance and Interest Rate Details
`;

describe("Wealthfront Cash Account PDF parser", () => {
  describe("February 2026 statement", () => {
    const { rows, statementBalances } = parseWealthfrontFromText(WEALTHFRONT_FEB_TEXT);

    it("emits 3 transaction rows (2 deposits, 1 withdrawal, 1 interest)", () => {
      // deposits: 2/3 and 2/18; withdrawal: 2/27; interest: 2/1
      expect(rows).toHaveLength(4);
    });

    it("parses deposit amounts as positive", () => {
      const deposits = rows.filter((r) => r.amount > 0 && r.description.includes("Deposit"));
      expect(deposits).toHaveLength(2);
      expect(deposits[0]!.amount).toBe(200.0);
      expect(deposits[1]!.amount).toBe(200.0);
    });

    it("parses withdrawal amount as negative", () => {
      const withdrawals = rows.filter((r) => r.amount < 0);
      expect(withdrawals).toHaveLength(1);
      expect(withdrawals[0]!.amount).toBe(-120000.0);
      expect(withdrawals[0]!.description).toMatch(/withdrawal/i);
    });

    it("parses interest as positive with period in description", () => {
      const interest = rows.find((r) => r.description.startsWith("Interest"));
      expect(interest).toBeDefined();
      expect(interest!.amount).toBe(905.51);
      expect(interest!.description).toBe("Interest - January 2026");
    });

    it("skips program-bank transfer rows", () => {
      const transfers = rows.filter((r) => r.description.toLowerCase().includes("program bank"));
      expect(transfers).toHaveLength(0);
    });

    it("outputs ISO dates", () => {
      expect(rows[0]!.txn_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rows.find((r) => r.description.startsWith("Interest"))!.txn_date).toBe("2026-02-01");
    });

    it("extracts ending balance and date", () => {
      expect(statementBalances).not.toBeNull();
      expect(statementBalances!.ending).toBe(210746.55);
      expect(statementBalances!.asOfEnd).toBe("2026-02-28");
    });
  });

  describe("March 2026 statement (RTP/FedNow + footnote mid-row)", () => {
    const { rows, statementBalances } = parseWealthfrontFromText(WEALTHFRONT_MAR_TEXT);

    it("emits 4 rows (2 deposits, 2 withdrawals, 1 interest)", () => {
      expect(rows).toHaveLength(5);
    });

    it("handles RTP/FedNow withdrawal with mid-row footnote", () => {
      const rtp = rows.filter((r) => r.description.includes("RTP/FedNow"));
      expect(rtp).toHaveLength(2);
      expect(rtp[0]!.amount).toBe(-50000.0);
      expect(rtp[1]!.amount).toBe(-10000.0);
    });

    it("parses interest correctly (February 2026 period)", () => {
      const interest = rows.find((r) => r.description.startsWith("Interest"));
      expect(interest!.amount).toBe(803.16);
      expect(interest!.description).toBe("Interest - February 2026");
    });

    it("extracts March ending balance", () => {
      expect(statementBalances!.ending).toBe(151949.71);
      expect(statementBalances!.asOfEnd).toBe("2026-03-31");
    });
  });
});
