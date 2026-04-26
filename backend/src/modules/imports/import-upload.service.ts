import { qAll, qExec, qGet } from "../../db/query.js";
import { canonicalizeImportSession } from "../canonical/canonical-ingest.service.js";
import { findEmployerById, resolvePayslipUploadContext } from "../payslip/payslip-employer-resolve.service.js";
import { parsePayslipPdfByProfile } from "../payslip/payslip-parse.service.js";
import { insertPayslipSnapshot, sha256Hex } from "../payslip/payslip.service.js";
import { type ParserProfileId } from "./profiles/profile-ids.js";
import { inferParserProfile } from "./infer-parser-profile.js";
import { updateImportFileBinding } from "./import-file-binding.service.js";
import { createImportSession, persistSessionFiles, transitionSessionStatus } from "./import-session.service.js";
import { parseSessionImportFiles } from "./import-parser.service.js";

type UploadFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype?: string;
};

type UploadBankParams = {
  householdId: string;
  userId: string;
  file: UploadFile;
  financialAccountId: string;
};

type UploadPayslipParams = {
  householdId: string;
  userId: string;
  file: UploadFile;
  employerId?: string;
};

type UploadParams =
  | ({ importType: "bank" } & UploadBankParams)
  | ({ importType: "payslip" } & UploadPayslipParams);

type UploadFailureCode =
  | "INVALID_ACCOUNT"
  | "PROFILE_INFERENCE_FAILED"
  | "SESSION_CREATE_FAILED"
  | "UPLOAD_FAILED"
  | "BINDING_FAILED"
  | "PARSE_FAILED"
  | "CANONICALIZE_FAILED"
  | "EMPLOYER_REQUIRED"
  | "INVALID_EMPLOYER"
  | "OPENAI_API_NOT_CONFIGURED"
  | "LLM_CANONICAL_VALIDATION_FAILED"
  | "LLM_EXTRACTION_FAILED"
  | "UNSUPPORTED_PARSER"
  | "DUPLICATE_PAYSLIP";

type UploadFailure = {
  ok: false;
  code: UploadFailureCode;
  message: string;
};

type UploadSuccess =
  | {
      ok: true;
      data: {
        type: "bank";
        sessionId: string;
        addedCount: number;
        duplicateCount: number;
        parserProfileId: string;
      };
    }
  | {
      ok: true;
      data: {
        type: "payslip";
        snapshotId: string;
        payPeriodStart: string | null;
        payPeriodEnd: string | null;
        netPayCurrent: number | null;
        employerDisplayName: string | null;
      };
    };

export type UploadAndImportResult = UploadSuccess | UploadFailure;

async function uploadBankAndImport(params: UploadBankParams): Promise<UploadAndImportResult> {
  const account = await qGet<{ id: string; type: string; institution: string }>(
    `SELECT id, type, institution
       FROM financial_account
       WHERE id = ? AND household_id = ?
       LIMIT 1`,
    params.financialAccountId,
    params.householdId
  );
  if (!account) {
    return { ok: false, code: "INVALID_ACCOUNT", message: "Financial account not found for household" };
  }

  const inferred = inferParserProfile(
    {
      id: account.id,
      type: account.type,
      institution: account.institution
    },
    params.file.originalname
  );
  if (!inferred) {
    return {
      ok: false,
      code: "PROFILE_INFERENCE_FAILED",
      message: "Could not infer parser profile for account and file combination."
    };
  }

  try {
    const created = await createImportSession(params.householdId, "upload", params.userId);

    const uploaded = await persistSessionFiles(created.id, params.householdId, [params.file]);
    if (!uploaded.ok) {
      return { ok: false, code: "UPLOAD_FAILED", message: uploaded.message };
    }
    const uploadedFile = uploaded.data.files[0];
    if (!uploadedFile) {
      return { ok: false, code: "UPLOAD_FAILED", message: "File upload did not create an import file row." };
    }

    const bound = await updateImportFileBinding(created.id, uploadedFile.id, params.householdId, params.userId, {
      financialAccountId: params.financialAccountId,
      parserProfileId: inferred as ParserProfileId
    });
    if (!bound.ok) {
      return { ok: false, code: "BINDING_FAILED", message: bound.message };
    }

    const parsed = await parseSessionImportFiles(created.id, params.householdId, params.userId, {});
    if (!parsed.ok) {
      return { ok: false, code: "PARSE_FAILED", message: parsed.message };
    }

    const canonicalized = await canonicalizeImportSession(created.id, params.householdId);
    if (!canonicalized.ok) {
      return { ok: false, code: "CANONICALIZE_FAILED", message: canonicalized.message };
    }

    await qExec(
      `UPDATE import_session
         SET stats_json = ?
       WHERE id = ? AND household_id = ?`,
      JSON.stringify({
        addedCount: canonicalized.data.inserted,
        duplicateCount: canonicalized.data.duplicates
      }),
      created.id,
      params.householdId
    );

    await transitionSessionStatus(created.id, params.householdId, "review");

    return {
      ok: true,
      data: {
        type: "bank",
        sessionId: created.id,
        addedCount: canonicalized.data.inserted,
        duplicateCount: canonicalized.data.duplicates,
        parserProfileId: inferred
      }
    };
  } catch {
    return { ok: false, code: "SESSION_CREATE_FAILED", message: "Could not complete bank import upload flow." };
  }
}

