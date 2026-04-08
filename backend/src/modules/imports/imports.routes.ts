import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { qGet } from "../../db/query.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import {
  createImportSession,
  listFilesForSession,
  listImportSessionsForHousehold,
  listSessionDetail,
  persistSessionFiles,
  transitionSessionStatus,
  type ServiceFailure
} from "./import-session.service.js";
import {
  createHouseholdFinancialAccount,
  ensurePayslipImportBucketAccount,
  listHouseholdFinancialAccounts,
  updateHouseholdFinancialAccount,
  updateImportFileBinding,
  type BindingFailure
} from "./import-file-binding.service.js";
import { getImportSessionSummary } from "./session-summary.service.js";
import {
  rollbackImportSessionLedger,
  type RollbackImportSessionFailure
} from "./import-session-rollback.service.js";
import { canonicalizeImportSession } from "../canonical/canonical-ingest.service.js";
import { parseSessionImportFiles, type ParseFailure, type ParseColumnMapping } from "./import-parser.service.js";
import { reconcilePayslipAsyncImportSession } from "./payslip-async-import-reconcile.service.js";
import { createHouseholdCustomInstitution, listHouseholdCustomInstitutions } from "./household-institutions.service.js";
import { listUsInstitutionLabels } from "./institution-catalog.js";
import { deleteImportSessionFile, type DeleteImportFileFailure } from "./import-file-delete.service.js";
import { isParserProfileId, PARSER_PROFILE_IDS } from "./profiles/profile-ids.js";

const upload = multer({ storage: multer.memoryStorage() });

const createSessionSchema = z.object({
  sourceType: z.enum(["upload", "watch_folder"]).default("upload")
});

const sessionStatusSchema = z.object({
  status: z.enum(["created", "processing", "review", "finalized", "failed"])
});

/** Mapping validated again in `parseSessionImportFiles` for `generic_tabular` (allows INVALID_MAPPING from service). */
const parseSchema = z.object({
  mapping: z
    .object({
      date: z.string().optional(),
      amount: z.string().optional(),
      description: z.string().optional(),
      postingDate: z.string().optional(),
      referenceId: z.string().optional()
    })
    .optional(),
  sheetName: z.string().optional()
});

const fileBindingSchema = z.object({
  financialAccountId: z.string().min(1),
  parserProfileId: z.string().min(1).refine(isParserProfileId, "Unknown parser profile id"),
  employerId: z.union([z.string().uuid(), z.null()]).optional(),
  ownerScope: z.enum(["household", "person"]).optional(),
  ownerPersonProfileId: z.union([z.string().uuid(), z.null()]).optional()
});

const accountUpsertSchema = z.object({
  type: z.enum(["checking", "savings", "credit_card", "loan", "mortgage", "investment", "payslip"]),
  institution: z.string().min(1).max(120),
  accountMask: z.union([z.string().max(20), z.null()]).optional(),
  ownerScope: z.enum(["household", "person"]).optional().default("household"),
  ownerPersonProfileId: z.union([z.string().uuid(), z.null()]).optional(),
  defaultParserProfileId: z.union([z.string().refine(isParserProfileId, "Unknown parser profile id"), z.null()]).optional()
});

function mapServiceFailureToStatus(failure: ServiceFailure): number {
  switch (failure.code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_TRANSITION":
    case "SESSION_CLOSED_FOR_UPLOAD":
      return 409;
    default:
      return 500;
  }
}

function mapRollbackFailureToStatus(failure: RollbackImportSessionFailure): number {
  switch (failure.code) {
    case "NOT_FOUND":
      return 404;
    case "SESSION_NOT_REVIEW":
      return 409;
    default:
      return 500;
  }
}

function mapParseFailureToStatus(failure: ParseFailure): number {
  switch (failure.code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_MAPPING":
    case "MISSING_FILE_BINDING":
      return 400;
    case "NO_SUPPORTED_FILES":
      return 409;
    default:
      return 500;
  }
}

function mapBindingFailureToStatus(failure: BindingFailure): number {
  switch (failure.code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_ACCOUNT":
    case "INVALID_PROFILE":
    case "INVALID_EMPLOYER":
    case "EMPLOYER_PARSER_MISMATCH":
      return 400;
    default:
      return 500;
  }
}

function mapDeleteImportFileFailureToStatus(failure: DeleteImportFileFailure): number {
  switch (failure.code) {
    case "NOT_FOUND":
      return 404;
    case "SESSION_FINALIZED":
      return 409;
    default:
      return 500;
  }
}

export const importsRouter = Router();
importsRouter.use(requireAuth);

importsRouter.post("/sessions", async (req: AuthenticatedRequest, res) => {
  const parsed = createSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const created = await createImportSession(householdId, parsed.data.sourceType);

  res.status(201).json({
    session: {
      id: created.id,
      householdId,
      sourceType: parsed.data.sourceType,
      status: created.status
    }
  });
});

