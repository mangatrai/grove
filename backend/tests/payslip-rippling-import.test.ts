import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { sqlStmt } from "./pg-stmt.js";
import { ripplingPayslipText } from "./fixtures/rippling-payslip-text.js";

/**
 * Rippling payslips parse inline from the PDF text layer (#301 Step 2). `extractPdfText` is mocked to return a
 * synthetic text fixture — the uploaded bytes only need a unique checksum. The LLM extractor must never run.
 */
vi.mock("../src/modules/imports/profiles/pdf-text.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/modules/imports/profiles/pdf-text.js")>();
  return { ...mod, extractPdfText: vi.fn(mod.extractPdfText) };
});
vi.mock("../src/modules/payslip/llm-extract/extract-payslip-llm.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/modules/payslip/llm-extract/extract-payslip-llm.js")>();
  return { ...mod, extractPayslipFromPdf: vi.fn().mockRejectedValue(new Error("LLM must not be called for Rippling")) };
});

import { buildApp } from "../src/app.js";
import { extractPdfText } from "../src/modules/imports/profiles/pdf-text.js";
import { extractPayslipFromPdf } from "../src/modules/payslip/llm-extract/extract-payslip-llm.js";

const app = buildApp();
const RIPPLING_EMPLOYER_ID = "e1000000-0000-4000-8000-0000000000a1";
const SEED_BOA_CHECKING = "40000000-0000-0000-0000-000000000001";

let token: string;
let ownerProfileId: string;
let savedEmployersJson: string | null;

function uniquePdf(tag: string): Buffer {
  return Buffer.from(`%PDF-1.4 rippling-test ${tag} ${Date.now()} ${Math.random()}`);
}

beforeAll(async () => {
  const login = await request(app).post("/auth/login").send({ email: "owner@example.com", password: "ChangeMe123!" });
  expect(login.status).toBe(200);
  token = login.body.token as string;

  const owner = await sqlStmt(
    `SELECT pp.id, pp.employers_json FROM person_profile pp
       JOIN app_user u ON u.id = pp.linked_user_id
      WHERE u.email = 'owner@example.com'`
  ).get<{ id: string; employers_json: string | null }>();
  expect(owner).toBeDefined();
  ownerProfileId = owner!.id;
  savedEmployersJson = owner!.employers_json;

  const res = await request(app)
    .patch("/household/profile")
    .set("authorization", `Bearer ${token}`)
    .send({
      employers: [
        {
          id: RIPPLING_EMPLOYER_ID,
          displayName: "Acme Corp",
          parserProfileId: "rippling_payslip_pdf",
          salaryDepositFinancialAccountId: SEED_BOA_CHECKING
        }
      ]
    });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await sqlStmt(`UPDATE person_profile SET employers_json = ? WHERE id = ?`).run(savedEmployersJson, ownerProfileId);
});

describe("POST /payslips/sniff — Rippling text", () => {
  it("suggests the Rippling parser and the employer configured for it", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce(ripplingPayslipText());
    const res = await request(app)
      .post("/payslips/sniff")
      .set("authorization", `Bearer ${token}`)
      .attach("file", uniquePdf("sniff"), "stub.pdf");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      suggestedParserProfileId: "rippling_payslip_pdf",
      confidence: "high",
      suggestedEmployerId: RIPPLING_EMPLOYER_ID
    });
    expect(res.body.hints.ripplingSignals).toEqual(["rippling_brand", "paystub_id", "advice_of_deposit"]);
  });
});

describe("POST /payslips/upload — Rippling employer", () => {
  it("parses inline with no LLM call and persists line items + deposit lines", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce(ripplingPayslipText());

    const up = await request(app)
      .post("/payslips/upload")
      .set("authorization", `Bearer ${token}`)
      .field("employerId", RIPPLING_EMPLOYER_ID)
      .attach("file", uniquePdf("upload-ok"), "Jun 1, 2026 - Jun 15, 2026 - PEO - Acme Corp.pdf");

    expect(up.status).toBe(201);
    expect(up.body.snapshot).toMatchObject({
      parserProfileId: "rippling_payslip_pdf",
      employerId: RIPPLING_EMPLOYER_ID,
      payDate: "2026-06-15",
      grossPayCurrent: 5000,
      netPayCurrent: 3717.5
    });
    expect(extractPayslipFromPdf).not.toHaveBeenCalled();

    const detail = await request(app)
      .get(`/payslips/${up.body.snapshot.id as string}`)
      .set("authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.canonicalExtractJson).toEqual({ version: 1, source: "rippling_pdf_text" });
    expect(detail.body.lineItems.earnings).toHaveLength(1);
    expect(detail.body.lineItems.tax_deductions).toHaveLength(3);
    expect(
      (detail.body.paymentSummaryJson as Array<{ account_or_check_number_masked: string; amount: number }>).map((d) => [
        d.account_or_check_number_masked,
        d.amount
      ])
    ).toEqual([
      ["...111", 3217.5],
      ["...222", 500]
    ]);
  });

  it("saves a stub with a new section and leaves the arithmetic to validationWarnings", async () => {
    // 401(k) row under a section the parser has never seen; SUMMARY still says Deductions $0 → net doesn't balance.
    vi.mocked(extractPdfText).mockResolvedValueOnce(
      ripplingPayslipText({ extraBody: ["PRE-TAX DEDUCTIONSCURRENT PERIODYTD AMOUNT", "401(k)$250.00$250.00"], payDate: "07/15/2026" })
    );
    const up = await request(app)
      .post("/payslips/upload")
      .set("authorization", `Bearer ${token}`)
      .field("employerId", RIPPLING_EMPLOYER_ID)
      .attach("file", uniquePdf("upload-new-section"), "stub.pdf");
    expect(up.status).toBe(201);

    const detail = await request(app)
      .get(`/payslips/${up.body.snapshot.id as string}`)
      .set("authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.preTaxDeductionsCurrent).toBe(250);
    expect(detail.body.lineItems.pre_tax_deductions.map((l: { name: string }) => l.name)).toEqual(["401(k)"]);
    expect(detail.body.validationWarnings.map((w: { code: string }) => w.code)).toEqual(["ARITHMETIC_IMBALANCE"]);
  });

  it("rejects text that is not a Rippling stub with 422 and saves nothing", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce("Some other payroll provider\nNet Pay 100.00");
    const before = await sqlStmt(`SELECT COUNT(*)::int AS n FROM payslip_snapshot`).get<{ n: number }>();

    const up = await request(app)
      .post("/payslips/upload")
      .set("authorization", `Bearer ${token}`)
      .field("employerId", RIPPLING_EMPLOYER_ID)
      .attach("file", uniquePdf("upload-bad"), "stub.pdf");

    expect(up.status).toBe(422);
    expect(up.body.code).toBe("PAYSLIP_TEXT_PARSE_FAILED");
    expect(up.body.detail).toMatch(/^rippling_header_missing: /);
    const after = await sqlStmt(`SELECT COUNT(*)::int AS n FROM payslip_snapshot`).get<{ n: number }>();
    expect(after!.n).toBe(before!.n);
    expect(extractPayslipFromPdf).not.toHaveBeenCalled();
  });
});

