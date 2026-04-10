import crypto from "node:crypto";
import fs from "node:fs";

import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { qAll, qExec, qGet } from "../../db/query.js";

import { getSessionForHousehold, type ServiceResult } from "./import-session.service.js";
import { resolveParserAdapter } from "./parsers/parser-registry.js";
import {
  parseBoaCheckingOrSavingsCsv,
  parseBoaCheckingOrSavingsCsvDetailed,
  type BoaCsvDiagnostics,
  type BoaStatementBalances
} from "./profiles/boa-checking-savings-csv.js";
import { parseBoaCreditCardCsv } from "./profiles/boa-credit-card-csv.js";
import { parseBoaEStatementFromTextDetailed } from "./profiles/boa-estatement-pdf.js";
import { extractPdfText } from "./profiles/pdf-text.js";
import { parseChaseCardCsv } from "./profiles/chase-card-csv.js";
import { parseCitiCardCsv } from "./profiles/citi-card-csv.js";
import { parseMarcusOnlineSavingsPdf } from "./profiles/marcus-online-savings-pdf.js";
import type { NormalizedRawPayload } from "./profiles/types.js";
import { parseAmount } from "./profiles/tabular-helpers.js";
import type { ParserProfileId } from "./profiles/profile-ids.js";
import {
  findEmployerById,
  employerParserProfileId,
  requireEmployerForPayslipImport
} from "../payslip/payslip-employer-resolve.service.js";
import { parsePayslipPdfByProfile } from "../payslip/payslip-parse.service.js";
import { upsertImportBalanceSnapshotFromStatement } from "../reports/balance-sheet.service.js";
import { insertPayslipSnapshot, sha256Hex } from "../payslip/payslip.service.js";
import { DELOITTE_PAYSLIP_PDF_PROFILE_ID } from "../payslip/payslip.types.js";
import { OPENAI_LLM_PAYSLIP_PROVIDER } from "../payslip/llm-extract/payslip-async.constants.js";

export interface ParseColumnMapping {
  date: string;
  amount: string;
  description: string;
  postingDate?: string;
  referenceId?: string;
}

export interface ParseRequest {
  /** Required for files using `generic_tabular` profile. */
  mapping?: ParseColumnMapping;
  sheetName?: string;
}

export interface ParseOutcome {
  parsedFiles: number;
  parsedRows: number;
  skippedFiles: Array<{ fileId: string; reason: string }>;
  /** Deloitte PDFs queued for async LLM extract; poll `/reconcile-payslip-async` until parsed. */
  asyncPayslipPending?: number;
}

type ParserDiagnostics = {
  boaCsv?: BoaCsvDiagnostics;
};

type ParseFailureCode =
  | "NOT_FOUND"
  | "NO_SUPPORTED_FILES"
  | "INVALID_MAPPING"
  | "MISSING_FILE_BINDING";

export interface ParseFailure {
  ok?: false;
  code: ParseFailureCode;
  message: string;
  /** Populated for `NO_SUPPORTED_FILES` so clients can distinguish duplicate checksum vs parse errors. */
  skippedFiles?: Array<{ fileId: string; reason: string }>;
}

function pickColumn(row: Record<string, string>, columnName: string | undefined): string {
  if (!columnName) {
    return "";
  }
  if (row[columnName] !== undefined) {
    return row[columnName];
  }
  const lookup = columnName.toLowerCase();
  const matchedKey = Object.keys(row).find((key) => key.toLowerCase() === lookup);
  return matchedKey ? row[matchedKey] : "";
}

function rowsFromGenericTabular(
  rows: Record<string, string>[],
  mapping: ParseColumnMapping
): NormalizedRawPayload[] {
  const out: NormalizedRawPayload[] = [];
  rows.forEach((row) => {
    const rawAmount = pickColumn(row, mapping.amount);
    const amount = parseAmount(rawAmount);
    const date = pickColumn(row, mapping.date);
    const description = pickColumn(row, mapping.description);
    if (!date || !description || amount === null) {
      return;
    }
    out.push({
      txn_date: date,
      posting_date: pickColumn(row, mapping.postingDate) || date,
      description,
      amount,
      reference_id: pickColumn(row, mapping.referenceId) || undefined,
      source_row: row
    });
  });
  return out;
}

