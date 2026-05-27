import request from "supertest";
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Let pdf-parse see plain text directly so unit tests don't need real PDF files
vi.mock("../src/modules/imports/profiles/pdf-text.js", () => ({
  extractPdfText: (buf: Buffer) => Promise.resolve(buf.toString("utf-8")),
}));

import { buildApp } from "../src/app.js";
import { parseEsppCsv, parseEsppPdf } from "../src/modules/espp/espp-parse.service.js";
import {
  deleteSale,
  getYearSummary,
  importBatch,
  recordSales,
} from "../src/modules/espp/espp.service.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";

async function login(): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: "owner@example.com", password: "ChangeMe123!" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function cleanupBatch(date: string) {
  await sqlStmt(`DELETE FROM espp_batch WHERE household_id = ? AND purchase_date = ?`)
    .run(HOUSEHOLD_ID, date);
}

// ─── Parse service unit tests ─────────────────────────────────────────────────

describe("parseEsppCsv", () => {
  it("parses a two-row allocation CSV", () => {
    const csv = [
      '"Plan","Instrument","Allocation date","Quantity","Cost basis","Cost basis (unit)"',
      '"IBM Employees Stock Purchase Plan","Purchase Shares","Mar 13, 2026","0.9045",210.14,"$"',
      '"IBM Employees Stock Purchase Plan","Purchase Shares","Mar 31, 2026","3.0955",203.68,"$"',
    ].join('\n');

    const rows = parseEsppCsv(Buffer.from(csv));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ purchaseDate: '2026-03-13', sharesTransferred: 0.9045, costBasisPerShare: 210.14 });
    expect(rows[1]).toMatchObject({ purchaseDate: '2026-03-31', sharesTransferred: 3.0955, costBasisPerShare: 203.68 });
  });

  it("returns empty array for header-only CSV", () => {
    const csv = '"Plan","Instrument","Allocation date","Quantity","Cost basis","Cost basis (unit)"';
    expect(parseEsppCsv(Buffer.from(csv))).toHaveLength(0);
  });

  it("skips rows with unparseable dates", () => {
    const csv = [
      '"Plan","Instrument","Allocation date","Quantity","Cost basis","Cost basis (unit)"',
      '"IBM","Shares","BADDATE","1.0",200.00,"$"',
    ].join('\n');
    expect(parseEsppCsv(Buffer.from(csv))).toHaveLength(0);
  });
});

describe("parseEsppPdf", () => {
  it("extracts fields from EquatePlus-style text", async () => {
    const text = `
      IBM Employees Stock Purchase Plan
      Purchase date: March 31, 2026
      Allocated 4.0000
      Distributed 3.0955
      Cost basis $203.68
      Purchase FMV $239.62
    `;
    const result = await parseEsppPdf(Buffer.from(text));
    expect(result.purchaseDate).toBe('2026-03-31');
    expect(result.sharesGranted).toBe(4.0);
    expect(result.sharesTransferred).toBe(3.0955);
    expect(result.costBasisPerShare).toBe(203.68);
    expect(result.fmvPerShare).toBe(239.62);
  });

  it("returns nulls when fields are absent", async () => {
    const result = await parseEsppPdf(Buffer.from('No relevant content here'));
    expect(result.purchaseDate).toBeNull();
    expect(result.sharesGranted).toBeNull();
  });
});

// ─── Service integration tests ────────────────────────────────────────────────

