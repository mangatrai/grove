import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/imports/profiles/pdf-text.js", () => ({
  extractPdfText: (buf: Buffer) => Promise.resolve(buf.toString("utf-8")),
}));

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

// Seeded in dev_0008_seed_properties.sql
const PROPERTY_ID = "a0000000-0000-0000-0000-000000000001";
const TAX_YEAR = 2026;
const ROUTE_TAX_YEAR = 2048;
const WRONG_PROPERTY_ID = "00000000-0000-0000-0000-000000000099";

const SYNTHETIC_CAD_EVIDENCE_TEXT = `
COMPARABLE SALES ANALYSIS
Subject
123456
2020 / 2024
12000
1500.0
92.0
$200,000
$600,000
123 TEST ST

Comp 1
$750,000
Comp 1
2026-03-01
$450,000
$600,000
$650,000

MARKET COMPARABLE SALES MAP
Comp 1 999001 0.25 $450,000 123 Test St, Dallas TX 75201

SUBJECT EQUITY ANALYSIS

EQUITY COMPARABLES MAP

PUBLIC CARD WITH SKETCH
IMPROVEMENTS
200,000
`;

async function login(): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: "owner@example.com", password: "ChangeMe123!" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function cleanupRouteYear(): Promise<void> {
  await sqlStmt(`DELETE FROM protest_comp_cad WHERE property_id = ? AND tax_year = ?`).run(
    PROPERTY_ID,
    ROUTE_TAX_YEAR
  );
  await sqlStmt(`DELETE FROM protest_worksheet WHERE property_id = ? AND tax_year = ?`).run(
    PROPERTY_ID,
    ROUTE_TAX_YEAR
  );
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

describe("protest CAD comp routes", () => {
  let token: string;

  beforeAll(async () => {
    token = await login();
    await cleanupRouteYear();
  });

  afterEach(async () => {
    await cleanupRouteYear();
  });

  it("POST comps adds a row and GET comps returns it", async () => {
    const post = await request(app)
      .post(`/api/protest/${PROPERTY_ID}/comps`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        year: ROUTE_TAX_YEAR,
        addressLine1: "123 Test St, Dallas TX 75201",
        city: "Dallas",
        sqft: 1500,
        assessedValueUsd: 200_000,
        marketValueUsd: 250_000,
      });
    expect(post.status).toBe(201);
    expect(post.body.cadPropertyId).toBeTruthy();

    const get = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/comps?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    const match = (get.body.comps as Array<{ addressLine1: string | null }>).find((c) =>
      c.addressLine1?.includes("123 Test St")
    );
    expect(match).toBeTruthy();
  });

  it("POST comps returns 404 for a property outside the household", async () => {
    const res = await request(app)
      .post(`/api/protest/${WRONG_PROPERTY_ID}/comps`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        year: ROUTE_TAX_YEAR,
        addressLine1: "123 Test St, Dallas TX 75201",
      });
    expect(res.status).toBe(404);
  });

  it("DELETE comps removes the correct row", async () => {
    const post = await request(app)
      .post(`/api/protest/${PROPERTY_ID}/comps`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        year: ROUTE_TAX_YEAR,
        addressLine1: "456 Delete Me St, Dallas TX 75201",
        assessedValueUsd: 200_000,
      });
    const cadPropertyId = post.body.cadPropertyId as string;

    const del = await request(app)
      .delete(`/api/protest/${PROPERTY_ID}/comps/${cadPropertyId}?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const get = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/comps?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    const ids = (get.body.comps as Array<{ cadPropertyId: string }>).map((c) => c.cadPropertyId);
    expect(ids).not.toContain(cadPropertyId);
  });

  it("PATCH comp notes round-trips through GET comps", async () => {
    const post = await request(app)
      .post(`/api/protest/${PROPERTY_ID}/comps`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        year: ROUTE_TAX_YEAR,
        addressLine1: "789 Notes St, Dallas TX 75201",
      });
    const cadPropertyId = post.body.cadPropertyId as string;

    const patch = await request(app)
      .patch(`/api/protest/${PROPERTY_ID}/comps/${cadPropertyId}/notes?taxYear=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "Equity comp research note" });
    expect(patch.status).toBe(204);

    const get = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/comps?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    const comp = (get.body.comps as Array<{ cadPropertyId: string; notes: string | null }>).find(
      (c) => c.cadPropertyId === cadPropertyId
    );
    expect(comp?.notes).toBe("Equity comp research note");
  });
});

