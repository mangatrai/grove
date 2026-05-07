import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/insights/llm-provider.service.js", () => ({
  PROMPT_VERSION: "v1.0",
  generateInsight: vi.fn(async () => ({
    healthRating: "on_track",
    healthRationale: "Household is stable with room to improve savings.",
    localBenchmark: "Local benchmark narrative.",
    nationalBenchmark: "National benchmark narrative.",
    whatsWorking: ["Positive cash flow", "Budget coverage is improving"],
    concerns: ["Emergency fund could be larger", "Debt service ratio is elevated"],
    spendingAnalysis: ["Dining out is higher than comparable households"],
    investmentGaps: ["Retirement contributions are below target"],
    nextSteps: ["Increase retirement savings by 2%", "Build 3-6 months of expenses in cash"]
  }))
}));

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

describe("insights API and household/profile extensions", () => {
  it("returns null latest insight before generation", async () => {
    const token = await login();
    const res = await request(app).get("/insights/financial").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data === null || typeof res.body.data === "object").toBe(true);
  });

  it("enqueue refresh job and poll status", async () => {
    const token = await login();
    const refresh = await request(app)
      .post("/insights/financial/refresh")
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(refresh.status).toBe(202);
    expect(typeof refresh.body.jobId).toBe("string");

    const status = await request(app)
      .get(`/insights/financial/status/${refresh.body.jobId as string}`)
      .set("authorization", `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body.ok).toBe(true);
    expect(["queued", "running", "complete", "failed"]).toContain(status.body.data.status);
  });

  it("returns history and by-id after generation completes", async () => {
    const token = await login();
    const refresh = await request(app)
      .post("/insights/financial/refresh")
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(refresh.status).toBe(202);
    const jobId = refresh.body.jobId as string;

    let insightId: string | null = null;
    for (let i = 0; i < 25; i += 1) {
      const st = await request(app)
        .get(`/insights/financial/status/${jobId}`)
        .set("authorization", `Bearer ${token}`);
      expect(st.status).toBe(200);
      if (st.body.data.status === "complete") {
        insightId = st.body.data.insightId as string;
        break;
      }
      if (st.body.data.status === "failed") {
        throw new Error(`insight job failed: ${String(st.body.data.errorText ?? "unknown")}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(typeof insightId).toBe("string");

    const history = await request(app)
      .get("/insights/financial/history?limit=10&offset=0")
      .set("authorization", `Bearer ${token}`);
    expect(history.status).toBe(200);
    expect(history.body.ok).toBe(true);
    expect(Array.isArray(history.body.data)).toBe(true);
    expect(history.body.data.length).toBeGreaterThan(0);

    const byId = await request(app)
      .get(`/insights/financial/${insightId as string}`)
      .set("authorization", `Bearer ${token}`);
    expect(byId.status).toBe(200);
    expect(byId.body.ok).toBe(true);
    expect(byId.body.data.id).toBe(insightId);
    expect(byId.body.data.payload.healthRating).toBe("on_track");
  });

  it("patches and returns extended household profile fields", async () => {
    const token = await login();
    const patch = await request(app)
      .patch("/household/profile")
      .set("authorization", `Bearer ${token}`)
      .send({
        age: 37,
        sex: "female",
        individualGrossIncomeUsd: 145000,
        riskTolerance: "moderate",
        financialGoals: ["Build emergency fund", "Invest for retirement"]
      });
    expect(patch.status).toBe(200);

    const getRes = await request(app).get("/household/profile").set("authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.profile.age).toBe(37);
    expect(getRes.body.profile.sex).toBe("female");
    expect(Number(getRes.body.profile.individualGrossIncomeUsd)).toBe(145000);
    expect(getRes.body.profile.riskTolerance).toBe("moderate");
    expect(getRes.body.profile.financialGoals).toEqual(["Build emergency fund", "Invest for retirement"]);
  });

  it("patches and returns extended household settings fields", async () => {
    const token = await login();
    const patch = await request(app)
      .patch("/household/settings")
      .set("authorization", `Bearer ${token}`)
      .send({
        city: "Austin",
        state: "TX",
        combinedGrossIncomeUsd: 250000
      });
    expect(patch.status).toBe(200);

    const getRes = await request(app).get("/household/settings").set("authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.city).toBe("Austin");
    expect(getRes.body.state).toBe("TX");
    expect(Number(getRes.body.combinedGrossIncomeUsd)).toBe(250000);
  });

  it("persists job row and supports status endpoint", async () => {
    const token = await login();
    const refresh = await request(app)
      .post("/insights/financial/refresh")
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(refresh.status).toBe(202);
    const jobId = refresh.body.jobId as string;

    const db = await sqlStmt(`SELECT id, household_id FROM insight_job WHERE id = ?`).get<{
      id: string;
      household_id: string;
    }>(jobId);
    expect(db?.id).toBe(jobId);
    expect(db?.household_id).toBe(HOUSEHOLD_ID);
  });
});