async function extractByProfile(
  profileId: ParserProfileId,
  buffer: Buffer,
  fileName: string,
  request: ParseRequest
): Promise<NormalizedRawPayload[] | ParseFailure> {
  switch (profileId) {
    case "generic_tabular": {
      if (!request.mapping?.date || !request.mapping?.amount || !request.mapping?.description) {
        return {
          ok: false as const,
          code: "INVALID_MAPPING",
          message: "generic_tabular requires mapping.date, mapping.amount, mapping.description"
        };
      }
      const adapter = resolveParserAdapter(fileName);
      if (!adapter) {
        return {
          ok: false as const,
          code: "INVALID_MAPPING",
          message: "generic_tabular supports .csv, .xlsx, .xls only"
        };
      }
      const rows = adapter.parse(buffer, { sheetName: request.sheetName });
      return rowsFromGenericTabular(rows, request.mapping);
    }
    case "chase_card_csv":
      return parseChaseCardCsv(buffer);
    case "citi_card_csv":
      return parseCitiCardCsv(buffer);
    case "boa_checking_csv":
    case "boa_savings_csv":
      return parseBoaCheckingOrSavingsCsv(buffer);
    case "boa_credit_card_csv":
      return parseBoaCreditCardCsv(buffer);
    case "boa_estatement_pdf": {
      const text = await extractPdfText(buffer);
      return parseBoaEStatementFromTextDetailed(text).rows;
    }
    case "marcus_online_savings_pdf":
      return await parseMarcusOnlineSavingsPdf(buffer);
    case "ibm_pay_contributions_pdf":
    case "adp_payslip_pdf":
    case "deloitte_payslip_pdf":
      throw new Error("payslip PDF profiles are handled in parseSessionImportFiles");
  }
}

async function extractByProfileWithDiagnostics(
  profileId: ParserProfileId,
  buffer: Buffer,
  fileName: string,
  request: ParseRequest
): Promise<{
  rows: NormalizedRawPayload[];
  diagnostics?: ParserDiagnostics;
  statementBalances?: BoaStatementBalances | null;
} | ParseFailure> {
  if (profileId === "boa_checking_csv" || profileId === "boa_savings_csv") {
    const src = profileId === "boa_savings_csv" ? "boa_savings_csv" : "boa_checking_csv";
    const parsed = parseBoaCheckingOrSavingsCsvDetailed(buffer, src);
    return { rows: parsed.rows, diagnostics: { boaCsv: parsed.diagnostics }, statementBalances: parsed.statementBalances };
  }
  if (profileId === "boa_estatement_pdf") {
    const text = await extractPdfText(buffer);
    const parsed = parseBoaEStatementFromTextDetailed(text);
    return { rows: parsed.rows, statementBalances: parsed.statementBalances };
  }
  const extracted = await extractByProfile(profileId, buffer, fileName, request);
  if (!Array.isArray(extracted)) {
    return extracted;
  }
  return { rows: extracted };
}