importsRouter.get("/sessions", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const sessions = await listImportSessionsForHousehold(householdId);
  res.status(200).json({ sessions });
});

importsRouter.post(
  "/sessions/:sessionId/files",
  upload.array("files"),
  async (req: AuthenticatedRequest, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ message: "No files provided" });
      return;
    }

    const result = await persistSessionFiles(req.params.sessionId, req.authUser!.householdId, files);
    if (!result.ok) {
      res.status(mapServiceFailureToStatus(result)).json({
        message: result.message,
        code: result.code,
        ...(result.from !== undefined ? { from: result.from } : {}),
        ...(result.to !== undefined ? { to: result.to } : {})
      });
      return;
    }

    res.status(201).json({ files: result.data.files, skipped: result.data.skipped });
  }
);

importsRouter.patch("/sessions/:sessionId/status", async (req: AuthenticatedRequest, res) => {
  const parsed = sessionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const result = await transitionSessionStatus(
    req.params.sessionId,
    req.authUser!.householdId,
    parsed.data.status
  );

  if (!result.ok) {
    res.status(mapServiceFailureToStatus(result)).json({
      message: result.message,
      code: result.code,
      ...(result.from !== undefined ? { from: result.from } : {}),
      ...(result.to !== undefined ? { to: result.to } : {})
    });
    return;
  }

  res.status(200).json({ sessionId: result.data.sessionId, status: result.data.status });
});

importsRouter.get("/accounts", async (req: AuthenticatedRequest, res) => {
  const { householdId, userId } = req.authUser!;
  await ensurePayslipImportBucketAccount(householdId, userId);
  const accounts = await listHouseholdFinancialAccounts(householdId);
  res.status(200).json({ accounts });
});

importsRouter.post("/accounts", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = accountUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  if (parsed.data.ownerScope === "person" && !parsed.data.ownerPersonProfileId) {
    res.status(400).json({ message: "ownerPersonProfileId is required when ownerScope=person" });
    return;
  }
  if (parsed.data.ownerPersonProfileId) {
    const ok = await qGet<{ ok: number }>(
      `SELECT 1 AS ok FROM person_profile WHERE id = ? AND household_id = ?`,
      parsed.data.ownerPersonProfileId,
      req.authUser!.householdId
    );
    if (!ok) {
      res.status(400).json({ message: "Owner person profile not found for household" });
      return;
    }
  }
  const created = await createHouseholdFinancialAccount({
    householdId: req.authUser!.householdId,
    ownerUserId: req.authUser!.userId,
    type: parsed.data.type,
    institution: parsed.data.institution,
    accountMask: parsed.data.accountMask ?? null,
    ownerScope: parsed.data.ownerScope,
    ownerPersonProfileId: parsed.data.ownerPersonProfileId ?? null,
    defaultParserProfileId: parsed.data.defaultParserProfileId ?? null
  });
  res.status(201).json({ id: created.id });
});

importsRouter.patch("/accounts/:accountId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ accountId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid account id", issues: params.error.issues });
    return;
  }
  const parsed = accountUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  if (parsed.data.ownerScope === "person" && !parsed.data.ownerPersonProfileId) {
    res.status(400).json({ message: "ownerPersonProfileId is required when ownerScope=person" });
    return;
  }
  if (parsed.data.ownerPersonProfileId) {
    const personOk = await qGet<{ ok: number }>(
      `SELECT 1 AS ok FROM person_profile WHERE id = ? AND household_id = ?`,
      parsed.data.ownerPersonProfileId,
      req.authUser!.householdId
    );
    if (!personOk) {
      res.status(400).json({ message: "Owner person profile not found for household" });
      return;
    }
  }
  const ok = await updateHouseholdFinancialAccount({
    accountId: params.data.accountId,
    householdId: req.authUser!.householdId,
    type: parsed.data.type,
    institution: parsed.data.institution,
    accountMask: parsed.data.accountMask ?? null,
    ownerScope: parsed.data.ownerScope,
    ownerPersonProfileId: parsed.data.ownerPersonProfileId ?? null,
    defaultParserProfileId: parsed.data.defaultParserProfileId ?? null
  });
  if (!ok) {
    res.status(404).json({ message: "Financial account not found" });
    return;
  }
  res.status(200).json({ updated: true });
});

importsRouter.get("/parser-profiles", (_req, res) => {
  res.status(200).json({ profiles: PARSER_PROFILE_IDS });
});

importsRouter.get("/institutions", async (req: AuthenticatedRequest, res) => {
  const catalog = listUsInstitutionLabels();
  const custom = await listHouseholdCustomInstitutions(req.authUser!.householdId);
  res.status(200).json({ catalog, custom });
});

const customInstitutionBodySchema = z.object({
  displayName: z.string().min(2).max(120)
});

