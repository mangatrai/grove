import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ibmFixture = path.join(__dirname, "fixtures", "ibm-payslip-sample.txt");

vi.mock("../src/modules/imports/profiles/pdf-text.js", () => ({
  extractPdfText: async () => readFileSync(ibmFixture, "utf8")
}));

import { buildApp } from "../src/app.js";

const app = buildApp();

describe("POST /payslips/upload", () => {
  async function loginToken(): Promise<string> {
    const res = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/payslips/upload")
      .attach("file", readFileSync(ibmFixture), "stub.pdf");
    expect(res.status).toBe(401);
  });

  it("stores payslip snapshot and rejects duplicate checksum", async () => {
    const token = await loginToken();
    const buf = readFileSync(ibmFixture);

    const first = await request(app)
      .post("/payslips/upload")
      .set("authorization", `Bearer ${token}`)
      .attach("file", buf, "ibm-january.pdf");

    expect(first.status).toBe(201);
    expect(first.body.snapshot).toBeDefined();
    expect(first.body.snapshot.parserProfileId).toBe("ibm_pay_contributions_pdf");
    expect(first.body.snapshot.grossPayCurrent).toBe(5000);
    expect(first.body.snapshot.fileChecksum).toMatch(/^[a-f0-9]{64}$/);

    const second = await request(app)
      .post("/payslips/upload")
      .set("authorization", `Bearer ${token}`)
      .attach("file", buf, "ibm-january-copy.pdf");

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("DUPLICATE_PAYSLIP");
    expect(second.body.existing.id).toBe(first.body.snapshot.id);
  });
});
