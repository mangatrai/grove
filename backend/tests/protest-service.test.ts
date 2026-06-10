import crypto from "node:crypto";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/imports/profiles/pdf-text.js", () => ({
  extractPdfText: (buf: Buffer) => Promise.resolve(buf.toString("utf-8")),
}));

import { parseCadEvidencePdf } from "../src/modules/protest/cad-evidence-parser.service.js";
import {
  addManualComp,
  appendConversationTurn,
  excludeComp,
  getOrCreateWorksheet,
  getWorksheet,
  listWorksheetComps,
  saveRedfinComps,
  saveCycleSummary,
  updateSummarizationState,
  updateWorksheetStatus,
  type ConversationTurn,
} from "../src/modules/protest/protest-worksheet.service.js";
import { checkProtestDeadlines } from "../src/modules/notifications/notification.service.js";
import { sqlStmt } from "./pg-stmt.js";

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const USER_ID = "20000000-0000-0000-0000-000000000001";
const PROPERTY_ID = "a0000000-0000-0000-0000-000000000001";
const SERVICE_TAX_YEAR = 2049;

function utcDateString(daysFromToday: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

async function cleanupServiceWorksheet(): Promise<void> {
  await sqlStmt(
    `DELETE FROM notification
      WHERE household_id = ? AND type IN ('protest_filing_deadline_approaching', 'protest_hearing_approaching')`
  ).run(HOUSEHOLD_ID);
  await sqlStmt(`DELETE FROM protest_comp WHERE property_id = ? AND tax_year = ?`).run(
    PROPERTY_ID,
    SERVICE_TAX_YEAR
  );
  await sqlStmt(`DELETE FROM protest_worksheet WHERE property_id = ? AND tax_year = ?`).run(
    PROPERTY_ID,
    SERVICE_TAX_YEAR
  );
}

async function countProtestNotifications(type?: string): Promise<number> {
  const row = type
    ? await sqlStmt<{ count: string }>(
        `SELECT COUNT(*) AS count FROM notification
          WHERE household_id = ? AND user_id = ? AND type = ?`
      ).get(HOUSEHOLD_ID, USER_ID, type)
    : await sqlStmt<{ count: string }>(
        `SELECT COUNT(*) AS count FROM notification
          WHERE household_id = ? AND user_id = ?
            AND type IN ('protest_filing_deadline_approaching', 'protest_hearing_approaching')`
      ).get(HOUSEHOLD_ID, USER_ID);
  return Number(row?.count ?? 0);
}

/**
 * Minimal DCAD-style text for parseCadEvidencePdf.
 *
 * Mirrors actual Denton CAD extraction order: PDF text is extracted column-by-column
 * so each section's data appears BEFORE its heading, and the summary appears AFTER.
 *
 * Page 2 (sales analysis): comp column data → Subject block → "COMPARABLE SALES ANALYSIS" → Summary
 * Page 3 (sales map):      Comp table rows → "MARKET COMPARABLE SALES MAP"
 * Page 4 (equity analysis): equity comp columns → "SUBJECT EQUITY ANALYSIS" → Summary
 * Page 5 (equity map):      Equity table rows → "EQUITY COMPARABLES MAP"
 * Page 6 (public card):     "PUBLIC CARD WITH SKETCH" → improvements value
 */
function buildCadEvidenceText(opts?: { assessedLine?: string }): string {
  const assessed = opts?.assessedLine ?? "$600,000";
  // Matches real Denton CAD column-order extraction:
  //   comp column values (including "Comp N" labels) appear BEFORE the section heading,
  //   the compact map table appears AFTER the heading, equity map rows appear AFTER EQUITY COMPARABLES MAP.
  return `
999001
0.25
A1
S06
DC99999
VB2
2020 / 2020
1500.0
12000
123 Test St
Dallas TX 75201
0.2750
$200,000
$750,000
Comp 1
2026-03-01
$450,000
$150,000
$650,000
91.0 $5,000
$0

Subject
XY1234
92.0
S06
DC99999
A1
2020 / 2024
12000
1500.0
0.2750
$200,000
${assessed}
456 Subject Ave
Dallas TX 75201
123456
VB2

COMPARABLE SALES ANALYSIS
Summary of Indicated Values
Median $650,000
Value / Sqft Sqft Lot Sqft
1,500 12,000
Value
$433.33

Sale PriceComp #Situs AddressProp IDDistance (mi)
Comp 10.25$450,000999001
123 Test St
Dallas TX 75201
MARKET COMPARABLE SALES MAP

SUBJECT EQUITY ANALYSIS
Summary of Equity Indicated Values

EQUITY COMPARABLES MAP
Property ID
Comp #Situs AddressProp IDDistance (mi)
PUBLIC CARD WITH SKETCH
IMPROVEMENTS
200,000
`;
}

beforeAll(async () => {
  await cleanupServiceWorksheet();
});

afterEach(async () => {
  await cleanupServiceWorksheet();
});

describe("worksheet state machine", () => {
  it("getOrCreateWorksheet returns the same row on a second call", async () => {
    const first = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const second = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(second.id).toBe(first.id);
  });

  it("allows not_filed to filed", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "filed");
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.status).toBe("filed");
  });

  it("allows filed to arb and stores hearing date", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "filed");
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "arb", { hearingDate: "2026-09-15" });
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.status).toBe("arb");
    expect(updated?.hearingDate).toBe("2026-09-15");
  });

  it("allows arb to resolved with outcome won_arb", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "arb", { hearingDate: "2026-09-15" });
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "resolved", { outcome: "won_arb" });
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.status).toBe("resolved");
    expect(updated?.outcome).toBe("won_arb");
  });

  it("does not block resolved back to filed at the service layer", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "resolved", { outcome: "won_arb" });
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "filed");
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.status).toBe("filed");
  });

  it("stores null outcome when resolved without an outcome field", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await updateWorksheetStatus(ws.id, HOUSEHOLD_ID, "resolved");
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.status).toBe("resolved");
    expect(updated?.outcome).toBeNull();
  });
});

