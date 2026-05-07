import crypto from "node:crypto";

import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();
const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";

async function login(): Promise<string> {
  const res = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

const merchantKeysToCleanup = new Set<string>();

afterEach(async () => {
  for (const merchantKey of merchantKeysToCleanup) {
    await sqlStmt(`DELETE FROM recurring_merchant_override WHERE household_id = ? AND merchant_key = ?`).run(
      HOUSEHOLD_ID,
      merchantKey
    );
  }
  merchantKeysToCleanup.clear();
});

describe("recurring overrides validation", () => {
  it("returns 400 when merchantKey is missing", async () => {
    const token = await login();
    const res = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${token}`)
      .send({ verdict: "confirmed" }); // no merchantKey
    expect(res.status).toBe(400);
  });

  it("returns 400 when verdict is missing", async () => {
    const token = await login();
    const res = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${token}`)
      .send({ merchantKey: "some-merchant" }); // no verdict
    expect(res.status).toBe(400);
  });

  it("returns 400 when verdict is not a recognised enum value", async () => {
    const token = await login();
    const res = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${token}`)
      .send({ merchantKey: "some-merchant", verdict: "maybe" }); // invalid enum
    expect(res.status).toBe(400);
  });

  it("returns 400 when merchantKey is an empty string", async () => {
    const token = await login();
    const res = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${token}`)
      .send({ merchantKey: "   ", verdict: "confirmed" }); // whitespace only, trims to ""
    expect(res.status).toBe(400);
  });
});

describe("recurring overrides household isolation", () => {
  // Second household created just for this describe block
  const h2Id = crypto.randomUUID();
  const h2UserId = crypto.randomUUID();
  const h2Email = `recurring-isolation-${h2Id.slice(0, 8)}@example.com`;
  const h2MerchantKey = `isolation-test-${h2Id.slice(0, 8)}`;
  let h2Token = "";

  beforeAll(async () => {
    await sqlStmt(`INSERT INTO household (id, name, created_at) VALUES (?, 'Isolation HH', CURRENT_TIMESTAMP)`).run(h2Id);
    await sqlStmt(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, 'owner', ?, 'all', CURRENT_TIMESTAMP)`
    ).run(
      h2UserId,
      h2Id,
      h2Email,
      "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO" // ChangeMe123!
    );
    await sqlStmt(`UPDATE household SET owner_user_id = ? WHERE id = ?`).run(h2UserId, h2Id);

    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: h2Email, password: "ChangeMe123!" });
    expect(loginRes.status).toBe(200);
    h2Token = loginRes.body.token as string;
  });

  afterAll(async () => {
    await sqlStmt(`DELETE FROM recurring_merchant_override WHERE household_id = ?`).run(h2Id);
    await sqlStmt(`UPDATE household SET owner_user_id = NULL WHERE id = ?`).run(h2Id);
    await sqlStmt(`DELETE FROM app_user WHERE id = ?`).run(h2UserId);
    await sqlStmt(`DELETE FROM household WHERE id = ?`).run(h2Id);
  });

  it("overrides created by household 2 are not visible to household 1", async () => {
    // HH2 creates an override
    const upsert = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${h2Token}`)
      .send({ merchantKey: h2MerchantKey, verdict: "confirmed" });
    expect(upsert.status).toBe(200);

    // HH1 (seeded) lists its overrides — should NOT see h2MerchantKey
    const h1Token = await login();
    const listRes = await request(app)
      .get("/recurring-overrides")
      .set("authorization", `Bearer ${h1Token}`);
    expect(listRes.status).toBe(200);
    const keys = (listRes.body.data as Array<{ merchantKey: string }>).map((r) => r.merchantKey);
    expect(keys).not.toContain(h2MerchantKey);
  });

  it("household 1 cannot delete household 2's override by id", async () => {
    // Get the override id that HH2 created
    const h2List = await request(app)
      .get("/recurring-overrides")
      .set("authorization", `Bearer ${h2Token}`);
    expect(h2List.status).toBe(200);
    const h2Override = (h2List.body.data as Array<{ merchantKey: string; id: string }>).find(
      (r) => r.merchantKey === h2MerchantKey
    );
    expect(h2Override).toBeDefined();

    // HH1 tries to delete it
    const h1Token = await login();
    const deleteRes = await request(app)
      .delete(`/recurring-overrides/${h2Override!.id}`)
      .set("authorization", `Bearer ${h1Token}`);
    expect(deleteRes.status).toBe(404); // not found for this household
  });
});