importsRouter.post("/institutions/custom", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = customInstitutionBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const result = await createHouseholdCustomInstitution(req.authUser!.householdId, parsed.data.displayName);
  if (!result.ok) {
    if (result.code === "DUPLICATE") {
      res.status(409).json({ message: "That institution name is already saved for your household." });
      return;
    }
    res.status(400).json({ message: "Invalid institution name" });
    return;
  }
  res.status(201).json({ id: result.id });
});

importsRouter.patch(
  "/sessions/:sessionId/files/:fileId",
  async (req: AuthenticatedRequest, res) => {
    const parsed = fileBindingSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      return;
    }

    const result = await updateImportFileBinding(
      req.params.sessionId,
      req.params.fileId,
      req.authUser!.householdId,
      req.authUser!.userId,
      {
        financialAccountId: parsed.data.financialAccountId,
        parserProfileId: parsed.data.parserProfileId,
        employerId: parsed.data.employerId,
        ownerScope: parsed.data.ownerScope,
        ownerPersonProfileId: parsed.data.ownerPersonProfileId
      }
    );

    if (!result.ok) {
      res.status(mapBindingFailureToStatus(result)).json({
        message: result.message,
        code: result.code
      });
      return;
    }

    res.status(200).json({ fileId: req.params.fileId, updated: true });
  }
);

importsRouter.delete("/sessions/:sessionId/files/:fileId", async (req: AuthenticatedRequest, res) => {
  const result = await deleteImportSessionFile(
    req.params.sessionId,
    req.params.fileId,
    req.authUser!.householdId
  );
  if (!result.ok) {
    res.status(mapDeleteImportFileFailureToStatus(result)).json({
      message: result.message,
      code: result.code
    });
    return;
  }
  res.status(200).json({ fileId: req.params.fileId, deleted: true });
});

importsRouter.get("/sessions/:sessionId/summary", async (req: AuthenticatedRequest, res) => {
  const summary = await getImportSessionSummary(req.params.sessionId, req.authUser!.householdId);
  if (!summary) {
    res.status(404).json({ message: "Import session not found" });
    return;
  }
  res.status(200).json(summary);
});

importsRouter.get("/sessions/:sessionId", async (req: AuthenticatedRequest, res) => {
  const session = await listSessionDetail(req.params.sessionId, req.authUser!.householdId);
  if (!session) {
    res.status(404).json({ message: "Import session not found" });
    return;
  }

  const files = await listFilesForSession(session.id);

  res.status(200).json({
    session: {
      id: session.id,
      householdId: session.household_id,
      sourceType: session.source_type,
      status: session.status,
      startedAt: session.started_at,
      finalizedAt: session.finalized_at
    },
    files
  });
});

importsRouter.post("/sessions/:sessionId/parse", async (req: AuthenticatedRequest, res) => {
  const parsed = parseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const result = await parseSessionImportFiles(
    req.params.sessionId,
    req.authUser!.householdId,
    req.authUser!.userId,
    {
      mapping: parsed.data.mapping as ParseColumnMapping | undefined,
      sheetName: parsed.data.sheetName
    }
  );

  if (!result.ok) {
    const status = mapParseFailureToStatus(result);
    res.status(status).json({
      message: result.message,
      code: result.code,
      ...(result.skippedFiles && result.skippedFiles.length > 0 ? { skippedFiles: result.skippedFiles } : {})
    });
    return;
  }

  res.status(200).json(result.data);
});

importsRouter.post("/sessions/:sessionId/reconcile-payslip-async", async (req: AuthenticatedRequest, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  try {
    const data = await reconcilePayslipAsyncImportSession(req.params.sessionId, req.authUser!.householdId, {
      force
    });
    res.status(200).json(data);
  } catch (e) {
    if (e instanceof Error && e.message === "Import session not found") {
      res.status(404).json({ message: e.message });
      return;
    }
    throw e;
  }
});

importsRouter.post("/sessions/:sessionId/canonicalize", async (req: AuthenticatedRequest, res) => {
  const result = await canonicalizeImportSession(req.params.sessionId, req.authUser!.householdId);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json({ message: result.message, code: result.code });
      return;
    }
    if (result.code === "NO_RAW_ROWS") {
      res.status(409).json({ message: result.message, code: result.code });
      return;
    }
    res.status(500).json({ message: "Unexpected canonicalize error" });
    return;
  }

  res.status(200).json(result.data);
});

importsRouter.post("/sessions/:sessionId/undo-import", async (req: AuthenticatedRequest, res) => {
  const result = await rollbackImportSessionLedger(req.params.sessionId, req.authUser!.householdId);
  if (!result.ok) {
    res.status(mapRollbackFailureToStatus(result)).json({
      message: result.message,
      code: result.code,
      ...(result.code === "SESSION_NOT_REVIEW" ? { currentStatus: result.currentStatus } : {})
    });
    return;
  }

  res.status(200).json(result.data);
});
