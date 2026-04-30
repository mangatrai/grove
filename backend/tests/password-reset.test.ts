import { createHash } from "node:crypto";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();
const KNOWN_EMAIL = "owner@example.com";
const KNOWN_PASSWORD = "ChangeMe123!";
const RESET_PASSWORD_1 = "ChangedPassword123!";

async function login(email = KNOWN_EMAIL, password = KNOWN_PASSWORD): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function cleanupPasswordResetRows(): Promise<void> {
  await sqlStmt(
    `
    DELETE FROM password_reset_token
    WHERE user_id = (
      SELECT id FROM app_user WHERE lower(email) = lower(?) LIMIT 1
    )
    `
  ).run(KNOWN_EMAIL);
}

function setEmailConfigForTest(): void {
  env.SMTP_HOST = "smtp.test.local";
  env.SMTP_USER = "tester";
  env.SMTP_PASS = "secret";
  env.SMTP_FROM = "Household Finance <noreply@example.com>";
  env.PUBLIC_BASE_URL = "https://finance.test.example";
}

function clearEmailConfigForTest(): void {
  env.SMTP_HOST = "";
  env.SMTP_USER = "";
  env.SMTP_PASS = "";
  env.SMTP_FROM = "";
  env.PUBLIC_BASE_URL = "";
}

async function restoreKnownPassword(): Promise<void> {
  await request(app)
    .post("/auth/change-password")
    .set("authorization", `Bearer ${await login(KNOWN_EMAIL, RESET_PASSWORD_1)}`)
    .send({ currentPassword: RESET_PASSWORD_1, newPassword: KNOWN_PASSWORD });
}

