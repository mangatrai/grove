import { randomUUID } from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();
const KNOWN_EMAIL = "owner@example.com";
const KNOWN_PASSWORD = "ChangeMe123!";

async function loginOwner(password = KNOWN_PASSWORD): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email: KNOWN_EMAIL, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
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

async function ownerProfileId(): Promise<string> {
  const row = await sqlStmt<{ id: string }>(
    `
    SELECT p.id
    FROM person_profile p
    JOIN app_user u ON u.id = p.linked_user_id
    WHERE lower(u.email) = lower(?)
    LIMIT 1
    `
  ).get(KNOWN_EMAIL);
  if (!row?.id) {
    throw new Error("Owner profile not found");
  }
  return row.id;
}

async function cleanupOwnerPasswordResetRows(): Promise<void> {
  await sqlStmt(
    `
    DELETE FROM password_reset_token
    WHERE user_id = (
      SELECT id FROM app_user WHERE lower(email) = lower(?) LIMIT 1
    )
    `
  ).run(KNOWN_EMAIL);
}

afterEach(async () => {
  clearEmailConfigForTest();
  await cleanupOwnerPasswordResetRows();
  await sqlStmt(
    `UPDATE app_user SET force_password_change = true WHERE lower(email) = lower(?)`
  ).run(KNOWN_EMAIL);
});

