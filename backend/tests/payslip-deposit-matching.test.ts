import crypto from "node:crypto";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { accountMaskMatches } from "../src/modules/payslip/payslip-deposit-match.service.js";
import { insertPayslipSnapshot } from "../src/modules/payslip/payslip.service.js";
import type { ParsedPayslipSummary, PayslipHybridColumns } from "../src/modules/payslip/payslip.types.js";
import { sqlStmt } from "./pg-stmt.js";

/**
 * #301 step 4 — per-deposit-line matching on GET /payslips/:id. Fictional amounts/dates only.
 * Seeded checking (primary deposit account) gets mask 9111, savings gets 9222.
 */
const app = buildApp();
const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const CHECKING = "40000000-0000-0000-0000-000000000001";
const SAVINGS = "40000000-0000-0000-0000-000000000006";
const EMPLOYER_ID = "e1000000-0000-4000-8000-0000000000b1";

let token: string;
let ownerProfileId: string;
let saved: { employersJson: string | null; salaryAccount: string | null; checkingMask: string | null; savingsMask: string | null };
const createdPayslips: string[] = [];
const createdTxns: string[] = [];

type Line = { mask: string | null; amount: number };

async function payslip(payDate: string, netPay: number, lines: Line[] | null): Promise<string> {
  const summary: ParsedPayslipSummary = {
    payPeriodStart: null,
    payPeriodEnd: null,
    payDate,
    hoursOrDaysCurrent: null,
    hoursOrDaysYtd: null,
    grossPayCurrent: null,
    grossPayYtd: null,
    employeeTaxesCurrent: null,
    employeeTaxesYtd: null,
    preTaxDeductionsCurrent: null,
    preTaxDeductionsYtd: null,
    postTaxDeductionsCurrent: null,
    postTaxDeductionsYtd: null,
    netPayCurrent: netPay,
    netPayYtd: null,
    taxableEarningsCurrent: null,
    taxableEarningsYtd: null,
    otherInformationCurrent: null,
    otherInformationYtd: null,
    rawExtractJson: {}
  };
  const hybrid: PayslipHybridColumns = {
    canonicalExtractJson: "{}",
    currency: "USD",
    employerDisplayName: "Acme Corp",
    employeeDisplayName: null,
    employerEinOrFein: null,
    employeeId: null,
    personnelNumber: null,
    talentId: null,
    taxProfileJson: null,
    paymentSummaryJson:
      lines == null
        ? null
        : JSON.stringify(
            lines.map((l) => ({
              payment_type: "direct_deposit",
              bank_name: null,
              bank_location: null,
              account_or_check_number_masked: l.mask,
              amount: l.amount,
              currency: "USD",
              pay_date: payDate
            }))
          ),
    extractionMetadataJson: null,
    employmentRate: null,
    employmentRateType: null
  };
  const res = await insertPayslipSnapshot(
    HOUSEHOLD_ID,
    "match-test.pdf",
    crypto.randomBytes(32).toString("hex"),
    "rippling_payslip_pdf",
    summary,
    null,
    EMPLOYER_ID,
    "person",
    ownerProfileId,
    hybrid,
    []
  );
  if (!res.ok) throw new Error("duplicate checksum in test");
  createdPayslips.push(res.snapshot.id);
  return res.snapshot.id;
}

async function credit(accountId: string, txnDate: string, amount: number): Promise<string> {
  const id = crypto.randomUUID();
  await sqlStmt(
    `INSERT INTO transaction_canonical
       (id, household_id, account_id, txn_date, amount, direction, merchant, status, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, 'credit', 'Acme Payroll', 'posted', ?, CURRENT_TIMESTAMP)`
  ).run(id, HOUSEHOLD_ID, accountId, txnDate, amount, `deposit-match-${id}`);
  createdTxns.push(id);
  return id;
}

async function detail(id: string) {
  const res = await request(app).get(`/payslips/${id}`).set("authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as {
    matchMode: string;
    depositLines: Array<{
      accountSuffix: string | null;
      amount: number;
      status: string;
      linked: { id: string } | null;
      candidates: Array<{ id: string; matchReason: string; dateDelta: number; amountDelta: number }>;
    }>;
    confirmedDeposits: Array<{ id: string; amountDelta: number }>;
    suggestedDeposits: Array<{ id: string }>;
    linkedTotal: number;
    netPay: number | null;
    remainder: number | null;
  };
}