describe("password reset", () => {
  beforeEach(() => {
    clearEmailConfigForTest();
  });

  afterEach(async () => {
    clearEmailConfigForTest();
    await cleanupPasswordResetRows();
    // Restore the seed value — changePassword() always sets force_password_change=false,
    // and the "resets password" test calls restoreKnownPassword() which hits that path.
    // Without this, running the test suite leaves the owner account with the flag cleared,
    // and the first-login gate won't fire when manually testing the app afterwards.
    await sqlStmt(
      `UPDATE app_user SET force_password_change = true WHERE lower(email) = lower(?)`
    ).run(KNOWN_EMAIL);
  });

  it("GET /auth/capabilities returns emailEnabled=false in TEST mode", async () => {
    const res = await request(app).get("/auth/capabilities");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ emailEnabled: false });
  });

  it("POST /auth/forgot-password always returns 200 for unknown email", async () => {
    const res = await request(app)
      .post("/auth/forgot-password")
      .send({ email: "not-found@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If that address is registered, a reset link is on its way.");
  });

  it("POST /auth/forgot-password always returns 200 for known email", async () => {
    const res = await request(app)
      .post("/auth/forgot-password")
      .send({ email: KNOWN_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If that address is registered, a reset link is on its way.");
  });

  it("creates token row after forgot-password for known email", async () => {
    setEmailConfigForTest();
    await request(app).post("/auth/forgot-password").send({ email: KNOWN_EMAIL });

    const row = await sqlStmt<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM password_reset_token
      WHERE user_id = (SELECT id FROM app_user WHERE lower(email) = lower(?) LIMIT 1)
      `
    ).get(KNOWN_EMAIL);
    expect(Number(row?.count ?? "0")).toBe(1);
  });

  it("deletes prior unused tokens when creating a new token", async () => {
    setEmailConfigForTest();
    await request(app).post("/auth/forgot-password").send({ email: KNOWN_EMAIL });
    await request(app).post("/auth/forgot-password").send({ email: KNOWN_EMAIL });

    const rows = await sqlStmt<{ id: string }>(
      `
      SELECT id
      FROM password_reset_token
      WHERE user_id = (SELECT id FROM app_user WHERE lower(email) = lower(?) LIMIT 1)
      `
    ).all(KNOWN_EMAIL);
    expect(rows).toHaveLength(1);
  });

  it("resets password and invalidates prior JWT token", async () => {
    setEmailConfigForTest();
    const oldJwt = await login();
    await request(app).post("/auth/forgot-password").send({ email: KNOWN_EMAIL });

    const row = await sqlStmt<{ token_hash: string }>(
      `
      SELECT token_hash
      FROM password_reset_token
      WHERE user_id = (SELECT id FROM app_user WHERE lower(email) = lower(?) LIMIT 1)
      ORDER BY created_at DESC
      LIMIT 1
      `
    ).get(KNOWN_EMAIL);
    expect(row?.token_hash).toBeDefined();

    const rawToken = "placeholder-not-used-in-test";
    await sqlStmt(`UPDATE password_reset_token SET token_hash = ? WHERE token_hash = ?`).run(
      hashToken(rawToken),
      row!.token_hash
    );

    const resetRes = await request(app)
      .post("/auth/reset-password")
      .send({ token: rawToken, newPassword: RESET_PASSWORD_1 });
    expect(resetRes.status).toBe(200);

    const meRes = await request(app).get("/auth/me").set("authorization", `Bearer ${oldJwt}`);
    expect(meRes.status).toBe(401);

    const newLogin = await request(app).post("/auth/login").send({ email: KNOWN_EMAIL, password: RESET_PASSWORD_1 });
    expect(newLogin.status).toBe(200);

    await restoreKnownPassword();
    await cleanupPasswordResetRows();
  });

  it("returns INVALID_TOKEN for expired token", async () => {
    setEmailConfigForTest();
    await request(app).post("/auth/forgot-password").send({ email: KNOWN_EMAIL });
    const row = await sqlStmt<{ token_hash: string }>(
      `SELECT token_hash FROM password_reset_token ORDER BY created_at DESC LIMIT 1`
    ).get();
    const rawToken = "expired-token";
    await sqlStmt(`UPDATE password_reset_token SET token_hash = ?, expires_at = NOW() - interval '1 minute' WHERE token_hash = ?`).run(
      hashToken(rawToken),
      row!.token_hash
    );
    const res = await request(app).post("/auth/reset-password").send({ token: rawToken, newPassword: RESET_PASSWORD_1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("returns INVALID_TOKEN for already-used token", async () => {
    setEmailConfigForTest();
    await request(app).post("/auth/forgot-password").send({ email: KNOWN_EMAIL });
    const row = await sqlStmt<{ token_hash: string }>(`SELECT token_hash FROM password_reset_token ORDER BY created_at DESC LIMIT 1`).get();
    const rawToken = "used-token";
    await sqlStmt(`UPDATE password_reset_token SET token_hash = ?, used_at = NOW() WHERE token_hash = ?`).run(
      hashToken(rawToken),
      row!.token_hash
    );
    const res = await request(app).post("/auth/reset-password").send({ token: rawToken, newPassword: RESET_PASSWORD_1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("returns INVALID_TOKEN for wrong token string", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "wrong-token", newPassword: RESET_PASSWORD_1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("rejects weak password with validation error", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "some-token", newPassword: "weak" });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it("returns SAME_AS_CURRENT for unchanged password", async () => {
    setEmailConfigForTest();
    await request(app).post("/auth/forgot-password").send({ email: KNOWN_EMAIL });
    const row = await sqlStmt<{ token_hash: string }>(
      `SELECT token_hash FROM password_reset_token ORDER BY created_at DESC LIMIT 1`
    ).get();
    const rawToken = "same-as-current";
    await sqlStmt(`UPDATE password_reset_token SET token_hash = ? WHERE token_hash = ?`).run(
      hashToken(rawToken),
      row!.token_hash
    );
    const res = await request(app).post("/auth/reset-password").send({
      token: rawToken,
      newPassword: KNOWN_PASSWORD
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SAME_AS_CURRENT");
  });

  it("changePassword sends notification when email configured", async () => {
    setEmailConfigForTest();
    const token = await login();

    const changeRes = await request(app)
      .post("/auth/change-password")
      .set("authorization", `Bearer ${token}`)
      .send({ currentPassword: KNOWN_PASSWORD, newPassword: RESET_PASSWORD_1 });
    expect(changeRes.status).toBe(200);

    const updatedToken = await login(KNOWN_EMAIL, RESET_PASSWORD_1);
    const restoreRes = await request(app)
      .post("/auth/change-password")
      .set("authorization", `Bearer ${updatedToken}`)
      .send({ currentPassword: RESET_PASSWORD_1, newPassword: KNOWN_PASSWORD });
    expect(restoreRes.status).toBe(200);
  });

});
