import crypto from "node:crypto";
import fs from "node:fs";

import { db } from "../../db/sqlite.js";

import { getSessionForHousehold, type ServiceResult } from "./import-session.service.js";
import { resolveParserAdapter } from "./parsers/parser-registry.js";
import { parseBoaCheckingOrSavingsCsv } from "./profiles/boa-checking-savings-csv.js";
import { parseBoaCreditCardCsv } from "./profiles/boa-credit-card-csv.js";
import { parseBoaEStatementPdf } from "./profiles/boa-estatement-pdf.js";
import { parseChaseCardCsv } from "./profiles/chase-card-csv.js";
import { parseCitiCardCsv } from "./profiles/citi-card-csv.js";
import { parseMarcusOnlineSavingsPdf } from "./profiles/marcus-online-savings-pdf.js";
import type { NormalizedRawPayload } from "./profiles/types.js";
import { parseAmount } from "./profiles/tabular-helpers.js";
import type { ParserProfileId } from "./profiles/profile-ids.js";

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
  }
}

export async function parseSessionImportFiles(
  sessionId: string,
  householdId: string,
  request: ParseRequest
): Promise<ServiceResult<ParseOutcome> | ParseFailure> {
  const session = getSessionForHousehold(sessionId, householdId);
  if (!session) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  const files = db
    .prepare(
      `SELECT id, file_name, stored_path, status, financial_account_id, parser_profile_id
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
      const extracted = await extractByProfile(profileId, buffer, file.file_name, request);
      if (!Array.isArray(extracted)) {
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

      const payloads = extracted;
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
        JSON.stringify({ stage: "parsed", parsedRows: parsedRowsForFile, profile: profileId }),
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
