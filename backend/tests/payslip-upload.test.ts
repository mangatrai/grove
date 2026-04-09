import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.OPENAI_API_KEY ??= "test-key-for-payslip-upload-tests";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ibmFixture = path.join(__dirname, "fixtures", "ibm-payslip-sample.txt");

import type { PayslipLlmExtract } from "../src/modules/payslip/llm-extract/payslip-llm.schema.js";

function mockLlmExtract(): PayslipLlmExtract {
  return {
    document_type: "payslip",
    source_employer: {
      name: "Acme",
      legal_entity: null,
      ein_or_fein: "12-3456789",
      address: "1 Main St"
    },
    employee: {
      name: "Jane Doe",
      employee_id: "E1",
      personnel_number: null,
      talent_id: null,
      address: null
    },
    pay_period: {
      start_date: "2026-01-01",
      end_date: "2026-01-15",
      pay_date: "2026-01-15"
    },
    employment_context: {
      rate: null,
      rate_type: null,
      cost_center: null,
      hours_or_days_worked_current: null,
      hours_or_days_worked_ytd: null
    },
    summary: {
      currency: "USD",
      gross_pay_current: 5000,
      gross_pay_ytd: 10000,
      total_earnings_current: null,
      total_earnings_ytd: null,
      taxable_earnings_current: null,
      taxable_earnings_ytd: null,
      pre_tax_deductions_current: 100,
      pre_tax_deductions_ytd: 200,
      post_tax_deductions_current: 50,
      post_tax_deductions_ytd: 100,
      tax_deductions_current: 800,
      tax_deductions_ytd: 1600,
      other_deductions_current: null,
      other_deductions_ytd: null,
      other_information_current: null,
      other_information_ytd: null,
      net_pay_current: 4000,
      net_pay_ytd: 8000
    },
    line_items: {
      earnings: [],
      pre_tax_deductions: [],
      post_tax_deductions: [],
      tax_deductions: [],
      other_deductions: [],
      other_information: [],
      taxable_earnings: []
    },
    tax_profile: {
      marital_status: null,
      federal_credits: null,
      state_credits: null,
      additional_withholding_federal: null,
      additional_withholding_state: null
    },
    payment_information: [],
    document_metadata: {
      page_count: 1,
      parser_source: "test",
      extraction_model: "test-model",
      extracted_at: new Date().toISOString()
    }
  };
}

vi.mock("../src/modules/payslip/llm-extract/extract-payslip-llm.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/modules/payslip/llm-extract/extract-payslip-llm.js")>();
  return {
    ...mod,
    extractPayslipFromPdf: vi.fn().mockResolvedValue({
      extract: mockLlmExtract(),
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    })
  };
});

import { buildApp } from "../src/app.js";

const app = buildApp();

/** Stable upload/import behavior when the test DB has multiple employers (requires employerId). */
beforeAll(async () => {
  const login = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(login.status).toBe(200);
  const token = login.body.token as string;
  const cleared = await request(app)
    .patch("/household/profile")
    .set("authorization", `Bearer ${token}`)
    .send({ employers: [] });
  expect(cleared.status).toBe(200);
});

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

describe("POST /payslips/manual", () => {
  async function loginToken(): Promise<string> {
    const res = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/payslips/manual").send({ payDate: "2026-02-01", netPayCurrent: 100 });
    expect(res.status).toBe(401);
  });

  it("creates manual snapshot with synthetic checksum and Manual entry file name", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/payslips/manual")
      .set("authorization", `Bearer ${token}`)
      .send({
        payDate: "2026-02-15",
        netPayCurrent: 1234.56,
        grossPayCurrent: 2000,
        parserProfileId: "ibm_pay_contributions_pdf"
      });

    expect(res.status).toBe(201);
    const snap = res.body.snapshot;
    expect(snap.fileName).toBe("Manual entry");
    expect(snap.fileChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.parserProfileId).toBe("ibm_pay_contributions_pdf");
    expect(snap.netPayCurrent).toBe(1234.56);
    expect(snap.rawExtractJson).toMatchObject({ source: "manual" });
  });

  it("rejects payload with no pay date and no gross/net", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/payslips/manual")
      .set("authorization", `Bearer ${token}`)
      .send({ payPeriodStart: "2026-01-01" });
    expect(res.status).toBe(400);
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
