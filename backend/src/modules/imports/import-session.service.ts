import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { qAll, qExec, qGet } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";

import {
  type ImportSessionStatus,
  isValidSessionTransition,
  sessionAcceptsFileUploads
} from "./import-session.state-machine.js";

export interface ImportSessionRow {
  id: string;
  household_id: string;
  source_type: string;
  status: ImportSessionStatus;
  started_at: string;
  finalized_at: string | null;
}

export type ServiceErrorCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "SESSION_CLOSED_FOR_UPLOAD";

export interface ServiceResult<T> {
  ok: true;
  data: T;
}

export interface ServiceFailure {
  ok: false;
  code: ServiceErrorCode;
  message: string;
  from?: ImportSessionStatus;
  to?: ImportSessionStatus;
}

function notFound(): ServiceFailure {
  return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
}

/**
 * Load session by id only if it belongs to the given household (authorization boundary).
 */
export async function getSessionForHousehold(
  sessionId: string,
  householdId: string
): Promise<ImportSessionRow | null> {
  const row = await qGet<ImportSessionRow>(
    `SELECT id, household_id, source_type, status, started_at, finalized_at
       FROM import_session
       WHERE id = ? AND household_id = ?`,
    sessionId,
    householdId
  );
  return row ?? null;
}

export async function createImportSession(
  householdId: string,
  sourceType: "upload" | "watch_folder"
): Promise<{ id: string; status: ImportSessionStatus }> {
  const sessionId = crypto.randomUUID();
  await qExec(
    `INSERT INTO import_session (id, household_id, source_type, status, started_at)
     VALUES (?, ?, ?, 'created', CURRENT_TIMESTAMP)`,
    sessionId,
    householdId,
    sourceType
  );
  return { id: sessionId, status: "created" };
}

export async function transitionSessionStatus(
  sessionId: string,
  householdId: string,
  nextStatus: ImportSessionStatus
): Promise<ServiceResult<{ sessionId: string; status: ImportSessionStatus }> | ServiceFailure> {
  const row = await qGet<{
    id: string;
    household_id: string;
    status: ImportSessionStatus;
  }>(`SELECT id, household_id, status FROM import_session WHERE id = ? AND household_id = ?`, sessionId, householdId);

  if (!row) {
    return notFound();
  }

  const current = row.status;
  if (!isValidSessionTransition(current, nextStatus)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: "Invalid session status transition",
      from: current,
      to: nextStatus
    };
  }

  await qExec(
    `UPDATE import_session
     SET status = ?,
         finalized_at = CASE WHEN ? = 'finalized' THEN CURRENT_TIMESTAMP ELSE finalized_at END
     WHERE id = ?`,
    nextStatus,
    nextStatus,
    sessionId
  );

  return { ok: true, data: { sessionId, status: nextStatus } };
}

export interface MulterFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype?: string;
}

export interface PersistedImportFile {
  id: string;
  fileName: string;
  checksum: string;
  status: "queued";
}

export interface SkippedImportFile {
  fileName: string;
  code: "DUPLICATE_CHECKSUM_IN_SESSION";
  message: string;
}

/**
 * Persist uploaded files to disk and DB. Moves session to `processing` after handling the request.
 * The session directory under `data/imports/<sessionId>/` is created only when at least one file
 * is written (not skipped as a duplicate checksum in this session).
 * Duplicate SHA-256 checksums within the same session are **skipped** (not fatal) so other files in
 * the same request still upload.
 */
