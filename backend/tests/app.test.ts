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
