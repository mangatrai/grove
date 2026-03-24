import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import request from "supertest";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { db } from "../src/db/sqlite.js";
import { buildApp } from "../src/app.js";

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
      "2026-03-01,Coffee,-4.50,ref-1",
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

    const canRes2 = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes2.status).toBe(200);
    expect(canRes2.body.inserted).toBe(0);
    expect(canRes2.body.duplicates).toBe(2);
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
  });
});
