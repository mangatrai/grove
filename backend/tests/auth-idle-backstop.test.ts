import crypto from "node:crypto";

import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { _resetActivityTrackerForTests } from "../src/modules/auth/activity-tracker.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

describe("auth idle backstop — Layer 2 server-side guarantee (FIX #221)", () => {
  const householdId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `fix221-${Date.now()}@example.com`;
  const password = "ChangeMe123!";
  let token: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    await sqlStmt(
      `INSERT INTO household (id, name, owner_user_id, employers_json) VALUES (?, 'FIX-221 Household', NULL, '[]')`
    ).run(householdId);
    await sqlStmt(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope)
       VALUES (?, ?, ?, 'owner', ?, 'own')`
    ).run(userId, householdId, email, passwordHash);
    await sqlStmt(`UPDATE household SET owner_user_id = ? WHERE id = ?`).run(userId, householdId);

    const login = await request(app).post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    token = login.body.token as string;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a background poll while the session was recently active (login itself counts)", async () => {
    const res = await request(app)
      .get("/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`)
      .set("x-background-poll", "1");
    expect(res.status).toBe(200);
  });

  it("rejects a background poll once the tracked session has been idle past 15 minutes", async () => {
    _resetActivityTrackerForTests();

    // Simulate a real (non-background) request made 16 minutes ago by rewinding only Date,
    // so the timer-driven parts of the stack (supertest, DB pool) keep using real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 16 * 60 * 1000);
    const seed = await request(app).get("/notifications").set("Authorization", `Bearer ${token}`);
    expect(seed.status).toBe(200);
    vi.useRealTimers();

    const poll = await request(app)
      .get("/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`)
      .set("x-background-poll", "1");
    expect(poll.status).toBe(401);
    expect(poll.body.code).toBe("token_stale");
  });

  it("a real (non-background) request always succeeds and refreshes the activity window", async () => {
    const real = await request(app).get("/notifications").set("Authorization", `Bearer ${token}`);
    expect(real.status).toBe(200);

    const poll = await request(app)
      .get("/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`)
      .set("x-background-poll", "1");
    expect(poll.status).toBe(200);
  });
});