export async function persistSessionFiles(
  sessionId: string,
  householdId: string,
  files: MulterFileLike[]
): Promise<ServiceResult<{ files: PersistedImportFile[]; skipped: SkippedImportFile[] }> | ServiceFailure> {
  const session = await getSessionForHousehold(sessionId, householdId);
  if (!session) {
    return notFound();
  }

  if (!sessionAcceptsFileUploads(session.status)) {
    return {
      ok: false,
      code: "SESSION_CLOSED_FOR_UPLOAD",
      message: "Session does not accept uploads in current state"
    };
  }

  const targetDir = resolveDataPath(path.join("data", "imports", sessionId));
  /** Only create the session dir when at least one file is actually written (not skipped as duplicate). */
  let ensuredTargetDir = false;

  const created: PersistedImportFile[] = [];
  const skipped: SkippedImportFile[] = [];

  for (const file of files) {
    const checksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const dup = await qGet(`SELECT 1 FROM import_file WHERE session_id = ? AND checksum = ?`, sessionId, checksum);
    if (dup) {
      skipped.push({
        fileName: file.originalname,
        code: "DUPLICATE_CHECKSUM_IN_SESSION",
        message: "A file with the same checksum was already uploaded in this session"
      });
      continue;
    }

    const fileId = crypto.randomUUID();
    const safeName = `${fileId}-${file.originalname}`;
    const storedPath = path.join(targetDir, safeName);

    if (!ensuredTargetDir) {
      fs.mkdirSync(targetDir, { recursive: true });
      ensuredTargetDir = true;
    }

    fs.writeFileSync(storedPath, file.buffer);

    try {
      await qExec(
        `INSERT INTO import_file (
       id, session_id, file_name, checksum, parser_profile_id, status,
       confidence_summary, stored_path, file_size, mime_type, uploaded_at
     ) VALUES (?, ?, ?, ?, NULL, 'queued', '{}', ?, ?, ?, CURRENT_TIMESTAMP)`,
        fileId,
        sessionId,
        file.originalname,
        checksum,
        storedPath,
        file.size,
        file.mimetype || "application/octet-stream"
      );
    } catch (err) {
      try {
        fs.unlinkSync(storedPath);
      } catch {
        // best-effort cleanup
      }
      throw err;
    }

    created.push({
      id: fileId,
      fileName: file.originalname,
      checksum,
      status: "queued"
    });
  }

  await qExec(`UPDATE import_session SET status = 'processing' WHERE id = ?`, sessionId);

  return { ok: true, data: { files: created, skipped } };
}

export async function listSessionDetail(sessionId: string, householdId: string): Promise<ImportSessionRow | null> {
  return getSessionForHousehold(sessionId, householdId);
}

/**
 * After canonical ingest, raw bytes are no longer needed; remove staged files and clear pointers.
 * Idempotent: safe if paths are already missing.
 */
export async function deleteStagingFilesForSession(sessionId: string): Promise<void> {
  const rows = await qAll<{ stored_path: string }>(
    `SELECT stored_path FROM import_file WHERE session_id = ? AND stored_path IS NOT NULL`,
    sessionId
  );

  await qExec(`UPDATE import_file SET stored_path = NULL WHERE session_id = ?`, sessionId);

  for (const row of rows) {
    try {
      if (fs.existsSync(row.stored_path)) {
        fs.unlinkSync(row.stored_path);
      }
    } catch {
      // best-effort
    }
  }

  const sessionDir = resolveDataPath(path.join("data", "imports", sessionId));
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
}

export type ImportSessionListRow = {
  id: string;
  status: ImportSessionStatus;
  sourceType: string;
  startedAt: string;
  finalizedAt: string | null;
  fileCount: number;
};

/**
 * Recent import sessions for the household (newest first). Used for resume / wayfinding in the UI.
 */
export async function listImportSessionsForHousehold(
  householdId: string,
  limit = 40
): Promise<ImportSessionListRow[]> {
  const cap = Math.min(Math.max(limit, 1), 100);
  const rows = await qAll<{
    id: string;
    status: ImportSessionStatus;
    sourceType: string;
    startedAt: string;
    finalizedAt: string | null;
    fileCount: string;
  }>(
    `SELECT s.id AS id, s.status AS status, s.source_type AS "sourceType", s.started_at AS "startedAt",
              s.finalized_at AS "finalizedAt",
              (SELECT COUNT(*)::text FROM import_file f WHERE f.session_id = s.id) AS "fileCount"
       FROM import_session s
       WHERE s.household_id = ?
       ORDER BY s.started_at DESC
       LIMIT ?`,
    householdId,
    cap
  );

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    sourceType: r.sourceType,
    startedAt: r.startedAt,
    finalizedAt: r.finalizedAt,
    fileCount: Number(r.fileCount) || 0
  }));
}

export async function listFilesForSession(sessionId: string): Promise<
  Array<{
    id: string;
    file_name: string;
    checksum: string;
    status: string;
    file_size: number | null;
    mime_type: string | null;
    uploaded_at: string;
    financial_account_id: string | null;
    parser_profile_id: string | null;
    employer_id: string | null;
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
  }>
> {
  return qAll(
    `SELECT id, file_name, checksum, status, file_size, mime_type, uploaded_at,
              financial_account_id, parser_profile_id, employer_id, owner_scope, owner_person_profile_id
       FROM import_file
       WHERE session_id = ?
       ORDER BY uploaded_at ASC`,
    sessionId
  );
}
