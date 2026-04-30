import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp();
const SEED_BOA_CHECKING = "40000000-0000-0000-0000-000000000001";

const BANK_CSV = [
  "Date,Description,Amount,Running Bal.",
  "01/15/2026,POS PURCHASE COFFEE,-12.34,1234.56",
  "01/16/2026,PAYROLL DEPOSIT,2500.00,3734.56"
].join("\n");

async function loginOwner(): Promise<string> {
  const response = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

describe("CR-118 imports upload flow", () => {
  it("bank upload happy path returns added/duplicate counts", async () => {
    const token = await loginOwner();

    const response = await request(app)
      .post("/imports/upload")
      .set("authorization", `Bearer ${token}`)
      .field("importType", "bank")
      .field("financialAccountId", SEED_BOA_CHECKING)
      .attach("file", Buffer.from(BANK_CSV), "boa-checking.csv");

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("bank");
    expect(Number(response.body.addedCount)).toBeGreaterThan(0);
    expect(Number(response.body.duplicateCount)).toBeGreaterThanOrEqual(0);
    expect(typeof response.body.sessionId).toBe("string");
  });

  it("duplicate upload returns zero added and duplicate count", async () => {
    const token = await loginOwner();

    const first = await request(app)
      .post("/imports/upload")
      .set("authorization", `Bearer ${token}`)
      .field("importType", "bank")
      .field("financialAccountId", SEED_BOA_CHECKING)
      .attach("file", Buffer.from(BANK_CSV), "boa-checking-dup.csv");
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/imports/upload")
      .set("authorization", `Bearer ${token}`)
      .field("importType", "bank")
      .field("financialAccountId", SEED_BOA_CHECKING)
      .attach("file", Buffer.from(BANK_CSV), "boa-checking-dup.csv");
    expect(second.status).toBe(200);
    expect(second.body.type).toBe("bank");
    expect(Number(second.body.addedCount)).toBe(0);
    expect(Number(second.body.duplicateCount)).toBeGreaterThan(0);
  });

  it("profile inference failure returns 422 with PROFILE_INFERENCE_FAILED", async () => {
    const token = await loginOwner();

    const response = await request(app)
      .post("/imports/upload")
      .set("authorization", `Bearer ${token}`)
      .field("importType", "bank")
      .field("financialAccountId", SEED_BOA_CHECKING)
      .attach("file", Buffer.from("not a csv"), "statement.txt");

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("PROFILE_INFERENCE_FAILED");
  });

  it("history includes bank item canUndo=true, then undo sets canUndo=false", async () => {
    const token = await loginOwner();

    const upload = await request(app)
      .post("/imports/upload")
      .set("authorization", `Bearer ${token}`)
      .field("importType", "bank")
      .field("financialAccountId", SEED_BOA_CHECKING)
      .attach("file", Buffer.from(BANK_CSV), "boa-history.csv");

    expect(upload.status).toBe(200);
    const sessionId = upload.body.sessionId as string;

    const beforeUndo = await request(app)
      .get("/imports/history")
      .set("authorization", `Bearer ${token}`);
    expect(beforeUndo.status).toBe(200);
    const beforeItem = (beforeUndo.body.items as Array<{ id: string; type: string; canUndo: boolean }>).find(
      (item) => item.id === sessionId && item.type === "bank"
    );
    expect(beforeItem).toBeDefined();
    expect(beforeItem?.canUndo).toBe(true);

    const undo = await request(app)
      .post(`/imports/sessions/${sessionId}/undo-import`)
      .set("authorization", `Bearer ${token}`);
    expect(undo.status).toBe(200);

    const afterUndo = await request(app)
      .get("/imports/history")
      .set("authorization", `Bearer ${token}`);
    expect(afterUndo.status).toBe(200);
    const afterItem = (afterUndo.body.items as Array<{ id: string; type: string; canUndo: boolean }>).find(
      (item) => item.id === sessionId && item.type === "bank"
    );
    expect(afterItem).toBeDefined();
    expect(afterItem?.canUndo).toBe(false);
  });

  it("GET /imports/accounts returns freshness fields after successful import upload", async () => {
    const token = await loginOwner();

    const upload = await request(app)
      .post("/imports/upload")
      .set("authorization", `Bearer ${token}`)
      .field("importType", "bank")
      .field("financialAccountId", SEED_BOA_CHECKING)
      .attach("file", Buffer.from(BANK_CSV), "boa-freshness.csv");
    expect(upload.status).toBe(200);

    const accountsRes = await request(app).get("/imports/accounts").set("authorization", `Bearer ${token}`);
    expect(accountsRes.status).toBe(200);
    const account = (accountsRes.body.accounts as Array<Record<string, unknown>>).find((a) => a.id === SEED_BOA_CHECKING);
    expect(account).toBeDefined();
    expect(typeof account?.last_uploaded_at).toBe("string");
    expect("last_statement_end_date" in (account ?? {})).toBe(true);
  });
});
