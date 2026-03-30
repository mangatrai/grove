import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
    const base = readFileSync(ibmFixture);
    const buf = Buffer.concat([base, Buffer.from(`\ndup-test-${Date.now()}`)]);

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

  it("lists payslips for household", async () => {
    const token = await loginToken();
    const base = readFileSync(ibmFixture);
    const buf = Buffer.concat([base, Buffer.from(`\nlist-test-${Date.now()}`)]);

    const up = await request(app)
      .post("/payslips/upload")
      .set("authorization", `Bearer ${token}`)
      .attach("file", buf, "list-test.pdf");

    expect(up.status).toBe(201);
    const id = up.body.snapshot.id as string;

    const list = await request(app).get("/payslips").set("authorization", `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(list.body.items)).toBe(true);
    const row = list.body.items.find((x: { id: string }) => x.id === id);
    expect(row).toBeDefined();
    expect(row.parserProfileId).toBe("ibm_pay_contributions_pdf");
  });
});

describe("GET /payslips/:id", () => {
  async function loginToken(): Promise<string> {
    const res = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  it("returns 401 without auth", async () => {
    const res = await request(app).get(`/payslips/${randomUUID()}`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-uuid id", async () => {
    const token = await loginToken();
    const res = await request(app).get("/payslips/not-a-uuid").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown id", async () => {
    const token = await loginToken();
    const res = await request(app)
      .get(`/payslips/${randomUUID()}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns full snapshot after upload", async () => {
    const token = await loginToken();
    const base = readFileSync(ibmFixture);
    const buf = Buffer.concat([base, Buffer.from(`\nget-one-${Date.now()}`)]);

    const up = await request(app)
      .post("/payslips/upload")
      .set("authorization", `Bearer ${token}`)
      .attach("file", buf, "detail-test.pdf");

    expect(up.status).toBe(201);
    const id = up.body.snapshot.id as string;

    const one = await request(app).get(`/payslips/${id}`).set("authorization", `Bearer ${token}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(id);
    expect(one.body.fileName).toBe("detail-test.pdf");
    expect(one.body.grossPayCurrent).toBe(5000);
    expect(one.body.netPayCurrent).toBeDefined();
    expect(one.body.rawExtractJson).toBeDefined();
    expect(typeof one.body.rawExtractJson).toBe("object");
  });
});

describe("Import session with ibm_pay_contributions_pdf", () => {
  async function loginToken(): Promise<string> {
    const res = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  it("parse creates payslip_snapshot with import_file_id; canonicalize succeeds with 0 ledger rows", async () => {
    const token = await loginToken();
    const sessionRes = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.session.id as string;

    const base = readFileSync(ibmFixture);
    const buf = Buffer.concat([base, Buffer.from(`\nimport-payslip-${Date.now()}`)]);

    const up = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", buf, "feb.pdf");
    expect(up.status).toBe(201);
    const fileId = up.body.files[0].id as string;

    const boaChecking = "40000000-0000-0000-0000-000000000001";
    const bind = await request(app)
      .patch(`/imports/sessions/${sessionId}/files/${fileId}`)
      .set("authorization", `Bearer ${token}`)
      .send({
        financialAccountId: boaChecking,
        parserProfileId: "ibm_pay_contributions_pdf"
      });
    expect(bind.status).toBe(200);

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedFiles).toBe(1);
    expect(parseRes.body.parsedRows).toBe(0);

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(0);

    const list = await request(app).get("/payslips").set("authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    const row = list.body.items.find((x: { importFileId?: string }) => x.importFileId === fileId);
    expect(row).toBeDefined();
    expect(row.grossPayCurrent).toBe(5000);
  });
});
