import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sqlStmt } from "./pg-stmt.js";

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
      rate: 180000,
      rate_type: "annual",
      cost_center: null,
      hours_or_days_worked_current: 80,
      hours_or_days_worked_ytd: 160
    },
    summary: {
      currency: "USD",
      gross_pay_current: 5000,
      gross_pay_ytd: 10000,
      total_earnings_current: null,
      total_earnings_ytd: null,
      taxable_earnings_current: 4200,
      taxable_earnings_ytd: 8400,
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
      earnings: [
        {
          name: "Regular Salary",
          authority: null,
          description: null,
          dates: { start_date: "2026-01-01", end_date: "2026-01-15", raw: null },
          hours_or_days: { current: 80, ytd: 160 },
          rate: 9588.75,
          amount_current: 5000,
          amount_ytd: 10000,
          raw_section: "EARNINGS"
        }
      ],
      pre_tax_deductions: [
        {
          name: "401k PreTax",
          authority: null,
          description: null,
          dates: { start_date: null, end_date: null, raw: null },
          hours_or_days: { current: null, ytd: null },
          rate: null,
          amount_current: 100,
          amount_ytd: 200,
          raw_section: "PRE-TAX DEDUCTION(S)"
        }
      ],
      post_tax_deductions: [],
      tax_deductions: [
        {
          name: "Federal Withholding",
          authority: null,
          description: null,
          dates: { start_date: null, end_date: null, raw: null },
          hours_or_days: { current: null, ytd: null },
          rate: null,
          amount_current: 800,
          amount_ytd: 1600,
          raw_section: "TAX DEDUCTION(S)"
        }
      ],
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

  it("accepts new extended fields: taxableEarnings, otherInformation, hoursYtd, employmentRate", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/payslips/manual")
      .set("authorization", `Bearer ${token}`)
      .send({
        payDate: "2026-04-15",
        netPayCurrent: 4350.17,
        grossPayCurrent: 9588.75,
        parserProfileId: "ibm_pay_contributions_pdf",
        hoursOrDaysCurrent: "80",
        hoursOrDaysYtd: "336",
        taxableEarningsCurrent: 8000,
        taxableEarningsYtd: 32000,
        otherInformationCurrent: 85.91,
        otherInformationYtd: 2511.34
      });

    expect(res.status).toBe(201);
    const snap = res.body.snapshot;
    expect(snap.hoursOrDaysCurrent).toBe("80");
    expect(snap.hoursOrDaysYtd).toBe("336");
    expect(snap.taxableEarningsCurrent).toBe(8000);
    expect(snap.taxableEarningsYtd).toBe(32000);
    expect(snap.otherInformationCurrent).toBe(85.91);
    expect(snap.otherInformationYtd).toBe(2511.34);
  });

  it("rejects payload with no pay date and no gross/net", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/payslips/manual")
      .set("authorization", `Bearer ${token}`)
      .send({ payPeriodStart: "2026-01-01" });
    expect(res.status).toBe(400);
  });

  it("accepts pre/post tax deductions and employee taxes YTD on manual create", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/payslips/manual")
      .set("authorization", `Bearer ${token}`)
      .send({
        payDate: "2026-03-01",
        netPayCurrent: 900,
        parserProfileId: "ibm_pay_contributions_pdf",
        preTaxDeductionsCurrent: 100,
        preTaxDeductionsYtd: 300,
        postTaxDeductionsCurrent: 20,
        postTaxDeductionsYtd: 60,
        employeeTaxesYtd: 4000
      });

    expect(res.status).toBe(201);
    const snap = res.body.snapshot;
    expect(snap.preTaxDeductionsCurrent).toBe(100);
    expect(snap.preTaxDeductionsYtd).toBe(300);
    expect(snap.postTaxDeductionsCurrent).toBe(20);
    expect(snap.postTaxDeductionsYtd).toBe(60);
    expect(snap.employeeTaxesYtd).toBe(4000);
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
    // New summary fields
    expect(one.body.hoursOrDaysCurrent).toBe("80");
    expect(one.body.hoursOrDaysYtd).toBe("160");
    expect(one.body.taxableEarningsCurrent).toBe(4200);
    expect(one.body.taxableEarningsYtd).toBe(8400);
    expect(one.body.employmentRate).toBe(180000);
    expect(one.body.employmentRateType).toBe("annual");
    // Line items — grouped by section
    expect(one.body.lineItems).toBeDefined();
    expect(Array.isArray(one.body.lineItems.earnings)).toBe(true);
    expect(one.body.lineItems.earnings.length).toBe(1);
    expect(one.body.lineItems.earnings[0].name).toBe("Regular Salary");
    expect(one.body.lineItems.earnings[0].amountCurrent).toBe(5000);
    expect(one.body.lineItems.earnings[0].hoursOrDaysCurrent).toBe(80);
    expect(one.body.lineItems.pre_tax_deductions.length).toBe(1);
    expect(one.body.lineItems.pre_tax_deductions[0].name).toBe("401k PreTax");
    expect(one.body.lineItems.tax_deductions.length).toBe(1);
    expect(one.body.lineItems.tax_deductions[0].name).toBe("Federal Withholding");
    expect(one.body.lineItems.post_tax_deductions).toEqual([]);
    expect(one.body.lineItems.other_information).toEqual([]);
    // confirmedDeposits / suggestedDeposits are always present — suggested empty when confirmed non-empty
    expect(Array.isArray(one.body.confirmedDeposits)).toBe(true);
    expect(Array.isArray(one.body.suggestedDeposits)).toBe(true);
    // validationWarnings is always present
    expect(Array.isArray(one.body.validationWarnings)).toBe(true);
  });
});