describe("importBatch", () => {
  afterEach(async () => {
    await cleanupBatch('2026-06-15');
    await cleanupBatch('2026-07-15');
  });

  it("creates a batch from PDF+CSV", async () => {
    const csv = [
      '"Plan","Instrument","Allocation date","Quantity","Cost basis","Cost basis (unit)"',
      '"IBM","Purchase Shares","Jun 15, 2026","10.0",180.00,"$"',
    ].join('\n');
    const pdfText = `
      Purchase date: June 15, 2026
      Allocated 10.0
      Distributed 10.0
      Cost basis $180.00
      Purchase FMV $212.00
    `;

    const result = await importBatch(HOUSEHOLD_ID, Buffer.from(pdfText), Buffer.from(csv));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.purchaseDate).toBe('2026-06-15');
    expect(result.data.costBasisPerShare).toBe(180);
    expect(result.data.fmvPerShare).toBe(212);
    expect(result.data.discountPerShare).toBeCloseTo(32, 1);
    expect(result.data.sharesTransferred).toBe(10);
  });

  it("upserts on re-import — no duplicate row", async () => {
    const pdfText = `
      Purchase date: Jul 15, 2026
      Allocated 8.0
      Distributed 8.0
      Cost basis $185.00
      Purchase FMV $218.00
    `;
    const buf = Buffer.from(pdfText);

    const r1 = await importBatch(HOUSEHOLD_ID, buf, null);
    expect(r1.ok).toBe(true);

    const r2 = await importBatch(HOUSEHOLD_ID, buf, null);
    expect(r2.ok).toBe(true);

    const row = await sqlStmt(
      `SELECT COUNT(*) AS cnt FROM espp_batch WHERE household_id = ? AND purchase_date = '2026-07-15'`
    ).get<{ cnt: string }>(HOUSEHOLD_ID);
    expect(Number(row!.cnt)).toBe(1);
  });

  it("returns error when no files provided", async () => {
    const result = await importBatch(HOUSEHOLD_ID, null, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_FILE');
  });
});

describe("recordSales + deleteSale", () => {
  const BATCH_DATE = '2026-08-15';
  let seedBatchId = '';

  beforeAll(async () => {
    // Insert batch directly — avoids dependency on PDF parsing in setup
    const id = 'test-espp-batch-aug2026';
    await sqlStmt(
      `INSERT INTO espp_batch
         (id, household_id, purchase_date, shares_granted, fmv_per_share, cost_basis_per_share,
          discount_per_share, shares_transferred, created_at, updated_at)
       VALUES (?, ?, ?, 20, 224, 190, 34, 20, NOW(), NOW())
       ON CONFLICT (household_id, purchase_date) DO UPDATE SET updated_at = NOW()`
    ).run(id, HOUSEHOLD_ID, BATCH_DATE);
    seedBatchId = id;
  });

  afterAll(async () => {
    await cleanupBatch(BATCH_DATE);
  });

  it("inserts sale rows and computes OI + cap gain", async () => {
    const result = await recordSales(HOUSEHOLD_ID, '2026-09-10', [
      { batchId: seedBatchId, sharesSold: 5, salePricePerShare: 230 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);

    const sale = result.data[0]!;
    expect(sale.proceeds).toBeCloseTo(1150, 1);       // 5 × 230
    expect(sale.ordinaryIncome).toBeCloseTo(170, 1);  // 34 × 5
    expect(sale.capGainLoss).toBeCloseTo(30, 1);      // (230 − 224) × 5
  });

  it("rejects oversold quantity", async () => {
    const result = await recordSales(HOUSEHOLD_ID, '2026-09-11', [
      { batchId: seedBatchId, sharesSold: 999, salePricePerShare: 230 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('OVERSOLD');
  });

  it("deleteSale removes a sale record", async () => {
    const r = await recordSales(HOUSEHOLD_ID, '2026-10-01', [
      { batchId: seedBatchId, sharesSold: 1, salePricePerShare: 235 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saleId = r.data[0]!.id;
    const del = await deleteSale(HOUSEHOLD_ID, saleId);
    expect(del.ok).toBe(true);

    const gone = await sqlStmt(`SELECT id FROM espp_sale WHERE id = ?`).get<{ id: string }>(saleId);
    expect(gone).toBeUndefined();
  });
});

describe("getYearSummary", () => {
  it("returns zero-value summary for year with no data", async () => {
    const summary = await getYearSummary(HOUSEHOLD_ID, 2099);
    expect(summary.year).toBe(2099);
    expect(summary.sharesPurchased).toBe(0);
    expect(summary.saleProceeds).toBe(0);
  });
});

// ─── API route smoke tests ────────────────────────────────────────────────────

describe("GET /espp/batches + /espp/summary", () => {
  it("returns 400 without year param", async () => {
    const token = await login();
    const res = await request(app).get("/espp/batches").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("returns 200 with valid year", async () => {
    const token = await login();
    const res = await request(app).get("/espp/batches?year=2026").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("batches");
  });

  it("returns 200 summary with valid year", async () => {
    const token = await login();
    const res = await request(app).get("/espp/summary?year=2026").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("year");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/espp/batches?year=2026");
    expect(res.status).toBe(401);
  });
});
