import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp();

async function ownerToken(): Promise<string> {
  const login = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(login.status).toBe(200);
  return login.body.token as string;
}

describe("Staff expense entry + approval workflow (STAFF-4)", () => {
  let ownerAuth: string;
  let staffEmail: string;
  let staffAuth: string;

  beforeAll(async () => {
    ownerAuth = await ownerToken();
    staffEmail = `nanny-expense-${Date.now()}@example.com`;

    const create = await request(app)
      .post("/staff")
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({
        firstName: "Test",
        lastName: "Nanny",
        email: staffEmail,
        employmentStartDate: "2026-01-01",
        regularScheduleJson: { mon: 8, tue: 8 },
        hourlyRateCents: 2500
      });
    expect(create.status).toBe(201);

    const login = await request(app).post("/auth/login").send({
      email: staffEmail,
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    staffAuth = login.body.token as string;
  });

  it("staff GET /staff/expenses/me starts empty", async () => {
    const res = await request(app).get("/staff/expenses/me").set("authorization", `Bearer ${staffAuth}`);
    expect(res.status).toBe(200);
    expect(res.body.expenses).toEqual([]);
  });

  it("owner/admin routes reject a staff-role token", async () => {
    const res = await request(app).get("/staff/expenses/pending").set("authorization", `Bearer ${staffAuth}`);
    expect(res.status).toBe(403);
  });

  it("rejects an unknown category and a non-positive amount", async () => {
    const badCategory = await request(app)
      .post("/staff/expenses/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ expenseDate: "2026-02-01", category: "Not A Real Category", amountCents: 500 });
    expect(badCategory.status).toBe(400);

    const badAmount = await request(app)
      .post("/staff/expenses/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ expenseDate: "2026-02-01", category: "Groceries & Kids' Supplies", amountCents: 0 });
    expect(badAmount.status).toBe(400);
  });

  it("submits an expense as pending, immediately visible in the approval queue and rejectable with a comment", async () => {
    const submit = await request(app)
      .post("/staff/expenses/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({
        expenseDate: "2026-02-02",
        category: "Activities & Outings",
        amountCents: 4500,
        description: "Zoo tickets"
      });
    expect(submit.status).toBe(201);
    expect(submit.body.expense.status).toBe("pending");

    const mine = await request(app).get("/staff/expenses/me").set("authorization", `Bearer ${staffAuth}`);
    expect(mine.status).toBe(200);
    expect(mine.body.expenses).toHaveLength(1);

    const pending = await request(app)
      .get("/staff/expenses/pending")
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(pending.status).toBe(200);
    const found = pending.body.expenses.find((e: { id: string }) => e.id === submit.body.expense.id);
    expect(found).toBeDefined();
    expect(found.staffFullName).toBeTruthy();
    expect(found.amountCents).toBe(4500);

    const rejectNoNote = await request(app)
      .post(`/staff/expenses/${submit.body.expense.id}/reject`)
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({});
    expect(rejectNoNote.status).toBe(400);

    const reject = await request(app)
      .post(`/staff/expenses/${submit.body.expense.id}/reject`)
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({ reviewNote: "Receipt missing" });
    expect(reject.status).toBe(200);
    expect(reject.body.expense.status).toBe("rejected");
    expect(reject.body.expense.reviewNote).toBe("Receipt missing");

    const rejectAgain = await request(app)
      .post(`/staff/expenses/${submit.body.expense.id}/reject`)
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({ reviewNote: "Still no receipt" });
    expect(rejectAgain.status).toBe(409);
    expect(rejectAgain.body.code).toBe("NOT_PENDING");
  });

  it("approves a pending expense and blocks a second approval", async () => {
    const submit = await request(app)
      .post("/staff/expenses/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ expenseDate: "2026-02-03", category: "Parking & Tolls", amountCents: 800 });
    expect(submit.status).toBe(201);

    const approve = await request(app)
      .post(`/staff/expenses/${submit.body.expense.id}/approve`)
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(approve.status).toBe(200);
    expect(approve.body.expense.status).toBe("approved");

    const reapprove = await request(app)
      .post(`/staff/expenses/${submit.body.expense.id}/approve`)
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(reapprove.status).toBe(409);
    expect(reapprove.body.code).toBe("NOT_PENDING");
  });
});
