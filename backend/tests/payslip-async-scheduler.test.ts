import crypto from "node:crypto";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as dbQuery from "../src/db/query.js";
import * as reconcileModule from "../src/modules/imports/payslip-async-import-reconcile.service.js";
import { armPayslipAsyncScheduler, runPollCycle } from "../src/modules/imports/payslip-async-scheduler.service.js";
import { OPENAI_LLM_PAYSLIP_PROVIDER } from "../src/modules/payslip/llm-extract/payslip-async.constants.js";
import { sqlStmt } from "./pg-stmt.js";

const HOUSEHOLD_ID = crypto.randomUUID();
const SESSION_ID = crypto.randomUUID();
const FILE_ID = crypto.randomUUID();

// These tests exercise the module-level hasPendingWork flag in the order it
// actually transitions in production (armed at boot -> idle -> re-armed by
// enqueue -> idle again on drain), so they must run in declaration order.
describe("payslip async scheduler — hasPendingWork flag lifecycle (FIX #220)", () => {
  const reconcileSpy = vi
    .spyOn(reconcileModule, "reconcilePayslipAsyncImportSession")
    .mockResolvedValue({ polledFiles: 0, completedFiles: 0, stillPending: false, errors: [] });

  beforeAll(async () => {
    await sqlStmt(
      `INSERT INTO household (id, name, owner_user_id, employers_json) VALUES (?, 'Scheduler Test Household', NULL, '[]')`
    ).run(HOUSEHOLD_ID);
  });

  afterEach(() => {
    reconcileSpy.mockClear();
  });

  it("runs the startup query once even with nothing pending, then goes idle", async () => {
    const qAllSpy = vi.spyOn(dbQuery, "qAll");
    await runPollCycle();
    expect(qAllSpy).toHaveBeenCalledTimes(1);
    qAllSpy.mockRestore();
  });

  it("skips the DB query entirely on the next tick while disarmed", async () => {
    const qAllSpy = vi.spyOn(dbQuery, "qAll");
    await runPollCycle();
    expect(qAllSpy).not.toHaveBeenCalled();
    qAllSpy.mockRestore();
  });

  it("re-arms on enqueue and queries again", async () => {
    armPayslipAsyncScheduler();
    const qAllSpy = vi.spyOn(dbQuery, "qAll");
    await runPollCycle();
    expect(qAllSpy).toHaveBeenCalledTimes(1);
    qAllSpy.mockRestore();
  });

  it("reconciles a pending session, then drains and goes idle once it clears", async () => {
    await sqlStmt(
      `INSERT INTO import_session (id, household_id, source_type, status) VALUES (?, ?, 'upload', 'processing')`
    ).run(SESSION_ID, HOUSEHOLD_ID);
    await sqlStmt(
      `INSERT INTO import_file (id, session_id, file_name, checksum, status, confidence_summary, payslip_async_provider)
       VALUES (?, ?, 'payslip.pdf', ?, 'processing', '{}', ?)`
    ).run(FILE_ID, SESSION_ID, crypto.randomUUID(), OPENAI_LLM_PAYSLIP_PROVIDER);

    armPayslipAsyncScheduler();
    await runPollCycle();
    expect(reconcileSpy).toHaveBeenCalledWith(SESSION_ID, HOUSEHOLD_ID);

    // Simulate the reconcile finishing: file leaves the 'processing' queue.
    await sqlStmt(`UPDATE import_file SET status = 'parsed', payslip_async_provider = NULL WHERE id = ?`).run(
      FILE_ID
    );

    const drainQAllSpy = vi.spyOn(dbQuery, "qAll");
    await runPollCycle();
    expect(drainQAllSpy).toHaveBeenCalledTimes(1);
    drainQAllSpy.mockRestore();

    const idleQAllSpy = vi.spyOn(dbQuery, "qAll");
    await runPollCycle();
    expect(idleQAllSpy).not.toHaveBeenCalled();
    idleQAllSpy.mockRestore();
  });
});
