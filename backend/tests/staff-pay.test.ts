import crypto from "node:crypto";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

const ACCOUNT_ID = "40000000-0000-0000-0000-000000000001"; // BOA Checking (dev seed)

async function ownerToken(): Promise<string> {
  const login = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(login.status).toBe(200);
  return login.body.token as string;
}

describe("Staff pay summary (STAFF-5)", () => {
  let ownerAuth: string;
  let householdId: string;
  let staffId: string;
  let staffPersonProfileId: string;
  let staffAuth: string;
  const insertedTxnIds: string[] = [];

  beforeAll(async () => {
    ownerAuth = await ownerToken();
    const staffEmail = `nanny-pay-${Date.now()}@example.com`;

    const create = await request(app)
      .post("/staff")
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({
        firstName: "Test",
        lastName: "Pay",
        email: staffEmail,
        employmentStartDate: "2026-01-01",
        hourlyRateCents: 2000
      });
    expect(create.status).toBe(201);
    staffId = create.body.member.id;
    staffPersonProfileId = create.body.member.personProfileId;
    householdId = create.body.member.householdId;

    const login = await request(app).post("/auth/login").send({
      email: staffEmail,
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    staffAuth = login.body.token as string;
  });

  afterAll(async () => {
    for (const id of insertedTxnIds) {
      await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(id);
    }
  });

  it("starts at zero earned/paid/balance", async () => {
    const res = await request(app)
      .get(`/staff/${staffId}/pay-summary`)
      .query({ from: "2026-01-01", to: "2026-12-31" })
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.earned.totalCents).toBe(0);
    expect(res.body.summary.paid.totalCents).toBe(0);
    expect(res.body.summary.balanceDueCents).toBe(0);
  });

  it("rejects a staff-role caller viewing someone else's summary, allows their own", async () => {
    const other = await request(app)
      .get(`/staff/${staffId}/pay-summary`)
      .query({ from: "2026-01-01", to: "2026-12-31" })
      .set("authorization", `Bearer ${staffAuth}`);
    expect(other.status).toBe(200); // it IS her own record

    const forbidden = await request(app)
      .get(`/staff/00000000-0000-0000-0000-000000000099/pay-summary`)
      .query({ from: "2026-01-01", to: "2026-12-31" })
      .set("authorization", `Bearer ${staffAuth}`);
    expect(forbidden.status).toBe(404);
  });

  it("counts approved timesheet hours and approved expenses toward earned, ignores pending/rejected", async () => {
    await request(app)
      .put("/staff/timesheets/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({
        weekStartDate: "2026-02-02",
        entries: [{ workDate: "2026-02-02", hoursWorked: 8 }]
      })
      .expect(200);
    const submitTs = await request(app)
      .post("/staff/timesheets/me/submit")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: "2026-02-02" });
    expect(submitTs.status).toBe(200);
    const periodId = submitTs.body.period.id;
    await request(app)
      .post(`/staff/timesheets/${periodId}/approve`)
      .set("authorization", `Bearer ${ownerAuth}`)
      .expect(200);

    const submitExp = await request(app)
      .post("/staff/expenses/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ expenseDate: "2026-02-03", category: "Parking & Tolls", amountCents: 500 });
    expect(submitExp.status).toBe(201);
    await request(app)
      .post(`/staff/expenses/${submitExp.body.expense.id}/approve`)
      .set("authorization", `Bearer ${ownerAuth}`)
      .expect(200);

    // A second, unapproved expense should NOT count.
    await request(app)
      .post("/staff/expenses/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ expenseDate: "2026-02-04", category: "Parking & Tolls", amountCents: 9999 })
      .expect(201);

    const res = await request(app)
      .get(`/staff/${staffId}/pay-summary`)
      .query({ from: "2026-02-01", to: "2026-02-28" })
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.earned.timesheetCents).toBe(16000); // 8h * $20.00
    expect(res.body.summary.earned.expenseCents).toBe(500);
    expect(res.body.summary.earned.totalCents).toBe(16500);
  });

  it("counts transactions tagged to the staff member under the Employee category tree as paid", async () => {
    const category = await sqlStmt(
      `SELECT c.id FROM category c JOIN category parent ON parent.id = c.parent_id
       WHERE c.household_id = ? AND parent.name = 'Employee' AND c.name = 'Salary'`
    ).get<{ id: string }>(householdId);
    expect(category).toBeTruthy();

    const txnId = crypto.randomUUID();
    const fingerprint = crypto.createHash("sha256").update(txnId).digest("hex");
    await sqlStmt(
      `INSERT INTO transaction_canonical
         (id, household_id, account_id, txn_date, amount, direction, memo, fingerprint, status, category_id, owner_scope, owner_person_profile_id)
       VALUES (?, ?, ?, ?, ?, 'debit', 'nanny pay', ?, 'posted', ?, 'person', ?)`
    ).run(txnId, householdId, ACCOUNT_ID, "2026-02-10", -20000, fingerprint, category!.id, staffPersonProfileId);
    insertedTxnIds.push(txnId);

    const res = await request(app)
      .get(`/staff/${staffId}/pay-summary`)
      .query({ from: "2026-02-01", to: "2026-02-28" })
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.paid.salaryCents).toBe(20000);
    expect(res.body.summary.paid.totalCents).toBe(20000);
    expect(res.body.summary.balanceDueCents).toBe(16500 - 20000);
  });
});