describe("Import session with rippling_payslip_pdf", () => {
  async function bindAndParse(buf: Buffer, parserProfileId = "rippling_payslip_pdf") {
    const sessionRes = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${token}`)
      .send({ sourceType: "upload" });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.session.id as string;
    const up = await request(app)
      .post(`/imports/sessions/${sessionId}/files`)
      .set("authorization", `Bearer ${token}`)
      .attach("files", buf, "stub.pdf");
    expect(up.status).toBe(201);
    const fileId = up.body.files[0].id as string;
    const bind = await request(app)
      .patch(`/imports/sessions/${sessionId}/files/${fileId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ financialAccountId: SEED_BOA_CHECKING, parserProfileId, employerId: RIPPLING_EMPLOYER_ID });
    return { sessionId, fileId, bind };
  }

  it("parses synchronously (no async queue) and canonicalize adds 0 ledger rows", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce(ripplingPayslipText({ payDate: "06/30/2026", payPeriod: "06/16/2026 - 06/30/2026" }));
    const { sessionId, fileId, bind } = await bindAndParse(uniquePdf("session-ok"));
    expect(bind.status).toBe(200);

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(parseRes.status).toBe(200);
    expect(parseRes.body.parsedFiles).toBe(1);
    expect(parseRes.body.asyncPayslipPending ?? 0).toBe(0);

    const snap = await sqlStmt(
      `SELECT id, parser_profile_id, employer_id, pay_date, payment_summary_json FROM payslip_snapshot WHERE import_file_id = ?`
    ).get<{ id: string; parser_profile_id: string; employer_id: string; pay_date: string; payment_summary_json: string }>(fileId);
    expect(snap).toMatchObject({ parser_profile_id: "rippling_payslip_pdf", employer_id: RIPPLING_EMPLOYER_ID, pay_date: "2026-06-30" });
    expect(JSON.parse(snap!.payment_summary_json)).toHaveLength(2);
    const items = await sqlStmt(`SELECT COUNT(*)::int AS n FROM payslip_line_item WHERE payslip_snapshot_id = ?`).get<{ n: number }>(
      snap!.id
    );
    expect(items!.n).toBe(4);

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);
    expect(canRes.body.inserted).toBe(0);
    expect(extractPayslipFromPdf).not.toHaveBeenCalled();
  });

  it("marks the file failed with the parser's reason when the PDF is not a Rippling stub", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce(ripplingPayslipText({ payDate: "soon", payPeriod: "June" }));
    const { sessionId, fileId, bind } = await bindAndParse(uniquePdf("session-bad"));
    expect(bind.status).toBe(200);

    const parseRes = await request(app)
      .post(`/imports/sessions/${sessionId}/parse`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(parseRes.status).toBe(409);
    expect(parseRes.body.skippedFiles).toContainEqual({ fileId, reason: "payslip_text_parse_failed" });

    const file = await sqlStmt(`SELECT status, confidence_summary FROM import_file WHERE id = ?`).get<{
      status: string;
      confidence_summary: string;
    }>(fileId);
    expect(file!.status).toBe("failed");
    expect(JSON.parse(file!.confidence_summary)).toMatchObject({
      reason: "payslip_text_parse_failed",
      detail: expect.stringMatching(/^rippling_no_pay_date: /)
    });
  });

  it("rejects binding a Rippling employer's file to another payslip format", async () => {
    const { bind } = await bindAndParse(uniquePdf("mismatch"), "ibm_pay_contributions_pdf");
    expect(bind.status).toBe(400);
    expect(bind.body.code).toBe("EMPLOYER_PARSER_MISMATCH");
  });
});
