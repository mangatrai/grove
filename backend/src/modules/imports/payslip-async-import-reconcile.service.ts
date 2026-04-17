/**
 * Background reconcile for async LLM payslip extraction (`openai_llm_payslip`).
 * Deferred work: OpenAI call runs here on poll interval (not during initial POST /parse).
 */
import fs from "node:fs";

import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { qAll, qExec } from "../../db/query.js";
import { getSessionForHousehold } from "./import-session.service.js";
import { extractPayslipFromPdf } from "../payslip/llm-extract/extract-payslip-llm.js";
import { OPENAI_LLM_PAYSLIP_PROVIDER } from "../payslip/llm-extract/payslip-async.constants.js";
import {
  mapCanonicalExtractToPersist,
  validateCanonicalForImport
} from "../payslip/llm-extract/payslip-canonical-map.js";
import { insertPayslipSnapshot, sha256Hex } from "../payslip/payslip.service.js";
import { DELOITTE_PAYSLIP_PDF_PROFILE_ID } from "../payslip/payslip.types.js";

const LOG_PREFIX = "[Payslip async LLM reconcile]";

export type ReconcilePayslipAsyncOutcome = {
  polledFiles: number;
  completedFiles: number;
  stillPending: boolean;
  errors: Array<{ fileId: string; message: string }>;
};

