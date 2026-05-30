import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const app = buildApp();

// Seeded in dev_0008_seed_properties.sql
const PROPERTY_ID = "a0000000-0000-0000-0000-000000000001";
const TAX_YEAR = 2026;

async function login(): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: "owner@example.com", password: "ChangeMe123!" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("GET /api/protest/:propertyId/evidence-packet", () => {
  let token: string;

  beforeAll(async () => {
    token = await login();
  });

  it("returns 200 with application/pdf for a seeded property + worksheet", async () => {
    const res = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/evidence-packet?year=${TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    // PDF magic bytes: %PDF
    const body = res.body as Buffer;
    expect(body.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("returns 200 with pdf when year param is omitted (defaults to current year)", async () => {
    const res = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/evidence-packet`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  it("returns 404 for a property that does not belong to the household", async () => {
    const res = await request(app)
      .get(`/api/protest/00000000-0000-0000-0000-000000000099/evidence-packet?year=${TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/evidence-packet?year=${TAX_YEAR}`);
    expect(res.status).toBe(401);
  });

  it("returns 200 with DOCX content-type for format=docx (PT-4b)", async () => {
    const res = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/evidence-packet?year=${TAX_YEAR}&format=docx`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/wordprocessingml/);
    expect(res.headers["content-disposition"]).toMatch(/\.docx/);
  });
});
