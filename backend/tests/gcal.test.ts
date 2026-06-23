import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const calendarListMock = vi.hoisted(() => vi.fn());
const eventsListMock = vi.hoisted(() => vi.fn());

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(_: unknown) {}
        async getToken(_: string) {
          return {
            tokens: {
              refresh_token: "mock-refresh-token",
              access_token: "mock-access-token",
              expiry_date: Date.now() + 3_600_000
            }
          };
        }
        generateAuthUrl(opts: Record<string, unknown>) {
          return `https://accounts.google.com/o/oauth2/auth?scope=${String(opts.scope)}&state=${String(opts.state)}`;
        }
      }
    },
    calendar: vi.fn(() => ({
      calendarList: {
        list: (...args: unknown[]) => calendarListMock(...args)
      },
      events: {
        list: (...args: unknown[]) => eventsListMock(...args)
      }
    }))
  }
}));

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();
const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "ChangeMe123!";
const SEEDED_PASSWORD_HASH = "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO";

const ADMIN_ID = "20000000-0000-0000-0000-000000000088";
const ADMIN_EMAIL = "admin-gcal@example.com";
const MEMBER_ID = "20000000-0000-0000-0000-000000000089";
const MEMBER_EMAIL = "member-gcal@example.com";

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function connectCalendar(token: string): Promise<void> {
  const res = await request(app)
    .post("/gcal/connect")
    .set("authorization", `Bearer ${token}`)
    .send({ code: "test-oauth-code" });
  expect(res.status).toBe(200);
}

