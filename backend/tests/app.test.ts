import crypto from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import request from "supertest";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildApp } from "../src/app.js";
import { db } from "../src/db/sqlite.js";
import { resolveDataPath } from "../src/paths.js";

const app = buildApp();

/** Seeded in `0002_seed_financial_accounts.sql` */
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

    db.prepare(
      `INSERT INTO household (id, name, created_at)
       VALUES (?, 'Other household', CURRENT_TIMESTAMP)`
    ).run(otherHouseholdId);
    db.prepare(
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

    const csv = [
      "Date,Description,Amount,Reference",
      "2026-03-01,Starbucks Coffee,-4.50,ref-1",
      "2026-03-02,Salary,3200.00,ref-2"
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

    const csv = [
      "Date,Description,Amount,Reference",
      "2026-04-01,STARBUCKS COFFEE,-5.00,ref-n1",
      "2026-04-01,STARBUCKS COFFEE STORE,-5.00,ref-n2"
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

    const openResolution = db
      .prepare(
        `SELECT COUNT(*) AS c FROM resolution_item WHERE household_id = (SELECT household_id FROM import_session WHERE id = ?) AND type = 'duplicate_ambiguity' AND status = 'open'`
      )
      .get(sessionId) as { c: number };
    expect(openResolution.c).toBeGreaterThanOrEqual(1);
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
    const owner = db.prepare(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const debitAccountId = crypto.randomUUID();
    const creditAccountId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Transfer Match Test A', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(debitAccountId, householdId, ownerUserId);
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'savings', 'Transfer Match Test B', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(creditAccountId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    db.prepare(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'transfer.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const txnDate = "1999-12-25";
    const debitDesc = "Transfer to owned savings";
    const creditDesc = "Transfer from owned checking";
    const rawCreditId = crypto.randomUUID();
    const rawDebitId = crypto.randomUUID();

    db.prepare(
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
    db.prepare(
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

    const creditRow = db.prepare(
      `SELECT id, transfer_group_id FROM transaction_canonical
       WHERE household_id = ? AND account_id = ? AND txn_date = ? AND amount = ? AND merchant = ?`
    ).get(householdId, creditAccountId, txnDate, 200, creditDesc) as { id: string; transfer_group_id: string | null };

    const debitRow = db.prepare(
      `SELECT id, transfer_group_id FROM transaction_canonical
       WHERE household_id = ? AND account_id = ? AND txn_date = ? AND amount = ? AND merchant = ?`
    ).get(householdId, debitAccountId, txnDate, -200, debitDesc) as { id: string; transfer_group_id: string | null };

    expect(creditRow).toBeDefined();
    expect(debitRow).toBeDefined();
    expect(creditRow.transfer_group_id).not.toBeNull();
    expect(debitRow.transfer_group_id).not.toBeNull();
    expect(creditRow.transfer_group_id).toBe(debitRow.transfer_group_id);
  });

  it("matches credit-card payment memo variants with 2-day date skew", async () => {
    const token = await loginAndGetToken();
    const owner = db.prepare(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAccountId = crypto.randomUUID();
    const cardAccountId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Payment Match Test Checking', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAccountId, householdId, ownerUserId);
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'credit_card', 'Payment Match Test Card', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(cardAccountId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    db.prepare(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'payment-variants.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    const debitDate = "1999-12-20";
    const creditDate = "1999-12-22";
    const debitDesc = "AUTOPAY ACH PAYMENT TO CHASE CARD";
    const creditDesc = "PAYMENT RECEIVED - THANK YOU";
    const rawDebitId = crypto.randomUUID();
    const rawCreditId = crypto.randomUUID();

    db.prepare(
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
    db.prepare(
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

    const rows = db.prepare(
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

  it("keeps multi-candidate payment matches in transfer_ambiguity queue", async () => {
    const token = await loginAndGetToken();
    const owner = db.prepare(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAccountId = crypto.randomUUID();
    const cardAccountAId = crypto.randomUUID();
    const cardAccountBId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Ambiguity Test Checking', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAccountId, householdId, ownerUserId);
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'credit_card', 'Ambiguity Test Card A', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(cardAccountAId, householdId, ownerUserId);
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'credit_card', 'Ambiguity Test Card B', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(cardAccountBId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    db.prepare(
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
      db.prepare(
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

    const matchedCountRow = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM transaction_canonical
         WHERE household_id = ?
           AND account_id IN (?, ?, ?)
           AND transfer_group_id IS NOT NULL`
      )
      .get(householdId, checkingAccountId, cardAccountAId, cardAccountBId) as { c: number };
    expect(matchedCountRow.c).toBe(0);

    const ambiguityRows = db
      .prepare(
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
      )
      .all(householdId, householdId, checkingAccountId, cardAccountAId, cardAccountBId) as Array<{
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
    const owner = db.prepare(`SELECT id, household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      id: string;
      household_id: string;
    };
    const householdId = owner.household_id;
    const ownerUserId = owner.id;

    const checkingAId = crypto.randomUUID();
    const checkingBId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'No-FP Test A', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingAId, householdId, ownerUserId);
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'No-FP Test B', NULL, 'USD', CURRENT_TIMESTAMP)`
    ).run(checkingBId, householdId, ownerUserId);

    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO import_session (id, household_id, source_type, status, started_at)
       VALUES (?, ?, 'upload', 'review', CURRENT_TIMESTAMP)`
    ).run(sessionId, householdId);
    db.prepare(
      `INSERT INTO import_file (id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
       VALUES (?, ?, 'generic-payment-words.csv', ?, NULL, 'parsed', '{}')`
    ).run(fileId, sessionId, crypto.randomBytes(32).toString("hex"));

    db.prepare(
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
    db.prepare(
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

    const matchedCount = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM transaction_canonical
         WHERE household_id = ?
           AND account_id IN (?, ?)
           AND transfer_group_id IS NOT NULL`
      )
      .get(householdId, checkingAId, checkingBId) as { c: number };
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

  it("parses BoA eStatement PDF using boa_estatement_pdf when fixture exists", async () => {
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

  it("parses real BoA checking CSV from repo when fixture exists", async () => {
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

    const csv = [
      "Date,Description,Amount,Reference",
      "2026-08-01,Ledger test A,-3.33,ref-lt-a",
      "2026-08-02,Ledger test B,4444.44,ref-lt-b"
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

    const ledger = await request(app)
      .get("/transactions?limit=50")
      .set("authorization", `Bearer ${token}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.total).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(ledger.body.transactions)).toBe(true);
    expect(ledger.body.transactions.some((t: { merchant?: string }) => t.merchant?.includes("Ledger test"))).toBe(true);

    const scoped = await request(app)
      .get(`/transactions?sessionId=${sessionId}&limit=50`)
      .set("authorization", `Bearer ${token}`);
    expect(scoped.status).toBe(200);
    expect(scoped.body.sessionId).toBe(sessionId);
    expect(scoped.body.total).toBe(2);
    expect(scoped.body.transactions.length).toBe(2);
  });

  it("returns 404 when ledger sessionId filter is not found for household", async () => {
    const token = await loginAndGetToken();
    const res = await request(app)
      .get("/transactions?sessionId=00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
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
    }
  });

  it("updates transaction category via PATCH", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id = crypto.randomUUID();
    const fp = crypto.randomBytes(32).toString("hex");
    const catId = "30000000-0000-0000-0000-000000000004";
    db.prepare(
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
    const household = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    db.prepare(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(crypto.randomUUID(), household.household_id, crypto.randomUUID(), "open item");
    db.prepare(
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
    const householdId = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id = crypto.randomUUID();
    db.prepare(
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
    db.prepare(
      `INSERT INTO household (id, name, created_at)
       VALUES (?, 'Other household 2', CURRENT_TIMESTAMP)`
    ).run(otherHouseholdId);
    const id = crypto.randomUUID();
    db.prepare(
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
    const householdId = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id = crypto.randomUUID();
    db.prepare(
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
    const householdId = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    db.prepare(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(id1, householdId.household_id, crypto.randomUUID(), "a");
    db.prepare(
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
    const householdId = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };

    const okId = crypto.randomUUID();
    const badTransitionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
    ).run(okId, householdId.household_id, crypto.randomUUID(), "ok");
    db.prepare(
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
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, '20000000-0000-0000-0000-000000000001', 'checking', 'Cash Summary Test', '9998', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId);

    const asOf = new Date().toISOString().slice(0, 10);
    const fp1 = crypto.randomBytes(32).toString("hex");
    const fp2 = crypto.randomBytes(32).toString("hex");
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    db.prepare(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id1, householdId, testAccountId, asOf, 1000, "credit", "pay", null, fp1, "test:cash1");
    db.prepare(
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
    expect(res.body.household.inflows).toBe(1000);
    expect(res.body.household.outflows).toBe(250.5);
    expect(res.body.household.net).toBe(749.5);
    expect(res.body.household.transactionCount).toBe(2);
    expect(Array.isArray(res.body.monthlyTrend)).toBe(true);
    expect(res.body.monthlyTrend.length).toBe(6);
    expect(Array.isArray(res.body.byAccount)).toBe(true);
    expect(res.body.byAccount).toHaveLength(1);
    expect(res.body.byAccount[0].accountId).toBe(testAccountId);
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

    const asOf = "1999-12-20";

    // Normal (non-transfer) transactions.
    const normalAccountId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Non-transfer Cash Summary Test', '0001', 'USD', CURRENT_TIMESTAMP)`
    ).run(normalAccountId, householdId, ownerUserId);

    // Transfer accounts (transfers are excluded from reporting).
    const transferCreditAccountId = crypto.randomUUID();
    const transferDebitAccountId = crypto.randomUUID();
    const transferGroupId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'savings', 'Transfer Cash Summary Credit Test', '0002', 'USD', CURRENT_TIMESTAMP)`
    ).run(transferCreditAccountId, householdId, ownerUserId);

    db.prepare(
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

    db.prepare(
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

    db.prepare(
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

    db.prepare(
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

    db.prepare(
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

  it("excludes transfer_ambiguity rows from cash summary aggregation", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    const token = login.body.token as string;
    const householdId = "10000000-0000-0000-0000-000000000001";
    const ownerUserId = "20000000-0000-0000-0000-000000000001";

    const asOf = "1999-12-21";
    const accountId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Transfer Ambiguity Cash Summary Test', '0999', 'USD', CURRENT_TIMESTAMP)`
    ).run(accountId, householdId, ownerUserId);

    const includeId = crypto.randomUUID();
    const ambiguousId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'Groceries', NULL, NULL, ?, ?, 'posted')`
    ).run(includeId, householdId, accountId, asOf, -50, crypto.randomBytes(32).toString("hex"), "test:include");
    db.prepare(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'debit', 'Card payment candidate', NULL, NULL, ?, ?, 'posted')`
    ).run(ambiguousId, householdId, accountId, asOf, -700, crypto.randomBytes(32).toString("hex"), "test:ambiguous");
    db.prepare(
      `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
       VALUES (?, ?, 'transfer_ambiguity', ?, ?, 'open')`
    ).run(
      crypto.randomUUID(),
      householdId,
      ambiguousId,
      JSON.stringify({ kind: "transfer_ambiguity", note: "cash summary exclusion regression guard" })
    );

    const res = await request(app)
      .get(`/reports/cash-summary?preset=rolling_30&asOf=${encodeURIComponent(asOf)}&accountId=${accountId}`)
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.household.inflows).toBe(0);
    expect(res.body.household.outflows).toBe(50);
    expect(res.body.household.net).toBe(-50);
    expect(res.body.household.transactionCount).toBe(1);
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
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, '20000000-0000-0000-0000-000000000001', 'checking', 'Category Report Test', '9997', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId);

    const asOf = new Date().toISOString().slice(0, 10);
    const fp1 = crypto.randomBytes(32).toString("hex");
    const fp2 = crypto.randomBytes(32).toString("hex");
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    db.prepare(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
         merchant, memo, transfer_group_id, fingerprint, source_ref, status
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
    ).run(id1, householdId, testAccountId, incomeCat, asOf, 1000, "credit", "pay", null, fp1, "test:cat1");
    db.prepare(
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
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Comparison Month Test', '7788', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId, ownerUserId);

    const currentYm = "2099-03";
    const prevYm = "2099-02";
    const yoyYm = "2098-03";
    const currentDate = `${currentYm}-05`;
    const prevDate = `${prevYm}-05`;
    const yoyDate = `${yoyYm}-05`;

    db.prepare(
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
    db.prepare(
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
    db.prepare(
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
    db.prepare(
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
    db.prepare(
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
    db.prepare(
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
    db.prepare(
      `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
       VALUES (?, ?, ?, 'checking', 'Comparison Rolling Test', '8899', 'USD', CURRENT_TIMESTAMP)`
    ).run(testAccountId, householdId, ownerUserId);

    const asOf = "2099-03-30";
    const currentWindowDate = "2099-03-25";
    const previousWindowDate = "2099-02-25";

    db.prepare(
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
    db.prepare(
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
});