export async function parseSessionImportFiles(
  sessionId: string,
  householdId: string,
  userId: string,
  request: ParseRequest
): Promise<ServiceResult<ParseOutcome> | ParseFailure> {
  const session = await getSessionForHousehold(sessionId, householdId);
  if (!session) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  const files = await qAll<{
    id: string;
    file_name: string;
    stored_path: string | null;
    status: string;
    financial_account_id: string | null;
    parser_profile_id: string | null;
    employer_id: string | null;
    owner_scope: "household" | "person" | null;
    owner_person_profile_id: string | null;
  }>(
    `SELECT id, file_name, stored_path, status, financial_account_id, parser_profile_id, employer_id,
              owner_scope, owner_person_profile_id
       FROM import_file
       WHERE session_id = ?
       ORDER BY uploaded_at ASC`,
    sessionId
  );

  if (files.length === 0) {
    return { ok: false, code: "NO_SUPPORTED_FILES", message: "No files in import session" };
  }

  const unbound = files.find((f) => !f.financial_account_id || !f.parser_profile_id);
  if (unbound) {
    return {
      ok: false,
      code: "MISSING_FILE_BINDING",
      message: "Each file must have financial_account_id and parser_profile_id before parse"
    };
  }

  const outcome: ParseOutcome = {
    parsedFiles: 0,
    parsedRows: 0,
    skippedFiles: []
  };

  for (const file of files) {
    if (!file.stored_path || !fs.existsSync(file.stored_path)) {
      outcome.skippedFiles.push({ fileId: file.id, reason: "missing_stored_file" });
      continue;
    }

    const profileId = file.parser_profile_id as ParserProfileId;
    const buffer = fs.readFileSync(file.stored_path);

    await qExec(
      `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
      "processing",
      JSON.stringify({ stage: "parsing", profile: profileId }),
      file.id
    );

    try {
      if (profileId === "ibm_pay_contributions_pdf" || profileId === "adp_payslip_pdf" || profileId === "deloitte_payslip_pdf") {
        if (!(await requireEmployerForPayslipImport(householdId, userId, file.employer_id))) {
          await qExec(
            `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
            "failed",
            JSON.stringify({
              stage: "failed",
              reason: "employer_required_for_payslip",
              profile: profileId
            }),
            file.id
          );
          outcome.skippedFiles.push({ fileId: file.id, reason: "missing_employer_for_payslip" });
          continue;
        }
        if (file.employer_id) {
          const emp = await findEmployerById(householdId, file.employer_id, userId);
          if (!emp) {
            await qExec(
              `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
              "failed",
              JSON.stringify({ stage: "failed", reason: "invalid_employer", profile: profileId }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "invalid_employer" });
            continue;
          }
          if (employerParserProfileId(emp) !== profileId) {
            await qExec(
              `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
              "failed",
              JSON.stringify({ stage: "failed", reason: "employer_parser_mismatch", profile: profileId }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "employer_parser_mismatch" });
            continue;
          }
        }
        await qExec(`DELETE FROM transaction_raw WHERE file_id = ?`, file.id);

        if (profileId === DELOITTE_PAYSLIP_PDF_PROFILE_ID) {
          if (!env.OPENAI_API_KEY?.trim()) {
            await qExec(
              `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
              "failed",
              JSON.stringify({
                stage: "failed",
                reason: "openai_api_not_configured",
                profile: profileId
              }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "payslip_openai_api_not_configured" });
            continue;
          }
          log.info("[Import parse] queueing Deloitte PDF for async LLM payslip extract", {
            importFileId: file.id,
            fileName: file.file_name,
            pdfBytes: buffer.byteLength,
            provider: OPENAI_LLM_PAYSLIP_PROVIDER
          });
          outcome.asyncPayslipPending = (outcome.asyncPayslipPending ?? 0) + 1;
          await qExec(
            `UPDATE import_file
     SET status = ?, confidence_summary = ?,
         payslip_async_provider = ?, payslip_async_last_poll_at = NULL
     WHERE id = ?`,
            "processing",
            JSON.stringify({
              stage: "llm_queued",
              profile: profileId,
              payslipAsyncProvider: OPENAI_LLM_PAYSLIP_PROVIDER
            }),
            OPENAI_LLM_PAYSLIP_PROVIDER,
            file.id
          );
          continue;
        }

        const checksum = sha256Hex(buffer);
        const parseResult = await parsePayslipPdfByProfile(buffer, profileId, { pdfPath: file.stored_path });
        if (!parseResult.ok) {
          if (parseResult.reason === "unsupported_parser") {
            await qExec(
              `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
              "failed",
              JSON.stringify({
                stage: "failed",
                reason: parseResult.reason,
                parserProfileId: parseResult.parserProfileId
              }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "payslip_unsupported_parser" });
            continue;
          }
          if (parseResult.reason === "openai_api_not_configured") {
            await qExec(
              `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
              "failed",
              JSON.stringify({
                stage: "failed",
                reason: "openai_api_not_configured",
                profile: profileId
              }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "payslip_openai_api_not_configured" });
            continue;
          }
          if (parseResult.reason === "llm_canonical_validation_failed") {
            await qExec(
              `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
              "failed",
              JSON.stringify({
                stage: "failed",
                reason: "llm_canonical_validation_failed",
                detail: parseResult.detail,
                profile: profileId
              }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "payslip_llm_canonical_validation_failed" });
            continue;
          }
          if (parseResult.reason === "llm_extraction_failed") {
            await qExec(
              `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
              "failed",
              JSON.stringify({
                stage: "failed",
                reason: "llm_extraction_failed",
                message: parseResult.message,
                profile: profileId
              }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "payslip_llm_extraction_failed" });
            continue;
          }
          await qExec(
            `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
            "failed",
            JSON.stringify({ stage: "failed", reason: "payslip_parse_unknown", profile: profileId }),
            file.id
          );
          outcome.skippedFiles.push({ fileId: file.id, reason: "payslip_parse_failed" });
          continue;
        }
        const ins = await insertPayslipSnapshot(
          householdId,
          file.file_name,
          checksum,
          profileId,
          parseResult.summary,
          file.id,
          file.employer_id,
          file.owner_scope === "person" ? "person" : "household",
          file.owner_scope === "person" ? file.owner_person_profile_id : null,
          parseResult.hybrid
        );
        if (!ins.ok) {
          await qExec(
            `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
            "failed",
            JSON.stringify({
              stage: "failed",
              reason: "duplicate_payslip_checksum",
              existingSnapshotId: ins.existing.id,
              profile: profileId
            }),
            file.id
          );
          outcome.skippedFiles.push({ fileId: file.id, reason: "duplicate_payslip_checksum" });
          continue;
        }
        outcome.parsedFiles += 1;
        await qExec(
          `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
          "parsed",
          JSON.stringify({
            stage: "parsed",
            parsedRows: 0,
            profile: profileId,
            payslipSnapshotId: ins.snapshot.id
          }),
          file.id
        );
        continue;
      }

      const extracted = await extractByProfileWithDiagnostics(profileId, buffer, file.file_name, request);
      if ("code" in extracted) {
        await qExec(
          `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
          "failed",
          JSON.stringify({ stage: "failed", reason: extracted.code }),
          file.id
        );
        if (extracted.code === "INVALID_MAPPING") {
          return extracted;
        }
        outcome.skippedFiles.push({ fileId: file.id, reason: extracted.code });
        continue;
      }

      const payloads = extracted.rows;
      await qExec(`DELETE FROM transaction_raw WHERE file_id = ?`, file.id);

      let parsedRowsForFile = 0;
      for (let index = 0; index < payloads.length; index++) {
        const payload = payloads[index]!;
        const rowPayload = {
          ...payload,
          financial_account_id: file.financial_account_id
        };
        await qExec(
          `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
     VALUES (?, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          file.id,
          index + 1,
          JSON.stringify(rowPayload),
          0.9
        );
        parsedRowsForFile += 1;
      }

      outcome.parsedFiles += 1;
      outcome.parsedRows += parsedRowsForFile;
      await qExec(
        `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
        "parsed",
        JSON.stringify({
          stage: "parsed",
          parsedRows: parsedRowsForFile,
          profile: profileId,
          parserDiagnostics: extracted.diagnostics ?? null,
          ...(extracted.statementBalances != null ? { statementBalances: extracted.statementBalances } : {})
        }),
        file.id
      );

      const sb = extracted.statementBalances;
      if (file.financial_account_id && sb != null && sb.ending != null && Number.isFinite(Number(sb.ending))) {
        const rawEnd = sb.asOfEnd?.trim() ? String(sb.asOfEnd).slice(0, 10) : "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawEnd)) {
          const acct = await qGet<{ currency: string }>(
            `SELECT currency FROM financial_account WHERE id = ? AND household_id = ? LIMIT 1`,
            file.financial_account_id,
            householdId
          );
          if (acct) {
            const snap = await upsertImportBalanceSnapshotFromStatement(householdId, {
              financialAccountId: file.financial_account_id,
              importFileId: file.id,
              asOfDate: rawEnd,
              amount: Number(sb.ending),
              currency: String(acct.currency ?? "USD")
            });
            if (!snap.ok) {
              log.warn("[Import parse] could not persist statement balance snapshot", {
                importFileId: file.id,
                financialAccountId: file.financial_account_id,
                code: snap.ok ? undefined : snap.code
              });
            }
          }
        }
      }
    } catch {
      await qExec(
        `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`,
        "failed",
        JSON.stringify({ stage: "failed", reason: "parse_error" }),
        file.id
      );
      outcome.skippedFiles.push({ fileId: file.id, reason: "parse_error" });
    }
  }

  const asyncPayslipPending = outcome.asyncPayslipPending ?? 0;
  if (outcome.parsedFiles === 0 && asyncPayslipPending === 0) {
    return {
      ok: false,
      code: "NO_SUPPORTED_FILES",
      message: "No files were parsed successfully",
      skippedFiles: outcome.skippedFiles
    };
  }

  if (asyncPayslipPending > 0) {
    await qExec(`UPDATE import_session SET status = 'processing' WHERE id = ?`, sessionId);
  } else {
    await qExec(`UPDATE import_session SET status = 'review' WHERE id = ?`, sessionId);
  }
  return {
    ok: true,
    data: {
      ...outcome,
      asyncPayslipPending
    }
  };
}
