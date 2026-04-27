import crypto from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildApp } from "../src/app.js";
import { resolveDataPath } from "../src/paths.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

/** Seeded in `seeds/dev/dev_0002_seed_financial_accounts.sql` */
const SEED_BOA_CHECKING = "40000000-0000-0000-0000-000000000001";
const SEED_CHASE_CC = "40000000-0000-0000-0000-000000000005";
const SEED_MARCUS_SAVINGS = "40000000-0000-0000-0000-000000000006";

describe("app health", () => {
  it("returns ok from health endpoint", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("auth and rbac baseline", () => {
  it("returns token for seeded owner account", async () => {
    const response = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe("string");
  });

  it("blocks protected endpoint without token", async () => {
    const response = await request(app).get("/auth/me");

    expect(response.status).toBe(401);
  });

  it("blocks member access to household management routes", async () => {
    await sqlStmt(
      `INSERT INTO app_user
       (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         household_id = EXCLUDED.household_id,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash,
         visibility_scope = EXCLUDED.visibility_scope`
    ).run(
      "20000000-0000-0000-0000-000000000099",
      "10000000-0000-0000-0000-000000000001",
      "member@example.com",
      "member",
      "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO",
      "own"
    );

    const login = await request(app).post("/auth/login").send({
      email: "member@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    const membersRes = await request(app)
      .get("/household/members")
      .set("authorization", `Bearer ${token}`);
    expect(membersRes.status).toBe(403);

    const patchRes = await request(app)
      .patch("/household/settings")
      .set("authorization", `Bearer ${token}`)
      .send({ monthlySavingsTargetUsd: 100 });
    expect(patchRes.status).toBe(403);

    // Members CAN create categories (member-scoped RBAC, Slice 2)
    const categoryCreateRes = await request(app)
      .post("/categories")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "MemberTestCategory" });
    expect(categoryCreateRes.status).toBe(201);

    // Members CANNOT create category rules (blocked)
    const ruleCreateRes = await request(app)
      .post("/categories/rules")
      .set("authorization", `Bearer ${token}`)
      .send({ pattern: "test", matchType: "contains", categoryId: "00000000-0000-0000-0000-000000000001" });
    expect(ruleCreateRes.status).toBe(403);

    // Members with no linked person profile CANNOT create import sessions (profile required, CR-109 Slice 3)
    const importSessionRes = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    expect(importSessionRes.status).toBe(403);

    // Members CANNOT create accounts when not linked to a person profile
    const accountCreateRes = await request(app)
      .post("/imports/accounts")
      .set("authorization", `Bearer ${token}`)
      .send({ type: "checking", institution: "Test Bank" });
    expect(accountCreateRes.status).toBe(403);

    // Members CANNOT start a household export (blocked)
    const exportStartRes = await request(app)
      .post("/exports/household")
      .set("authorization", `Bearer ${token}`);
    expect(exportStartRes.status).toBe(403);

    // Members CANNOT restore from backup (blocked, owner only)
    const restoreRes = await request(app)
      .post("/exports/household/import")
      .set("authorization", `Bearer ${token}`);
    expect(restoreRes.status).toBe(403);
  });
});

describe("household profiles and members", () => {
  async function loginAndGetToken(email = "owner@example.com", password = "ChangeMe123!"): Promise<string> {
    const response = await request(app).post("/auth/login").send({
      email,
      password
    });
    expect(response.status).toBe(200);
    return response.body.token as string;
  }

  it("reads and updates current profile fields", async () => {
    const token = await loginAndGetToken();

    const getProfile = await request(app).get("/household/profile").set("authorization", `Bearer ${token}`);
    expect(getProfile.status).toBe(200);
    expect(getProfile.body.profile).toMatchObject({
      id: expect.any(String),
      householdId: "10000000-0000-0000-0000-000000000001",
      role: expect.any(String),
      relationship: expect.any(String)
    });

    const patchProfile = await request(app)
      .patch("/household/profile")
      .set("authorization", `Bearer ${token}`)
      .send({
        fullName: "Owner Test Name",
        phoneNumber: "+1-555-0100",
        avatarKey: "avatars/owner-test.png"
      });
    expect(patchProfile.status).toBe(200);
    expect(patchProfile.body.profile.fullName).toBe("Owner Test Name");
    expect(patchProfile.body.profile.phoneNumber).toBe("+1-555-0100");
    expect(patchProfile.body.profile.avatarKey).toBe("avatars/owner-test.png");
  });

  it("lists, creates and updates members and enforces household scope", async () => {
    const token = await loginAndGetToken();

    const listBefore = await request(app).get("/household/members").set("authorization", `Bearer ${token}`);
    expect(listBefore.status).toBe(200);
    expect(Array.isArray(listBefore.body.members)).toBe(true);
    const initialCount = listBefore.body.members.length as number;

    const createMember = await request(app)
      .post("/household/members")
      .set("authorization", `Bearer ${token}`)
      .send({
        fullName: "Kid One",
        email: "kid.one@example.com",
        phoneNumber: "555-0199",
        avatarKey: "avatars/kid-1.png",
        role: "member",
        relationship: "child"
      });
    expect(createMember.status).toBe(201);
    const createdMemberId = createMember.body.member.id as string;
    expect(createMember.body.member.fullName).toBe("Kid One");
    expect(createMember.body.member.relationship).toBe("child");

    const listAfter = await request(app).get("/household/members").set("authorization", `Bearer ${token}`);
    expect(listAfter.status).toBe(200);
    expect(listAfter.body.members.length).toBe(initialCount + 1);

    const patchMember = await request(app)
      .patch(`/household/members/${createdMemberId}`)
      .set("authorization", `Bearer ${token}`)
      .send({
        fullName: "Kid One Updated",
        role: "head",
        relationship: "other"
      });
    expect(patchMember.status).toBe(200);
    expect(patchMember.body.member.fullName).toBe("Kid One Updated");
    expect(patchMember.body.member.role).toBe("head");
    expect(patchMember.body.member.relationship).toBe("other");

    const otherHouseholdId = crypto.randomUUID();
    const otherProfileId = crypto.randomUUID();
    const otherMembershipId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO household (id, name, created_at)
       VALUES (?, 'Other household for profile scope', CURRENT_TIMESTAMP)`
    ).run(otherHouseholdId);
    await sqlStmt(
      `INSERT INTO person_profile (id, household_id, full_name, email)
       VALUES (?, ?, 'Other Member', 'other.member@example.com')`
    ).run(otherProfileId, otherHouseholdId);
    await sqlStmt(
      `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
       VALUES (?, ?, ?, 'member', 'other')`
    ).run(otherMembershipId, otherHouseholdId, otherProfileId);

    const crossHouseholdPatch = await request(app)
      .patch(`/household/members/${otherProfileId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ fullName: "Should Not Update" });
    expect(crossHouseholdPatch.status).toBe(404);
  });
});

describe("auth change password", () => {
  it("changes password, rejects invalid current password, and supports login with new password", async () => {
    const householdId = "10000000-0000-0000-0000-000000000001";
    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const email = `change-password-${crypto.randomUUID()}@example.com`;
    const oldPassword = "TempOldPass123!";
    const newPassword = "TempNewPass456!";

    await sqlStmt(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, 'member', ?, 'own', CURRENT_TIMESTAMP)`
    ).run(userId, householdId, email, bcrypt.hashSync(oldPassword, 10));
    await sqlStmt(
      `INSERT INTO person_profile (id, household_id, linked_user_id, full_name, email)
       VALUES (?, ?, ?, 'Temp User', ?)`
    ).run(profileId, householdId, userId, email);
    await sqlStmt(
      `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
       VALUES (?, ?, ?, 'member', 'other')`
    ).run(membershipId, householdId, profileId);

    const loginOld = await request(app).post("/auth/login").send({
      email,
      password: oldPassword
    });
    expect(loginOld.status).toBe(200);
    const token = loginOld.body.token as string;

    const badCurrent = await request(app)
      .post("/auth/change-password")
      .set("authorization", `Bearer ${token}`)
      .send({
        currentPassword: "WrongCurrent123!",
        newPassword
      });
    expect(badCurrent.status).toBe(400);
    expect(badCurrent.body.code).toBe("INVALID_CURRENT_PASSWORD");

    const sameAsCurrent = await request(app)
      .post("/auth/change-password")
      .set("authorization", `Bearer ${token}`)
      .send({
        currentPassword: oldPassword,
        newPassword: oldPassword
      });
    expect(sameAsCurrent.status).toBe(400);
    expect(sameAsCurrent.body.code).toBe("SAME_AS_CURRENT");

    const changeOk = await request(app)
      .post("/auth/change-password")
      .set("authorization", `Bearer ${token}`)
      .send({
        currentPassword: oldPassword,
        newPassword
      });
    expect(changeOk.status).toBe(200);

    const staleTokenMe = await request(app).get("/auth/me").set("authorization", `Bearer ${token}`);
    expect(staleTokenMe.status).toBe(401);

    const loginOldAfter = await request(app).post("/auth/login").send({
      email,
      password: oldPassword
    });
    expect(loginOldAfter.status).toBe(401);

    const loginNewAfter = await request(app).post("/auth/login").send({
      email,
      password: newPassword
    });
    expect(loginNewAfter.status).toBe(200);
    expect(typeof loginNewAfter.body.token).toBe("string");
  });
});

describe("import sessions and file intake", () => {
  async function bindImportFile(
    token: string,
    sessionId: string,
    fileId: string,
    financialAccountId: string,
    parserProfileId: string
  ): Promise<void> {
    const res = await request(app)
      .patch(`/imports/sessions/${sessionId}/files/${fileId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ financialAccountId, parserProfileId });
    expect(res.status).toBe(200);
  }

  async function loginAndGetToken(): Promise<string> {
    const response = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(response.status).toBe(200);
    return response.body.token as string;
  }

  it("creates an import session and uploads files with checksum", async () => {
    const token = await loginAndGetToken();

    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });

    expect(sessionResponse.status).toBe(201);
    const sessionId = sessionResponse.body.session.id as string;
    expect(sessionId).toBeTruthy();

    const uploadResponse = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from("row1,row2"), "statement.csv")
      .attach("files", Buffer.from("fake pdf data"), "card-statement.pdf");

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.files.length).toBe(2);
    expect(uploadResponse.body.files[0].checksum).toMatch(/^[a-f0-9]{64}$/);

    const fetchResponse = await request(app)
      .get(`/imports/sessions/${sessionId}`)
      .set("authorization", `Bearer ${token}`);

    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.body.session.status).toBe("processing");
    expect(fetchResponse.body.files.length).toBe(2);

    const listRes = await request(app).get("/imports/sessions").set("authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.sessions)).toBe(true);
    expect(listRes.body.sessions.some((s: { id: string }) => s.id === sessionId)).toBe(true);
  });

  it("deletes a staged import file from the session", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    expect(sessionResponse.status).toBe(201);
    const sessionId = sessionResponse.body.session.id as string;

    const uploadResponse = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from("row1,row2"), "statement.csv")
      .attach("files", Buffer.from("other"), "other.csv");

    expect(uploadResponse.status).toBe(201);
    const fileId = uploadResponse.body.files[0].id as string;

    const delRes = await request(app)
      .delete(`/imports/sessions/${sessionId}/files/${fileId}`)
      .set("authorization", `Bearer ${token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted).toBe(true);

    const fetchResponse = await request(app)
      .get(`/imports/sessions/${sessionId}`)
      .set("authorization", `Bearer ${token}`);
    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.body.files.length).toBe(1);
  });

  it("enforces session status transition order", async () => {
    const token = await loginAndGetToken();

    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const invalidTransition = await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "finalized" });

    expect(invalidTransition.status).toBe(409);

    const toProcessing = await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "processing" });
    expect(toProcessing.status).toBe(200);

    const toReview = await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "review" });
    expect(toReview.status).toBe(200);

    const toFinalized = await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "finalized" });
    expect(toFinalized.status).toBe(200);
  });

  it("returns 404 for unknown session id", async () => {
    const token = await loginAndGetToken();
    const response = await request(app)
      .get("/imports/sessions/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
  });

  it("returns 404 when session belongs to another household", async () => {
    const token = await loginAndGetToken();
    const otherHouseholdId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO household (id, name, created_at)
       VALUES (?, 'Other household', CURRENT_TIMESTAMP)`
    ).run(otherHouseholdId);
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'created', CURRENT_TIMESTAMP)`
    ).run(otherSessionId, otherHouseholdId);

    const getRes = await request(app)
      .get(`/imports/sessions/${otherSessionId}`)
      .set("authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/imports/sessions/${otherSessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "processing" });
    expect(patchRes.status).toBe(404);

    const uploadRes = await request(app)
      .post(`/imports/sessions/${otherSessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from("x"), "a.txt");
    expect(uploadRes.status).toBe(404);
  });

  it("returns 400 for invalid status patch body", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const bad = await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "not-a-status" });
    expect(bad.status).toBe(400);
  });

  it("skips duplicate checksum in same session and returns 201 with skipped[]", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;
    const payload = Buffer.from("same-bytes");

    const first = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", payload, "one.csv");
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", payload, "two.csv");
    expect(second.status).toBe(201);
    expect(Array.isArray(second.body.files)).toBe(true);
    expect(second.body.files).toHaveLength(0);
    expect(second.body.skipped).toHaveLength(1);
    expect(second.body.skipped[0].code).toBe("DUPLICATE_CHECKSUM_IN_SESSION");
  });

  it("does not create data/imports/<sessionId> when every file is skipped as duplicate", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;
    const payload = Buffer.from("bytes-for-all-skipped-dir-test");

    const first = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", payload, "one.csv");
    expect(first.status).toBe(201);

    const stagingDir = resolveDataPath(path.join("data", "imports", sessionId));
    expect(existsSync(stagingDir)).toBe(true);

    rmSync(stagingDir, { recursive: true, force: true });
    expect(existsSync(stagingDir)).toBe(false);

    const second = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", payload, "two.csv");
    expect(second.status).toBe(201);
    expect(second.body.files).toHaveLength(0);
    expect(second.body.skipped).toHaveLength(1);
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("returns 409 when uploading after session is finalized", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "processing" });
    await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "review" });
    await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "finalized" });

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from("late"), "late.csv");
    expect(uploadRes.status).toBe(409);
    expect(uploadRes.body.code).toBe("SESSION_CLOSED_FOR_UPLOAD");
  });

  it("parses CSV file into transaction_raw rows and moves session to review", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const tag = Date.now();
    const dayBase = tag % 8000;
    const txnDate1 = new Date(Date.UTC(2026, 0, 1 + (dayBase % 27))).toISOString().slice(0, 10);
    const txnDate2 = new Date(Date.UTC(2026, 0, 2 + (dayBase % 27))).toISOString().slice(0, 10);
    const csv = [
      "Date,Description,Amount,Reference",
      `${txnDate1},Starbucks Coffee ${tag},-4.50,ref-1-${tag}`,
      `${txnDate2},Salary ${tag},3200.00,ref-2-${tag}`
    ].join("\n");

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(csv), "sample.csv");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "generic_tabular");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({
        mapping: {
          date: "Date",
          description: "Description",
          amount: "Amount",
          referenceId: "Reference"
        }
      });

    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedFiles).toBe(1);
    expect(parseRes.body.parsedRows).toBe(2);

    const fetchRes = await request(app)
      .get(`/imports/sessions/${sessionId}`)
      .set("authorization", `Bearer ${token}`);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.session.status).toBe("review");
    expect(fetchRes.body.files[0].status).toBe("parsed");

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(2);
    expect(canRes.body.duplicates).toBe(0);
    expect(canRes.body.nearDuplicates).toBe(0);

    const canRes2 = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes2.status).toBe(200);
    expect(canRes2.body.inserted).toBe(0);
    expect(canRes2.body.duplicates).toBe(2);
    expect(canRes2.body.nearDuplicates).toBe(0);
  });

  it("routes near-duplicate rows to resolution_item and skips second ledger insert", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const txnDate = new Date(Date.UTC(2025, 0, 1 + crypto.randomInt(0, 8000))).toISOString().slice(0, 10);
    const csv = [
      "Date,Description,Amount,Reference",
      `${txnDate},STARBUCKS COFFEE,-5.00,ref-n1`,
      `${txnDate},STARBUCKS COFFEE STORE,-5.00,ref-n2`
    ].join("\n");

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(csv), "near.csv");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "generic_tabular");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({
        mapping: {
          date: "Date",
          description: "Description",
          amount: "Amount",
          referenceId: "Reference"
        }
      });
    expect(parseRes.status).toBe(200);

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(1);
    expect(canRes.body.nearDuplicates).toBe(1);
    expect(canRes.body.duplicates).toBe(0);

    const openResolution = (await sqlStmt(
      `SELECT COUNT(*)::int AS c FROM resolution_item WHERE household_id = (SELECT household_id FROM import_session WHERE id = ?) AND type = 'duplicate_ambiguity' AND status = 'open'`
    ).get(sessionId)) as { c: number };
    expect(openResolution.c).toBeGreaterThanOrEqual(1);

    const fileSum = await request(app)
      .get(`/imports/sessions/${sessionId}/summary`)
      .set("authorization", `Bearer ${token}`);
    expect(fileSum.status).toBe(200);
    expect(fileSum.body.files[0].rawRowCount).toBe(2);
    expect(fileSum.body.files[0].canonicalRowCount).toBe(1);
    expect(fileSum.body.files[0].nearDuplicatesFlagged).toBe(1);
    expect(fileSum.body.files[0].notPostedExactDuplicateOrSkipped).toBe(0);
    expect(fileSum.body.files[0].openItemsNeedingReview).toBeGreaterThanOrEqual(1);
  });

  it("CR-080: exact duplicate from a second import creates status=duplicate canonical and resolution_item", async () => {
    const token = await loginAndGetToken();

    // Use a unique tag so this test doesn't collide with other runs.
    const tag = `exactdup-${Date.now()}`;
    const txnDate = new Date(Date.UTC(2025, 2, 15)).toISOString().slice(0, 10);
    const csv = [
      "Date,Description,Amount,Reference",
      `${txnDate},EXACT DUP COFFEE ${tag},-7.00,ref-exact-${tag}`
    ].join("\n");

    // --- Import 1: original transaction ---
    const sess1 = (await request(app).post("/imports/sessions").set("authorization", `Bearer ${token}`).send({ sourceType: "upload" })).body.session.id as string;
    const up1 = await request(app).post(`/imports/sessions/${sess1}/files`).set("authorization", `Bearer ${token}`).attach("files", Buffer.from(csv), "orig.csv");
    expect(up1.status).toBe(201);
    await bindImportFile(token, sess1, up1.body.files[0].id as string, SEED_BOA_CHECKING, "generic_tabular");
    await request(app).post(`/imports/sessions/${sess1}/parse`).set("authorization", `Bearer ${token}`).send({ mapping: { date: "Date", description: "Description", amount: "Amount", referenceId: "Reference" } });
    const can1 = await request(app).post(`/imports/sessions/${sess1}/canonicalize`).set("authorization", `Bearer ${token}`).send({});
    expect(can1.status).toBe(200);
    expect(can1.body.inserted).toBe(1);

    // --- Import 2: same CSV again ---
    const sess2 = (await request(app).post("/imports/sessions").set("authorization", `Bearer ${token}`).send({ sourceType: "upload" })).body.session.id as string;
    const up2 = await request(app).post(`/imports/sessions/${sess2}/files`).set("authorization", `Bearer ${token}`).attach("files", Buffer.from(csv), "dup.csv");
    expect(up2.status).toBe(201);
    await bindImportFile(token, sess2, up2.body.files[0].id as string, SEED_BOA_CHECKING, "generic_tabular");
    await request(app).post(`/imports/sessions/${sess2}/parse`).set("authorization", `Bearer ${token}`).send({ mapping: { date: "Date", description: "Description", amount: "Amount", referenceId: "Reference" } });
    const can2 = await request(app).post(`/imports/sessions/${sess2}/canonicalize`).set("authorization", `Bearer ${token}`).send({});
    expect(can2.status).toBe(200);
    // Duplicate row is now inserted (not silently dropped).
    expect(can2.body.inserted).toBe(0);
    expect(can2.body.duplicates).toBe(1);

    // Verify the duplicate canonical exists with status='duplicate'.
    const dupRow = (await sqlStmt(
      `SELECT status FROM transaction_canonical WHERE household_id = (SELECT household_id FROM import_session WHERE id = ?) AND status = 'duplicate' AND merchant LIKE ?`
    ).get(sess2, `%EXACT DUP COFFEE ${tag}%`)) as { status: string } | undefined;
    expect(dupRow?.status).toBe("duplicate");

    // Verify a resolution_item(duplicate_ambiguity) was created.
    const riRow = (await sqlStmt(
      `SELECT ri.id FROM resolution_item ri INNER JOIN transaction_canonical tc ON tc.source_ref = ('raw:' || ri.target_id) WHERE tc.status = 'duplicate' AND tc.household_id = (SELECT household_id FROM import_session WHERE id = ?) AND ri.type = 'duplicate_ambiguity' AND ri.status = 'open' LIMIT 1`
    ).get(sess2)) as { id: string } | undefined;
    expect(riRow).toBeTruthy();

    // Verify it appears in Needs Review ledger.
    const needsReview = await request(app).get("/transactions?needsReview=true&limit=50").set("authorization", `Bearer ${token}`);
    expect(needsReview.status).toBe(200);
    const dupInReview = (needsReview.body.transactions as Array<{ status: string; merchant: string }>).find(
      (t) => t.status === "duplicate" && t.merchant?.includes(`EXACT DUP COFFEE ${tag}`)
    );
    expect(dupInReview).toBeTruthy();

    // Resolve the flag — canonical should be promoted to 'posted'.
    const resolveRes = await request(app)
      .post("/resolution/bulk")
      .set("authorization", `Bearer ${token}`)
      .send({ ids: [riRow!.id], status: "resolved" });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.updated.length).toBe(1);

    const afterResolve = (await sqlStmt(
      `SELECT status FROM transaction_canonical WHERE household_id = (SELECT household_id FROM import_session WHERE id = ?) AND merchant LIKE ? AND status = 'posted' ORDER BY created_at DESC LIMIT 1`
    ).get(sess2, `%EXACT DUP COFFEE ${tag}%`)) as { status: string } | undefined;
    expect(afterResolve?.status).toBe("posted");
  });

  it(
    "undo-import removes session canonical rows before finalize and allows re-canonicalize",
    async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const txnDate = new Date(Date.UTC(2025, 5, 1 + crypto.randomInt(0, 8000))).toISOString().slice(0, 10);
    const csv = [
      "Date,Description,Amount,Reference",
      `${txnDate},UNDOIMPTEST COFFEE,-5.00,ref-u1`,
      `${txnDate},UNDOIMPTEST COFFEE STORE,-5.00,ref-u2`
    ].join("\n");

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(csv), "undo-near.csv");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "generic_tabular");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({
        mapping: {
          date: "Date",
          description: "Description",
          amount: "Amount",
          referenceId: "Reference"
        }
      });
    expect(parseRes.status).toBe(200);

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(1);
    expect(canRes.body.nearDuplicates).toBe(1);

    const undoRes = await request(app)
      .post(`/imports/sessions/${sessionId}/undo-import`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.deletedCanonicalRows).toBe(1);
    expect(undoRes.body.deletedResolutionItems).toBeGreaterThanOrEqual(1);

    const fileSum = await request(app)
      .get(`/imports/sessions/${sessionId}/summary`)
      .set("authorization", `Bearer ${token}`);
    expect(fileSum.status).toBe(200);
    expect(fileSum.body.files[0].canonicalRowCount).toBe(0);

    const canRes2 = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes2.status).toBe(200);
    expect(canRes2.body.inserted).toBe(1);
    },
    60_000
  );

  it("allows undo-import when session is finalized", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "processing" });
    await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "review" });
    await request(app)
      .patch(`/imports/sessions/${sessionId}/status`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "finalized" });

    const undoRes = await request(app)
      .post(`/imports/sessions/${sessionId}/undo-import`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.deletedCanonicalRows).toBe(0);
    expect(undoRes.body.deletedResolutionItems).toBe(0);
  });

  it("returns 409 when canonicalize runs before parse (no transaction_raw)", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(409);
    expect(canRes.body.code).toBe("NO_RAW_ROWS");
  });

  it("sets transfer_group_id for unambiguous transfer pairs", async () => {
    const token = await loginAndGetToken();
    const owner = await sqlStmt(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const debitAccountId = crypto.randomUUID();
    const creditAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Transfer Match Test A', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(debitAccountId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'savings', 'Transfer Match Test B', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(creditAccountId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'transfer.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const txnDate = "1999-12-25";
    const debitDesc = "Transfer to owned savings";
    const creditDesc = "Transfer from owned checking";
    const rawCreditId = crypto.randomUUID();
    const rawDebitId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawCreditId,
      fileId,
      0,
      JSON.stringify({
        txn_date: txnDate,
        description: creditDesc,
        amount: 200,
        financial_account_id: creditAccountId
      })
    );
    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawDebitId,
      fileId,
      1,
      JSON.stringify({
        txn_date: txnDate,
        description: debitDesc,
        amount: -200,
        financial_account_id: debitAccountId
      })
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(2);

    const creditRow = await sqlStmt(
      `SELECT id, transfer_group_id FROM transaction_canonical
       WHERE household_id = ? AND account_id = ? AND txn_date = ? AND amount = ? AND merchant = ?`
    ).get(householdId, creditAccountId, txnDate, 200, creditDesc) as { id: string; transfer_group_id: string | null };

    const debitRow = await sqlStmt(
      `SELECT id, transfer_group_id FROM transaction_canonical
       WHERE household_id = ? AND account_id = ? AND txn_date = ? AND amount = ? AND merchant = ?`
    ).get(householdId, debitAccountId, txnDate, -200, debitDesc) as { id: string; transfer_group_id: string | null };

    expect(creditRow).toBeDefined();
    expect(debitRow).toBeDefined();
    expect(creditRow.transfer_group_id).not.toBeNull();
    expect(debitRow.transfer_group_id).not.toBeNull();
    expect(creditRow.transfer_group_id).toBe(debitRow.transfer_group_id);
  });

  it("sets transfer_group for directional internal transfer memos across accounts", async () => {
    const token = await loginAndGetToken();
    const owner = await sqlStmt(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAccountId = crypto.randomUUID();
    const savingsAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Internal Dir Transfer Checking', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAccountId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'savings', 'Internal Dir Transfer Savings', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(savingsAccountId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'internal-dir.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const txnDate = "1999-08-08";
    const rawDebitId = crypto.randomUUID();
    const rawCreditId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawDebitId,
      fileId,
      0,
      JSON.stringify({
        txn_date: txnDate,
        description: "TRANSFER TO SAVINGS",
        amount: -250,
        financial_account_id: checkingAccountId
      })
    );
    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawCreditId,
      fileId,
      1,
      JSON.stringify({
        txn_date: txnDate,
        description: "TRANSFER FROM CHECKING",
        amount: 250,
        financial_account_id: savingsAccountId
      })
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(2);

    const rows = await sqlStmt(
      `SELECT amount, transfer_group_id
       FROM transaction_canonical
       WHERE household_id = ? AND account_id IN (?, ?)
       ORDER BY amount ASC`
    ).all(householdId, checkingAccountId, savingsAccountId) as Array<{
      amount: number;
      transfer_group_id: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.transfer_group_id).not.toBeNull();
    expect(rows[1]?.transfer_group_id).not.toBeNull();
    expect(rows[0]?.transfer_group_id).toBe(rows[1]?.transfer_group_id);
  });

  it("matches credit-card payment memo variants with 2-day date skew", async () => {
    const token = await loginAndGetToken();
    const owner = await sqlStmt(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAccountId = crypto.randomUUID();
    const cardAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Payment Match Test Checking', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAccountId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'credit_card', 'Payment Match Test Card', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(cardAccountId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'payment-variants.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const debitDate = "1999-12-20";
    const creditDate = "1999-12-22";
    const debitDesc = "AUTOPAY ACH PAYMENT TO CHASE CARD";
    const creditDesc = "PAYMENT RECEIVED - THANK YOU";
    const rawDebitId = crypto.randomUUID();
    const rawCreditId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawDebitId,
      fileId,
      0,
      JSON.stringify({
        txn_date: debitDate,
        description: debitDesc,
        amount: -315.44,
        financial_account_id: checkingAccountId
      })
    );
    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawCreditId,
      fileId,
      1,
      JSON.stringify({
        txn_date: creditDate,
        description: creditDesc,
        amount: 315.44,
        financial_account_id: cardAccountId
      })
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(2);

    const rows = await sqlStmt(
      `SELECT id, amount, transfer_group_id
       FROM transaction_canonical
       WHERE household_id = ? AND account_id IN (?, ?)
       ORDER BY amount ASC`
    ).all(householdId, checkingAccountId, cardAccountId) as Array<{
      id: string;
      amount: number;
      transfer_group_id: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.transfer_group_id).not.toBeNull();
    expect(rows[1]?.transfer_group_id).not.toBeNull();
    expect(rows[0]?.transfer_group_id).toBe(rows[1]?.transfer_group_id);
  });

  it("sets transfer_group when card payment credit leg has no PAYMENT token (THANK YOU only)", async () => {
    const token = await loginAndGetToken();
    const owner = await sqlStmt(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAccountId = crypto.randomUUID();
    const cardAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Asymmetric Card Pay Checking', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAccountId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'credit_card', 'Asymmetric Card Pay Card', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(cardAccountId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'asymmetric-thanks.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const txnDate = "1999-11-11";
    const rawDebitId = crypto.randomUUID();
    const rawCreditId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawDebitId,
      fileId,
      0,
      JSON.stringify({
        txn_date: txnDate,
        description: "ONLINE PAYMENT TO VISA",
        amount: -88.5,
        financial_account_id: checkingAccountId
      })
    );
    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawCreditId,
      fileId,
      1,
      JSON.stringify({
        txn_date: txnDate,
        description: "THANK YOU",
        amount: 88.5,
        financial_account_id: cardAccountId
      })
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(2);

    const rows = await sqlStmt(
      `SELECT amount, transfer_group_id
       FROM transaction_canonical
       WHERE household_id = ? AND account_id IN (?, ?)
       ORDER BY amount ASC`
    ).all(householdId, checkingAccountId, cardAccountId) as Array<{
      amount: number;
      transfer_group_id: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.transfer_group_id).not.toBeNull();
    expect(rows[1]?.transfer_group_id).not.toBeNull();
    expect(rows[0]?.transfer_group_id).toBe(rows[1]?.transfer_group_id);
  });

  it("sets transfer_group for HELOC-style loan payment across checking and loan accounts", async () => {
    const token = await loginAndGetToken();
    const owner = await sqlStmt(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAccountId = crypto.randomUUID();
    const loanAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'HELOC Pay Checking', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAccountId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'loan', 'HELOC Pay Loan', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(loanAccountId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'heloc-pay.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const txnDate = "1999-10-10";
    const debitDesc = "ONLINE PAYMENT TO HELOC";
    const creditDesc = "PAYMENT RECEIVED - THANK YOU";
    const rawDebitId = crypto.randomUUID();
    const rawCreditId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawDebitId,
      fileId,
      0,
      JSON.stringify({
        txn_date: txnDate,
        description: debitDesc,
        amount: -450,
        financial_account_id: checkingAccountId
      })
    );
    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      rawCreditId,
      fileId,
      1,
      JSON.stringify({
        txn_date: txnDate,
        description: creditDesc,
        amount: 450,
        financial_account_id: loanAccountId
      })
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(2);

    const rows = await sqlStmt(
      `SELECT amount, transfer_group_id
       FROM transaction_canonical
       WHERE household_id = ? AND account_id IN (?, ?)
       ORDER BY amount ASC`
    ).all(householdId, checkingAccountId, loanAccountId) as Array<{
      amount: number;
      transfer_group_id: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.transfer_group_id).not.toBeNull();
    expect(rows[1]?.transfer_group_id).not.toBeNull();
    expect(rows[0]?.transfer_group_id).toBe(rows[1]?.transfer_group_id);
  });

  it("keeps multi-candidate payment matches in transfer_ambiguity queue", async () => {
    const token = await loginAndGetToken();
    const owner = await sqlStmt(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAccountId = crypto.randomUUID();
    const cardAccountAId = crypto.randomUUID();
    const cardAccountBId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Ambiguity Test Checking', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAccountId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'credit_card', 'Ambiguity Test Card A', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(cardAccountAId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'credit_card', 'Ambiguity Test Card B', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(cardAccountBId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'payment-ambiguity.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const rows = [
      {
        rowIndex: 0,
        txnDate: "1999-12-24",
        description: "ACH PAYMENT TO CREDIT CARD",
        amount: -500,
        accountId: checkingAccountId
      },
      {
        rowIndex: 1,
        txnDate: "1999-12-24",
        description: "PAYMENT RECEIVED THANK YOU",
        amount: 500,
        accountId: cardAccountAId
      },
      {
        rowIndex: 2,
        txnDate: "1999-12-25",
        description: "PAYMENT RECEIVED THANK YOU",
        amount: 500,
        accountId: cardAccountBId
      }
    ];

    for (const r of rows) {
      await sqlStmt(
        `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
         VALUES (?, ?, ?, ?, 0.9)`
      ).run(
        crypto.randomUUID(),
        fileId,
        r.rowIndex,
        JSON.stringify({
          txn_date: r.txnDate,
          description: r.description,
          amount: r.amount,
          financial_account_id: r.accountId
        })
      );
    }

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(3);

    const matchedCountRow = (await sqlStmt(
      `SELECT COUNT(*)::int AS c
         FROM transaction_canonical
         WHERE household_id = ?
           AND account_id IN (?, ?, ?)
           AND transfer_group_id IS NOT NULL`
    ).get(householdId, checkingAccountId, cardAccountAId, cardAccountBId)) as { c: number };
    expect(matchedCountRow.c).toBe(0);

    const ambiguityRows = (await sqlStmt(
      `SELECT target_id, reason
         FROM resolution_item
         WHERE household_id = ?
           AND type = 'transfer_ambiguity'
           AND status = 'open'
           AND target_id IN (
             SELECT id
             FROM transaction_canonical
             WHERE household_id = ?
               AND account_id IN (?, ?, ?)
           )`
    ).all(householdId, householdId, checkingAccountId, cardAccountAId, cardAccountBId)) as Array<{
      target_id: string;
      reason: string;
    }>;
    expect(ambiguityRows.length).toBe(3);
    const parsedReason = JSON.parse(ambiguityRows[0]!.reason) as {
      matcherTelemetry?: { candidateScores?: Array<{ score: number }> };
    };
    expect(Array.isArray(parsedReason.matcherTelemetry?.candidateScores)).toBe(true);
  });

  it("does not auto-match generic payment wording without card/loan context", async () => {
    const token = await loginAndGetToken();
    const owner = await sqlStmt(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAId = crypto.randomUUID();
    const checkingBId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'No-FP Test A', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAId, householdId, ownerUserId);
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'No-FP Test B', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingBId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'generic-payment-words.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      crypto.randomUUID(),
      fileId,
      0,
      JSON.stringify({
        txn_date: "1999-12-24",
        description: "AUTOMATIC PAYMENT",
        amount: -120,
        financial_account_id: checkingAId
      })
    );
    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
       VALUES (?, ?, ?, ?, 0.9)`
    ).run(
      crypto.randomUUID(),
      fileId,
      1,
      JSON.stringify({
        txn_date: "1999-12-25",
        description: "PAYMENT POSTED",
        amount: 120,
        financial_account_id: checkingBId
      })
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(2);

    const matchedCount = (await sqlStmt(
      `SELECT COUNT(*)::int AS c
         FROM transaction_canonical
         WHERE household_id = ?
           AND account_id IN (?, ?)
           AND transfer_group_id IS NOT NULL`
    ).get(householdId, checkingAId, checkingBId)) as { c: number };
    expect(matchedCount.c).toBe(0);
  });

  it("parses XLSX file into transaction_raw rows", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const worksheet = XLSX.utils.json_to_sheet([
      { Date: "2026-03-03", Description: "Rent", Amount: "-1500.00" },
      { Date: "2026-03-04", Description: "Bonus", Amount: "500.00" }
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", excelBuffer, "sample.xlsx");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "generic_tabular");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({
        mapping: {
          date: "Date",
          description: "Description",
          amount: "Amount"
        }
      });
    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedFiles).toBe(1);
    expect(parseRes.body.parsedRows).toBe(2);
  });

  it("returns 400 when parse mapping is invalid for generic_tabular", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const csv = ["Date,Description,Amount", "2026-03-01,X,1"].join("\n");
    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(csv), "sample.csv");
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "generic_tabular");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({
        mapping: {
          date: "Date",
          amount: "Amount"
        }
      });

    expect(parseRes.status).toBe(400);
    expect(parseRes.body.code).toBe("INVALID_MAPPING");
  });

  it("returns 400 when parse runs before file account binding", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from("a,b\n1,2"), "x.csv");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});

    expect(parseRes.status).toBe(400);
    expect(parseRes.body.code).toBe("MISSING_FILE_BINDING");
  });

  it("lists household financial accounts for import mapping", async () => {
    const token = await loginAndGetToken();
    const res = await request(app).get("/imports/accounts").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(6);
  });

  it("parses Chase activity CSV using chase_card_csv profile", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const csv = [
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
      "12/24/2025,12/25/2025,COFFEE,Food & Drink,Sale,-5.00,"
    ].join("\n");

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(csv), "chase.csv");
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_CHASE_CC, "chase_card_csv");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});

    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedRows).toBe(1);
  });

  it("parses BoA eStatement PDF using boa_estatement_pdf when fixture exists", { timeout: 60_000 }, async () => {
    const fixture = path.join(process.cwd(), "..", "data", "imports", "custom", "eStmt_2026-03-19.pdf");
    if (!existsSync(fixture)) {
      return;
    }

    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", readFileSync(fixture), "eStmt_2026-03-19.pdf");
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "boa_estatement_pdf");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});

    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedRows).toBeGreaterThan(30);
  });

  it("parses Marcus online savings PDF using marcus_online_savings_pdf when fixture exists", async () => {
    const fixture = path.join(
      process.cwd(),
      "..",
      "data",
      "imports",
      "custom",
      "STMTCMB100_20260301_4970_Rai_1525207_303950.PDF"
    );
    if (!existsSync(fixture)) {
      return;
    }

    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", readFileSync(fixture), "marcus.pdf");
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_MARCUS_SAVINGS, "marcus_online_savings_pdf");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});

    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedRows).toBeGreaterThanOrEqual(1);
  });

  it("parses real BoA checking CSV from repo when fixture exists", { timeout: 60_000 }, async () => {
    const fixture = path.join(process.cwd(), "..", "data", "imports", "custom", "stmt.csv");
    if (!existsSync(fixture)) {
      return;
    }

    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", readFileSync(fixture), "stmt.csv");
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "boa_checking_csv");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});

    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedRows).toBeGreaterThan(10);
    const summaryRes = await request(app)
      .get(`/imports/sessions/${sessionId}/summary`)
      .set("authorization", `Bearer ${token}`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.files[0].diagnostics.parser.boaCsv.dataLineCount).toBeGreaterThan(10);
  });

  it("returns 401 for ledger list without token", async () => {
    const res = await request(app).get("/transactions");
    expect(res.status).toBe(401);
  });

  it("returns session summary with raw vs ledger counts and lists ledger transactions", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const emptySummary = await request(app)
      .get(`/imports/sessions/${sessionId}/summary`)
      .set("authorization", `Bearer ${token}`);
    expect(emptySummary.status).toBe(200);
    expect(emptySummary.body.totals.rawRows).toBe(0);
    expect(emptySummary.body.totals.canonicalRows).toBe(0);
    expect(emptySummary.body.totals.nearDuplicatesFlagged).toBe(0);
    expect(emptySummary.body.totals.openItemsNeedingReview).toBe(0);
    expect(emptySummary.body.totals.notPostedExactDuplicateOrSkipped).toBe(0);

    const tag = Date.now();
    const dayBase = tag % 8000;
    const txnDate1 = new Date(Date.UTC(2026, 7, 1 + (dayBase % 27))).toISOString().slice(0, 10);
    const txnDate2 = new Date(Date.UTC(2026, 7, 2 + (dayBase % 27))).toISOString().slice(0, 10);
    const csv = [
      "Date,Description,Amount,Reference",
      `${txnDate1},Ledger test A ${tag},-3.33,ref-lt-a-${tag}`,
      `${txnDate2},Ledger test B ${tag},4444.44,ref-lt-b-${tag}`
    ].join("\n");

    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(csv), "ledger-test.csv");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "generic_tabular");

    await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({
        mapping: {
          date: "Date",
          description: "Description",
          amount: "Amount",
          referenceId: "Reference"
        }
      });

    await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});

    const sum = await request(app)
      .get(`/imports/sessions/${sessionId}/summary`)
      .set("authorization", `Bearer ${token}`);
    expect(sum.status).toBe(200);
    expect(sum.body.totals.rawRows).toBe(2);
    expect(sum.body.totals.canonicalRows).toBe(2);
    expect(sum.body.files[0].rawRowCount).toBe(2);
    expect(sum.body.files[0].canonicalRowCount).toBe(2);
    expect(sum.body.files[0].nearDuplicatesFlagged).toBe(0);
    expect(sum.body.files[0].notPostedExactDuplicateOrSkipped).toBe(0);
    expect(sum.body.files[0].diagnostics.canonicalize.inserted).toBe(2);
    expect(sum.body.files[0].diagnostics.canonicalize.duplicateFingerprint).toBe(0);
    expect(sum.body.files[0].diagnostics.canonicalize.nearDuplicate).toBe(0);

    const scoped = await request(app)
      .get(`/transactions?sessionId=${sessionId}&limit=50`)
      .set("authorization", `Bearer ${token}`);
    expect(scoped.status).toBe(200);
    expect(scoped.body.sessionId).toBe(sessionId);
    expect(scoped.body.total).toBe(2);
    expect(scoped.body.transactions.length).toBe(2);
    expect(
      scoped.body.transactions.some((t: { merchant?: string }) => t.merchant?.includes(`Ledger test A ${tag}`))
    ).toBe(true);
  });

  it("computes reconciliation diagnostics when profile rows expose a balance column variant", async () => {
    const token = await loginAndGetToken();
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;

    const csv = [
      "Date,Description,Amount,Balance,Reference",
      "2026-08-01,Coffee,-5.00,995.00,ref-r1",
      "2026-08-02,Payroll,105.00,1100.00,ref-r2"
    ].join("\n");
    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(csv), "recon-balance.csv");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.files[0].id as string;
    await bindImportFile(token, sessionId, fileId, SEED_BOA_CHECKING, "generic_tabular");

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({
        mapping: {
          date: "Date",
          description: "Description",
          amount: "Amount",
          referenceId: "Reference"
        }
      });
    expect(parseRes.status).toBe(200);

    const sum = await request(app)
      .get(`/imports/sessions/${sessionId}/summary`)
      .set("authorization", `Bearer ${token}`);
    expect(sum.status).toBe(200);
    expect(sum.body.files[0].reconciliation.available).toBe(true);
    expect(sum.body.files[0].reconciliation.status).toBe("ok");
    expect(sum.body.files[0].reconciliation.openingBalance).toBeCloseTo(1000, 2);
    expect(sum.body.files[0].reconciliation.closingBalance).toBeCloseTo(1100, 2);
  });

  it("returns 404 when ledger sessionId filter is not found for household", async () => {
    const token = await loginAndGetToken();
    const res = await request(app)
      .get("/transactions?sessionId=00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("transactions command center (Epic 11.2)", () => {
  it("creates a manual transaction via POST", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const tag = Date.now();
    const res = await request(app)
      .post("/transactions")
      .set("authorization", `Bearer ${token}`)
      .send({
        accountId: SEED_BOA_CHECKING,
        txnDate: "2026-03-27",
        amount: -12.34,
        merchant: `API manual test ${tag}`,
        memo: null,
        categoryId: "30000000-0000-0000-0000-000000000004"
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("string");
  });

  it("search matches substring or FTS and orders by txn_date desc", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const idNewerDate = crypto.randomUUID();
    const idBetterFts = crypto.randomUUID();
    const fp1 = crypto.randomBytes(32).toString("hex");
    const fp2 = crypto.randomBytes(32).toString("hex");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'debit', 'ledgerbm25', NULL, NULL, ?, 'manual:fts-order-a', 'posted')`
    ).run(
      idNewerDate,
      householdId.household_id,
      SEED_BOA_CHECKING,
      "30000000-0000-0000-0000-000000000004",
      "2026-12-15",
      -1,
      fp1
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'debit', 'ledgerbm25 ledgerbm25 ledgerbm25 ledgerbm25 ledgerbm25', NULL, NULL, ?, 'manual:fts-order-b', 'posted')`
    ).run(
      idBetterFts,
      householdId.household_id,
      SEED_BOA_CHECKING,
      "30000000-0000-0000-0000-000000000004",
      "2026-01-05",
      -1,
      fp2
    );

    const res = await request(app)
      .get(`/transactions?search=${encodeURIComponent("ledgerbm25")}&limit=50`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const txs = res.body.transactions as { id: string }[];
    const idxBetter = txs.findIndex((t) => t.id === idBetterFts);
    const idxNewer = txs.findIndex((t) => t.id === idNewerDate);
    expect(idxBetter).toBeGreaterThanOrEqual(0);
    expect(idxNewer).toBeGreaterThanOrEqual(0);
    // Hybrid search (substring OR FTS); list order is by date, newest first.
    expect(idxNewer).toBeLessThan(idxBetter);
  });

  it("lists needsReview rows with reviewReasons for uncategorized posted rows", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const id = crypto.randomUUID();
    const fp = crypto.randomBytes(32).toString("hex");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'review-flag', NULL, NULL, ?, 'manual:test', 'posted')`
    ).run(id, householdId.household_id, SEED_BOA_CHECKING, "2026-01-15", -2.5, fp);

    const res = await request(app)
      .get(`/transactions?needsReview=true&limit=50&search=${encodeURIComponent("review-flag")}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const hit = res.body.transactions.find((t: { id: string }) => t.id === id);
    expect(hit).toBeDefined();
    expect(Array.isArray(hit.reviewReasons)).toBe(true);
    expect(hit.reviewReasons).toContain("Uncategorized");
  });

  it("rejects resolutionType without needsReview=true", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const res = await request(app)
      .get("/transactions?resolutionType=unknown_category")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("needsReview");
  });

  it("filters needsReview by resolutionType and returns openReviewItems", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const txnId = crypto.randomUUID();
    const resId = crypto.randomUUID();
    const fp = crypto.randomBytes(32).toString("hex");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'debit', 'res-type-filter', NULL, NULL, ?, 'manual:rtf', 'posted')`
    ).run(
      txnId,
      householdId.household_id,
      SEED_BOA_CHECKING,
      "30000000-0000-0000-0000-000000000004",
      "2026-02-01",
      -3,
      fp
    );
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'unknown_category', ?, ?, 'open')`
    ).run(resId, householdId.household_id, txnId, JSON.stringify({ kind: "unknown_category" }));

    const allReview = await request(app)
      .get(`/transactions?needsReview=true&limit=100&search=${encodeURIComponent("res-type-filter")}`)
      .set("authorization", `Bearer ${token}`);
    expect(allReview.status).toBe(200);
    const allHit = allReview.body.transactions.find((t: { id: string }) => t.id === txnId);
    expect(allHit).toBeDefined();
    expect(Array.isArray(allHit.openReviewItems)).toBe(true);
    expect(allHit.openReviewItems.some((x: { id: string }) => x.id === resId)).toBe(true);
    const hitItem = allHit.openReviewItems.find((x: { id: string }) => x.id === resId);
    expect(hitItem).toMatchObject({ type: "unknown_category", status: "open" });

    const xferOnly = await request(app)
      .get(
        `/transactions?needsReview=true&resolutionType=transfer_ambiguity&limit=100&search=${encodeURIComponent("res-type-filter")}`
      )
      .set("authorization", `Bearer ${token}`);
    expect(xferOnly.status).toBe(200);
    expect(xferOnly.body.transactions.some((t: { id: string }) => t.id === txnId)).toBe(false);

    const catOnly = await request(app)
      .get(
        `/transactions?needsReview=true&resolutionType=unknown_category&limit=100&search=${encodeURIComponent("res-type-filter")}`
      )
      .set("authorization", `Bearer ${token}`);
    expect(catOnly.status).toBe(200);
    expect(catOnly.body.transactions.some((t: { id: string }) => t.id === txnId)).toBe(true);
  });

  it("CR-096: resolutionType=duplicate_ambiguity includes status=duplicate canonical rows (no resolution_item required)", async () => {
    // Regression test for CR-096: exact duplicates (status='duplicate') must appear when filtering
    // by resolutionType=duplicate_ambiguity, even when the source_ref→resolution_item join fails or
    // the resolution_item has already been closed. The fix adds `tc.status = 'duplicate' OR` to the
    // SQL predicate so the status alone qualifies the row.
    const login = await request(app).post("/auth/login").send({ email: "owner@example.com", password: "ChangeMe123!" });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    const householdId = (await sqlStmt(
      `SELECT household_id FROM app_user WHERE email = ?`
    ).get("owner@example.com")) as { household_id: string };

    // Insert a canonical row with status='duplicate' and NO resolution_item — simulating
    // the scenario where the RI was already resolved/closed or is absent.
    const txnId = crypto.randomUUID();
    const fp = crypto.randomBytes(32).toString("hex");
    const tag = `cr096-${Date.now()}`;
    await sqlStmt(
      `INSERT INTO transaction_canonical
         (id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
          merchant, memo, transfer_group_id, fingerprint, source_ref, status)
       VALUES (?, ?, ?, NULL, ?, '2026-01-15', -42, 'debit', ?, NULL, NULL, ?, 'raw:cr096test', 'duplicate')`
    ).run(
      txnId,
      householdId.household_id,
      SEED_BOA_CHECKING,
      "30000000-0000-0000-0000-000000000004",
      tag,
      fp
    );

    // 1. Verify the row surfaces under generic needsReview (status NOT IN posted/trashed).
    const allReview = await request(app)
      .get(`/transactions?needsReview=true&limit=200&search=${encodeURIComponent(tag)}`)
      .set("authorization", `Bearer ${token}`);
    expect(allReview.status).toBe(200);
    expect(allReview.body.transactions.some((t: { id: string }) => t.id === txnId)).toBe(true);

    // 2. Verify the row appears when resolutionType=duplicate_ambiguity (the CR-096 fix).
    const dupFilter = await request(app)
      .get(`/transactions?needsReview=true&resolutionType=duplicate_ambiguity&limit=200&search=${encodeURIComponent(tag)}`)
      .set("authorization", `Bearer ${token}`);
    expect(dupFilter.status).toBe(200);
    expect(dupFilter.body.transactions.some((t: { id: string }) => t.id === txnId)).toBe(
      true,
      "status=duplicate canonical must appear when resolutionType=duplicate_ambiguity even without a resolution_item"
    );

    // 3. Verify the row does NOT appear when filtering by a non-matching resolutionType.
    //    reconciliation_mismatch won't match a status=duplicate row (no RI at all in this test).
    const reconFilter = await request(app)
      .get(`/transactions?needsReview=true&resolutionType=reconciliation_mismatch&limit=200&search=${encodeURIComponent(tag)}`)
      .set("authorization", `Bearer ${token}`);
    expect(reconFilter.status).toBe(200);
    expect(reconFilter.body.transactions.some((t: { id: string }) => t.id === txnId)).toBe(false);
  });

  it("lists open review items with file/raw context via GET /transactions/:id/open-review", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const rawId = crypto.randomUUID();
    const txnId = crypto.randomUUID();
    const resId = crypto.randomUUID();
    const fp = crypto.randomBytes(32).toString("hex");

    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status)
       VALUES (?, ?, 'upload', 'review')`
    ).run(sessionId, householdId.household_id);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, status, checksum, stored_path)
       VALUES (?, ?, 'stmt.csv', 'parsed', ?, NULL)`
    ).run(fileId, sessionId, crypto.randomBytes(8).toString("hex"));
    await sqlStmt(
      `INSERT INTO transaction_raw (id, file_id, extracted_payload_json, row_index, confidence)
       VALUES (?, ?, ?, 0, 0.95)`
    ).run(
      rawId,
      fileId,
      JSON.stringify({
        txn_date: "2026-02-10",
        amount: -44.44,
        description: "Open review API raw line"
      })
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'Open review API', NULL, NULL, ?, ?, 'posted')`
    ).run(txnId, householdId.household_id, SEED_BOA_CHECKING, "2026-02-10", -44.44, fp, `raw:${rawId}`);
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'unknown_category', ?, ?, 'in_review')`
    ).run(resId, householdId.household_id, txnId, JSON.stringify({ kind: "unknown_category" }));

    const res = await request(app)
      .get(`/transactions/${txnId}/open-review`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].id).toBe(resId);
    expect(res.body.items[0].status).toBe("in_review");
    expect(res.body.items[0].context?.fileName).toBe("stmt.csv");
    expect(res.body.items[0].context?.sessionId).toBe(sessionId);
    expect(res.body.items[0].context?.raw?.description).toContain("Open review API raw line");

    const bad = await request(app)
      .get(`/transactions/${crypto.randomUUID()}/open-review`)
      .set("authorization", `Bearer ${token}`);
    expect(bad.status).toBe(404);
  });

  it("returns 409 when manual POST duplicates fingerprint", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const body = {
      accountId: SEED_BOA_CHECKING,
      txnDate: "2026-04-01",
      amount: -99.99,
      merchant: `Dup test ${crypto.randomUUID()}`,
      memo: null as string | null,
      categoryId: null as string | null
    };
    const first = await request(app).post("/transactions").set("authorization", `Bearer ${token}`).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post("/transactions").set("authorization", `Bearer ${token}`).send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("DUPLICATE_FINGERPRINT");
  });
});

describe("categories and ledger category field (Epic 5.1)", () => {
  it("lists default categories", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app).get("/categories").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.some((c: { name: string }) => c.name === "Groceries")).toBe(true);
  });

  it("returns parentId for child categories (Postgres quoted aliases)", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app).get("/categories").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groceries = res.body.categories.find((c: { name: string }) => c.name === "Groceries") as {
      parentId: string | null;
    };
    expect(groceries).toBeDefined();
    expect(groceries.parentId).toBe("30000000-0000-0000-0000-000000000101");
  });

  it("returns builtin rules with ruleKey and matchType (Postgres quoted aliases)", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app).get("/categories/rules").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.builtinRules)).toBe(true);
    expect(res.body.builtinRules.length).toBeGreaterThan(0);
    const first = res.body.builtinRules[0] as {
      ruleKey: string;
      matchType: string;
      categoryId: string;
      amountScope: string;
    };
    expect(typeof first.ruleKey).toBe("string");
    expect(first.ruleKey.length).toBeGreaterThan(0);
    expect(["contains", "prefix", "regex"]).toContain(first.matchType);
    expect(first.categoryId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(["any", "credit_only", "debit_only"]).toContain(first.amountScope);
  });

  it("bulk household rules accept categoryPath only (path resolution)", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app)
      .post("/categories/rules/bulk")
      .set("authorization", `Bearer ${token}`)
      .send({
        rules: [
          {
            pattern: `path-import-${crypto.randomUUID().slice(0, 8)}`,
            matchType: "contains",
            categoryPath: "Investments > Stocks",
            amountScope: "debit_only",
            confidence: 0.9,
            priority: 50,
            enabled: true
          }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].categoryId).toBe("30000000-0000-0000-0000-000000000009");
  });

  it("returns categoryId and categoryName on ledger rows", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app).get("/transactions?limit=5").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    if (res.body.transactions.length > 0) {
      const t = res.body.transactions[0];
      expect(t).toHaveProperty("categoryId");
      expect(t).toHaveProperty("categoryName");
      expect(t).toHaveProperty("classificationMeta");
    }
  });

  it("GET /transactions includes classificationMeta with source manual for POST /transactions rows", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const created = await request(app)
      .post("/transactions")
      .set("authorization", `Bearer ${token}`)
      .send({
        accountId: SEED_BOA_CHECKING,
        txnDate: "2020-06-15",
        amount: -3.5,
        merchant: "classification-meta-probe",
        categoryId: "30000000-0000-0000-0000-000000000004"
      });
    expect(created.status).toBe(201);
    const list = await request(app)
      .get("/transactions?search=classification-meta-probe&limit=10")
      .set("authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.transactions.length).toBeGreaterThanOrEqual(1);
    const row = list.body.transactions.find(
      (x: { merchant?: string }) => x.merchant === "classification-meta-probe"
    );
    expect(row?.classificationMeta?.source).toBe("manual");
  });

  it("updates transaction category via PATCH", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id = crypto.randomUUID();
    const fp = crypto.randomBytes(32).toString("hex");
    const catId = "30000000-0000-0000-0000-000000000004";
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 't', NULL, NULL, ?, 'manual:patch', 'posted')`
    ).run(id, householdId.household_id, SEED_BOA_CHECKING, new Date().toISOString().slice(0, 10), -1, fp);

    const patch = await request(app)
      .patch(`/transactions/${id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ categoryId: catId });

    expect(patch.status).toBe(200);
    expect(patch.body.categoryId).toBe(catId);
    expect(patch.body.categoryName).toBe("Groceries");

    const clear = await request(app)
      .patch(`/transactions/${id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ categoryId: null });

    expect(clear.status).toBe(200);
    expect(clear.body.categoryId).toBeNull();
  });
});

