import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createImportSession,
  listFilesForSession,
  listSessionDetail,
  persistSessionFiles,
  transitionSessionStatus,
  type ServiceFailure
} from "./import-session.service.js";
import {
  ensurePayslipImportPlaceholderAccount,
  listHouseholdFinancialAccounts,
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
  employerId: z.union([z.string().uuid(), z.null()]).optional()
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

export const importsRouter = Router();
importsRouter.use(requireAuth);

importsRouter.post("/sessions", (req: AuthenticatedRequest, res) => {
  const parsed = createSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const created = createImportSession(householdId, parsed.data.sourceType);

  res.status(201).json({
    session: {
      id: created.id,
      householdId,
      sourceType: parsed.data.sourceType,
      status: created.status
    }
  });
});

importsRouter.post(
  "/sessions/:sessionId/files",
  upload.array("files"),
  (req: AuthenticatedRequest, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ message: "No files provided" });
      return;
    }

    const result = persistSessionFiles(req.params.sessionId, req.authUser!.householdId, files);
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

importsRouter.patch("/sessions/:sessionId/status", (req: AuthenticatedRequest, res) => {
  const parsed = sessionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const result = transitionSessionStatus(
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

importsRouter.get("/accounts", (req: AuthenticatedRequest, res) => {
  const { householdId, userId } = req.authUser!;
  ensurePayslipImportPlaceholderAccount(householdId, userId);
  const accounts = listHouseholdFinancialAccounts(householdId);
  res.status(200).json({ accounts });
});

importsRouter.get("/parser-profiles", (_req, res) => {
  res.status(200).json({ profiles: PARSER_PROFILE_IDS });
});

importsRouter.patch(
  "/sessions/:sessionId/files/:fileId",
  (req: AuthenticatedRequest, res) => {
    const parsed = fileBindingSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      return;
    }

    const result = updateImportFileBinding(
      req.params.sessionId,
      req.params.fileId,
      req.authUser!.householdId,
      req.authUser!.userId,
      {
        financialAccountId: parsed.data.financialAccountId,
        parserProfileId: parsed.data.parserProfileId,
        employerId: parsed.data.employerId
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

importsRouter.get("/sessions/:sessionId/summary", (req: AuthenticatedRequest, res) => {
  const summary = getImportSessionSummary(req.params.sessionId, req.authUser!.householdId);
  if (!summary) {
    res.status(404).json({ message: "Import session not found" });
    return;
  }
  res.status(200).json(summary);
});

importsRouter.get("/sessions/:sessionId", (req: AuthenticatedRequest, res) => {
  const session = listSessionDetail(req.params.sessionId, req.authUser!.householdId);
  if (!session) {
    res.status(404).json({ message: "Import session not found" });
    return;
  }

  const files = listFilesForSession(session.id);

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
      code: result.code
    });
    return;
  }

  res.status(200).json(result.data);
});

importsRouter.post("/sessions/:sessionId/canonicalize", (req: AuthenticatedRequest, res) => {
  const result = canonicalizeImportSession(req.params.sessionId, req.authUser!.householdId);
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

importsRouter.post("/sessions/:sessionId/undo-import", (req: AuthenticatedRequest, res) => {
  const result = rollbackImportSessionLedger(req.params.sessionId, req.authUser!.householdId);
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