describe("unified protest_comp CRUD", () => {
  beforeAll(cleanupServiceWorksheet);
  afterEach(cleanupServiceWorksheet);

  it("addManualComp inserts a row visible in listWorksheetComps", async () => {
    await addManualComp(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR, {
      addressLine1: "100 Manual Way, Flower Mound TX 75028",
      city: "Flower Mound",
      sqft: 2000,
      cadAssessedValueUsd: 300_000,
      cadMarketValueUsd: 320_000,
    });
    const comps = await listWorksheetComps(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const match = comps.find((c) => c.addressLine1?.includes("100 Manual Way"));
    expect(match?.source).toBe("manual");
    expect(match?.cadAssessedValueUsd).toBe(300_000);
  });

  it("excludeComp hides a comp from default listing", async () => {
    const comp = await addManualComp(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR, {
      addressLine1: "200 Exclude Way, Flower Mound TX 75028",
    });
    const compId = comp.id;

    await excludeComp(PROPERTY_ID, HOUSEHOLD_ID, compId, true);

    const visible = await listWorksheetComps(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(visible.some((c) => c.id === compId)).toBe(false);

    const all = await listWorksheetComps(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR, { includeExcluded: true });
    const found = all.find((c) => c.id === compId);
    expect(found?.excluded).toBe(true);
  });

  it("saveRedfinComps inserts rows with source=redfin and skips duplicates", async () => {
    await saveRedfinComps(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR, [
      { address: "300 Redfin Ave, Dallas TX 75201", city: "Dallas", state: "TX", zip: "75201",
        sqft: 1800, beds: 3, baths: 2, yearBuilt: 2005, soldPrice: 410_000, soldDate: "2025-09-15",
        pricePerSqft: 228, raw: {} },
    ]);
    const comps = await listWorksheetComps(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR, {
      sources: ["redfin"],
    });
    expect(comps.some((c) => c.addressLine1?.includes("300 Redfin Ave"))).toBe(true);

    // second call with same address is idempotent
    await saveRedfinComps(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR, [
      { address: "300 Redfin Ave, Dallas TX 75201", city: "Dallas", state: "TX", zip: "75201",
        sqft: 1800, beds: 3, baths: 2, yearBuilt: 2005, soldPrice: 415_000, soldDate: "2025-09-15",
        pricePerSqft: 230, raw: {} },
    ]);
    const dedupe = await listWorksheetComps(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR, {
      sources: ["redfin"],
    });
    const rfCount = dedupe.filter((c) => c.addressLine1?.includes("300 Redfin Ave")).length;
    expect(rfCount).toBe(1);
  });
});

describe("conversation persistence", () => {
  it("appendConversationTurn stores a turn retrievable in order", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const turn: ConversationTurn = {
      role: "user",
      content: "First message",
      ts: "2026-06-01T12:00:00.000Z",
    };
    await appendConversationTurn(ws.id, turn);
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.conversationJson).toHaveLength(1);
    expect(updated?.conversationJson[0]).toMatchObject({ role: "user", content: "First message" });
  });

  it("second turn appends without removing the first", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await appendConversationTurn(ws.id, {
      role: "user",
      content: "Turn one",
      ts: "2026-06-01T12:00:00.000Z",
    });
    await appendConversationTurn(ws.id, {
      role: "assistant",
      content: "Turn two",
      ts: "2026-06-01T12:01:00.000Z",
    });
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.conversationJson).toHaveLength(2);
    expect(updated?.conversationJson[0]?.content).toBe("Turn one");
    expect(updated?.conversationJson[1]?.content).toBe("Turn two");
  });

  it("updateSummarizationState advances cursor and stores summary", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await updateSummarizationState(ws.id, 5, "Summarized chunk");
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.summarizationCursor).toBe(5);
    expect(updated?.conversationSummary).toBe("Summarized chunk");
  });

  it("saveCycleSummary survives a round-trip load", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    await saveCycleSummary(ws.id, "Cycle closed with informal settlement.");
    const updated = await getWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    expect(updated?.cycleSummary).toBe("Cycle closed with informal settlement.");
  });
});