describe("resolution queue", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/resolution");
    expect(res.status).toBe(401);
  });

  it("returns items array for authenticated household", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const res = await request(app).get("/resolution").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    if (res.body.items.length > 0) {
      expect(res.body.items[0]).toHaveProperty("context");
    }
  });

  it("filters resolution list by status", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const household = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(crypto.randomUUID(), household.household_id, crypto.randomUUID(), "open item");
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'resolved')`
    ).run(crypto.randomUUID(), household.household_id, crypto.randomUUID(), "resolved item");

    const res = await request(app).get("/resolution?status=open").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("open");
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.every((x: { status: string }) => x.status === "open")).toBe(true);
  });

  it("updates resolution status for household item", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(id, householdId.household_id, crypto.randomUUID(), "manual test");

    const patch = await request(app)
      .patch(`/resolution/${id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "in_review" });

    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("in_review");
  });

  it("returns 404 when updating another household's resolution item", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;

    const otherHouseholdId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO household (id, name, created_at)
       VALUES (?, 'Other household 2', CURRENT_TIMESTAMP)`
    ).run(otherHouseholdId);
    const id = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(id, otherHouseholdId, crypto.randomUUID(), "other household");

    const patch = await request(app)
      .patch(`/resolution/${id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "resolved" });
    expect(patch.status).toBe(404);
  });

  it("returns 409 for invalid resolution transition", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'resolved')`
    ).run(id, householdId.household_id, crypto.randomUUID(), "resolved item");

    const patch = await request(app)
      .patch(`/resolution/${id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "in_review" });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe("INVALID_TRANSITION");
  });

  it("bulk updates multiple resolution items", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(id1, householdId.household_id, crypto.randomUUID(), "a");
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(id2, householdId.household_id, crypto.randomUUID(), "b");

    const bulk = await request(app)
      .post("/resolution/bulk")
      .set("authorization", `Bearer ${token}`)
      .send({ ids: [id1, id2], status: "in_review" });

    expect(bulk.status).toBe(200);
    expect(bulk.body.updated).toHaveLength(2);
    expect(bulk.body.errors).toHaveLength(0);
    expect(bulk.body.updated.every((u: { status: string }) => u.status === "in_review")).toBe(true);
  });

  it("bulk returns per-item errors without failing the whole request", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const okId = crypto.randomUUID();
    const badTransitionId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(okId, householdId.household_id, crypto.randomUUID(), "ok");
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'resolved')`
    ).run(badTransitionId, householdId.household_id, crypto.randomUUID(), "bad");

    const bulk = await request(app)
      .post("/resolution/bulk")
      .set("authorization", `Bearer ${token}`)
      .send({ ids: [okId, badTransitionId], status: "in_review" });

    expect(bulk.status).toBe(200);
    expect(bulk.body.updated).toHaveLength(1);
    expect(bulk.body.updated[0].id).toBe(okId);
    expect(bulk.body.errors).toHaveLength(1);
    expect(bulk.body.errors[0].id).toBe(badTransitionId);
    expect(bulk.body.errors[0].code).toBe("INVALID_TRANSITION");
  });

  it("bulk-apply-category updates unknown_category items and reports mixed-selection errors", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const txnId = crypto.randomUUID();
    const fp = crypto.randomBytes(32).toString("hex");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'bulk-cat-target', NULL, NULL, ?, 'manual:bulk-cat', 'posted')`
    ).run(txnId, householdId.household_id, SEED_BOA_CHECKING, "2026-02-01", -23.45, fp);

    const unknownId = crypto.randomUUID();
    const wrongTypeId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'unknown_category', ?, ?, 'open')`
    ).run(unknownId, householdId.household_id, txnId, JSON.stringify({ kind: "unknown_category" }));
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(wrongTypeId, householdId.household_id, crypto.randomUUID(), JSON.stringify({ kind: "near_duplicate" }));

    const res = await request(app)
      .post("/resolution/bulk-apply-category")
      .set("authorization", `Bearer ${token}`)
      .send({ ids: [unknownId, wrongTypeId], categoryId: "30000000-0000-0000-0000-000000000004" });
    expect(res.status).toBe(200);
    expect(res.body.updated.some((u: { id: string }) => u.id === unknownId)).toBe(true);
    expect(res.body.errors.some((e: { id: string; code: string }) => e.id === wrongTypeId && e.code === "WRONG_TYPE")).toBe(
      true
    );

    const txn = (await sqlStmt(`SELECT category_id FROM transaction_canonical WHERE id = ? AND household_id = ?`).get(
      txnId,
      householdId.household_id
    )) as { category_id: string | null } | undefined;
    expect(txn?.category_id).toBe("30000000-0000-0000-0000-000000000004");
    const item = (await sqlStmt(`SELECT status FROM resolution_item WHERE id = ? AND household_id = ?`).get(
      unknownId,
      householdId.household_id
    )) as { status: string } | undefined;
    expect(item?.status).toBe("resolved");
  });
});

describe("cash summary (reports)", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/reports/cash-summary?preset=rolling_30");
    expect(res.status).toBe(401);
  });

  it("returns 400 when preset=month without month", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/cash-summary?preset=month")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("aggregates inflows, outflows, and net for the KPI range", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const testAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, '20000000-0000-0000-0000-000000000001', 'checking', 'Cash Summary Test', '9998', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId);

    const asOf = new Date().toISOString().slice(0, 10);
    const fp1 = crypto.randomBytes(32).toString("hex");
    const fp2 = crypto.randomBytes(32).toString("hex");
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id1, householdId, testAccountId, asOf, 1000, "credit", "pay", null, fp1, "test:cash1");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id2, householdId, testAccountId, asOf, -250.5, "debit", "shop", null, fp2, "test:cash2");

    const res = await request(app)
      .get(
        `/reports/cash-summary?preset=rolling_30&asOf=${encodeURIComponent(asOf)}&breakdown=true&accountId=${testAccountId}`
      )
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.maxCustomRangeDays).toBe("number");
    expect(res.body.maxCustomRangeDays).toBeGreaterThanOrEqual(31);
    expect(res.body.household.inflows).toBe(1000);
    expect(res.body.household.outflows).toBe(250.5);
    expect(res.body.household.net).toBe(749.5);
    expect(res.body.household.transactionCount).toBe(2);
    expect(Array.isArray(res.body.monthlyTrend)).toBe(true);
    expect(res.body.monthlyTrend.length).toBe(6);
    expect(Array.isArray(res.body.byAccount)).toBe(true);
    expect(res.body.byAccount).toHaveLength(1);
    expect(res.body.byAccount[0].accountId).toBe(testAccountId);
    expect(res.body.spendingPower).toBeDefined();
    expect(res.body.spendingPower.monthlySavingsTargetUsd).toBeNull();
    expect(res.body.spendingPower.safeToSpend).toBeNull();
    expect(res.body.spendingPower.savingsRate).toBe(0.75);
    expect(typeof res.body.spendingPower.explanation).toBe("string");
  });

  it("computes safe-to-spend when household monthly savings target is set", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdRow = await sqlStmt(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    await sqlStmt(`UPDATE household SET monthly_savings_target_usd = ? WHERE id = ?`).run(300, householdRow.household_id);

    const res = await request(app)
      .get("/reports/cash-summary?preset=rolling_30")
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.spendingPower.monthlySavingsTargetUsd).toBe(300);
    expect(res.body.spendingPower.savingsTargetApplied).not.toBeNull();
    expect(res.body.spendingPower.safeToSpend).not.toBeNull();
    expect(res.body.spendingPower.safeToSpend).toBeCloseTo(
      res.body.household.net - (res.body.spendingPower.savingsTargetApplied as number),
      5
    );

    await sqlStmt(`UPDATE household SET monthly_savings_target_usd = NULL WHERE id = ?`).run(householdRow.household_id);
  });

  it("excludes transfer rows from KPI and category aggregation", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const ownerUserId = "20000000-0000-0000-0000-000000000001";

    const incomeCat = "30000000-0000-0000-0000-000000000001";
    const housingCat = "30000000-0000-0000-0000-000000000002";

    const asOf = new Date(Date.UTC(1990, 0, 1 + crypto.randomInt(0, 20000))).toISOString().slice(0, 10);

    // Normal (non-transfer) transactions.
    const normalAccountId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Non-transfer Cash Summary Test', '0001', 'USD', CURRENT_TIMESTAMP)`
    ).run(normalAccountId, householdId, ownerUserId);

    // Transfer accounts (transfers are excluded from reporting).
    const transferCreditAccountId = crypto.randomUUID();
    const transferDebitAccountId = crypto.randomUUID();
    const transferGroupId = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'savings', 'Transfer Cash Summary Credit Test', '0002', 'USD', CURRENT_TIMESTAMP)`
    ).run(transferCreditAccountId, householdId, ownerUserId);

    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Transfer Cash Summary Debit Test', '0003', 'USD', CURRENT_TIMESTAMP)`
    ).run(transferDebitAccountId, householdId, ownerUserId);

    const salaryId = crypto.randomUUID();
    const rentId = crypto.randomUUID();
    const transferCreditId = crypto.randomUUID();
    const transferDebitId = crypto.randomUUID();
    const fp1 = crypto.randomBytes(32).toString("hex");
    const fp2 = crypto.randomBytes(32).toString("hex");
    const fp3 = crypto.randomBytes(32).toString("hex");
    const fp4 = crypto.randomBytes(32).toString("hex");

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      salaryId,
      householdId,
      normalAccountId,
      incomeCat,
      asOf,
      1000,
      "credit",
      "Salary payment",
      fp1,
      "test:salary"
    );

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      rentId,
      householdId,
      normalAccountId,
      housingCat,
      asOf,
      -250.5,
      "debit",
      "Rent payment",
      fp2,
      "test:rent"
    );

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'posted')`
    ).run(
      transferCreditId,
      householdId,
      transferCreditAccountId,
      incomeCat,
      asOf,
      999,
      "credit",
      "Transfer credit",
      transferGroupId,
      fp3,
      "test:transfer-credit"
    );

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'posted')`
    ).run(
      transferDebitId,
      householdId,
      transferDebitAccountId,
      housingCat,
      asOf,
      -999,
      "debit",
      "Transfer debit",
      transferGroupId,
      fp4,
      "test:transfer-debit"
    );

    const res = await request(app).get(
      `/reports/cash-summary?preset=rolling_30&asOf=${encodeURIComponent(asOf)}&categoryBreakdown=true&categoryRollup=leaf`
    ).set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.household.inflows).toBe(1000);
    expect(res.body.household.outflows).toBe(250.5);
    expect(res.body.household.net).toBe(749.5);
    expect(res.body.household.transactionCount).toBe(2);

    expect(Array.isArray(res.body.byCategory)).toBe(true);
    expect(res.body.byCategory).toHaveLength(2);
    const housing = res.body.byCategory.find((r: { categoryName: string }) => r.categoryName === "Housing");
    const income = res.body.byCategory.find((r: { categoryName: string }) => r.categoryName === "Income");
    expect(housing).toBeDefined();
    expect(income).toBeDefined();
    expect(housing.outflows).toBe(250.5);
    expect(housing.inflows).toBe(0);
    expect(income.inflows).toBe(1000);
    expect(income.outflows).toBe(0);
    expect(res.body.byCategory.some((r: { categoryName: string }) => r.categoryName === "Uncategorized")).toBe(false);

    expect(Array.isArray(res.body.monthlyOutflowsByCategory)).toBe(true);
    const monthRow = res.body.monthlyOutflowsByCategory.find(
      (m: { month: string }) => m.month === asOf.slice(0, 7)
    );
    expect(monthRow).toBeDefined();
    const seg = monthRow.segments.find((s: { categoryName: string }) => s.categoryName === "Housing");
    expect(seg.outflows).toBe(250.5);
  });

  it("excludes confirmed transfer pairs (transfer_group_id) but includes transfer_ambiguity rows from cash summary", async () => {
    // transfer_ambiguity resolution items are intentionally NOT excluded from cash summary;
    // both legs of an internal transfer net to zero in household-level reporting anyway.
    // Only confirmed transfer pairs (transfer_group_id IS NOT NULL) are excluded.
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const ownerUserId = "20000000-0000-0000-0000-000000000001";

    const asOf = "1999-12-21";
    const accountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Transfer Ambiguity Cash Summary Test', '0999', 'USD', CURRENT_TIMESTAMP)`
    ).run(accountId, householdId, ownerUserId);

    const includeId = crypto.randomUUID();
    const ambiguousId = crypto.randomUUID();
    const confirmedTransferId = crypto.randomUUID();
    const tGroupId = crypto.randomUUID();
    // Plain grocery transaction — always included
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'Groceries', NULL, NULL, ?, ?, 'posted')`
    ).run(includeId, householdId, accountId, asOf, -50, crypto.randomBytes(32).toString("hex"), "test:include");
    // Suspected-transfer row (transfer_ambiguity RI, no transfer_group_id) — included in cash summary
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'Card payment candidate', NULL, NULL, ?, ?, 'posted')`
    ).run(ambiguousId, householdId, accountId, asOf, -700, crypto.randomBytes(32).toString("hex"), "test:ambiguous");
    await sqlStmt(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'transfer_ambiguity', ?, ?, 'open')`
    ).run(
      crypto.randomUUID(),
      householdId,
      ambiguousId,
      JSON.stringify({ kind: "transfer_ambiguity" })
    );
    // Confirmed transfer row (transfer_group_id IS NOT NULL) — excluded from cash summary
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'Confirmed transfer', NULL, ?, ?, ?, 'posted')`
    ).run(confirmedTransferId, householdId, accountId, asOf, -999, tGroupId, crypto.randomBytes(32).toString("hex"), "test:confirmed");

    const res = await request(app)
      .get(`/reports/cash-summary?preset=rolling_30&asOf=${encodeURIComponent(asOf)}&accountId=${accountId}`)
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.household.inflows).toBe(0);
    // Both the grocery ($50) and the suspected-transfer ($700) are included; confirmed transfer ($999) is excluded.
    expect(res.body.household.outflows).toBe(750);
    expect(res.body.household.net).toBe(-750);
    expect(res.body.household.transactionCount).toBe(2);
  });

  it("returns byCategory and monthlyOutflowsByCategory when categoryBreakdown=true", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const testAccountId = crypto.randomUUID();
    const incomeCat = "30000000-0000-0000-0000-000000000001";
    const housingCat = "30000000-0000-0000-0000-000000000002";
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, '20000000-0000-0000-0000-000000000001', 'checking', 'Category Report Test', '9997', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId);

    const asOf = new Date().toISOString().slice(0, 10);
    const fp1 = crypto.randomBytes(32).toString("hex");
    const fp2 = crypto.randomBytes(32).toString("hex");
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id1, householdId, testAccountId, incomeCat, asOf, 1000, "credit", "pay", null, fp1, "test:cat1");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id2, householdId, testAccountId, housingCat, asOf, -250.5, "debit", "rent", null, fp2, "test:cat2");

    const res = await request(app)
      .get(
        `/reports/cash-summary?preset=rolling_30&asOf=${encodeURIComponent(asOf)}&categoryBreakdown=true&categoryRollup=leaf&accountId=${testAccountId}`
      )
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.byCategory)).toBe(true);
    expect(res.body.byCategory).toHaveLength(2);
    const housing = res.body.byCategory.find((r: { categoryName: string }) => r.categoryName === "Housing");
    const income = res.body.byCategory.find((r: { categoryName: string }) => r.categoryName === "Income");
    expect(housing).toBeDefined();
    expect(housing.outflows).toBe(250.5);
    expect(income).toBeDefined();
    expect(income.inflows).toBe(1000);

    // Epic 7: per-category prior-window totals/deltas are included with `categoryBreakdown=true`.
    // In this test scenario, all seeded transactions are on `asOf`, so the previous rolling window contains 0 rows.
    expect(housing.previousInflows).toBe(0);
    expect(housing.previousOutflows).toBe(0);
    expect(housing.previousNet).toBe(0);
    expect(housing.deltaInflows).toBe(0);
    expect(housing.deltaOutflows).toBe(250.5);
    expect(housing.deltaNet).toBe(-250.5);

    expect(income.previousInflows).toBe(0);
    expect(income.previousOutflows).toBe(0);
    expect(income.previousNet).toBe(0);
    expect(income.deltaInflows).toBe(1000);
    expect(income.deltaOutflows).toBe(0);
    expect(income.deltaNet).toBe(1000);

    expect(Array.isArray(res.body.monthlyOutflowsByCategory)).toBe(true);
    expect(res.body.monthlyOutflowsByCategory.length).toBe(6);
    const asOfYm = asOf.slice(0, 7);
    const monthRow = res.body.monthlyOutflowsByCategory.find(
      (m: { month: string }) => m.month === asOfYm
    );
    expect(monthRow).toBeDefined();
    expect(Array.isArray(monthRow.segments)).toBe(true);
    const seg = monthRow.segments.find((s: { categoryName: string }) => s.categoryName === "Housing");
    expect(seg.outflows).toBe(250.5);
  });

  it("returns month-over-month and year-over-year comparison deltas for month preset", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const ownerUserId = "20000000-0000-0000-0000-000000000001";
    const testAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Comparison Month Test', '7788', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId, ownerUserId);

    const currentYm = "2099-03";
    const prevYm = "2099-02";
    const yoyYm = "2098-03";
    const currentDate = `${currentYm}-05`;
    const prevDate = `${prevYm}-05`;
    const yoyDate = `${yoyYm}-05`;

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      currentDate,
      1000,
      "credit",
      "month-current-credit",
      crypto.randomBytes(32).toString("hex"),
      "test:month-current-credit"
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      currentDate,
      -400,
      "debit",
      "month-current-debit",
      crypto.randomBytes(32).toString("hex"),
      "test:month-current-debit"
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      prevDate,
      700,
      "credit",
      "month-prev-credit",
      crypto.randomBytes(32).toString("hex"),
      "test:month-prev-credit"
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      prevDate,
      -300,
      "debit",
      "month-prev-debit",
      crypto.randomBytes(32).toString("hex"),
      "test:month-prev-debit"
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      yoyDate,
      600,
      "credit",
      "month-yoy-credit",
      crypto.randomBytes(32).toString("hex"),
      "test:month-yoy-credit"
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      yoyDate,
      -100,
      "debit",
      "month-yoy-debit",
      crypto.randomBytes(32).toString("hex"),
      "test:month-yoy-debit"
    );

    const res = await request(app)
      .get(`/reports/cash-summary?preset=month&month=${currentYm}&accountId=${testAccountId}`)
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.comparison.previousPeriod.delta.inflows).toBe(300);
    expect(res.body.comparison.previousPeriod.delta.outflows).toBe(100);
    expect(res.body.comparison.previousPeriod.delta.net).toBe(200);
    expect(res.body.comparison.yearOverYear.delta.inflows).toBe(400);
    expect(res.body.comparison.yearOverYear.delta.outflows).toBe(300);
    expect(res.body.comparison.yearOverYear.delta.net).toBe(100);
  });

  it("returns previous comparable window deltas for rolling preset", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const ownerUserId = "20000000-0000-0000-0000-000000000001";
    const testAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Comparison Rolling Test', '8899', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId, ownerUserId);

    const asOf = "2099-03-30";
    const currentWindowDate = "2099-03-25";
    const previousWindowDate = "2099-02-25";

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      currentWindowDate,
      1000,
      "credit",
      "rolling-current-credit",
      crypto.randomBytes(32).toString("hex"),
      "test:rolling-current-credit"
    );
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, 'posted')`
    ).run(
      crypto.randomUUID(),
      householdId,
      testAccountId,
      previousWindowDate,
      700,
      "credit",
      "rolling-prev-credit",
      crypto.randomBytes(32).toString("hex"),
      "test:rolling-prev-credit"
    );

    const res = await request(app)
      .get(`/reports/cash-summary?preset=rolling_30&asOf=${asOf}&accountId=${testAccountId}`)
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.comparison.previousPeriod.range.start).toBe("2099-01-30");
    expect(res.body.comparison.previousPeriod.range.end).toBe("2099-02-28");
    expect(res.body.comparison.previousPeriod.delta.inflows).toBe(300);
    expect(res.body.comparison.previousPeriod.delta.net).toBe(300);
    expect(res.body.comparison.yearOverYear).toBeUndefined();
  });

  it("returns 404 for account filter outside household", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app)
      .get(`/reports/cash-summary?preset=rolling_30&accountId=${crypto.randomUUID()}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("returns 400 when only one of dateFrom/dateTo is provided", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/cash-summary?dateFrom=2025-01-01")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("dateFrom");
  });

  it("returns 400 when preset is omitted and custom dates are not set", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/cash-summary?asOf=2025-06-01")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/preset/i);
  });

  it("returns 400 for custom range with dateFrom after dateTo", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/cash-summary?dateFrom=2025-06-10&dateTo=2025-06-01")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("INVALID_DATE_ORDER");
  });

  it("returns 400 for custom range longer than configured max inclusive days", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/cash-summary?dateFrom=2018-01-01&dateTo=2025-06-01")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("CUSTOM_RANGE_TOO_LONG");
  });

  it("aggregates KPIs for an inclusive custom dateFrom/dateTo range", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const testAccountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, '20000000-0000-0000-0000-000000000001', 'checking', 'Custom Range Cash Summary', '9996', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId);

    const inRange = "2010-05-15";
    const outRange = "2010-01-01";
    const fp1 = crypto.randomBytes(32).toString("hex");
    const fp2 = crypto.randomBytes(32).toString("hex");
    const fp3 = crypto.randomBytes(32).toString("hex");
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const id3 = crypto.randomUUID();

    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id1, householdId, testAccountId, inRange, 100, "credit", "in", null, fp1, "test:custom-in");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id2, householdId, testAccountId, inRange, -40, "debit", "out", null, fp2, "test:custom-out");
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id3, householdId, testAccountId, outRange, 999, "credit", "outside", null, fp3, "test:custom-outside");

    const res = await request(app)
      .get(
        `/reports/cash-summary?dateFrom=2010-05-01&dateTo=2010-05-31&breakdown=true&accountId=${testAccountId}`
      )
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.range.preset).toBe("custom");
    expect(res.body.range.start).toBe("2010-05-01");
    expect(res.body.range.end).toBe("2010-05-31");
    expect(res.body.asOf).toBe("2010-05-31");
    expect(res.body.household.inflows).toBe(100);
    expect(res.body.household.outflows).toBe(40);
    expect(res.body.household.net).toBe(60);
    expect(res.body.household.transactionCount).toBe(2);
    // Same-length prior window as rolling presets (31 days May 1–31 → Mar 31 – Apr 30).
    expect(res.body.comparison.previousPeriod.range.start).toBe("2010-03-31");
    expect(res.body.comparison.previousPeriod.range.end).toBe("2010-04-30");
  });
});