describe("recurring overrides auth guard", () => {
  it("returns 401 without JWT on all endpoints", async () => {
    const listRes = await request(app).get("/recurring-overrides");
    expect(listRes.status).toBe(401);

    const postRes = await request(app).post("/recurring-overrides").send({
      merchantKey: "spotify",
      verdict: "dismissed"
    });
    expect(postRes.status).toBe(401);

    const deleteRes = await request(app).delete("/recurring-overrides/00000000-0000-0000-0000-000000000000");
    expect(deleteRes.status).toBe(401);
  });
});

describe("recurring overrides CRUD", () => {
  it("POST upserts confirmed and dismissed overrides, GET lists them, DELETE removes them", async () => {
    const token = await login();
    const keyConfirmed = "netflix";
    const keyDismissed = "coffee shop";
    merchantKeysToCleanup.add(keyConfirmed);
    merchantKeysToCleanup.add(keyDismissed);

    const upsertConfirmed = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${token}`)
      .send({
        merchantKey: keyConfirmed,
        displayName: "Netflix",
        verdict: "confirmed",
        amountAnchor: 18.99,
        amountTolerancePct: 15
      });
    expect(upsertConfirmed.status).toBe(200);
    expect(upsertConfirmed.body.ok).toBe(true);
    expect(upsertConfirmed.body.data.merchantKey).toBe(keyConfirmed);
    expect(upsertConfirmed.body.data.verdict).toBe("confirmed");

    const dbConfirmed = await sqlStmt(
      `SELECT verdict, amount_anchor, amount_tolerance_pct
       FROM recurring_merchant_override
       WHERE household_id = ? AND merchant_key = ?`
    ).get<{ verdict: string; amount_anchor: string; amount_tolerance_pct: string }>(HOUSEHOLD_ID, keyConfirmed);
    expect(dbConfirmed?.verdict).toBe("confirmed");
    expect(Number(dbConfirmed?.amount_anchor ?? 0)).toBeCloseTo(18.99, 2);
    expect(Number(dbConfirmed?.amount_tolerance_pct ?? 0)).toBeCloseTo(15, 2);

    const upsertDismissed = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${token}`)
      .send({
        merchantKey: keyDismissed,
        verdict: "dismissed"
      });
    expect(upsertDismissed.status).toBe(200);
    expect(upsertDismissed.body.ok).toBe(true);
    expect(upsertDismissed.body.data.verdict).toBe("dismissed");

    const upsertAgain = await request(app)
      .post("/recurring-overrides")
      .set("authorization", `Bearer ${token}`)
      .send({
        merchantKey: keyConfirmed,
        verdict: "dismissed"
      });
    expect(upsertAgain.status).toBe(200);
    expect(upsertAgain.body.ok).toBe(true);
    expect(upsertAgain.body.data.verdict).toBe("dismissed");

    const listRes = await request(app).get("/recurring-overrides").set("authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    const keys = (listRes.body.data as Array<{ merchantKey: string }>).map((r) => r.merchantKey);
    expect(keys).toContain(keyConfirmed);
    expect(keys).toContain(keyDismissed);

    const deleteExisting = await request(app)
      .delete(`/recurring-overrides/${upsertDismissed.body.data.id as string}`)
      .set("authorization", `Bearer ${token}`);
    expect(deleteExisting.status).toBe(200);
    expect(deleteExisting.body.ok).toBe(true);

    const deleteMissing = await request(app)
      .delete("/recurring-overrides/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(deleteMissing.status).toBe(404);
    expect(deleteMissing.body.ok).toBe(false);
    expect(deleteMissing.body.code).toBe("NOT_FOUND");
  });
});