async function link(payslipId: string, txnId: string) {
  const res = await request(app).put(`/payslips/${payslipId}/deposits/${txnId}`).set("authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  const login = await request(app).post("/auth/login").send({ email: "owner@example.com", password: "ChangeMe123!" });
  expect(login.status).toBe(200);
  token = login.body.token as string;

  const owner = await sqlStmt(
    `SELECT pp.id, pp.employers_json, pp.salary_deposit_financial_account_id AS salary
       FROM person_profile pp JOIN app_user u ON u.id = pp.linked_user_id
      WHERE u.email = 'owner@example.com'`
  ).get<{ id: string; employers_json: string | null; salary: string | null }>();
  ownerProfileId = owner!.id;
  const masks = await sqlStmt(`SELECT id, account_mask FROM financial_account WHERE id IN (?, ?)`).all<{
    id: string;
    account_mask: string | null;
  }>(CHECKING, SAVINGS);
  saved = {
    employersJson: owner!.employers_json,
    salaryAccount: owner!.salary,
    checkingMask: masks.find((m) => m.id === CHECKING)?.account_mask ?? null,
    savingsMask: masks.find((m) => m.id === SAVINGS)?.account_mask ?? null
  };

  await sqlStmt(`UPDATE financial_account SET account_mask = ? WHERE id = ?`).run("9111", CHECKING);
  await sqlStmt(`UPDATE financial_account SET account_mask = ? WHERE id = ?`).run("9222", SAVINGS);
  const res = await request(app)
    .patch("/household/profile")
    .set("authorization", `Bearer ${token}`)
    .send({
      employers: [
        { id: EMPLOYER_ID, displayName: "Acme Corp", parserProfileId: "rippling_payslip_pdf", salaryDepositFinancialAccountId: CHECKING }
      ]
    });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  for (const id of createdPayslips) await sqlStmt(`DELETE FROM payslip_snapshot WHERE id = ?`).run(id);
  for (const id of createdTxns) await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(id);
  await sqlStmt(`UPDATE financial_account SET account_mask = ? WHERE id = ?`).run(saved.checkingMask, CHECKING);
  await sqlStmt(`UPDATE financial_account SET account_mask = ? WHERE id = ?`).run(saved.savingsMask, SAVINGS);
  await sqlStmt(
    `UPDATE person_profile SET employers_json = ?, salary_deposit_financial_account_id = ? WHERE id = ?`
  ).run(saved.employersJson, saved.salaryAccount, ownerProfileId);
});

describe("accountMaskMatches", () => {
  it("compares the common tail of stored mask and printed digits", () => {
    expect(accountMaskMatches("9111", "111")).toBe(true);
    expect(accountMaskMatches("x9111", "9111")).toBe(true);
    expect(accountMaskMatches("9111", "12349111")).toBe(true);
    expect(accountMaskMatches("9111", "222")).toBe(false);
    expect(accountMaskMatches("9111", "11")).toBe(false);
    expect(accountMaskMatches(null, "111")).toBe(false);
    expect(accountMaskMatches("9111", null)).toBe(false);
  });
});

