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

describe("Staff PDF reports (STAFF-6)", () => {
  let ownerAuth: string;
  let staffId: string;
  let staffAuth: string;

  beforeAll(async () => {
    ownerAuth = await ownerToken();
    const staffEmail = `nanny-reports-${Date.now()}@example.com`;

    const create = await request(app)
      .post("/staff")
      .set("authorization", `Bearer ${ownerAuth}`)
      .send({
        firstName: "Test",
        lastName: "Reports",
        email: staffEmail,
        employmentStartDate: "2026-01-01",
        hourlyRateCents: 2000
      });
    expect(create.status).toBe(201);
    staffId = create.body.member.id;

    const login = await request(app).post("/auth/login").send({
      email: staffEmail,
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    staffAuth = login.body.token as string;

    await request(app)
      .put("/staff/timesheets/me")
      .set("authorization", `Bearer ${staffAuth}`)
      .send({
        weekStartDate: "2026-02-02",
        entries: [{ workDate: "2026-02-02", hoursWorked: 8, note: "test note" }]
      })
      .expect(200);
  });

  it("streams an hours-report PDF for the owner and includes a filename", async () => {
    const res = await request(app)
      .get(`/staff/${staffId}/reports/hours`)
      .query({ from: "2026-02-01", to: "2026-02-28" })
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("hours-report");
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("streams a payment-report PDF for the owner", async () => {
    const res = await request(app)
      .get(`/staff/${staffId}/reports/payment`)
      .query({ from: "2026-02-01", to: "2026-02-28" })
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("payment-report");
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("lets a staff member download her own reports", async () => {
    const hours = await request(app)
      .get(`/staff/${staffId}/reports/hours`)
      .query({ from: "2026-02-01", to: "2026-02-28" })
      .set("authorization", `Bearer ${staffAuth}`);
    expect(hours.status).toBe(200);

    const payment = await request(app)
      .get(`/staff/${staffId}/reports/payment`)
      .query({ from: "2026-02-01", to: "2026-02-28" })
      .set("authorization", `Bearer ${staffAuth}`);
    expect(payment.status).toBe(200);
  });

  it("blocks a staff member from downloading another staff member's reports", async () => {
    const res = await request(app)
      .get(`/staff/00000000-0000-0000-0000-000000000099/reports/hours`)
      .query({ from: "2026-02-01", to: "2026-02-28" })
      .set("authorization", `Bearer ${staffAuth}`);
    expect(res.status).toBe(404);
  });

  it("rejects malformed date-range query params", async () => {
    const res = await request(app)
      .get(`/staff/${staffId}/reports/hours`)
      .query({ from: "not-a-date", to: "2026-02-28" })
      .set("authorization", `Bearer ${ownerAuth}`);
    expect(res.status).toBe(400);
  });
});
