import { randomUUID } from "node:crypto";

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

function mondayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const THIS_WEEK = mondayIso(new Date().toISOString().slice(0, 10));
const NEXT_WEEK = addDays(THIS_WEEK, 7);

describe("Staff timesheet entry + approval workflow (STAFF-3)", () => {
  let ownerAuth: string;
  let staffEmail: string;
  let staffAuth: string;
  let staffId: string;

  beforeAll(async () => {
    ownerAuth = await ownerToken();
    staffEmail = `nanny-${Date.now()}@example.com`;

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
    expect(create.body.inviteSent).toBe(false); // no SMTP configured in test env
    staffId = create.body.member.id as string;

    const login = await request(app).post("/auth/login").send({
      email: staffEmail,
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    staffAuth = login.body.token as string;
  });

  it("staff GET /staff/timesheets/me for a fresh week returns scheduledHours computed from household_help_availability", async () => {
    const res = await request(app)
      .get(`/staff/timesheets/me?weekStart=${THIS_WEEK}`)
      .set("authorization", `Bearer ${staffAuth}`);
    expect(res.status).toBe(200);
    expect(res.body.period.status).toBe("draft");
    expect(res.body.period.weekStartDate).toBe(THIS_WEEK);
    expect(res.body.period.entries).toEqual([]); // prefill is a frontend-only convenience; nothing persisted yet
    expect(res.body.scheduledHours).toEqual({
      [THIS_WEEK]: 8,
      [addDays(THIS_WEEK, 1)]: 8
    });
  });

  it("owner/admin GET /staff/timesheets/me?staffId= selects the given staff member's timesheet", async () => {
    const res = await request(app)
      .get(`/staff/timesheets/me?weekStart=${THIS_WEEK}&staffId=${staffId}`)
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(200);
    expect(res.body.period.weekStartDate).toBe(THIS_WEEK);
  });

  it("owner/admin GET /staff/timesheets/me without staffId is rejected", async () => {
    const res = await request(app)
      .get(`/staff/timesheets/me?weekStart=${THIS_WEEK}`)
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(404);
  });

  it("a staff-role token cannot select a different staffId than its own", async () => {
    const res = await request(app)
      .get(`/staff/timesheets/me?weekStart=${THIS_WEEK}&staffId=${randomUUID()}`)
      .set("authorization", `Bearer ${staffAuth}`);
    expect(res.status).toBe(404);
  });

  it("owner/admin routes reject a staff-role token", async () => {
    const res = await request(app).get("/staff/timesheets/pending").set("authorization", `Bearer ${staffAuth}`);
    expect(res.status).toBe(403);
  });

  it("saves draft entries, rejects a workDate outside the week, and blocks submit with zero hours", async () => {
    const badDate = await request(app)
      .put("/staff/timesheets/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: THIS_WEEK, entries: [{ workDate: addDays(THIS_WEEK, 10), hoursWorked: 4 }] });
    expect(badDate.status).toBe(400);
    expect(badDate.body.code).toBe("INVALID_DATE");

    const emptySubmit = await request(app)
      .post("/staff/timesheets/me/submit")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: THIS_WEEK });
    expect(emptySubmit.status).toBe(409);
    expect(emptySubmit.body.code).toBe("EMPTY");

    const save = await request(app)
      .put("/staff/timesheets/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({
        weekStartDate: THIS_WEEK,
        entries: [
          { workDate: THIS_WEEK, hoursWorked: 8, note: "Full day" },
          { workDate: addDays(THIS_WEEK, 1), hoursWorked: 6.5 }
        ]
      });
    expect(save.status).toBe(200);
    expect(save.body.period.totalHours).toBe(14.5);
    expect(save.body.period.status).toBe("draft");
  });

  it("submit → owner approval queue → approve", async () => {
    const submit = await request(app)
      .post("/staff/timesheets/me/submit")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: THIS_WEEK });
    expect(submit.status).toBe(200);
    expect(submit.body.period.status).toBe("submitted");

    const editWhileSubmitted = await request(app)
      .put("/staff/timesheets/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: THIS_WEEK, entries: [{ workDate: THIS_WEEK, hoursWorked: 1 }] });
    expect(editWhileSubmitted.status).toBe(409);
    expect(editWhileSubmitted.body.code).toBe("NOT_EDITABLE");

    const pending = await request(app)
      .get("/staff/timesheets/pending")
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(pending.status).toBe(200);
    const entry = pending.body.periods.find((p: { weekStartDate: string }) => p.weekStartDate === THIS_WEEK);
    expect(entry).toBeDefined();
    expect(entry.totalHours).toBe(14.5);

    const approve = await request(app)
      .post(`/staff/timesheets/${entry.id}/approve`)
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(approve.status).toBe(200);
    expect(approve.body.period.status).toBe("approved");

    const reapprove = await request(app)
      .post(`/staff/timesheets/${entry.id}/approve`)
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(reapprove.status).toBe(409);
    expect(reapprove.body.code).toBe("NOT_SUBMITTED");
  });

  it("reject-with-comment returns the period to rejected status, editable, and clears the note on resubmit", async () => {
    await request(app)
      .put("/staff/timesheets/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: NEXT_WEEK, entries: [{ workDate: NEXT_WEEK, hoursWorked: 5 }] });
    const submit = await request(app)
      .post("/staff/timesheets/me/submit")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: NEXT_WEEK });
    expect(submit.status).toBe(200);
    const periodId = submit.body.period.id as string;

    const rejectNoNote = await request(app)
      .post(`/staff/timesheets/${periodId}/reject`)
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({});
    expect(rejectNoNote.status).toBe(400);

    const reject = await request(app)
      .post(`/staff/timesheets/${periodId}/reject`)
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({ reviewNote: "Please double-check Tuesday's hours" });
    expect(reject.status).toBe(200);
    expect(reject.body.period.status).toBe("rejected");
    expect(reject.body.period.reviewNote).toBe("Please double-check Tuesday's hours");

    const editAfterReject = await request(app)
      .put("/staff/timesheets/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: NEXT_WEEK, entries: [{ workDate: NEXT_WEEK, hoursWorked: 5.5 }] });
    expect(editAfterReject.status).toBe(200);
    expect(editAfterReject.body.period.status).toBe("rejected");

    const resubmit = await request(app)
      .post("/staff/timesheets/me/submit")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({ weekStartDate: NEXT_WEEK });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.period.status).toBe("submitted");
    expect(resubmit.body.period.reviewNote).toBeNull();
  });

});
