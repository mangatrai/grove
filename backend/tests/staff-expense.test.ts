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
  let staffId: string;
  let staffPersonProfileId: string;

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
        schedule: { daysOfWeek: [1, 2], startTime: "09:00", endTime: "17:00" },
        hourlyRateCents: 2500
      });
    expect(create.status).toBe(201);
    staffId = create.body.member.id as string;
    staffPersonProfileId = create.body.member.personProfileId as string;

    const login = await request(app).post("/auth/login").send({
      email: staffEmail,
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    staffAuth = login.body.token as string;
  });

  it("(STAFF-17) persists the schedule given at staff creation, not just the staff record", async () => {
    const res = await request(app).get("/api/family/availability").set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(200);
    const slot = (res.body.slots as Array<{ personProfileId: string; slotType: string; daysOfWeek: number[] }>).find(
      (s) => s.personProfileId === staffPersonProfileId && s.slotType === "regular"
    );
    expect(slot).toBeDefined();
    expect(slot!.daysOfWeek).toEqual([1, 2]);
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

  it("owner/admin can select a staff member via ?staffId= and submit a claim through the shared /me route", async () => {
    const ownerMissingStaffId = await request(app)
      .get("/staff/expenses/me")
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(ownerMissingStaffId.status).toBe(404);

    const submit = await request(app)
      .post("/staff/expenses/me")
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({ expenseDate: "2026-02-04", category: "Medical/First Aid", amountCents: 1200, description: "First-aid kit", staffId });
    expect(submit.status).toBe(201);
    expect(submit.body.expense.status).toBe("pending");

    const fetch = await request(app)
      .get(`/staff/expenses/me?staffId=${staffId}`)
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(fetch.status).toBe(200);
    expect(fetch.body.expenses.some((e: { id: string }) => e.id === submit.body.expense.id)).toBe(true);

    const unknownStaff = await request(app)
      .get("/staff/expenses/me?staffId=00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(unknownStaff.status).toBe(404);
  });

  it("a staff-role token cannot select a different staffId than its own", async () => {
    const foreignStaffId = await request(app)
      .get("/staff/expenses/me?staffId=00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${staffAuth}`);
    expect(foreignStaffId.status).toBe(404);

    const ownStaffId = await request(app)
      .get(`/staff/expenses/me?staffId=${staffId}`)
      .set("authorization", `Bearer ${staffAuth}`);
    expect(ownStaffId.status).toBe(200);
  });
});