async function uploadPayslipAndImport(params: UploadPayslipParams): Promise<UploadAndImportResult> {
  const resolved = await resolvePayslipUploadContext(params.householdId, params.userId, params.employerId);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message };
  }

  const parsed = await parsePayslipPdfByProfile(params.file.buffer, resolved.parserProfileId as ParserProfileId);
  if (!parsed.ok) {
    if (parsed.reason === "unsupported_parser") {
      return { ok: false, code: "UNSUPPORTED_PARSER", message: "This payslip parser is not supported yet." };
    }
    if (parsed.reason === "openai_api_not_configured") {
      return { ok: false, code: "OPENAI_API_NOT_CONFIGURED", message: "OpenAI API key is not configured." };
    }
    if (parsed.reason === "llm_canonical_validation_failed") {
      return { ok: false, code: "LLM_CANONICAL_VALIDATION_FAILED", message: "Extracted payslip did not pass validation." };
    }
    return { ok: false, code: "LLM_EXTRACTION_FAILED", message: parsed.message };
  }

  const inserted = await insertPayslipSnapshot(
    params.householdId,
    params.file.originalname || "payslip.pdf",
    sha256Hex(params.file.buffer),
    resolved.parserProfileId,
    parsed.summary,
    null,
    resolved.employerId,
    undefined,
    undefined,
    parsed.hybrid,
    parsed.lineItems
  );
  if (!inserted.ok) {
    return {
      ok: false,
      code: "DUPLICATE_PAYSLIP",
      message: "A payslip with this file checksum was already uploaded for this household."
    };
  }

  const employer = resolved.employerId
    ? await findEmployerById(params.householdId, resolved.employerId, params.userId)
    : null;
  const employerDisplayName = employer?.displayName?.trim() || null;
  return {
    ok: true,
    data: {
      type: "payslip",
      snapshotId: inserted.snapshot.id,
      payPeriodStart: inserted.snapshot.payPeriodStart,
      payPeriodEnd: inserted.snapshot.payPeriodEnd,
      netPayCurrent: inserted.snapshot.netPayCurrent,
      employerDisplayName
    }
  };
}

export async function uploadAndImport(params: UploadParams): Promise<UploadAndImportResult> {
  if (params.importType === "bank") {
    return uploadBankAndImport(params);
  }
  return uploadPayslipAndImport(params);
}

export type ImportHistoryItem = {
  id: string;
  type: "bank" | "payslip";
  createdAt: string;
  label: string;
  status: string;
  addedCount: number | null;
  duplicateCount: number | null;
  canUndo: boolean;
};

export async function getImportHistory(householdId: string): Promise<ImportHistoryItem[]> {
  const bankRows = await qAll<{
    id: string;
    created_at: string;
    status: string;
    file_name: string | null;
    stats_json: string | null;
    canonical_count: string;
  }>(
    `SELECT s.id,
            s.started_at AS created_at,
            s.status,
            f.file_name,
            s.stats_json::text AS stats_json,
            (
              SELECT COUNT(*)::text
              FROM transaction_canonical tc
              WHERE tc.household_id = s.household_id
                AND tc.source_ref IN (
                  SELECT 'raw:' || tr.id
                  FROM transaction_raw tr
                  JOIN import_file fi ON fi.id = tr.file_id
                  WHERE fi.session_id = s.id
                )
            ) AS canonical_count
       FROM import_session s
       LEFT JOIN LATERAL (
         SELECT file_name FROM import_file
         WHERE session_id = s.id
         ORDER BY uploaded_at ASC
         LIMIT 1
       ) f ON TRUE
      WHERE s.household_id = ?
      ORDER BY s.started_at DESC
      LIMIT 50`,
    householdId
  );
  const payslipRows = await qAll<{
    id: string;
    created_at: string;
    file_name: string;
  }>(
    `SELECT id, created_at, file_name
       FROM payslip_snapshot
      WHERE household_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    householdId
  );

  const bankItems: ImportHistoryItem[] = bankRows.map((row) => {
    let addedCount: number | null = null;
    let duplicateCount: number | null = null;
    if (row.stats_json) {
      try {
        const parsed = JSON.parse(row.stats_json) as { addedCount?: number; duplicateCount?: number };
        addedCount = Number.isFinite(parsed.addedCount) ? Number(parsed.addedCount) : null;
        duplicateCount = Number.isFinite(parsed.duplicateCount) ? Number(parsed.duplicateCount) : null;
      } catch {
        addedCount = null;
        duplicateCount = null;
      }
    }
    return {
      id: row.id,
      type: "bank",
      createdAt: row.created_at,
      label: row.file_name || "Bank import session",
      status: row.status,
      addedCount,
      duplicateCount,
      canUndo: row.status === "review" && Number(row.canonical_count) > 0
    };
  });

  const payslipItems: ImportHistoryItem[] = payslipRows.map((row) => ({
    id: row.id,
    type: "payslip",
    createdAt: row.created_at,
    label: row.file_name || "Payslip upload",
    status: "uploaded",
    addedCount: null,
    duplicateCount: null,
    canUndo: true
  }));

  return [...bankItems, ...payslipItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);
}
