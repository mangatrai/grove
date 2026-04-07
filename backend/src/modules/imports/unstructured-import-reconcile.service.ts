import fs from "node:fs";

import { env } from "../../config/env.js";
import { qAll, qExec, qGet } from "../../db/query.js";
import { getSessionForHousehold } from "./import-session.service.js";
import {
  isUnstructuredJobComplete,
  isUnstructuredJobFailed,
  unstructuredJobsDownloadResult,
  unstructuredJobsGetStatus
} from "./unstructured-jobs.service.js";
import {
  parseDeloittePayslipFromUnstructuredElements,
  type UnstructuredPartitionElement
} from "../payslip/profiles/deloitte-unstructured-parse.js";
import { insertPayslipSnapshot, sha256Hex } from "../payslip/payslip.service.js";
import { DELOITTE_PAYSLIP_PDF_PROFILE_ID } from "../payslip/payslip.types.js";

function normalizePartitionElements(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === "object" && "elements" in data && Array.isArray((data as { elements: unknown }).elements)) {
    return (data as { elements: unknown[] }).elements;
  }
  return [];
}

export type ReconcileUnstructuredOutcome = {
  polledFiles: number;
  completedFiles: number;
  stillPending: boolean;
  errors: Array<{ fileId: string; message: string }>;
};

/**
 * Poll Unstructured for completed Deloitte import files and insert payslip snapshots.
 * Throttles per `UNSTRUCTURED_POLL_INTERVAL_MS` unless `force` is true.
 */
export async function reconcileUnstructuredImportSession(
  sessionId: string,
  householdId: string,
  options?: { force?: boolean }
): Promise<ReconcileUnstructuredOutcome> {
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
    unstructured_job_id: string | null;
    unstructured_input_file_id: string | null;
    unstructured_last_poll_at: string | null;
    employer_id: string | null;
    owner_scope: "household" | "person" | null;
    owner_person_profile_id: string | null;
  }>(
    `SELECT id, file_name, stored_path, status, parser_profile_id,
            unstructured_job_id, unstructured_input_file_id, unstructured_last_poll_at,
            employer_id, owner_scope, owner_person_profile_id
     FROM import_file
     WHERE session_id = ? AND parser_profile_id = ?
       AND unstructured_job_id IS NOT NULL
       AND unstructured_input_file_id IS NOT NULL
       AND status = 'processing'`,
    sessionId,
    DELOITTE_PAYSLIP_PDF_PROFILE_ID
  );

  const outcome: ReconcileUnstructuredOutcome = {
    polledFiles: 0,
    completedFiles: 0,
    stillPending: false,
    errors: []
  };

  const intervalMs = env.UNSTRUCTURED_POLL_INTERVAL_MS;
  const now = Date.now();

  for (const file of files) {
    const jobId = file.unstructured_job_id!;
    const inputFileId = file.unstructured_input_file_id!;

    if (!file.stored_path) {
      outcome.errors.push({ fileId: file.id, message: "missing_stored_file" });
      continue;
    }

    const lastPoll = file.unstructured_last_poll_at ? new Date(file.unstructured_last_poll_at).getTime() : 0;
    if (!options?.force && lastPoll > 0 && now - lastPoll < intervalMs) {
      outcome.stillPending = true;
      continue;
    }

    outcome.polledFiles += 1;

    try {
      const { status } = await unstructuredJobsGetStatus(jobId);
      await qExec(`UPDATE import_file SET unstructured_last_poll_at = NOW() WHERE id = ?`, file.id);

      if (isUnstructuredJobFailed(status)) {
        await qExec(
          `UPDATE import_file SET status = ?, confidence_summary = ? WHERE id = ?`,
          "failed",
          JSON.stringify({
            stage: "failed",
            reason: "unstructured_job_failed",
            unstructuredStatus: status
          }),
          file.id
        );
        outcome.errors.push({ fileId: file.id, message: `unstructured_job_failed:${status}` });
        continue;
      }

      if (!isUnstructuredJobComplete(status)) {
        outcome.stillPending = true;
        continue;
      }

      const raw = await unstructuredJobsDownloadResult(jobId, inputFileId);
      const elements = normalizePartitionElements(raw) as UnstructuredPartitionElement[];
      const summary = parseDeloittePayslipFromUnstructuredElements(elements);
      if (!summary) {
        await qExec(
          `UPDATE import_file SET status = ?, confidence_summary = ? WHERE id = ?`,
          "failed",
          JSON.stringify({ stage: "failed", reason: "unstructured_parse_no_summary" }),
          file.id
        );
        outcome.errors.push({ fileId: file.id, message: "unstructured_parse_no_summary" });
        continue;
      }

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
        file.owner_scope === "person" ? file.owner_person_profile_id : null
      );

      if (!ins.ok) {
        await qExec(
          `UPDATE import_file SET status = ?, confidence_summary = ? WHERE id = ?`,
          "failed",
          JSON.stringify({
            stage: "failed",
            reason: "duplicate_payslip_checksum",
            existingSnapshotId: ins.existing.id
          }),
          file.id
        );
        outcome.errors.push({ fileId: file.id, message: "duplicate_payslip_checksum" });
        continue;
      }

      await qExec(
        `UPDATE import_file SET status = ?, confidence_summary = ?,
                unstructured_job_id = NULL, unstructured_input_file_id = NULL
         WHERE id = ?`,
        "parsed",
        JSON.stringify({
          stage: "parsed",
          parsedRows: 0,
          profile: DELOITTE_PAYSLIP_PDF_PROFILE_ID,
          payslipSnapshotId: ins.snapshot.id,
          unstructuredSource: "jobs"
        }),
        file.id
      );
      outcome.completedFiles += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await qExec(`UPDATE import_file SET unstructured_last_poll_at = NOW() WHERE id = ?`, file.id);
      outcome.errors.push({ fileId: file.id, message: msg.slice(0, 500) });
    }
  }

  const remaining = await qGet<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM import_file
     WHERE session_id = ? AND parser_profile_id = ?
       AND unstructured_job_id IS NOT NULL AND status = 'processing'`,
    sessionId,
    DELOITTE_PAYSLIP_PDF_PROFILE_ID
  );
  if (Number(remaining?.c ?? 0) > 0) {
    outcome.stillPending = true;
  }

  const processingRow = await qGet<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM import_file WHERE session_id = ? AND status = 'processing'`,
    sessionId
  );
  if (Number(processingRow?.c ?? 0) === 0) {
    await qExec(`UPDATE import_session SET status = 'review' WHERE id = ?`, sessionId);
  }

  return outcome;
}
