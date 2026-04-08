/**
 * POC: render PDF pages with Poppler `pdftoppm`, one OpenAI vision + JSON-schema call, Zod validation.
 * Prerequisites: `OPENAI_API_KEY`, Poppler on PATH, repo root `.env` with `OPENAI_MODEL` optional.
 *
 * Usage (from repo): `npm run extract-payslip-llm -w backend`
 * Optional arg: path to PDF (defaults to Deloitte sample under `data/imports/custom/`).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractPayslipFromPdf } from "../src/modules/payslip/llm-extract/extract-payslip-llm.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultPdf = path.join(repoRoot, "data/imports/custom/Pay Statement_2026_0206.pdf");

async function main(): Promise<void> {
  const pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultPdf;
  const { extract, usage } = await extractPayslipFromPdf({ pdfPath });
  console.log(JSON.stringify({ extract, usage }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
