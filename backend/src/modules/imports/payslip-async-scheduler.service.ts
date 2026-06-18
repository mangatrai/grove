/**
 * Background scheduler for async LLM payslip extraction.
 *
 * Polls all import sessions with pending `openai_llm_payslip` files at
 * PAYSLIP_ASYNC_POLL_INTERVAL_MS (default 120 s). Each pending session is
 * handed to reconcilePayslipAsyncImportSession which runs the OpenAI extract,
 * creates the payslip snapshot, and marks the file parsed/failed.
 *
 * The reconcile function applies its own per-file throttle (payslip_async_last_poll_at),
 * so rapid server restarts do not re-trigger recently-processed files.
 */

import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { qAll } from "../../db/query.js";
import { OPENAI_LLM_PAYSLIP_PROVIDER } from "../payslip/llm-extract/payslip-async.constants.js";
import { reconcilePayslipAsyncImportSession } from "./payslip-async-import-reconcile.service.js";

const LOG_PREFIX = "[Payslip async scheduler]";
let schedulerStarted = false;

export function startPayslipAsyncScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalMs = env.PAYSLIP_ASYNC_POLL_INTERVAL_MS;
  log.info(`${LOG_PREFIX} started — polling every ${intervalMs / 1000}s`);

  // Run once immediately on startup, then on interval.
  void runPollCycle();
  setInterval(() => { void runPollCycle(); }, intervalMs);
}

async function runPollCycle(): Promise<void> {
  let pendingSessions: Array<{ session_id: string; household_id: string }>;
  try {
    pendingSessions = await qAll<{ session_id: string; household_id: string }>(
      `SELECT DISTINCT f.session_id, s.household_id
       FROM import_file f
       JOIN import_session s ON s.id = f.session_id
       WHERE f.status = 'processing'
         AND f.payslip_async_provider = ?`,
      OPENAI_LLM_PAYSLIP_PROVIDER
    );
  } catch (err) {
    log.error(`${LOG_PREFIX} DB query failed`, { err: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (pendingSessions.length === 0) return;
  log.info(`${LOG_PREFIX} ${pendingSessions.length} session(s) pending`);

  for (const { session_id, household_id } of pendingSessions) {
    try {
      const outcome = await reconcilePayslipAsyncImportSession(session_id, household_id);
      if (outcome.completedFiles > 0) {
        log.info(`${LOG_PREFIX} session=${session_id} completed=${outcome.completedFiles}`);
      }
      if (outcome.errors.length > 0) {
        log.warn(`${LOG_PREFIX} session=${session_id} errors`, { errors: outcome.errors });
      }
    } catch (err) {
      log.error(`${LOG_PREFIX} session=${session_id} failed`, { err: err instanceof Error ? err.message : String(err) });
    }
  }
}