describe("Google Calendar OAuth API", () => {
  beforeAll(async () => {
    await sqlStmt(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         household_id = EXCLUDED.household_id, email = EXCLUDED.email, role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash, visibility_scope = EXCLUDED.visibility_scope`
    ).run(ADMIN_ID, HOUSEHOLD_ID, ADMIN_EMAIL, "admin", SEEDED_PASSWORD_HASH, "all");

    await sqlStmt(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         household_id = EXCLUDED.household_id, email = EXCLUDED.email, role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash, visibility_scope = EXCLUDED.visibility_scope`
    ).run(MEMBER_ID, HOUSEHOLD_ID, MEMBER_EMAIL, "member", SEEDED_PASSWORD_HASH, "own");
  });

  afterAll(async () => {
    await sqlStmt(
      "DELETE FROM oauth_integrations WHERE provider = 'google_calendar' AND household_id = ?"
    ).run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM app_user WHERE id IN (?, ?)").run(ADMIN_ID, MEMBER_ID);
  });

  beforeEach(async () => {
    await sqlStmt(
      "DELETE FROM oauth_integrations WHERE provider = 'google_calendar' AND household_id = ?"
    ).run(HOUSEHOLD_ID);
    calendarListMock.mockReset();
    eventsListMock.mockReset();
  });

  // -------------------------------------------------------------------------
  // GET /gcal/status
  // -------------------------------------------------------------------------

  it("GET /gcal/status returns 401 without token", async () => {
    const res = await request(app).get("/gcal/status");
    expect(res.status).toBe(401);
  });

  it("GET /gcal/status returns 403 for member", async () => {
    const token = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gcal/status").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("GET /gcal/status returns connected:false when not connected", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gcal/status").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POST /gcal/connect
  // -------------------------------------------------------------------------

  it("POST /gcal/connect returns 401 without token", async () => {
    const res = await request(app).post("/gcal/connect").send({ code: "x" });
    expect(res.status).toBe(401);
  });

  it("POST /gcal/connect returns 403 for member", async () => {
    const token = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gcal/connect")
      .set("authorization", `Bearer ${token}`)
      .send({ code: "x" });
    expect(res.status).toBe(403);
  });

  it("POST /gcal/connect returns 200 and stores tokens for owner", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await connectCalendar(token);

    const statusRes = await request(app).get("/gcal/status").set("authorization", `Bearer ${token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.connected).toBe(true);
    expect(statusRes.body.needsReauth).toBe(false);
  });

  it("POST /gcal/connect returns 200 and stores tokens for admin", async () => {
    const token = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    await connectCalendar(token);

    const statusRes = await request(app).get("/gcal/status").set("authorization", `Bearer ${token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.connected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // DELETE /gcal/disconnect
  // -------------------------------------------------------------------------

  it("DELETE /gcal/disconnect returns 401 without token", async () => {
    const res = await request(app).delete("/gcal/disconnect");
    expect(res.status).toBe(401);
  });

  it("DELETE /gcal/disconnect clears the user token", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await connectCalendar(token);

    let statusRes = await request(app).get("/gcal/status").set("authorization", `Bearer ${token}`);
    expect(statusRes.body.connected).toBe(true);

    const disconnectRes = await request(app)
      .delete("/gcal/disconnect")
      .set("authorization", `Bearer ${token}`);
    expect(disconnectRes.status).toBe(200);
    expect(disconnectRes.body.connected).toBe(false);

    statusRes = await request(app).get("/gcal/status").set("authorization", `Bearer ${token}`);
    expect(statusRes.body.connected).toBe(false);
  });

  it("owner and admin tokens stored independently", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const adminToken = await login(ADMIN_EMAIL, OWNER_PASSWORD);

    await connectCalendar(ownerToken);
    await connectCalendar(adminToken);

    const ownerStatus = await request(app).get("/gcal/status").set("authorization", `Bearer ${ownerToken}`);
    const adminStatus = await request(app).get("/gcal/status").set("authorization", `Bearer ${adminToken}`);
    expect(ownerStatus.body.connected).toBe(true);
    expect(adminStatus.body.connected).toBe(true);

    await request(app).delete("/gcal/disconnect").set("authorization", `Bearer ${ownerToken}`);

    const ownerAfter = await request(app).get("/gcal/status").set("authorization", `Bearer ${ownerToken}`);
    const adminAfter = await request(app).get("/gcal/status").set("authorization", `Bearer ${adminToken}`);
    expect(ownerAfter.body.connected).toBe(false);
    expect(adminAfter.body.connected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // GET /gcal/events
  // -------------------------------------------------------------------------

  it("GET /gcal/events returns 409 GCAL_NOT_CONNECTED when not connected", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gcal/events").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GCAL_NOT_CONNECTED");
  });

  it("GET /gcal/events returns events after connect", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await connectCalendar(token);

    calendarListMock.mockResolvedValue({
      data: { items: [{ id: "primary", summary: "My Calendar" }] }
    });
    eventsListMock.mockResolvedValue({
      data: {
        items: [
          {
            id: "evt1",
            summary: "School pickup",
            start: { dateTime: "2026-06-25T15:00:00-05:00" },
            end: { dateTime: "2026-06-25T15:30:00-05:00" },
            location: null,
            description: null
          }
        ]
      }
    });

    const res = await request(app).get("/gcal/events?days=7").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events[0].summary).toBe("School pickup");
    expect(res.body.events[0].allDay).toBe(false);
    expect(res.body.count).toBe(1);
  });

  it("GET /gcal/events returns all-day events correctly", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await connectCalendar(token);

    calendarListMock.mockResolvedValue({
      data: { items: [{ id: "primary", summary: "My Calendar" }] }
    });
    eventsListMock.mockResolvedValue({
      data: {
        items: [
          {
            id: "evt2",
            summary: "Kid's field trip",
            start: { date: "2026-06-26" },
            end: { date: "2026-06-27" },
            location: null,
            description: null
          }
        ]
      }
    });

    const res = await request(app).get("/gcal/events?days=14").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.events[0].allDay).toBe(true);
    expect(res.body.events[0].start).toBe("2026-06-26");
  });

  it("GET /gcal/events marks needs_reauth on 401 from Google", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await connectCalendar(token);

    const { GaxiosError } = await import("gaxios");
    const config = {
      url: "https://www.googleapis.com/calendar/v3/users/me/calendarList"
    } as Parameters<typeof GaxiosError>[0];
    const response = {
      status: 401,
      statusText: "Unauthorized",
      config,
      data: {},
      headers: new Headers()
    } as Parameters<typeof GaxiosError>[2];
    calendarListMock.mockRejectedValue(new GaxiosError("Unauthorized", config, response));

    const res = await request(app).get("/gcal/events").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GCAL_NEEDS_REAUTH");

    const statusRes = await request(app).get("/gcal/status").set("authorization", `Bearer ${token}`);
    expect(statusRes.body.needsReauth).toBe(true);
  });
});