describe("protest manual sold comp routes", () => {
  let token: string;

  beforeAll(async () => {
    token = await login();
    await cleanupRouteYear();
  });

  afterEach(async () => {
    await cleanupRouteYear();
  });

  it("POST sold-comps adds a manual comp", async () => {
    const res = await request(app)
      .post(`/api/protest/${PROPERTY_ID}/sold-comps`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        year: ROUTE_TAX_YEAR,
        address: "123 Test St, Dallas TX 75201",
        soldPrice: 400_000,
        sqft: 1500,
      });
    expect(res.status).toBe(201);
    expect(res.body.comp.address).toBe("123 Test St, Dallas TX 75201");
  });

  it("DELETE sold-comps removes the manual comp", async () => {
    const post = await request(app)
      .post(`/api/protest/${PROPERTY_ID}/sold-comps`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        year: ROUTE_TAX_YEAR,
        address: "222 Remove Sold St, Dallas TX 75201",
        soldPrice: 350_000,
      });
    const compId = post.body.comp.id as string;

    const del = await request(app)
      .delete(`/api/protest/${PROPERTY_ID}/sold-comps/${compId}?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/sold-comps?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    const ids = (list.body.manualSoldComps as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(compId);
  });
});

describe("protest worksheet routes", () => {
  let token: string;

  beforeAll(async () => {
    token = await login();
    await cleanupRouteYear();
  });

  afterEach(async () => {
    await cleanupRouteYear();
  });

  it("GET worksheet creates a row on first call", async () => {
    const res = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/worksheet?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.worksheet.taxYear).toBe(ROUTE_TAX_YEAR);
    expect(res.body.worksheet.propertyId).toBe(PROPERTY_ID);
  });

  it("GET worksheet returns the same row on second call", async () => {
    const first = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/worksheet?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    const second = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/worksheet?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(second.body.worksheet.id).toBe(first.body.worksheet.id);
  });

  it("PATCH worksheet updates status and filing deadline", async () => {
    await request(app)
      .get(`/api/protest/${PROPERTY_ID}/worksheet?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);

    const patch = await request(app)
      .patch(`/api/protest/${PROPERTY_ID}/worksheet`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        year: ROUTE_TAX_YEAR,
        status: "filed",
        filingDeadline: "2026-05-15",
      });
    expect(patch.status).toBe(200);
    expect(patch.body.worksheet.status).toBe("filed");
    expect(patch.body.worksheet.filingDeadline).toBe("2026-05-15");
  });

  it("PATCH worksheet returns 404 for a property outside the household", async () => {
    const res = await request(app)
      .patch(`/api/protest/${WRONG_PROPERTY_ID}/worksheet`)
      .set("Authorization", `Bearer ${token}`)
      .send({ year: ROUTE_TAX_YEAR, status: "filed" });
    expect(res.status).toBe(404);
  });
});

describe("protest CAD evidence upload routes", () => {
  let token: string;

  beforeAll(async () => {
    token = await login();
    await cleanupRouteYear();
  });

  afterEach(async () => {
    await cleanupRouteYear();
  });

  it("POST cad-evidence parses upload and populates worksheet JSON", async () => {
    const res = await request(app)
      .post(`/api/protest/${PROPERTY_ID}/cad-evidence?taxYear=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(SYNTHETIC_CAD_EVIDENCE_TEXT, "utf-8"), {
        filename: "test-evidence.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.salesAnalysis.comps.length).toBeGreaterThanOrEqual(1);

    const ws = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/worksheet?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ws.body.worksheet.cadEvidenceJson).not.toBeNull();
    expect(ws.body.worksheet.cadEvidenceFilename).toBe("test-evidence.pdf");
  });

  it("DELETE cad-evidence clears stored evidence fields", async () => {
    await request(app)
      .post(`/api/protest/${PROPERTY_ID}/cad-evidence?taxYear=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(SYNTHETIC_CAD_EVIDENCE_TEXT, "utf-8"), {
        filename: "test-evidence.pdf",
        contentType: "application/pdf",
      });

    const del = await request(app)
      .delete(`/api/protest/${PROPERTY_ID}/cad-evidence?taxYear=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const ws = await request(app)
      .get(`/api/protest/${PROPERTY_ID}/worksheet?year=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ws.body.worksheet.cadEvidenceJson).toBeNull();
    expect(ws.body.worksheet.cadEvidenceFilename).toBeNull();
  });

  it("POST cad-evidence returns 404 for a property outside the household", async () => {
    const res = await request(app)
      .post(`/api/protest/${WRONG_PROPERTY_ID}/cad-evidence?taxYear=${ROUTE_TAX_YEAR}`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(SYNTHETIC_CAD_EVIDENCE_TEXT, "utf-8"), {
        filename: "test-evidence.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(404);
  });
});
