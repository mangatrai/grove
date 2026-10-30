import crypto from "node:crypto";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  autoLinkDepositsForTxnDates,
  autoLinkPayslipDeposits
} from "../src/modules/payslip/payslip-deposit-match.service.js";
import { insertPayslipSnapshot } from "../src/modules/payslip/payslip.service.js";
import type { ParsedPayslipSummary, PayslipHybridColumns } from "../src/modules/payslip/payslip.types.js";
import { sqlStmt } from "./pg-stmt.js";

/**
 * #301 step 5 — deposit auto-link with dismiss. Fictional amounts/dates only.
 * Seeded checking (primary deposit account) gets mask 9111, savings gets 9222.
 */
const app = buildApp();
const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const CHECKING = "40000000-0000-0000-0000-000000000001";
const SAVINGS = "40000000-0000-0000-0000-000000000006";
const EMPLOYER_ID = "e1000000-0000-4000-8000-0000000000b2";

let token: string;
let ownerProfileId: string;
let saved: { employersJson: string | null; salaryAccount: string | null; checkingMask: string | null; savingsMask: string | null };
const createdPayslips: string[] = [];
const createdTxns: string[] = [];
const createdSessions: string[] = [];

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
    "auto-link-test.pdf",
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
  ).run(id, HOUSEHOLD_ID, accountId, txnDate, amount, `auto-link-${id}`);
  createdTxns.push(id);
  return id;
}

/** Real bank import path: CSV upload → parse → canonicalize into the seeded checking account. */
async function importCsvCredit(txnDate: string, amount: number): Promise<string> {
  const sessionRes = await request(app).post("/imports/sessions").set("authorization", `Bearer ${token}`).send({ sourceType: "upload" });
  expect(sessionRes.status).toBe(201);
  const sessionId = sessionRes.body.session.id as string;
  createdSessions.push(sessionId);
  const csv = ["Date,Description,Amount,Reference", `${txnDate},ACME PAYROLL,${amount.toFixed(2)},auto-link-${sessionId}`].join("\n");
  const upload = await request(app)
    .post(`/imports/sessions/${sessionId}/files`)
    .set("authorization", `Bearer ${token}`)
    .attach("files", Buffer.from(csv), "auto-link-test.csv");
  expect(upload.status).toBe(201);
  const fileId = upload.body.files[0].id as string;
  const bind = await request(app)
    .patch(`/imports/sessions/${sessionId}/files/${fileId}`)
    .set("authorization", `Bearer ${token}`)
    .send({ financialAccountId: CHECKING, parserProfileId: "generic_tabular" });
  expect(bind.status).toBe(200);
  const parse = await request(app)
    .post(`/imports/sessions/${sessionId}/parse`)
    .set("authorization", `Bearer ${token}`)
    .send({ mapping: { date: "Date", description: "Description", amount: "Amount", referenceId: "Reference" } });
  expect(parse.status).toBe(200);
  const can = await request(app).post(`/imports/sessions/${sessionId}/canonicalize`).set("authorization", `Bearer ${token}`).send({});
  expect(can.status).toBe(200);
  const row = await sqlStmt(
    `SELECT tc.id FROM transaction_canonical tc
       JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       JOIN import_file f ON f.id = tr.file_id
      WHERE f.session_id = ? LIMIT 1`
  ).get<{ id: string }>(sessionId);
  createdTxns.push(row!.id);
  return row!.id;
}

type Detail = {
  matchMode: string;
  depositLines: Array<{ status: string; linked: { id: string; linkSource?: string } | null; candidates: Array<{ id: string }> }>;
  confirmedDeposits: Array<{ id: string; linkSource?: string }>;
};

async function detail(id: string): Promise<Detail> {
  const res = await request(app).get(`/payslips/${id}`).set("authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as Detail;
}

async function matchRow(payslipId: string, txnId: string) {
  return sqlStmt(
    `SELECT link_source, dismissed_at FROM payslip_deposit_match WHERE payslip_snapshot_id = ? AND transaction_canonical_id = ?`
  ).get<{ link_source: string; dismissed_at: unknown }>(payslipId, txnId);
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
  for (const id of createdSessions) {
    await sqlStmt(`DELETE FROM transaction_raw WHERE file_id IN (SELECT id FROM import_file WHERE session_id = ?)`).run(id);
    await sqlStmt(`DELETE FROM import_file WHERE session_id = ?`).run(id);
    await sqlStmt(`DELETE FROM import_session WHERE id = ?`).run(id);
  }
  await sqlStmt(`UPDATE financial_account SET account_mask = ? WHERE id = ?`).run(saved.checkingMask, CHECKING);
  await sqlStmt(`UPDATE financial_account SET account_mask = ? WHERE id = ?`).run(saved.savingsMask, SAVINGS);
  await sqlStmt(
    `UPDATE person_profile SET employers_json = ?, salary_deposit_financial_account_id = ? WHERE id = ?`
  ).run(saved.employersJson, saved.salaryAccount, ownerProfileId);
});