describe("protest deadline notifications", () => {
  it("creates no notifications when deadlines are unset", async () => {
    await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const before = await countProtestNotifications();
    await checkProtestDeadlines(HOUSEHOLD_ID, USER_ID);
    const after = await countProtestNotifications();
    expect(after).toBe(before);
  });

  it("creates filing deadline notification when deadline is one day away", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const deadline = utcDateString(1);
    await sqlStmt(`UPDATE protest_worksheet SET filing_deadline = ? WHERE id = ?`).run(deadline, ws.id);
    await checkProtestDeadlines(HOUSEHOLD_ID, USER_ID);
    const count = await countProtestNotifications("protest_filing_deadline_approaching");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("creates hearing notification when hearing date is seven days away", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const hearing = utcDateString(7);
    await sqlStmt(`UPDATE protest_worksheet SET hearing_date = ? WHERE id = ?`).run(hearing, ws.id);
    await checkProtestDeadlines(HOUSEHOLD_ID, USER_ID);
    const count = await countProtestNotifications("protest_hearing_approaching");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates when checkProtestDeadlines runs twice within two days", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const deadline = utcDateString(1);
    await sqlStmt(`UPDATE protest_worksheet SET filing_deadline = ? WHERE id = ?`).run(deadline, ws.id);
    await checkProtestDeadlines(HOUSEHOLD_ID, USER_ID);
    const afterFirst = await countProtestNotifications("protest_filing_deadline_approaching");
    await checkProtestDeadlines(HOUSEHOLD_ID, USER_ID);
    const afterSecond = await countProtestNotifications("protest_filing_deadline_approaching");
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    expect(afterSecond).toBe(afterFirst);
  });

  it("skips notifications for resolved worksheets", async () => {
    const ws = await getOrCreateWorksheet(PROPERTY_ID, HOUSEHOLD_ID, SERVICE_TAX_YEAR);
    const deadline = utcDateString(1);
    await sqlStmt(
      `UPDATE protest_worksheet SET filing_deadline = ?, status = 'resolved', outcome = 'won_arb' WHERE id = ?`
    ).run(deadline, ws.id);
    const before = await countProtestNotifications();
    await checkProtestDeadlines(HOUSEHOLD_ID, USER_ID);
    const after = await countProtestNotifications();
    expect(after).toBe(before);
  });
});

describe("parseCadEvidencePdf", () => {
  it("parses one sales comp block with address and values", async () => {
    const data = await parseCadEvidencePdf(Buffer.from(buildCadEvidenceText()));
    expect(data.salesAnalysis.comps).toHaveLength(1);
    expect(data.salesAnalysis.comps[0]?.address).toContain("123 Test St");
    expect(data.assessedValueUsd).toBe(600_000);
    expect(data.salesAnalysis.comps[0]?.salePriceUsd).toBe(450_000);
    expect(data.livingAreaSqft).toBe(1500);
  });

  it("parses currency formatting with commas to a numeric value", async () => {
    const data = await parseCadEvidencePdf(
      Buffer.from(buildCadEvidenceText({ assessedLine: "$1,234,567" }))
    );
    expect(data.assessedValueUsd).toBe(1_234_567);
  });

  it("returns empty comp arrays when no comp sections are present", async () => {
    const data = await parseCadEvidencePdf(Buffer.from("Property tax evidence — no comps listed."));
    expect(data.salesAnalysis.comps).toEqual([]);
    expect(data.equityAnalysis.comps).toEqual([]);
  });

  it("returns empty comps for malformed or empty input without throwing", async () => {
    await expect(parseCadEvidencePdf(Buffer.from(""))).resolves.toMatchObject({
      salesAnalysis: { comps: [] },
      equityAnalysis: { comps: [] },
    });
    await expect(parseCadEvidencePdf(Buffer.from("   \n\t  "))).resolves.toMatchObject({
      salesAnalysis: { comps: [] },
      equityAnalysis: { comps: [] },
    });
  });
});