export async function reconcilePayslipAsyncImportSession(
  sessionId: string,
  householdId: string,
  options?: { force?: boolean }
): Promise<ReconcilePayslipAsyncOutcome> {
  const session = await getSessionForHousehold(sessionId, householdId);
  if (!session) {
    throw new Error("Import session not found");
  }

  const files = await qAll<{
    id: string;
    file_name: string;
    stored_path: string | null;
    status: string;
    parser_profile_id: string | null;
    payslip_async_provider: string | null;
    payslip_async_last_poll_at: string | null;
    employer_id: string | null;
    owner_scope: "household" | "person" | null;
    owner_person_profile_id: string | null;
  }>(
    `SELECT id, file_name, stored_path, status, parser_profile_id,
            payslip_async_provider, payslip_async_last_poll_at,
            employer_id, owner_scope, owner_person_profile_id
     FROM import_file
     WHERE session_id = ?
       AND parser_profile_id = ?
       AND payslip_async_provider = ?
       AND status = 'processing'`,
    sessionId,
    DELOITTE_PAYSLIP_PDF_PROFILE_ID,
    OPENAI_LLM_PAYSLIP_PROVIDER
  );

  const outcome: ReconcilePayslipAsyncOutcome = {
    polledFiles: 0,
    completedFiles: 0,
    stillPending: false,
    errors: []
  };

  if (files.length > 0) {
    log.info(`${LOG_PREFIX} session=${sessionId} pendingFiles=${files.length}`, {
      fileIds: files.map((f) => f.id),
      force: Boolean(options?.force)
    });
  }

  const intervalMs = env.PAYSLIP_ASYNC_POLL_INTERVAL_MS;
  const now = Date.now();

  for (const file of files) {
    if (!file.stored_path || !fs.existsSync(file.stored_path)) {
      log.warn(`${LOG_PREFIX} missing_stored_file`, { importFileId: file.id, fileName: file.file_name });
      outcome.errors.push({ fileId: file.id, message: "missing_stored_file" });
      continue;
    }

    const lastPoll = file.payslip_async_last_poll_at ? new Date(file.payslip_async_last_poll_at).getTime() : 0;
    if (!options?.force && lastPoll > 0 && now - lastPoll < intervalMs) {
      outcome.stillPending = true;
      continue;
    }

    outcome.polledFiles += 1;
    log.info(`${LOG_PREFIX} running LLM extract`, { importFileId: file.id, fileName: file.file_name });

    try {
      await qExec(`UPDATE import_file SET payslip_async_last_poll_at = NOW() WHERE id = ?`, file.id);

      const { extract, usage } = await extractPayslipFromPdf({ pdfPath: file.stored_path });
      const validation = validateCanonicalForImport(extract);
      if (!validation.ok) {
        await qExec(
          `UPDATE import_file SET status = ?, confidence_summary = ? WHERE id = ?`,
          "failed",
          JSON.stringify({
            stage: "failed",
            reason: "llm_canonical_validation_failed",
            detail: validation.reasons,
            profile: DELOITTE_PAYSLIP_PDF_PROFILE_ID
          }),
          file.id
        );
        outcome.errors.push({ fileId: file.id, message: validation.reasons.join(",") });
        continue;
      }

      const { summary, hybrid, lineItems } = mapCanonicalExtractToPersist(extract, usage?.total_tokens ?? null);
      const buffer = fs.readFileSync(file.stored_path);
      const checksum = sha256Hex(buffer);

      const ins = await insertPayslipSnapshot(
        householdId,
        file.file_name,
        checksum,
        DELOITTE_PAYSLIP_PDF_PROFILE_ID,
        summary,
        file.id,
        file.employer_id,
        file.owner_scope === "person" ? "person" : "household",
        file.owner_scope === "person" ? file.owner_person_profile_id : null,
        hybrid,
        lineItems
      );

      if (!ins.ok) {
        await qExec(
          `UPDATE import_file SET status = ?, confidence_summary = ? WHERE id = ?`,
          "failed",
          JSON.stringify({
            stage: "failed",
            reason: "duplicate_payslip_checksum",
            existingSnapshotId: ins.existing.id,
            profile: DELOITTE_PAYSLIP_PDF_PROFILE_ID
          }),
          file.id
        );
        outcome.errors.push({ fileId: file.id, message: "duplicate_payslip_checksum" });
        continue;
      }

      await qExec(
        `UPDATE import_file
         SET status = ?, confidence_summary = ?,
             payslip_async_provider = NULL, payslip_async_last_poll_at = NULL
         WHERE id = ?`,
        "parsed",
        JSON.stringify({
          stage: "parsed",
          parsedRows: 0,
          profile: DELOITTE_PAYSLIP_PDF_PROFILE_ID,
          payslipSnapshotId: ins.snapshot.id,
          payslipAsyncProvider: OPENAI_LLM_PAYSLIP_PROVIDER,
          usageTokens: usage?.total_tokens ?? null
        }),
        file.id
      );
      log.info(`${LOG_PREFIX} import_file parsed`, { importFileId: file.id, payslipSnapshotId: ins.snapshot.id });
      outcome.completedFiles += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      log.error(`${LOG_PREFIX} failed`, { importFileId: file.id, message: msg, stack });
      await qExec(
        `UPDATE import_file SET status = ?, confidence_summary = ? WHERE id = ?`,
        "failed",
        JSON.stringify({
          stage: "failed",
          reason: "llm_extract_failed",
          detail: msg.slice(0, 800),
          profile: DELOITTE_PAYSLIP_PDF_PROFILE_ID
        }),
        file.id
      );
      outcome.errors.push({ fileId: file.id, message: msg.slice(0, 500) });
    }
  }

  const remaining = await qAll<{ id: string }>(
    `SELECT id FROM import_file
     WHERE session_id = ?
       AND parser_profile_id = ?
       AND payslip_async_provider = ?
       AND status = 'processing'`,
    sessionId,
    DELOITTE_PAYSLIP_PDF_PROFILE_ID,
    OPENAI_LLM_PAYSLIP_PROVIDER
  );
  if (remaining.length > 0) {
    outcome.stillPending = true;
  }

  const processingRow = await qAll<{ id: string }>(
    `SELECT id FROM import_file WHERE session_id = ? AND status = 'processing'`,
    sessionId
  );
  if (processingRow.length === 0) {
    await qExec(`UPDATE import_session SET status = 'review' WHERE id = ?`, sessionId);
  }

  if (outcome.polledFiles > 0 || outcome.errors.length > 0) {
    log.info(`${LOG_PREFIX} done session=${sessionId}`, {
      polledFiles: outcome.polledFiles,
      completedFiles: outcome.completedFiles,
      stillPending: outcome.stillPending,
      errorCount: outcome.errors.length
    });
  }

  return outcome;
}