describe("member invite + admin reset email flows", () => {
  it("createHouseholdMember with createLogin=true sends invite token when email configured", async () => {
    setEmailConfigForTest();
    const token = await loginOwner();
    const memberEmail = `invite-inline-${randomUUID()}@example.com`;

    const createMemberRes = await request(app)
      .post("/household/members")
      .set("authorization", `Bearer ${token}`)
      .send({
        firstName: "Inline",
        lastName: "Invite",
        email: memberEmail,
        role: "member",
        relationship: "other",
        createLogin: true
      });
    expect(createMemberRes.status).toBe(201);
    expect(createMemberRes.body.inviteSent).toBe(true);

    const memberId = (createMemberRes.body.member as { id: string }).id;
    const linked = await sqlStmt<{ linked_user_id: string | null }>(
      `SELECT linked_user_id FROM person_profile WHERE id = ? LIMIT 1`
    ).get(memberId);
    expect(linked?.linked_user_id).toBeTruthy();
    const linkedUserId = linked!.linked_user_id!;

    const tokenRow = await sqlStmt<{ cnt: string; ttl_hours: string }>(
      `
      SELECT COUNT(*)::text AS cnt,
             ROUND(EXTRACT(EPOCH FROM (MAX(expires_at) - NOW())) / 3600.0, 2)::text AS ttl_hours
      FROM password_reset_token
      WHERE user_id = ?
      `
    ).get(linkedUserId);
    expect(Number(tokenRow?.cnt ?? "0")).toBe(1);
    expect(Number(tokenRow?.ttl_hours ?? "0")).toBeGreaterThan(23);
    expect(Number(tokenRow?.ttl_hours ?? "0")).toBeLessThanOrEqual(24);

    await sqlStmt(`DELETE FROM password_reset_token WHERE user_id = ?`).run(linkedUserId);
    await sqlStmt(`DELETE FROM household_membership WHERE household_id = ? AND person_profile_id = ?`).run(
      "10000000-0000-0000-0000-000000000001",
      memberId
    );
    await sqlStmt(`DELETE FROM person_profile WHERE household_id = ? AND id = ?`).run(
      "10000000-0000-0000-0000-000000000001",
      memberId
    );
    await sqlStmt(`DELETE FROM app_user WHERE household_id = ? AND id = ?`).run(
      "10000000-0000-0000-0000-000000000001",
      linkedUserId
    );
  });

  it("createLoginForMember sends invite token when email configured", async () => {
    setEmailConfigForTest();
    const token = await loginOwner();
    const memberEmail = `invite-${randomUUID()}@example.com`;

    const createMemberRes = await request(app)
      .post("/household/members")
      .set("authorization", `Bearer ${token}`)
      .send({
        firstName: "Invite",
        lastName: "Target",
        email: memberEmail,
        role: "member",
        relationship: "other",
        createLogin: false
      });
    expect(createMemberRes.status).toBe(201);

    const memberId = (createMemberRes.body.member as { id: string }).id;
    const createLoginRes = await request(app)
      .post(`/household/members/${encodeURIComponent(memberId)}/create-login`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(createLoginRes.status).toBe(201);
    expect(createLoginRes.body.inviteSent).toBe(true);

    const linked = await sqlStmt<{ linked_user_id: string | null }>(
      `SELECT linked_user_id FROM person_profile WHERE id = ? LIMIT 1`
    ).get(memberId);
    expect(linked?.linked_user_id).toBeTruthy();
    const linkedUserId = linked!.linked_user_id!;

    const tokenRow = await sqlStmt<{ cnt: string; ttl_hours: string }>(
      `
      SELECT COUNT(*)::text AS cnt,
             ROUND(EXTRACT(EPOCH FROM (MAX(expires_at) - NOW())) / 3600.0, 2)::text AS ttl_hours
      FROM password_reset_token
      WHERE user_id = ?
      `
    ).get(linkedUserId);
    expect(Number(tokenRow?.cnt ?? "0")).toBe(1);
    expect(Number(tokenRow?.ttl_hours ?? "0")).toBeGreaterThan(23);
    expect(Number(tokenRow?.ttl_hours ?? "0")).toBeLessThanOrEqual(24);

    await sqlStmt(`DELETE FROM password_reset_token WHERE user_id = ?`).run(linkedUserId);
    await sqlStmt(`DELETE FROM household_membership WHERE household_id = ? AND person_profile_id = ?`).run(
      "10000000-0000-0000-0000-000000000001",
      memberId
    );
    await sqlStmt(`DELETE FROM person_profile WHERE household_id = ? AND id = ?`).run(
      "10000000-0000-0000-0000-000000000001",
      memberId
    );
    await sqlStmt(`DELETE FROM app_user WHERE household_id = ? AND id = ?`).run(
      "10000000-0000-0000-0000-000000000001",
      linkedUserId
    );
  });

  it("resetMemberPassword sends reset token when email configured", async () => {
    setEmailConfigForTest();
    const token = await loginOwner();
    const profileId = await ownerProfileId();

    const resetRes = await request(app)
      .post(`/household/members/${encodeURIComponent(profileId)}/reset-password`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.emailSent).toBe(true);
    expect(resetRes.body.tempPassword).toBeUndefined();

    const ownerTokenRows = await sqlStmt<{ cnt: string }>(
      `
      SELECT COUNT(*)::text AS cnt
      FROM password_reset_token
      WHERE user_id = (SELECT id FROM app_user WHERE lower(email) = lower(?) LIMIT 1)
      `
    ).get(KNOWN_EMAIL);
    expect(Number(ownerTokenRows?.cnt ?? "0")).toBe(1);

    await cleanupOwnerPasswordResetRows();
  });

  it("resetMemberPassword returns tempPassword when email not configured", async () => {
    clearEmailConfigForTest();
    const token = await loginOwner();
    const profileId = await ownerProfileId();

    const resetRes = await request(app)
      .post(`/household/members/${encodeURIComponent(profileId)}/reset-password`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.emailSent).toBe(false);
    expect(typeof resetRes.body.tempPassword).toBe("string");
    expect(resetRes.body.tempPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    const tempLogin = await loginOwner(resetRes.body.tempPassword as string);
    const restoreRes = await request(app)
      .post("/auth/change-password")
      .set("authorization", `Bearer ${tempLogin}`)
      .send({
        currentPassword: resetRes.body.tempPassword,
        newPassword: KNOWN_PASSWORD
      });
    expect(restoreRes.status).toBe(200);
  });

  it("delete member enforces login guard and deleteLogin path", async () => {
    clearEmailConfigForTest();
    const token = await loginOwner();
    const memberEmail = `delete-flow-${randomUUID()}@example.com`;

    const createMemberRes = await request(app)
      .post("/household/members")
      .set("authorization", `Bearer ${token}`)
      .send({
        firstName: "Delete",
        lastName: "Flow",
        email: memberEmail,
        role: "member",
        relationship: "other",
        createLogin: true
      });
    expect(createMemberRes.status).toBe(201);
    expect(createMemberRes.body.inviteSent).toBe(false);

    const memberId = (createMemberRes.body.member as { id: string }).id;
    const linked = await sqlStmt<{ linked_user_id: string | null }>(
      `SELECT linked_user_id FROM person_profile WHERE id = ? LIMIT 1`
    ).get(memberId);
    expect(linked?.linked_user_id).toBeTruthy();
    const linkedUserId = linked!.linked_user_id!;

    const blockedDeleteRes = await request(app)
      .delete(`/household/members/${encodeURIComponent(memberId)}`)
      .set("authorization", `Bearer ${token}`)
      .send({ deleteLogin: false });
    expect(blockedDeleteRes.status).toBe(409);
    expect(blockedDeleteRes.body.code).toBe("HAS_LOGIN_ACCOUNT");

    const stillExists = await sqlStmt<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM person_profile WHERE household_id = ? AND id = ?`
    ).get("10000000-0000-0000-0000-000000000001", memberId);
    expect(Number(stillExists?.cnt ?? "0")).toBe(1);

    const deleteWithLoginRes = await request(app)
      .delete(`/household/members/${encodeURIComponent(memberId)}`)
      .set("authorization", `Bearer ${token}`)
      .send({ deleteLogin: true });
    expect(deleteWithLoginRes.status).toBe(204);

    const userCount = await sqlStmt<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM app_user WHERE household_id = ? AND id = ?`
    ).get("10000000-0000-0000-0000-000000000001", linkedUserId);
    expect(Number(userCount?.cnt ?? "0")).toBe(0);
  });
});
