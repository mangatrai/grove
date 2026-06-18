import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { log } from "../../logger.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { getStockQuote } from "./espp-stock.service.js";
import {
  deleteSale,
  getYearSummary,
  importBatch,
  listBatchesWithSales,
  recordSales,
} from "./espp.service.js";

export const esppRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
});

const yearSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2099),
});

const salesBodySchema = z.object({
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z.array(z.object({
    batchId:           z.string().uuid(),
    sharesSold:        z.number().positive(),
    salePricePerShare: z.number().positive(),
  })).min(1),
});

esppRouter.use(requireAuth);
esppRouter.use(requireRole(['owner', 'admin', 'member']));

/** GET /espp/stock-quote — last IBM close price (1-hour in-memory cache) */
esppRouter.get('/stock-quote', async (_req, res) => {
  const quote = await getStockQuote();
  if (!quote) {
    res.status(503).json({ message: 'Stock quote unavailable' });
    return;
  }
  res.json(quote);
});

/** GET /espp/batches?year=YYYY */
esppRouter.get('/batches', async (req: AuthenticatedRequest, res) => {
  const parsed = yearSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: 'year query param required (integer)', errors: parsed.error.issues });
    return;
  }
  const { householdId } = req.authUser!;
  const batches = await listBatchesWithSales(householdId, parsed.data.year);
  res.json({ batches });
});

/** GET /espp/summary?year=YYYY */
esppRouter.get('/summary', async (req: AuthenticatedRequest, res) => {
  const parsed = yearSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: 'year query param required (integer)', errors: parsed.error.issues });
    return;
  }
  const { householdId } = req.authUser!;
  const summary = await getYearSummary(householdId, parsed.data.year);
  res.json(summary);
});

/** POST /espp/import — multipart, fields: pdf (optional), csv (optional), at least one required */
esppRouter.post(
  '/import',
  upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'csv', maxCount: 1 }]),
  async (req: AuthenticatedRequest, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const pdfBuffer = files?.['pdf']?.[0]?.buffer ?? null;
    const csvBuffer = files?.['csv']?.[0]?.buffer ?? null;

    log.debug({
      hasPdf: pdfBuffer != null,
      pdfBytes: pdfBuffer?.length ?? 0,
      hasCsv: csvBuffer != null,
      csvBytes: csvBuffer?.length ?? 0,
    }, 'espp:import received files');

    if (!pdfBuffer && !csvBuffer) {
      log.warn('espp:import rejected — no files in request (multer found nothing)');
      res.status(400).json({ message: 'At least one file (pdf or csv) is required.' });
      return;
    }

    const { householdId } = req.authUser!;
    const result = await importBatch(householdId, pdfBuffer, csvBuffer);

    if (!result.ok) {
      log.warn({ code: result.code, message: result.message, householdId }, 'espp:import failed');
      const status = result.code === 'NO_FILE' ? 400 : 422;
      res.status(status).json({ message: result.message, code: result.code });
      return;
    }

    log.info({ count: result.data.length, dates: result.data.map(b => b.purchaseDate), householdId }, 'espp:import batches upserted');
    res.status(201).json({ batches: result.data });
  }
);

/** POST /espp/sales */
esppRouter.post('/sales', async (req: AuthenticatedRequest, res) => {
  const parsed = salesBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.issues });
    return;
  }
  const { householdId } = req.authUser!;
  const result = await recordSales(householdId, parsed.data.saleDate, parsed.data.rows);
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' || result.code === 'BATCH_NOT_FOUND' ? 404 : 422;
    res.status(status).json({ message: result.message, code: result.code });
    return;
  }
  res.status(201).json({ sales: result.data });
});

/** DELETE /espp/sales/:saleId */
esppRouter.delete('/sales/:saleId', async (req: AuthenticatedRequest, res) => {
  const { householdId } = req.authUser!;
  const result = await deleteSale(householdId, req.params.saleId!);
  if (!result.ok) {
    res.status(404).json({ message: result.message, code: result.code });
    return;
  }
  res.status(204).send();
});
