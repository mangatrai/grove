import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

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