describe("GET /payslips/:id — per-line deposit matching", () => {
  it("split pay: each line is suggested on its own account; partial confirm keeps the other line suggested", async () => {
    const id = await payslip("2026-08-14", 2971.2, [
      { mask: "...111", amount: 2471.13 },
      { mask: "...222", amount: 500.07 }
    ]);
    const toChecking = await credit(CHECKING, "2026-08-14", 2471.13);
    const toSavings = await credit(SAVINGS, "2026-08-15", 500.07);

    const before = await detail(id);
    expect(before.matchMode).toBe("lines");
    expect(before.depositLines.map((l) => [l.accountSuffix, l.amount, l.status])).toEqual([
      ["111", 2471.13, "suggested"],
      ["222", 500.07, "suggested"]
    ]);
    expect(before.depositLines[0]!.candidates[0]).toMatchObject({ id: toChecking, matchReason: "account_mask", dateDelta: 0 });
    expect(before.depositLines[1]!.candidates[0]).toMatchObject({ id: toSavings, matchReason: "account_mask", dateDelta: 1 });
    expect(before.suggestedDeposits.map((d) => d.id)).toEqual([toChecking, toSavings]);
    expect(before).toMatchObject({ linkedTotal: 0, netPay: 2971.2, remainder: 2971.2 });

    await link(id, toChecking);
    const after = await detail(id);
    expect(after.depositLines[0]).toMatchObject({ status: "linked", linked: { id: toChecking }, candidates: [] });
    expect(after.depositLines[1]).toMatchObject({ status: "suggested" });
    expect(after.depositLines[1]!.candidates[0]!.id).toBe(toSavings);
    expect(after.suggestedDeposits.map((d) => d.id)).toEqual([toSavings]);
    expect(after.confirmedDeposits).toEqual([expect.objectContaining({ id: toChecking, amountDelta: 0 })]);
    expect(after).toMatchObject({ linkedTotal: 2471.13, remainder: 500.07 });
  });

  it("an account-mask match outranks a same-amount credit on the primary account, even if farther in date", async () => {
    const id = await payslip("2026-08-21", 613.41, [{ mask: "*****9222", amount: 613.41 }]);
    const onPrimary = await credit(CHECKING, "2026-08-21", 613.41);
    const onMaskedAccount = await credit(SAVINGS, "2026-08-24", 613.41);

    const d = await detail(id);
    expect(d.depositLines[0]!.candidates.map((c) => [c.id, c.matchReason])).toEqual([
      [onMaskedAccount, "account_mask"],
      [onPrimary, "primary_account"]
    ]);
  });

  it("a line with no printed account ranks the primary account first", async () => {
    const id = await payslip("2026-08-21", 702.19, [{ mask: null, amount: 702.19 }]);
    const elsewhere = await credit(SAVINGS, "2026-08-21", 702.19);
    const onPrimary = await credit(CHECKING, "2026-08-23", 702.19);

    const d = await detail(id);
    expect(d.depositLines[0]!.candidates.map((c) => [c.id, c.matchReason])).toEqual([
      [onPrimary, "primary_account"],
      [elsewhere, "other"]
    ]);
  });

  it("a transaction already linked to another payslip is not suggested again", async () => {
    const first = await payslip("2026-09-04", 777.77, [{ mask: "...111", amount: 777.77 }]);
    const second = await payslip("2026-09-04", 777.77, [{ mask: "...111", amount: 777.77 }]);
    const deposit = await credit(CHECKING, "2026-09-04", 777.77);

    await link(first, deposit);
    const d = await detail(second);
    expect(d.depositLines[0]!.status).toBe("not_found");
    expect(d.suggestedDeposits).toEqual([]);
  });

  it("window and amount boundaries: day 7 in, day 8 out, one cent off out", async () => {
    const id = await payslip("2026-09-11", 888.88, [{ mask: "...111", amount: 888.88 }]);
    const day7 = await credit(CHECKING, "2026-09-18", 888.88);
    await credit(CHECKING, "2026-09-19", 888.88);
    await credit(CHECKING, "2026-09-11", 888.87);

    const d = await detail(id);
    expect(d.depositLines[0]!.candidates.map((c) => c.id)).toEqual([day7]);
  });

  it("lines that don't sum to net pay fall back to the net-pay matcher (nothing rejected)", async () => {
    const id = await payslip("2026-09-25", 1234.56, [{ mask: "...111", amount: 1000 }]);
    const netDeposit = await credit(CHECKING, "2026-09-25", 1234.56);

    const d = await detail(id);
    expect(d.matchMode).toBe("net_pay");
    expect(d.depositLines).toEqual([]);
    expect(d.suggestedDeposits.map((s) => s.id)).toContain(netDeposit);
    expect(d).toMatchObject({ linkedTotal: 0, netPay: 1234.56, remainder: 1234.56 });
  });

  it("payslips with no deposit lines use the net-pay matcher", async () => {
    const id = await payslip("2026-10-09", 1357.91, null);
    const netDeposit = await credit(CHECKING, "2026-10-10", 1357.91);

    const d = await detail(id);
    expect(d.matchMode).toBe("net_pay");
    expect(d.suggestedDeposits.map((s) => s.id)).toContain(netDeposit);
  });
});
