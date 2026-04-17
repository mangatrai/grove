import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { qGet } from "../../db/query.js";
import { isParserProfileId, type ParserProfileId } from "../imports/profiles/profile-ids.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  employerParserProfileId,
  findEmployerById,
  resolvePayslipUploadContext
} from "./payslip-employer-resolve.service.js";
import { parsePayslipPdfByProfile } from "./payslip-parse.service.js";
import { sniffPayslipPdfBuffer } from "./payslip-sniff.service.js";
import {
  deletePayslipSnapshotForHousehold,
  findMatchedDeposits,
  getPayslipLineItems,
  getPayslipSnapshotForHousehold,
  insertManualPayslipSnapshot,
  insertPayslipSnapshot,
  listPayslipSnapshots,
  patchPayslipSnapshotForHousehold,
  sha256Hex
} from "./payslip.service.js";
import { DELOITTE_PAYSLIP_PDF_PROFILE_ID } from "./payslip.types.js";

/** 25 MB per payslip file — PDFs are small; caps memory usage per upload request. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }
});

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
    hoursOrDaysCurrent: z.string().nullable().optional(),
    hoursOrDaysYtd: z.string().nullable().optional(),
    taxableEarningsCurrent: z.number().nullable().optional(),
    taxableEarningsYtd: z.number().nullable().optional(),
    otherInformationCurrent: z.number().nullable().optional(),
    otherInformationYtd: z.number().nullable().optional(),
    employmentRate: z.number().nullable().optional(),
    employmentRateType: z.string().max(50).nullable().optional()
  })
  .strict();

const manualPayslipBodySchema = payslipPatchSchema
  .merge(
    z.object({
      employerId: z.union([z.string().uuid(), z.null()]).optional(),
      parserProfileId: z.string().min(1).max(120).optional(),
      ownerScope: z.enum(["household", "person"]).optional(),
      ownerPersonProfileId: z.union([z.string().uuid(), z.null()]).optional()
    })
  )
  .strict()
  .refine(
    (d) => d.payDate != null || d.netPayCurrent != null || d.grossPayCurrent != null,
    "Provide at least pay date, gross pay, or net pay"
  );

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

payslipRouter.post("/manual", async (req: AuthenticatedRequest, res) => {
  const parsed = manualPayslipBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;

  const ownerScope = body.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (body.ownerPersonProfileId ?? null) : null;
  if (ownerScope === "person" && !ownerPersonProfileId) {
    res.status(400).json({ message: "ownerPersonProfileId is required when ownerScope=person" });
    return;
  }
  if (ownerScope === "person" && ownerPersonProfileId) {
    const ownerOk = await qGet<{ ok: number }>(
      `SELECT 1 AS ok FROM person_profile WHERE id = ? AND household_id = ? LIMIT 1`,
      ownerPersonProfileId,
      householdId
    );
    if (!ownerOk) {
      res.status(400).json({ message: "Owner person profile not found for household" });
      return;
    }
  }

  const employerIdRaw =
    body.employerId === undefined || body.employerId === null ? undefined : body.employerId;

  const resolved = await resolvePayslipUploadContext(householdId, userId, employerIdRaw);
  if (!resolved.ok) {
    res.status(400).json({
      message: resolved.message,
      code: resolved.code
    });
    return;
  }

  let parserProfileId = resolved.parserProfileId;
  if (body.parserProfileId) {
    if (!isParserProfileId(body.parserProfileId)) {
      res.status(400).json({ message: "Unknown parser profile id", code: "INVALID_PROFILE" });
      return;
    }
    if (resolved.employerId) {
      const emp = await findEmployerById(householdId, resolved.employerId, userId);
      if (!emp) {
        res.status(400).json({ message: "Employer not found in household settings", code: "INVALID_EMPLOYER" });
        return;
      }
      const want = employerParserProfileId(emp);
      if (want !== body.parserProfileId) {
        res.status(400).json({
          message: `Employer is configured for ${want}; selected format was ${body.parserProfileId}`,
          code: "EMPLOYER_PARSER_MISMATCH"
        });
        return;
      }
    } else {
      parserProfileId = body.parserProfileId as ParserProfileId;
    }
  }

  let employerDisplayName: string | null = null;
  if (resolved.employerId) {
    const emp = await findEmployerById(householdId, resolved.employerId, userId);
    employerDisplayName = emp?.displayName?.trim() ? String(emp.displayName).trim() : null;
  }

  const summary = {
    payPeriodStart: body.payPeriodStart ?? null,
    payPeriodEnd: body.payPeriodEnd ?? null,
    payDate: body.payDate ?? null,
    hoursOrDaysCurrent: body.hoursOrDaysCurrent ?? null,
    hoursOrDaysYtd: body.hoursOrDaysYtd ?? null,
    grossPayCurrent: body.grossPayCurrent ?? null,
    grossPayYtd: body.grossPayYtd ?? null,
    employeeTaxesCurrent: body.employeeTaxesCurrent ?? null,
    employeeTaxesYtd: body.employeeTaxesYtd ?? null,
    preTaxDeductionsCurrent: body.preTaxDeductionsCurrent ?? null,
    preTaxDeductionsYtd: body.preTaxDeductionsYtd ?? null,
    postTaxDeductionsCurrent: body.postTaxDeductionsCurrent ?? null,
    postTaxDeductionsYtd: body.postTaxDeductionsYtd ?? null,
    netPayCurrent: body.netPayCurrent ?? null,
    netPayYtd: body.netPayYtd ?? null,
    taxableEarningsCurrent: body.taxableEarningsCurrent ?? null,
    taxableEarningsYtd: body.taxableEarningsYtd ?? null,
    otherInformationCurrent: body.otherInformationCurrent ?? null,
    otherInformationYtd: body.otherInformationYtd ?? null
  };

  const result = await insertManualPayslipSnapshot(householdId, {
    parserProfileId,
    employerId: resolved.employerId,
    employerDisplayName,
    ownerScope,
    ownerPersonProfileId,
    summary
  });

  res.status(201).json({ snapshot: result.snapshot });
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
          "This payslip parser is not implemented yet. Supported parsers: IBM Pay & Contributions (PDF, OpenAI vision), Deloitte Pay Statement (PDF) via Import.",
        code: "UNSUPPORTED_PARSER",
        parserProfileId: parseResult.parserProfileId
      });
      return;
    }
    if (parseResult.reason === "openai_api_not_configured") {
      res.status(422).json({
        message: "OpenAI API key is not configured. Set OPENAI_API_KEY to extract IBM payslips.",
        code: "OPENAI_API_NOT_CONFIGURED"
      });
      return;
    }
    if (parseResult.reason === "llm_canonical_validation_failed") {
      res.status(422).json({
        message: "Extracted payslip did not pass validation.",
        code: "LLM_CANONICAL_VALIDATION_FAILED",
        detail: parseResult.detail,
        fileChecksum: checksum
      });
      return;
    }
    if (parseResult.reason === "llm_extraction_failed") {
      res.status(422).json({
        message: parseResult.message,
        code: "LLM_EXTRACTION_FAILED",
        fileChecksum: checksum
      });
      return;
    }
    res.status(422).json({ message: "Payslip parse failed.", code: "PARSE_FAILED", fileChecksum: checksum });
    return;
  }

  const result = await insertPayslipSnapshot(
    householdId,
    fileName,
    checksum,
    resolved.parserProfileId,
    parseResult.summary,
    null,
    resolved.employerId,
    undefined,
    undefined,
    parseResult.hybrid,
    parseResult.lineItems
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
  const [matchedDeposits, lineItems] = await Promise.all([
    findMatchedDeposits(householdId, snapshot.payDate, snapshot.netPayCurrent, snapshot.ownerPersonProfileId),
    getPayslipLineItems(snapshot.id, householdId)
  ]);
  res.json({ ...snapshot, matchedDeposits, lineItems });
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

payslipRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const params = idParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid payslip id", issues: params.error.flatten() });
    return;
  }
  const { householdId, role, personProfileId } = req.authUser!;
  // Members may only delete payslips assigned to their own person profile.
  const ownerRestriction = role === "member" ? personProfileId : null;
  const result = await deletePayslipSnapshotForHousehold(householdId, params.data.id, ownerRestriction);
  if (result === "not_found") {
    res.status(404).json({ message: "Payslip not found", code: "NOT_FOUND" });
    return;
  }
  if (result === "forbidden") {
    res.status(403).json({ message: "Not allowed to delete this payslip", code: "FORBIDDEN" });
    return;
  }
  res.status(204).send();
});
