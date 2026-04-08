import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import type { ParserProfileId } from "../imports/profiles/profile-ids.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { resolvePayslipUploadContext } from "./payslip-employer-resolve.service.js";
import { parsePayslipPdfByProfile } from "./payslip-parse.service.js";
import { sniffPayslipPdfBuffer } from "./payslip-sniff.service.js";
import {
  getPayslipSnapshotForHousehold,
  insertPayslipSnapshot,
  listPayslipSnapshots,
  patchPayslipSnapshotForHousehold,
  sha256Hex
} from "./payslip.service.js";
import { DELOITTE_PAYSLIP_PDF_PROFILE_ID } from "./payslip.types.js";

const upload = multer({ storage: multer.memoryStorage() });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  ownerScope: z.enum(["household", "person"]).optional(),
  ownerPersonProfileId: z.string().uuid().optional()
});

const idParamSchema = z.object({
  id: z.string().uuid()
});

const payslipPatchSchema = z
  .object({
    payPeriodStart: z.string().nullable().optional(),
    payPeriodEnd: z.string().nullable().optional(),
    payDate: z.string().nullable().optional(),
    grossPayCurrent: z.number().nullable().optional(),
    grossPayYtd: z.number().nullable().optional(),
    employeeTaxesCurrent: z.number().nullable().optional(),
    employeeTaxesYtd: z.number().nullable().optional(),
    preTaxDeductionsCurrent: z.number().nullable().optional(),
    preTaxDeductionsYtd: z.number().nullable().optional(),
    postTaxDeductionsCurrent: z.number().nullable().optional(),
    postTaxDeductionsYtd: z.number().nullable().optional(),
    netPayCurrent: z.number().nullable().optional(),
    netPayYtd: z.number().nullable().optional(),
    hoursOrDaysCurrent: z.string().nullable().optional()
  })
  .strict();

export const payslipRouter = Router();
payslipRouter.use(requireAuth);

payslipRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  const { total, items } = await listPayslipSnapshots(householdId, {
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    ownerScope: parsed.data.ownerScope,
    ownerPersonProfileId: parsed.data.ownerPersonProfileId ?? null
  });
  res.json({ total, limit: parsed.data.limit, offset: parsed.data.offset, items });
});

/** Optional PDF text sniff for parser / employer suggestion (before upload). Register before /:id. */
payslipRouter.post("/sniff", upload.single("file"), async (req: AuthenticatedRequest, res) => {
  const file = req.file;
  if (!file || !file.buffer?.length) {
    res.status(400).json({ message: "No file provided", code: "MISSING_FILE" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await sniffPayslipPdfBuffer(householdId, req.authUser!.userId, file.buffer);
  if (!out.ok) {
    res.status(422).json({
      message:
        out.reason === "empty_pdf_text"
          ? "No selectable text in this PDF."
          : "Could not read the PDF file.",
      code: out.reason === "empty_pdf_text" ? "NO_PDF_TEXT" : "PDF_READ_ERROR"
    });
    return;
  }
  const s = out.suggestion;
  res.status(200).json({
    suggestedParserProfileId: s.suggestedParserProfileId,
    confidence: s.confidence,
    hints: s.hints,
    suggestedEmployerId: s.suggestedEmployerId,
    note: s.note
  });
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
  const employerIdRaw =
    typeof (req.body as { employerId?: unknown })?.employerId === "string"
      ? (req.body as { employerId: string }).employerId
      : undefined;

  const resolved = await resolvePayslipUploadContext(householdId, req.authUser!.userId, employerIdRaw);
  if (!resolved.ok) {
    res.status(400).json({
      message: resolved.message,
      code: resolved.code
    });
    return;
  }

  const parseResult = await parsePayslipPdfByProfile(
    file.buffer,
    resolved.parserProfileId as ParserProfileId
  );

  if (!parseResult.ok) {
    if (parseResult.reason === "unsupported_parser") {
      if (parseResult.parserProfileId === DELOITTE_PAYSLIP_PDF_PROFILE_ID) {
        res.status(422).json({
          message:
            "Deloitte Pay Statement PDFs are processed via Import (async OpenAI extraction). Use Import → bind employer → Parse, then wait for processing or run Reconcile.",
          code: "DELOITTE_USE_IMPORT",
          parserProfileId: parseResult.parserProfileId
        });
        return;
      }
      res.status(422).json({
        message:
          "This payslip parser is not implemented yet. Supported parsers: IBM Pay & Contributions (PDF), Deloitte Pay Statement (PDF) via Import.",
        code: "UNSUPPORTED_PARSER",
        parserProfileId: parseResult.parserProfileId
      });
      return;
    }
    const body: Record<string, unknown> = {
      message:
        parseResult.reason === "empty_pdf_text"
          ? "No selectable text in this PDF. Image-only or scanned payslips need OCR or a text-based export."
          : parseResult.reason === "pdf_read_error"
            ? "Could not read the PDF file."
            : "Could not find gross pay, net pay, or pay period fields in the extracted text. The layout may differ from supported templates (IBM-style Current/YTD summary).",
      code:
        parseResult.reason === "empty_pdf_text"
          ? "NO_PDF_TEXT"
          : parseResult.reason === "pdf_read_error"
            ? "PDF_READ_ERROR"
            : "PARSE_FAILED",
      fileChecksum: checksum
    };
    res.status(422).json(body);
    return;
  }

  const result = await insertPayslipSnapshot(
    householdId,
    fileName,
    checksum,
    resolved.parserProfileId,
    parseResult.summary,
    null,
    resolved.employerId
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

payslipRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payslip id", issues: parsed.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  const snapshot = await getPayslipSnapshotForHousehold(householdId, parsed.data.id);
  if (!snapshot) {
    res.status(404).json({ message: "Payslip not found", code: "NOT_FOUND" });
    return;
  }
  res.json(snapshot);
});

payslipRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const params = idParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid payslip id", issues: params.error.flatten() });
    return;
  }
  const body = payslipPatchSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ message: "Invalid payload", issues: body.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  const updated = await patchPayslipSnapshotForHousehold(householdId, params.data.id, body.data);
  if (!updated) {
    res.status(404).json({ message: "Payslip not found", code: "NOT_FOUND" });
    return;
  }
  res.json({ snapshot: updated });
});
