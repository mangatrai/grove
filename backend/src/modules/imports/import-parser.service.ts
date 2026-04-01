import crypto from "node:crypto";
import fs from "node:fs";

import { db } from "../../db/sqlite.js";

import { getSessionForHousehold, type ServiceResult } from "./import-session.service.js";
import { resolveParserAdapter } from "./parsers/parser-registry.js";
import {
  parseBoaCheckingOrSavingsCsv,
  parseBoaCheckingOrSavingsCsvDetailed,
  type BoaCsvDiagnostics
} from "./profiles/boa-checking-savings-csv.js";
import { parseBoaCreditCardCsv } from "./profiles/boa-credit-card-csv.js";
import { parseBoaEStatementPdf } from "./profiles/boa-estatement-pdf.js";
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
import { insertPayslipSnapshot, sha256Hex } from "../payslip/payslip.service.js";

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
    case "boa_estatement_pdf":
      return await parseBoaEStatementPdf(buffer);
    case "marcus_online_savings_pdf":
      return await parseMarcusOnlineSavingsPdf(buffer);
    case "ibm_pay_contributions_pdf":
    case "adp_payslip_pdf":
      throw new Error("payslip PDF profiles are handled in parseSessionImportFiles");
  }
}

async function extractByProfileWithDiagnostics(
  profileId: ParserProfileId,
  buffer: Buffer,
  fileName: string,
  request: ParseRequest
): Promise<{ rows: NormalizedRawPayload[]; diagnostics?: ParserDiagnostics } | ParseFailure> {
  if (profileId === "boa_checking_csv" || profileId === "boa_savings_csv") {
    const parsed = parseBoaCheckingOrSavingsCsvDetailed(buffer);
    return { rows: parsed.rows, diagnostics: { boaCsv: parsed.diagnostics } };
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
  const session = getSessionForHousehold(sessionId, householdId);
  if (!session) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  const files = db
    .prepare(
      `SELECT id, file_name, stored_path, status, financial_account_id, parser_profile_id, employer_id,
              owner_scope, owner_person_profile_id
       FROM import_file
       WHERE session_id = ?
       ORDER BY uploaded_at ASC`
    )
    .all(sessionId) as Array<{
    id: string;
    file_name: string;
    stored_path: string | null;
    status: string;
    financial_account_id: string | null;
    parser_profile_id: string | null;
    employer_id: string | null;
    owner_scope: "household" | "person" | null;
    owner_person_profile_id: string | null;
  }>;

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

  const updateFileStatusStmt = db.prepare(
    `UPDATE import_file
     SET status = ?, confidence_summary = ?
     WHERE id = ?`
  );

  const deleteRawRowsStmt = db.prepare(`DELETE FROM transaction_raw WHERE file_id = ?`);
  const insertRawRowStmt = db.prepare(
    `INSERT INTO transaction_raw (id, file_id, row_index, extracted_payload_json, confidence)
     VALUES (?, ?, ?, ?, ?)`
  );

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

    updateFileStatusStmt.run("processing", JSON.stringify({ stage: "parsing", profile: profileId }), file.id);

    try {
      if (profileId === "ibm_pay_contributions_pdf" || profileId === "adp_payslip_pdf") {
        if (!requireEmployerForPayslipImport(householdId, userId, file.employer_id)) {
          updateFileStatusStmt.run(
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
          const emp = findEmployerById(householdId, file.employer_id, userId);
          if (!emp) {
            updateFileStatusStmt.run(
              "failed",
              JSON.stringify({ stage: "failed", reason: "invalid_employer", profile: profileId }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "invalid_employer" });
            continue;
          }
          if (employerParserProfileId(emp) !== profileId) {
            updateFileStatusStmt.run(
              "failed",
              JSON.stringify({ stage: "failed", reason: "employer_parser_mismatch", profile: profileId }),
              file.id
            );
            outcome.skippedFiles.push({ fileId: file.id, reason: "employer_parser_mismatch" });
            continue;
          }
        }
        deleteRawRowsStmt.run(file.id);
        const checksum = sha256Hex(buffer);
        const parseResult = await parsePayslipPdfByProfile(buffer, profileId);
        if (!parseResult.ok) {
          if (parseResult.reason === "unsupported_parser") {
            updateFileStatusStmt.run(
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
          updateFileStatusStmt.run(
            "failed",
            JSON.stringify({ stage: "failed", reason: parseResult.reason, profile: profileId }),
            file.id
          );
          outcome.skippedFiles.push({ fileId: file.id, reason: `payslip_${parseResult.reason}` });
          continue;
        }
        const ins = insertPayslipSnapshot(
          householdId,
          file.file_name,
          checksum,
          profileId,
          parseResult.summary,
          file.id,
          file.employer_id,
          file.owner_scope === "person" ? "person" : "household",
          file.owner_scope === "person" ? file.owner_person_profile_id : null
        );
        if (!ins.ok) {
          updateFileStatusStmt.run(
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
        updateFileStatusStmt.run(
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
        updateFileStatusStmt.run(
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
      deleteRawRowsStmt.run(file.id);

      let parsedRowsForFile = 0;
      payloads.forEach((payload, index) => {
        const rowPayload = {
          ...payload,
          financial_account_id: file.financial_account_id
        };
        insertRawRowStmt.run(
          crypto.randomUUID(),
          file.id,
          index + 1,
          JSON.stringify(rowPayload),
          0.9
        );
        parsedRowsForFile += 1;
      });

      outcome.parsedFiles += 1;
      outcome.parsedRows += parsedRowsForFile;
      updateFileStatusStmt.run(
        "parsed",
        JSON.stringify({
          stage: "parsed",
          parsedRows: parsedRowsForFile,
          profile: profileId,
          parserDiagnostics: extracted.diagnostics ?? null
        }),
        file.id
      );
    } catch {
      updateFileStatusStmt.run(
        "failed",
        JSON.stringify({ stage: "failed", reason: "parse_error" }),
        file.id
      );
      outcome.skippedFiles.push({ fileId: file.id, reason: "parse_error" });
    }
  }

  if (outcome.parsedFiles === 0) {
    return { ok: false, code: "NO_SUPPORTED_FILES", message: "No files were parsed successfully" };
  }

  db.prepare(`UPDATE import_session SET status = 'review' WHERE id = ?`).run(sessionId);
  return { ok: true, data: outcome };
}