describe("household settings", () => {
  it("GET and PATCH monthly savings target", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;

    const g = await request(app).get("/household/settings").set("authorization", `Bearer ${token}`);
    expect(g.status).toBe(200);
    expect(g.body).toHaveProperty("monthlySavingsTargetUsd");
    expect(g.body).toHaveProperty("salaryDepositFinancialAccountId");
    expect(g.body).toHaveProperty("employers");
    expect(Array.isArray(g.body.employers)).toBe(true);

    const p = await request(app)
      .patch("/household/settings")
      .set("authorization", `Bearer ${token}`)
      .send({ monthlySavingsTargetUsd: 750 });
    expect(p.status).toBe(200);
    expect(p.body.monthlySavingsTargetUsd).toBe(750);

    const p2 = await request(app)
      .patch("/household/settings")
      .set("authorization", `Bearer ${token}`)
      .send({ monthlySavingsTargetUsd: null });
    expect(p2.status).toBe(200);
    expect(p2.body.monthlySavingsTargetUsd).toBeNull();
  });

  it("PATCH profile: salary deposit account and employers (person_profile)", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const checking = "40000000-0000-0000-0000-000000000001";

    const p = await request(app)
      .patch("/household/profile")
      .set("authorization", `Bearer ${token}`)
      .send({
        salaryDepositFinancialAccountId: checking,
        employers: [{ displayName: "Test Employer", parserProfileId: "ibm_pay_contributions_pdf", parserMapping: {} }]
      });
    expect(p.status).toBe(200);

    const settings = await request(app).get("/household/settings").set("authorization", `Bearer ${token}`);
    expect(settings.status).toBe(200);
    expect(settings.body.salaryDepositFinancialAccountId).toBe(checking);
    expect(Array.isArray(settings.body.employers)).toBe(true);
    expect(settings.body.employers[0].displayName).toBe("Test Employer");
    expect(settings.body.employers[0].parserProfileId).toBe("ibm_pay_contributions_pdf");

    const clear = await request(app)
      .patch("/household/profile")
      .set("authorization", `Bearer ${token}`)
      .send({ salaryDepositFinancialAccountId: null, employers: [] });
    expect(clear.status).toBe(200);

    const after = await request(app).get("/household/settings").set("authorization", `Bearer ${token}`);
    expect(after.status).toBe(200);
    expect(after.body.salaryDepositFinancialAccountId).toBeNull();
    expect(after.body.employers).toEqual([]);
  });

  it("PATCH profile: per-employer salary deposit accounts persist independently in employers_json", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const checking = SEED_BOA_CHECKING;
    const chase = SEED_CHASE_CC;

    const p = await request(app)
      .patch("/household/profile")
      .set("authorization", `Bearer ${token}`)
      .send({
        employers: [
          {
            displayName: "IBM",
            parserProfileId: "ibm_pay_contributions_pdf",
            parserMapping: {},
            salaryDepositFinancialAccountId: checking
          },
          {
            displayName: "Deloitte",
            parserProfileId: "deloitte_payslip_pdf",
            parserMapping: {},
            salaryDepositFinancialAccountId: chase
          }
        ]
      });
    expect(p.status).toBe(200);

    const settings = await request(app).get("/household/settings").set("authorization", `Bearer ${token}`);
    expect(settings.status).toBe(200);
    expect(settings.body.salaryDepositFinancialAccountId).toBe(checking);
    expect(settings.body.employers).toHaveLength(2);
    expect(settings.body.employers[0].salaryDepositFinancialAccountId).toBe(checking);
    expect(settings.body.employers[1].salaryDepositFinancialAccountId).toBe(chase);
  });
});

