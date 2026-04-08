import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type RenderPdfToPngOptions = {
  /** Rasterization DPI (default 200). */
  dpi?: number;
  /** If set, passed to `pdftoppm -scale-to` to cap max dimension in pixels. */
  scaleToMaxPx?: number;
};

const POPPLER_HINT =
  "Install Poppler so `pdftoppm` is on PATH (e.g. macOS: `brew install poppler`).";

function sortPngNames(files: string[]): string[] {
  return files.sort((a, b) => {
    const na = /\d+/.exec(a)?.[0];
    const nb = /\d+/.exec(b)?.[0];
    if (na !== undefined && nb !== undefined) {
      return Number(na) - Number(nb);
    }
    return a.localeCompare(b);
  });
}

/**
 * Renders every page of a PDF to PNG buffers using Poppler `pdftoppm`.
 * @returns PNG buffers in page order and the page count.
 */
export function renderPdfPagesToPng(
  pdfPath: string,
  options: RenderPdfToPngOptions = {}
): { pages: Buffer[]; pageCount: number } {
  const dpi = options.dpi ?? 200;
  const tmp = mkdtempSync(path.join(tmpdir(), "payslip-pdf-"));
  const outPrefix = path.join(tmp, "page");
  try {
    const args = ["-png", "-r", String(dpi)];
    if (options.scaleToMaxPx !== undefined && options.scaleToMaxPx > 0) {
      args.push("-scale-to", String(options.scaleToMaxPx));
    }
    args.push(pdfPath, outPrefix);
    execFileSync("pdftoppm", args, { stdio: "pipe" });
    const files = readdirSync(tmp).filter((f) => f.toLowerCase().endsWith(".png"));
    if (files.length === 0) {
      throw new Error(`pdftoppm produced no PNG files for ${pdfPath}`);
    }
    const sorted = sortPngNames(files);
    const pages = sorted.map((f) => readFileSync(path.join(tmp, f)));
    return { pages, pageCount: pages.length };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      throw new Error(`pdftoppm not found. ${POPPLER_HINT}`);
    }
    throw err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
