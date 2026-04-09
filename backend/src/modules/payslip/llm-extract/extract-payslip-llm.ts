import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";

import { env } from "../../../config/env.js";
import {
  payslipDocumentMetadataSchema,
  payslipLlmApiResponseSchema,
  type PayslipLlmExtract
} from "./payslip-llm.schema.js";
import { renderPdfPagesToPng } from "./pdf-page-to-png.js";

const PARSER_SOURCE = "openai-chat-completions-json_schema";

function loadPayslipJsonSchema(): Record<string, unknown> {
  const path = fileURLToPath(new URL("./payslip.schema.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/**
 * OpenAI `response_format.json_schema.schema` (Draft-07, `strict: true`).
 * Uses `$defs.LineItem` + `$ref`; if the API rejects refs, duplicate the LineItem object under each
 * array `items` in a copy of this file (see plan). Loaded from disk so `tsc` emits JS next to the JSON.
 */
export const PAYSLIP_JSON_SCHEMA_FOR_OPENAI: Record<string, unknown> = loadPayslipJsonSchema();

export type ExtractPayslipLlmOptions = {
  /** On-disk PDF (avoids a temp copy when the file is already stored). */
  pdfPath?: string;
  /** PDF bytes; written to a temp file for rendering (exactly one of `pdfPath` or `pdfBuffer` required). */
  pdfBuffer?: Buffer;
  /** Override model (defaults to `env.OPENAI_MODEL`). */
  model?: string;
};

function requireApiKey(): string {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set in the environment.");
  }
  return key;
}

/**
 * Single OpenAI vision call + structured JSON schema output, Zod validation, merged `document_metadata`.
 * No automatic retries (SDK `maxRetries: 0`).
 */
export async function extractPayslipFromPdf(options: ExtractPayslipLlmOptions): Promise<{
  extract: PayslipLlmExtract;
  usage: OpenAI.Chat.Completions.ChatCompletion["usage"];
}> {
  const hasPath = options.pdfPath != null && options.pdfPath.length > 0;
  const hasBuf = options.pdfBuffer != null && options.pdfBuffer.byteLength > 0;
  if (hasPath === hasBuf) {
    throw new Error("Exactly one of pdfPath or pdfBuffer must be provided.");
  }

  const apiKey = requireApiKey();
  const model = options.model ?? env.OPENAI_MODEL;
  const client = new OpenAI({ apiKey, maxRetries: 0 });

  let pdfPathForRender: string;
  let tempDir: string | undefined;
  if (hasPath) {
    pdfPathForRender = options.pdfPath!;
  } else {
    tempDir = await mkdtemp(join(tmpdir(), "payslip-pdf-"));
    pdfPathForRender = join(tempDir, "payslip.pdf");
    await writeFile(pdfPathForRender, options.pdfBuffer!);
  }

  let pageCount: number;
  let pages: Buffer[];
  try {
    const rendered = renderPdfPagesToPng(pdfPathForRender, { dpi: 200, scaleToMaxPx: 2048 });
    pageCount = rendered.pageCount;
    pages = rendered.pages;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const imageParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = pages.map((buf) => ({
    type: "image_url",
    image_url: {
      url: `data:image/png;base64,${buf.toString("base64")}`
    }
  }));

  const systemPrompt = [
    "You extract payroll data from payslip page images into JSON that matches the provided schema.",
    "Use null for any field that is absent or not visible.",
    "Prefer ISO dates YYYY-MM-DD when you can infer a full date from the document.",
    "Numbers must be plain JSON numbers without currency symbols or thousands separators.",
    "Deloitte-style layout: the stub often has two side-by-side column groups (Current vs YTD). Pair each Current amount with the YTD in the same column group only — do not mix Current from one block with YTD from another.",
    "Map each table row into the appropriate line_items section; use raw_section for the section label when helpful.",
    "For PRE-TAX DEDUCTION(S), POST-TAX DEDUCTION(S), and OTHER DEDUCTION(S), capture each visible row with both amount_current and amount_ytd when the table shows Current/YTD columns.",
    "If a section has row-level Current/YTD values but the section header/summary total is absent, keep summary fields null and still return line_items rows with amount_ytd populated.",
    "Taxes: put every row from a TAX DEDUCTION(S) / withholding section into line_items.tax_deductions with amount_current and amount_ytd per row.",
    "Set summary.tax_deductions_current and summary.tax_deductions_ytd to the section totals (sums of those rows) when the stub shows totals; if only line items are visible, the totals can be left null (the server may sum line items).",
    "Deloitte: rows labeled OTHER DEDUCTION(S) are post-tax — put them in line_items.post_tax_deductions and roll section totals into summary.post_tax_deductions_current and summary.post_tax_deductions_ytd (not summary.other_deductions_* or line_items.other_deductions).",
    "Deloitte: 'After-Tax Ded' / after-tax deduction totals map to summary.post_tax_deductions_current (and YTD when shown).",
    "Deloitte: 'TAXABLE EARNINGS (FED)' and similar federal taxable lines belong in summary.taxable_earnings_current / summary.taxable_earnings_ytd only — do not treat them as gross pay.",
    "Do not invent totals; use null if unclear."
  ].join(" ");

  const userText = `There are ${pageCount} page image(s) in order (page 1 first). Extract the full payslip per schema.`;

  const completion = await client.chat.completions.create({
    model,
    max_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [{ type: "text", text: userText }, ...imageParts]
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "payslip",
        strict: true,
        schema: PAYSLIP_JSON_SCHEMA_FOR_OPENAI
      }
    }
  });

  const content = completion.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI returned no message content.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    throw new Error("OpenAI returned non-JSON message content.");
  }

  const parsed = payslipLlmApiResponseSchema.parse(raw);

  const merged: PayslipLlmExtract = {
    ...parsed,
    document_metadata: payslipDocumentMetadataSchema.parse({
      page_count: pageCount,
      parser_source: PARSER_SOURCE,
      extraction_model: model,
      extracted_at: new Date().toISOString()
    })
  };

  return { extract: merged, usage: completion.usage };
}