describe("resolution summary (DOC-005 orphan count)", () => {
  it("GET /resolution/summary includes openDuplicateAmbiguityNotOnLedger", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const res = await request(app).get("/resolution/summary").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("openDuplicateAmbiguityNotOnLedger");
    expect(typeof res.body.openDuplicateAmbiguityNotOnLedger).toBe("number");
  });
});

describe("member ownership closure", () => {
  it("persists owner scope/person on import file binding", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const sessionResponse = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    const sessionId = sessionResponse.body.session.id as string;
    const uploadRes = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", Buffer.from("Date,Description,Amount\n2026-08-01,Owned,-1"), "owned.csv");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.files[0].id as string;
    const ownerProfile = await sqlStmt(`SELECT id FROM person_profile WHERE linked_user_id = ?`).get(
      "20000000-0000-0000-0000-000000000001"
    ) as { id: string };
    const bind = await request(app)
      .patch(`/imports/sessions/${sessionId}/files/${fileId}`)
      .set("authorization", `Bearer ${token}`)
      .send({
        financialAccountId: SEED_BOA_CHECKING,
        parserProfileId: "generic_tabular",
        ownerScope: "person",
        ownerPersonProfileId: ownerProfile.id
      });
    expect(bind.status).toBe(200);
    const row = (await sqlStmt(
      `SELECT owner_scope, owner_person_profile_id FROM import_file WHERE id = ?`
    ).get(fileId)) as { owner_scope: string; owner_person_profile_id: string | null };
    expect(row.owner_scope).toBe("person");
    expect(row.owner_person_profile_id).toBe(ownerProfile.id);
  });

  it("filters transactions and cash summary by owner", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const ownerUserId = "20000000-0000-0000-0000-000000000001";
    let ownerProfile = (await sqlStmt(`SELECT id FROM person_profile WHERE linked_user_id = ?`).get(
      ownerUserId
    )) as { id: string } | undefined;
    if (!ownerProfile) {
      const profileId = crypto.randomUUID();
      await sqlStmt(
        `INSERT INTO person_profile (id, household_id, linked_user_id, full_name, email)
         VALUES (?, ?, ?, 'Owner', 'owner@example.com')`
      ).run(profileId, householdId, ownerUserId);
      ownerProfile = { id: profileId };
    }
    const txnId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status, owner_scope, owner_person_profile_id
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'credit', 'owner-filter-target', NULL, NULL, ?, 'manual:owner-target', 'posted', 'person', ?)`
    ).run(
      txnId,
      householdId,
      SEED_BOA_CHECKING,
      "30000000-0000-0000-0000-000000000001",
      "2026-03-20",
      321,
      crypto.randomBytes(32).toString("hex"),
      ownerProfile.id
    );

    const tx = await request(app)
      .get(`/transactions?ownerScope=person&ownerPersonProfileId=${ownerProfile.id}&search=owner-filter-target`)
      .set("authorization", `Bearer ${token}`);
    expect(tx.status).toBe(200);
    expect(tx.body.transactions.some((t: { id: string }) => t.id === txnId)).toBe(true);

    const sum = await request(app)
      .get(
        `/reports/cash-summary?preset=rolling_30&asOf=2026-03-31&ownerScope=person&ownerPersonProfileId=${ownerProfile.id}`
      )
      .set("authorization", `Bearer ${token}`);
    expect(sum.status).toBe(200);
    expect(sum.body.household.inflows).toBeGreaterThan(0);
  });
});

describe("balance sheet (reports)", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/reports/balance-sheet");
    expect(res.status).toBe(401);
  });

  it("POST manual balance then GET balance-sheet includes asset row", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const asOf = "2026-06-30";
    const post = await request(app)
      .post("/reports/balance-sheet/manual")
      .set("authorization", `Bearer ${token}`)
      .send({
        financialAccountId: SEED_BOA_CHECKING,
        asOfDate: "2026-06-15",
        amount: 4321,
        currency: "USD"
      });
    expect(post.status).toBe(201);

    const get = await request(app)
      .get(`/reports/balance-sheet?asOf=${encodeURIComponent(asOf)}`)
      .set("authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.asOf).toBe(asOf);
    const row = get.body.assets.find((a: { financialAccountId: string }) => a.financialAccountId === SEED_BOA_CHECKING);
    expect(row).toBeDefined();
    expect(row.balance).toBe(4321);
    expect(row.balanceSource).toBe("manual");
    expect(typeof get.body.totals.netWorth).toBe("number");
  });

  it("GET balance-sheet uses persisted import snapshot when present", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const snapId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO account_balance_snapshot (id, household_id, financial_account_id, as_of_date, amount, currency, source, import_file_id)
       VALUES (?, ?, ?, ?::date, ?, ?, 'import', NULL)`
    ).run(snapId, householdId, SEED_MARCUS_SAVINGS, "2025-12-31", 7777.5, "USD");

    try {
      const get = await request(app)
        .get("/reports/balance-sheet?asOf=2026-06-30")
        .set("authorization", `Bearer ${token}`);
      expect(get.status).toBe(200);
      const row = get.body.assets.find(
        (a: { financialAccountId: string }) => a.financialAccountId === SEED_MARCUS_SAVINGS
      );
      expect(row).toBeDefined();
      expect(row.balance).toBe(7777.5);
      expect(row.balanceSource).toBe("import");
      expect(row.balanceAsOf).toBe("2025-12-31");
    } finally {
      await sqlStmt(`DELETE FROM account_balance_snapshot WHERE id = ?`).run(snapId);
    }
  });

  it("GET balance-sheet/history returns monthly points", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/balance-sheet/history?from=2026-01-01&to=2026-03-31&interval=month")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe("month");
    expect(Array.isArray(res.body.points)).toBe(true);
    expect(res.body.points.length).toBeGreaterThanOrEqual(1);
    const first = res.body.points[0];
    expect(first).toHaveProperty("asOf");
    expect(first).toHaveProperty("totals");
    expect(first.totals).toHaveProperty("netWorth");
  });

  it("GET balance-sheet/history rejects too many day samples", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/balance-sheet/history?from=2025-01-01&to=2025-12-31&interval=day")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BALANCE_HISTORY_TOO_MANY_POINTS");
  });

  it("GET balance-sheet rejects ownerScope=person without ownerPersonProfileId", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const res = await request(app)
      .get("/reports/balance-sheet?asOf=2026-06-30&ownerScope=person")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("GET balance-sheet/history includes accounts when accountIds provided", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const res = await request(app)
      .get(
        `/reports/balance-sheet/history?from=2026-01-01&to=2026-03-31&interval=month&accountIds=${SEED_BOA_CHECKING}`
      )
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.points.length).toBeGreaterThan(0);
    const p0 = res.body.points[0];
    expect(Array.isArray(p0.accounts)).toBe(true);
    expect(p0.accounts.some((a: { financialAccountId: string }) => a.financialAccountId === SEED_BOA_CHECKING)).toBe(
      true
    );
  });
});