describe("deposit auto-link (#301 step 5)", () => {
  it("auto-links both split deposits when the payslip arrives after the bank credits", async () => {
    const toChecking = await credit(CHECKING, "2026-07-10", 1611.11);
    const toSavings = await credit(SAVINGS, "2026-07-11", 222.22);
    const id = await payslip("2026-07-10", 1833.33, [
      { mask: "...111", amount: 1611.11 },
      { mask: "...222", amount: 222.22 }
    ]);

    const d = await detail(id);
    expect(d.depositLines.map((l) => [l.status, l.linked?.id, l.linked?.linkSource])).toEqual([
      ["linked", toChecking, "auto"],
      ["linked", toSavings, "auto"]
    ]);
    expect((await matchRow(id, toChecking))?.link_source).toBe("auto");
  });

  it("auto-links after a later bank import adds the credit", async () => {
    const id = await payslip("2026-07-17", 1414.14, [{ mask: "...111", amount: 1414.14 }]);
    expect((await detail(id)).depositLines[0]!.status).toBe("not_found");

    const txnId = await importCsvCredit("2026-07-17", 1414.14);
    const d = await detail(id);
    expect(d.depositLines[0]).toMatchObject({ status: "linked", linked: { id: txnId, linkSource: "auto" } });
  });

  it("does not auto-link ambiguous or weak candidates, or in net-pay mode", async () => {
    // Two same-amount credits on the masked account → ambiguous.
    await credit(CHECKING, "2026-07-24", 515.15);
    await credit(CHECKING, "2026-07-25", 515.15);
    const twoOnMask = await payslip("2026-07-24", 515.15, [{ mask: "...111", amount: 515.15 }]);
    expect((await detail(twoOnMask)).depositLines[0]!.status).toBe("suggested");

    // Only candidate sits on an account that is neither the printed one nor the primary → weak.
    await credit(SAVINGS, "2026-07-24", 616.16);
    const weak = await payslip("2026-07-24", 616.16, [{ mask: "...111", amount: 616.16 }]);
    expect((await detail(weak)).depositLines[0]!.status).toBe("suggested");

    // No deposit lines → net-pay fallback suggests, never links.
    await credit(CHECKING, "2026-07-24", 717.17);
    const noLines = await payslip("2026-07-24", 717.17, null);
    const n = await detail(noLines);
    expect(n.matchMode).toBe("net_pay");
    expect(n.confirmedDeposits).toEqual([]);
  });

  it("removing an auto link leaves a tombstone the auto-linker respects; a manual relink clears it", async () => {
    const txnId = await credit(CHECKING, "2026-08-07", 818.18);
    const id = await payslip("2026-08-07", 818.18, [{ mask: "...111", amount: 818.18 }]);
    expect((await detail(id)).depositLines[0]!.status).toBe("linked");

    const del = await request(app).delete(`/payslips/${id}/deposits/${txnId}`).set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.confirmedDeposits).toEqual([]);
    const tomb = await matchRow(id, txnId);
    expect(tomb?.link_source).toBe("auto");
    expect(tomb?.dismissed_at).toBeTruthy();

    // The dismissed credit is no longer offered for this payslip, and re-running doesn't re-add it.
    expect(await autoLinkPayslipDeposits(HOUSEHOLD_ID, id)).toBe(0);
    await autoLinkDepositsForTxnDates(HOUSEHOLD_ID, ["2026-08-07"]);
    expect((await detail(id)).depositLines[0]).toMatchObject({ status: "not_found", linked: null });
    expect((await matchRow(id, txnId))?.dismissed_at).toBeTruthy();

    // Manually relinking the dismissed pair turns the tombstone back into a live, manual link.
    const put = await request(app).put(`/payslips/${id}/deposits/${txnId}`).set("authorization", `Bearer ${token}`);
    expect(put.status).toBe(200);
    expect(put.body.warning).toBeNull();
    const relinked = await matchRow(id, txnId);
    expect(relinked).toMatchObject({ link_source: "manual", dismissed_at: null });
    expect((await detail(id)).depositLines[0]).toMatchObject({ status: "linked", linked: { id: txnId, linkSource: "manual" } });

    // Removing a manual link deletes the row.
    await request(app).delete(`/payslips/${id}/deposits/${txnId}`).set("authorization", `Bearer ${token}`);
    expect(await matchRow(id, txnId)).toBeUndefined();
  });

  it("manually linking a transaction already linked to another payslip is allowed, with a warning", async () => {
    const txnId = await credit(CHECKING, "2026-08-14", 919.19);
    const first = await payslip("2026-08-14", 919.19, [{ mask: "...111", amount: 919.19 }]);
    const second = await payslip("2026-08-14", 919.19, null);
    expect((await detail(first)).depositLines[0]!.linked?.id).toBe(txnId);

    const put = await request(app).put(`/payslips/${second}/deposits/${txnId}`).set("authorization", `Bearer ${token}`);
    expect(put.status).toBe(200);
    expect(put.body.warning).toMatchObject({ code: "LINKED_TO_OTHER_PAYSLIP", otherPayslipIds: [first] });
    expect(put.body.confirmedDeposits.map((d: { id: string }) => d.id)).toEqual([txnId]);
  });

  it("an auto-link failure never fails the payslip insert or the bank import", async () => {
    // An unparseable pay date makes the matcher throw; the insert must still succeed.
    const id = await payslip("not-a-date", 100, [{ mask: "...111", amount: 100 }]);
    const row = await sqlStmt(`SELECT id FROM payslip_snapshot WHERE id = ?`).get<{ id: string }>(id);
    expect(row?.id).toBe(id);
    expect(await autoLinkPayslipDeposits(HOUSEHOLD_ID, id)).toBe(0);
    expect(await autoLinkDepositsForTxnDates(HOUSEHOLD_ID, ["garbage"])).toBe(0);
  });
});
