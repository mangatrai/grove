import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID } from "./payslip.types.js";
import { parseIbmPayslipPdf } from "./profiles/ibm-payslip-pdf.js";
import { insertPayslipSnapshot, listPayslipSnapshots, sha256Hex } from "./payslip.service.js";

const upload = multer({ storage: multer.memoryStorage() });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

export const payslipRouter = Router();
payslipRouter.use(requireAuth);

payslipRouter.get("/", (req: AuthenticatedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  const { total, items } = listPayslipSnapshots(householdId, {
    limit: parsed.data.limit,
    offset: parsed.data.offset
  });
  res.json({ total, limit: parsed.data.limit, offset: parsed.data.offset, items });
});

payslipRouter.post("/upload", upload.single("file"), async (req: AuthenticatedRequest, res) => {
  const file = req.file;
  if (!file || !file.buffer?.length) {
    res.status(400).json({ message: "No file provided", code: "MISSING_FILE" });
    return;
  }

  const householdId = req.authUser!.householdId;
  const fileName = file.originalname || "payslip.pdf";
  const checksum = sha256Hex(file.buffer);

  const parsed = await parseIbmPayslipPdf(file.buffer);
  if (!parsed.ok) {
    const body: Record<string, unknown> = {
      message:
        parsed.reason === "empty_pdf_text"
          ? "No selectable text in this PDF. Image-only or scanned payslips need OCR or a text-based export."
          : parsed.reason === "pdf_read_error"
            ? "Could not read the PDF file."
            : "Could not find gross pay, net pay, or pay period fields in the extracted text. The layout may differ from supported templates (IBM-style Current/YTD summary).",
      code:
        parsed.reason === "empty_pdf_text"
          ? "NO_PDF_TEXT"
          : parsed.reason === "pdf_read_error"
            ? "PDF_READ_ERROR"
            : "PARSE_FAILED",
      fileChecksum: checksum
    };
    res.status(422).json(body);
    return;
  }

  const result = insertPayslipSnapshot(
    householdId,
    fileName,
    checksum,
    IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID,
    parsed.summary
  );

  if (!result.ok) {
    res.status(409).json({
      message: "A payslip with this file checksum was already uploaded for this household",
      code: "DUPLICATE_PAYSLIP",
      existing: result.existing
    });
    return;
  }

  res.status(201).json({ snapshot: result.snapshot });
});
