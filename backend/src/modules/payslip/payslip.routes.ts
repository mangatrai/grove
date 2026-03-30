import { Router } from "express";
import multer from "multer";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID } from "./payslip.types.js";
import { parseIbmPayslipPdf } from "./profiles/ibm-payslip-pdf.js";
import { insertPayslipSnapshot, sha256Hex } from "./payslip.service.js";

const upload = multer({ storage: multer.memoryStorage() });

export const payslipRouter = Router();
payslipRouter.use(requireAuth);

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
  if (!parsed) {
    res.status(422).json({
      message: "Could not parse payslip summary from PDF text",
      code: "PARSE_FAILED",
      fileChecksum: checksum
    });
    return;
  }

  const result = insertPayslipSnapshot(
    householdId,
    fileName,
    checksum,
    IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID,
    parsed
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
