import { createRequire } from "node:module";

/**
 * Load `lib/pdf-parse.js` via require — the package root `index.js` runs a debug harness when
 * `module.parent` is absent (common under ESM), which breaks tests and tooling.
 */
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer
) => Promise<{ text?: string }>;

/**
 * Extract plain text from a PDF buffer (text-based statements; scanned PDFs need OCR).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return typeof result.text === "string" ? result.text : "";
}