// ─── confirmedDeposits / suggestedDeposits (CR-068, F-5c) ──────────────────────

describe("GET /payslips/:id — confirmedDeposits / suggestedDeposits", () => {
  const SEEDED_HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
  const SEED_BOA_CHECKING = "40000000-0000-0000-0000-000000000001";

  async function loginToken(): Promise<string> {
    const res = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  it("suggestedDeposits finds a canonical credit deposit within ±7 days and 1% of net pay", async () => {
    const token = await loginToken();

    // The mock LLM always returns payDate="2026-01-15" and netPayCurrent=4000.
    // Insert a canonical credit transaction that should match.
    const txnId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO transaction_canonical
         (id, household_id, account_id, txn_date, amount, direction, merchant, status, fingerprint, created_at)
       VALUES (?, ?, ?, '2026-01-14', 4000, 'credit', 'ACH Payroll Deposit', 'posted', ?, CURRENT_TIMESTAMP)`
    ).run(txnId, SEEDED_HOUSEHOLD_ID, SEED_BOA_CHECKING, `matched-deposit-fp-${txnId}`);

    try {
      const base = readFileSync(ibmFixture);
      const buf = Buffer.concat([base, Buffer.from(`\ndeposit-match-${Date.now()}`)]);

      const up = await request(app)
        .post("/payslips/upload")
        .set("authorization", `Bearer ${token}`)
        .attach("file", buf, "deposit-match.pdf");
      expect(up.status).toBe(201);
      const id = up.body.snapshot.id as string;

      const one = await request(app)
        .get(`/payslips/${id}`)
        .set("authorization", `Bearer ${token}`);
      expect(one.status).toBe(200);
      expect(Array.isArray(one.body.confirmedDeposits)).toBe(true);
      expect(one.body.confirmedDeposits.length).toBe(0);
      expect(Array.isArray(one.body.suggestedDeposits)).toBe(true);

      // Our inserted transaction must appear in suggestedDeposits
      const match = (
        one.body.suggestedDeposits as Array<{
          id: string;
          direction: string;
          amount: number;
          txnDate: string;
          accountId: string;
          institution: string;
          accountType: string;
        }>
      ).find((d) => d.id === txnId);
      expect(match).toBeDefined();
      expect(match!.direction).toBe("credit");
      expect(match!.amount).toBe(4000);
      expect(match!.txnDate).toBe("2026-01-14");
      expect(match!.accountId).toBe(SEED_BOA_CHECKING);
      expect(match!.institution).toBeDefined();
      expect(match!.accountType).toBeDefined();
      expect(match!.dateDelta).toBe(1);
      expect(match!.amountDelta).toBe(0);
    } finally {
      await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(txnId);
    }
  });

  it("suggestedDeposits excludes credits outside the ±7-day window", async () => {
    const token = await loginToken();

    // Insert a credit transaction 10 days before pay date — outside the ±7-day window (pay 2026-01-15)
    const txnId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO transaction_canonical
         (id, household_id, account_id, txn_date, amount, direction, merchant, status, fingerprint, created_at)
       VALUES (?, ?, ?, '2026-01-05', 4000, 'credit', 'OutOfWindow Deposit', 'posted', ?, CURRENT_TIMESTAMP)`
    ).run(txnId, SEEDED_HOUSEHOLD_ID, SEED_BOA_CHECKING, `out-of-window-fp-${txnId}`);

    try {
      const base = readFileSync(ibmFixture);
      const buf = Buffer.concat([base, Buffer.from(`\nout-of-window-${Date.now()}`)]);

      const up = await request(app)
        .post("/payslips/upload")
        .set("authorization", `Bearer ${token}`)
        .attach("file", buf, "out-of-window.pdf");
      expect(up.status).toBe(201);
      const id = up.body.snapshot.id as string;

      const one = await request(app)
        .get(`/payslips/${id}`)
        .set("authorization", `Bearer ${token}`);
      expect(one.status).toBe(200);
      expect(Array.isArray(one.body.confirmedDeposits)).toBe(true);
      expect(Array.isArray(one.body.suggestedDeposits)).toBe(true);

      // Our out-of-window transaction must NOT appear in suggestedDeposits
      const ids = (one.body.suggestedDeposits as Array<{ id: string }>).map((d) => d.id);
      expect(ids).not.toContain(txnId);
    } finally {
      await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(txnId);
    }
  });

  it("PUT then DELETE /payslips/:id/deposits/:canonicalId stores link and suppresses suggestedDeposits", async () => {
    const token = await loginToken();
    const txnId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO transaction_canonical
         (id, household_id, account_id, txn_date, amount, direction, merchant, status, fingerprint, created_at)
       VALUES (?, ?, ?, '2026-01-14', 4000, 'credit', 'ACH Payroll Deposit', 'posted', ?, CURRENT_TIMESTAMP)`
    ).run(txnId, SEEDED_HOUSEHOLD_ID, SEED_BOA_CHECKING, `deposit-put-fp-${txnId}`);

    try {
      const base = readFileSync(ibmFixture);
      const buf = Buffer.concat([base, Buffer.from(`\ndeposit-put-${Date.now()}`)]);

      const up = await request(app)
        .post("/payslips/upload")
        .set("authorization", `Bearer ${token}`)
        .attach("file", buf, "deposit-put.pdf");
      expect(up.status).toBe(201);
      const id = up.body.snapshot.id as string;

      const put = await request(app)
        .put(`/payslips/${id}/deposits/${txnId}`)
        .set("authorization", `Bearer ${token}`);
      expect(put.status).toBe(200);
      expect(Array.isArray(put.body.confirmedDeposits)).toBe(true);
      expect(put.body.confirmedDeposits).toHaveLength(1);
      expect(put.body.confirmedDeposits[0].id).toBe(txnId);

      const afterPut = await request(app)
        .get(`/payslips/${id}`)
        .set("authorization", `Bearer ${token}`);
      expect(afterPut.status).toBe(200);
      expect(afterPut.body.confirmedDeposits).toHaveLength(1);
      expect(afterPut.body.suggestedDeposits).toEqual([]);

      const del = await request(app)
        .delete(`/payslips/${id}/deposits/${txnId}`)
        .set("authorization", `Bearer ${token}`);
      expect(del.status).toBe(200);
      expect(del.body.confirmedDeposits).toEqual([]);

      const afterDel = await request(app)
        .get(`/payslips/${id}`)
        .set("authorization", `Bearer ${token}`);
      expect(afterDel.status).toBe(200);
      expect(afterDel.body.confirmedDeposits).toEqual([]);
      expect(
        (afterDel.body.suggestedDeposits as Array<{ id: string }>).some((d) => d.id === txnId)
      ).toBe(true);
    } finally {
      await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(txnId);
    }
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
