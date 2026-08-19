import { randomUUID } from "node:crypto";

import { qAll, qBegin, qExec, qGet, sqlBind } from "../../db/query.js";
import { log } from "../../logger.js";
import { parseEsppCsv, parseEsppPdf } from "./espp-parse.service.js";
import type {
  EsppBatchRow,
  EsppBatchWithSales,
  EsppOfferingPeriod,
  EsppSaleRow,
  EsppYearSummary,
  SaleInput,
} from "./espp.types.js";

// ─── Offering period / disposition classification ─────────────────────────────

// IBM ESPP offering periods are semiannual, starting Jan 1 and Jul 1 (IBM 2014 ESPP
// Prospectus, "Offering Period"). The offering start date is the option-grant date
// for tax purposes even though this plan has no lookback in the purchase-price formula.
export function computeOfferingDate(purchaseDate: string): string {
  const [yearStr, monthStr] = purchaseDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 7 ? `${year}-07-01` : `${year}-01-01`;
}

// Qualifying disposition requires holding 2+ years from the offering (grant) date
// AND 1+ year from the purchase date (IRC §423(c); confirmed against IBM's prospectus
// and Computershare's 2025 Tax Form Reference Guide).
export function isQualifyingDisposition(offeringDate: string, purchaseDate: string, saleDate: string): boolean {
  const sale = new Date(`${saleDate}T00:00:00Z`);

  const twoYearsFromOffering = new Date(`${offeringDate}T00:00:00Z`);
  twoYearsFromOffering.setUTCFullYear(twoYearsFromOffering.getUTCFullYear() + 2);

  const oneYearFromPurchase = new Date(`${purchaseDate}T00:00:00Z`);
  oneYearFromPurchase.setUTCFullYear(oneYearFromPurchase.getUTCFullYear() + 1);

  return sale >= twoYearsFromOffering && sale >= oneYearFromPurchase;
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

function mapBatch(r: Record<string, unknown>): EsppBatchRow {
  return {
    id:                   r.id as string,
    householdId:          r.household_id as string,
    purchaseDate:         r.purchase_date as string,
    offeringDate:         r.offering_date as string,
    sharesGranted:        parseFloat(String(r.shares_granted)),
    fmvPerShare:          r.fmv_per_share != null ? parseFloat(String(r.fmv_per_share)) : null,
    costBasisPerShare:    parseFloat(String(r.cost_basis_per_share)),
    discountPerShare:     r.discount_per_share != null ? parseFloat(String(r.discount_per_share)) : null,
    sharesTransferred:    parseFloat(String(r.shares_transferred)),
    payslipId:            (r.payslip_id as string) ?? null,
    esppDiscountPayslip:  r.espp_discount_payslip != null ? parseFloat(String(r.espp_discount_payslip)) : null,
    esppSalaryDeduction:  r.espp_salary_deduction != null ? parseFloat(String(r.espp_salary_deduction)) : null,
    esppOtherDeduction:   r.espp_other_deduction  != null ? parseFloat(String(r.espp_other_deduction))  : null,
    createdAt:            String(r.created_at),
    updatedAt:            String(r.updated_at),
  };
}

function mapSale(r: Record<string, unknown>): EsppSaleRow {
  return {
    id:                  r.id as string,
    batchId:             r.batch_id as string,
    householdId:         r.household_id as string,
    saleDate:            r.sale_date as string,
    sharesSold:          parseFloat(String(r.shares_sold)),
    salePricePerShare:   parseFloat(String(r.sale_price_per_share)),
    proceeds:            parseFloat(String(r.proceeds)),
    dispositionType:     (r.disposition_type as 'qualifying' | 'disqualifying' | null) ?? null,
    ordinaryIncome:      r.ordinary_income != null ? parseFloat(String(r.ordinary_income)) : null,
    capGainLoss:         r.cap_gain_loss  != null ? parseFloat(String(r.cap_gain_loss))  : null,
    createdAt:           String(r.created_at),
  };
}

function mapOfferingPeriod(r: Record<string, unknown>): EsppOfferingPeriod {
  return {
    id:            r.id as string,
    householdId:   r.household_id as string,
    offeringDate:  r.offering_date as string,
    fmvPerShare:   r.fmv_per_share != null ? parseFloat(String(r.fmv_per_share)) : null,
    createdAt:     String(r.created_at),
    updatedAt:     String(r.updated_at),
  };
}

// ─── Payslip linkage ─────────────────────────────────────────────────────────

type PayslipLink = {
  id: string;
  discount: number;
  salary: number;
  other: number;
} | null;

async function findPayslipLink(householdId: string, purchaseDate: string): Promise<PayslipLink> {
  // Aggregate across ALL payslips on this date — some months have two payslips (salary +
  // commissions), each carrying an ESPP deduction line. GROUP BY ps.id + LIMIT 1 would
  // silently discard the second payslip's contribution.
  const row = await qGet<Record<string, unknown>>(
    `SELECT MIN(ps.id) AS id,
            COALESCE(SUM(CASE WHEN pli.name ILIKE '%Discount%' THEN pli.amount_current ELSE 0 END), 0) AS discount,
            COALESCE(SUM(CASE WHEN pli.name ILIKE '%Salary%'   THEN pli.amount_current ELSE 0 END), 0) AS salary,
            COALESCE(SUM(CASE WHEN pli.name ILIKE '%Other%'    THEN pli.amount_current ELSE 0 END), 0) AS other
     FROM payslip_snapshot ps
     JOIN payslip_line_item pli ON pli.payslip_snapshot_id = ps.id
     WHERE ps.household_id = ?
       AND pli.name ILIKE '%ESPP%'
       AND (ps.pay_date = ? OR ps.pay_period_end = ?)`,
    householdId, purchaseDate, purchaseDate
  );
  if (!row || row.id == null) return null;
  return {
    id:       row.id as string,
    discount: parseFloat(String(row.discount)),
    salary:   parseFloat(String(row.salary)),
    other:    parseFloat(String(row.other)),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listBatchesWithSales(
  householdId: string,
  year: number
): Promise<EsppBatchWithSales[]> {
  const batches = await qAll<Record<string, unknown>>(
    `SELECT b.*,
            COALESCE(SUM(s.shares_sold), 0) AS total_sold
     FROM espp_batch b
     LEFT JOIN espp_sale s ON s.batch_id = b.id
     WHERE b.household_id = ?
       AND EXTRACT(YEAR FROM b.purchase_date::date) = ?
     GROUP BY b.id
     ORDER BY b.purchase_date DESC`,
    householdId, year
  );

  if (batches.length === 0) return [];

  const sales = await qAll<Record<string, unknown>>(
    `SELECT s.* FROM espp_sale s
     JOIN espp_batch b ON b.id = s.batch_id
     WHERE b.household_id = ?
       AND EXTRACT(YEAR FROM b.purchase_date::date) = ?
     ORDER BY s.sale_date DESC`,
    householdId, year
  );

  return batches.map(b => {
    const batchSales = sales.filter(s => s.batch_id === b.id);
    const totalSold  = parseFloat(String(b.total_sold)) || 0;
    const transferred = parseFloat(String(b.shares_transferred));
    const held        = Math.max(0, transferred - totalSold);
    const status: EsppBatchWithSales['status'] =
      totalSold === 0 ? 'Unsold' :
      held < 0.00005 ? 'Fully Sold' :
      'Partially Sold';

    return {
      ...mapBatch(b),
      sharesSold: totalSold,
      held,
      status,
      sales: batchSales.map(mapSale),
    };
  });
}

export async function getYearSummary(
  householdId: string,
  year: number
): Promise<EsppYearSummary> {
  const bRow = await qGet<Record<string, unknown>>(
    `SELECT
       COALESCE(SUM(shares_granted),                              0) AS shares_purchased,
       COALESCE(SUM(shares_transferred),                          0) AS shares_transferred,
       COALESCE(SUM(cost_basis_per_share * shares_granted),       0) AS total_invested,
       COALESCE(SUM(CASE
         WHEN espp_discount_payslip IS NOT NULL THEN espp_discount_payslip
         ELSE COALESCE(discount_per_share * shares_transferred, 0)
       END), 0) AS discount_received
     FROM espp_batch
     WHERE household_id = ?
       AND EXTRACT(YEAR FROM purchase_date::date) = ?`,
    householdId, year
  );

  const sRow = await qGet<Record<string, unknown>>(
    `SELECT
       COALESCE(SUM(s.shares_sold),       0) AS shares_sold,
       COALESCE(SUM(s.proceeds),          0) AS sale_proceeds,
       COALESCE(SUM(s.ordinary_income),   0) AS ordinary_income,
       COALESCE(SUM(s.cap_gain_loss),     0) AS cap_gain_loss,
       COALESCE(SUM(CASE WHEN s.disposition_type = 'qualifying' AND s.ordinary_income IS NULL THEN 1 ELSE 0 END), 0) AS pending_count
     FROM espp_sale s
     JOIN espp_batch b ON b.id = s.batch_id
     WHERE b.household_id = ?
       AND EXTRACT(YEAR FROM b.purchase_date::date) = ?`,
    householdId, year
  );

  const sharesSold    = parseFloat(String(sRow?.shares_sold))    || 0;
  const saleProceeds  = parseFloat(String(sRow?.sale_proceeds))  || 0;
  const ordinaryInc   = parseFloat(String(sRow?.ordinary_income)) || 0;
  const capGain       = parseFloat(String(sRow?.cap_gain_loss))   || 0;
  const totalInvested = parseFloat(String(bRow?.total_invested))  || 0;
  const pendingCount  = parseInt(String(sRow?.pending_count), 10)  || 0;

  // Realized G/L = OI + cap gain (or equivalently: proceeds − cost_basis × shares_sold)
  const realizedGainLoss = ordinaryInc + capGain;

  return {
    year,
    sharesPurchased:    parseFloat(String(bRow?.shares_purchased))   || 0,
    sharesTransferred:  parseFloat(String(bRow?.shares_transferred))  || 0,
    sharesSold,
    totalInvested,
    discountReceivedYtd: parseFloat(String(bRow?.discount_received)) || 0,
    saleProceeds,
    realizedGainLoss,
    ordinaryIncomeYtd:  ordinaryInc,
    capGainLossYtd:     capGain,
    pendingOfferingFmvCount: pendingCount,
  };
}

export async function importBatch(
  householdId: string,
  pdfBuffer: Buffer | null,
  csvBuffer: Buffer | null
): Promise<{ ok: true; data: EsppBatchRow[] } | { ok: false; code: string; message: string }> {
  if (!pdfBuffer && !csvBuffer) {
    return { ok: false, code: 'NO_FILE', message: 'At least one file (PDF or CSV) is required.' };
  }

  let pdfData: Awaited<ReturnType<typeof parseEsppPdf>> | null = null;
  if (pdfBuffer) {
    try {
      pdfData = await parseEsppPdf(pdfBuffer);
    } catch (err) {
      log.warn({ err }, 'espp: PDF parse error');
      return { ok: false, code: 'PDF_PARSE_ERROR', message: 'Could not extract data from PDF.' };
    }
  }

  const csvRows = csvBuffer ? parseEsppCsv(csvBuffer) : [];

  // Build the set of batches to upsert:
  // • CSV rows define all purchase dates (the full year roster).
  // • PDF enriches the one batch whose date matches the PDF.
  // • If PDF-only (no CSV), create a single batch from PDF data.
  type BatchSpec = {
    purchaseDate: string;
    offeringDate: string;
    sharesGranted: number;
    sharesTransferred: number;
    costBasisPerShare: number;
    fmvPerShare: number | null;
    discountPerShare: number | null;
    // true = CSV delta (accumulate on conflict); false = PDF-only (preserve existing on conflict)
    accumulateTransferred: boolean;
  };

  const specs: BatchSpec[] = [];

  if (csvRows.length > 0) {
    for (const csvRow of csvRows) {
      const isPdfDate = pdfData?.purchaseDate === csvRow.purchaseDate;
      const fmv = isPdfDate ? (pdfData?.fmvPerShare ?? null) : null;
      const cost = isPdfDate && pdfData?.costBasisPerShare != null
        ? pdfData.costBasisPerShare
        : csvRow.costBasisPerShare;
      const granted = isPdfDate && pdfData?.sharesGranted != null
        ? pdfData.sharesGranted
        : csvRow.sharesTransferred;
      // CSV Quantity is the incremental delta for this transfer event — never use PDF Distributed
      const transferred = csvRow.sharesTransferred;
      specs.push({
        purchaseDate:     csvRow.purchaseDate,
        offeringDate:     computeOfferingDate(csvRow.purchaseDate),
        sharesGranted:    granted,
        sharesTransferred: transferred,
        costBasisPerShare: cost,
        fmvPerShare:       fmv,
        discountPerShare:  fmv != null ? fmv - cost : null,
        accumulateTransferred: true,
      });
    }

    // If PDF has a date that doesn't appear in the CSV, add a PDF-only batch
    if (pdfData?.purchaseDate && !csvRows.some(r => r.purchaseDate === pdfData!.purchaseDate)) {
      const cost = pdfData.costBasisPerShare;
      if (cost != null) {
        const fmv = pdfData.fmvPerShare ?? null;
        const granted = pdfData.sharesGranted ?? pdfData.sharesTransferred ?? 0;
        specs.push({
          purchaseDate:     pdfData.purchaseDate,
          offeringDate:     computeOfferingDate(pdfData.purchaseDate),
          sharesGranted:    granted,
          sharesTransferred: pdfData.sharesTransferred ?? granted,
          costBasisPerShare: cost,
          fmvPerShare:       fmv,
          discountPerShare:  fmv != null ? fmv - cost : null,
          accumulateTransferred: false,
        });
      }
    }
  } else if (pdfData) {
    // PDF-only import
    if (!pdfData.purchaseDate) {
      return { ok: false, code: 'NO_DATE', message: 'Could not determine purchase date from uploaded files.' };
    }
    if (!pdfData.costBasisPerShare) {
      return { ok: false, code: 'NO_COST_BASIS', message: 'Could not determine cost basis. Please include the PDF.' };
    }
    const fmv = pdfData.fmvPerShare ?? null;
    const cost = pdfData.costBasisPerShare;
    const granted = pdfData.sharesGranted ?? pdfData.sharesTransferred ?? 0;
    specs.push({
      purchaseDate:      pdfData.purchaseDate,
      offeringDate:      computeOfferingDate(pdfData.purchaseDate),
      sharesGranted:     granted,
      sharesTransferred: pdfData.sharesTransferred ?? granted,
      costBasisPerShare: cost,
      fmvPerShare:       fmv,
      discountPerShare:  fmv != null ? fmv - cost : null,
      accumulateTransferred: false,
    });
  }

  if (specs.length === 0) {
    return { ok: false, code: 'NO_DATE', message: 'Could not determine purchase date from uploaded files.' };
  }

  const now = new Date().toISOString();

  for (const spec of specs) {
    const link = await findPayslipLink(householdId, spec.purchaseDate);
    const id   = randomUUID();

    if (spec.accumulateTransferred) {
      // CSV import: accumulate shares_transferred (each CSV is a transfer event delta).
      // Cap at shares_granted to prevent double-import inflation on already-complete batches.
      // shares_granted keeps the larger of PDF-sourced vs CSV fallback values.
      await qExec(
        `INSERT INTO espp_batch (
           id, household_id, purchase_date, offering_date,
           shares_granted, fmv_per_share, cost_basis_per_share, discount_per_share,
           shares_transferred, payslip_id,
           espp_discount_payslip, espp_salary_deduction, espp_other_deduction,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (household_id, purchase_date) DO UPDATE SET
           shares_granted         = GREATEST(EXCLUDED.shares_granted, espp_batch.shares_granted),
           fmv_per_share          = COALESCE(EXCLUDED.fmv_per_share, espp_batch.fmv_per_share),
           cost_basis_per_share   = EXCLUDED.cost_basis_per_share,
           discount_per_share     = COALESCE(EXCLUDED.discount_per_share, espp_batch.discount_per_share),
           shares_transferred     = LEAST(
             GREATEST(EXCLUDED.shares_granted, espp_batch.shares_granted),
             espp_batch.shares_transferred + EXCLUDED.shares_transferred
           ),
           payslip_id             = COALESCE(EXCLUDED.payslip_id, espp_batch.payslip_id),
           espp_discount_payslip  = COALESCE(EXCLUDED.espp_discount_payslip, espp_batch.espp_discount_payslip),
           espp_salary_deduction  = COALESCE(EXCLUDED.espp_salary_deduction, espp_batch.espp_salary_deduction),
           espp_other_deduction   = COALESCE(EXCLUDED.espp_other_deduction,  espp_batch.espp_other_deduction),
           updated_at             = ?`,
        id, householdId, spec.purchaseDate, spec.offeringDate,
        spec.sharesGranted, spec.fmvPerShare, spec.costBasisPerShare, spec.discountPerShare,
        spec.sharesTransferred, link?.id ?? null,
        link?.discount ?? null, link?.salary ?? null, link?.other ?? null,
        now, now,
        now
      );
    } else {
      // PDF-only import: preserve existing shares_transferred (PDF "Distributed" is a running
      // total that includes historical events from other batches — don't accumulate it).
      await qExec(
        `INSERT INTO espp_batch (
           id, household_id, purchase_date, offering_date,
           shares_granted, fmv_per_share, cost_basis_per_share, discount_per_share,
           shares_transferred, payslip_id,
           espp_discount_payslip, espp_salary_deduction, espp_other_deduction,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (household_id, purchase_date) DO UPDATE SET
           shares_granted         = GREATEST(EXCLUDED.shares_granted, espp_batch.shares_granted),
           fmv_per_share          = COALESCE(EXCLUDED.fmv_per_share, espp_batch.fmv_per_share),
           cost_basis_per_share   = EXCLUDED.cost_basis_per_share,
           discount_per_share     = COALESCE(EXCLUDED.discount_per_share, espp_batch.discount_per_share),
           shares_transferred     = COALESCE(espp_batch.shares_transferred, EXCLUDED.shares_transferred),
           payslip_id             = COALESCE(EXCLUDED.payslip_id, espp_batch.payslip_id),
           espp_discount_payslip  = COALESCE(EXCLUDED.espp_discount_payslip, espp_batch.espp_discount_payslip),
           espp_salary_deduction  = COALESCE(EXCLUDED.espp_salary_deduction, espp_batch.espp_salary_deduction),
           espp_other_deduction   = COALESCE(EXCLUDED.espp_other_deduction,  espp_batch.espp_other_deduction),
           updated_at             = ?`,
        id, householdId, spec.purchaseDate, spec.offeringDate,
        spec.sharesGranted, spec.fmvPerShare, spec.costBasisPerShare, spec.discountPerShare,
        spec.sharesTransferred, link?.id ?? null,
        link?.discount ?? null, link?.salary ?? null, link?.other ?? null,
        now, now,
        now
      );
    }
    log.info({ purchaseDate: spec.purchaseDate, fmv: spec.fmvPerShare, accumulateTransferred: spec.accumulateTransferred, householdId }, 'espp:import batch upserted');
  }

  const offeringDates = Array.from(new Set(specs.map(s => s.offeringDate)));
  for (const offeringDate of offeringDates) {
    await qExec(
      `INSERT INTO espp_offering_period (id, household_id, offering_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (household_id, offering_date) DO NOTHING`,
      randomUUID(), householdId, offeringDate, now, now
    );
  }

  const dates = specs.map(s => s.purchaseDate);
  const placeholders = dates.map(() => '?').join(', ');
  const rows = await qAll<Record<string, unknown>>(
    `SELECT * FROM espp_batch WHERE household_id = ? AND purchase_date IN (${placeholders}) ORDER BY purchase_date DESC`,
    householdId, ...dates
  );

  return { ok: true, data: rows.map(mapBatch) };
}

type SaleTaxResult = {
  dispositionType: 'qualifying' | 'disqualifying';
  ordinaryIncome: number | null;
  capGainLoss: number | null;
};

// Disqualifying: ordinary income = (purchase-date FMV − purchase price) × shares (IBM 2014 ESPP
// Prospectus, "Tax" §1). Qualifying: ordinary income = lesser of actual gain (floored at 0) or
// (discount% × offering-date FMV) × shares (Computershare 2025 Tax Form Reference Guide, "ESPP —
// Qualified"); requires offering_fmv from Form 3922 Box 3, entered via the Offering Periods UI.
function computeSaleTax(
  batch: { offeringDate: string; purchaseDate: string; fmvPerShare: number; costBasisPerShare: number; discountPerShare: number },
  offeringFmv: number | null,
  saleDate: string,
  sharesSold: number,
  salePricePerShare: number
): SaleTaxResult {
  const qualifying = isQualifyingDisposition(batch.offeringDate, batch.purchaseDate, saleDate);

  if (!qualifying) {
    const ordinaryIncome = parseFloat((batch.discountPerShare * sharesSold).toFixed(2));
    const capGainLoss    = parseFloat(((salePricePerShare - batch.fmvPerShare) * sharesSold).toFixed(2));
    return { dispositionType: 'disqualifying', ordinaryIncome, capGainLoss };
  }

  if (offeringFmv == null) {
    return { dispositionType: 'qualifying', ordinaryIncome: null, capGainLoss: null };
  }

  const totalRealizedGain = (salePricePerShare - batch.costBasisPerShare) * sharesSold;
  const actualGainFloored = Math.max(0, totalRealizedGain);
  const discountPct       = batch.discountPerShare / batch.fmvPerShare;
  const cap                = discountPct * offeringFmv * sharesSold;
  const ordinaryIncome     = parseFloat(Math.min(actualGainFloored, cap).toFixed(2));
  const capGainLoss        = parseFloat((totalRealizedGain - ordinaryIncome).toFixed(2));

  return { dispositionType: 'qualifying', ordinaryIncome, capGainLoss };
}

export async function recordSales(
  householdId: string,
  saleDate: string,
  rows: SaleInput[]
): Promise<{ ok: true; data: EsppSaleRow[] } | { ok: false; code: string; message: string }> {
  // Validate: each batch must belong to this household and have enough held shares
  for (const row of rows) {
    const batch = await qGet<Record<string, unknown>>(
      `SELECT b.*, COALESCE(SUM(s.shares_sold), 0) AS total_sold
       FROM espp_batch b
       LEFT JOIN espp_sale s ON s.batch_id = b.id
       WHERE b.id = ? AND b.household_id = ?
       GROUP BY b.id`,
      row.batchId, householdId
    );

    if (!batch) {
      return { ok: false, code: 'BATCH_NOT_FOUND', message: `Batch ${row.batchId} not found.` };
    }

    const transferred = parseFloat(String(batch.shares_transferred));
    const alreadySold = parseFloat(String(batch.total_sold));
    const held        = transferred - alreadySold;

    if (row.sharesSold > held + 0.000001) {
      return {
        ok: false,
        code: 'OVERSOLD',
        message: `Batch ${batch.purchase_date}: only ${held.toFixed(6)} shares available, cannot sell ${row.sharesSold}.`,
      };
    }

    if (batch.fmv_per_share == null || batch.discount_per_share == null) {
      return {
        ok: false,
        code: 'INCOMPLETE_BATCH',
        message: `Batch ${batch.purchase_date} is missing FMV data. Re-import with PDF to record sales.`,
      };
    }
  }

  const inserted: EsppSaleRow[] = [];

  await qBegin(async (tx) => {
    for (const row of rows) {
      const batchRaw = await qGet<Record<string, unknown>>(
        `SELECT * FROM espp_batch WHERE id = ?`, row.batchId
      );
      const offeringPeriod = await qGet<Record<string, unknown>>(
        `SELECT fmv_per_share FROM espp_offering_period WHERE household_id = ? AND offering_date = ?`,
        householdId, batchRaw!.offering_date as string
      );

      const batch = {
        offeringDate:      batchRaw!.offering_date as string,
        purchaseDate:      batchRaw!.purchase_date as string,
        fmvPerShare:       parseFloat(String(batchRaw!.fmv_per_share)),
        costBasisPerShare: parseFloat(String(batchRaw!.cost_basis_per_share)),
        discountPerShare:  parseFloat(String(batchRaw!.discount_per_share)),
      };
      const offeringFmv = offeringPeriod?.fmv_per_share != null ? parseFloat(String(offeringPeriod.fmv_per_share)) : null;

      const proceeds = parseFloat((row.sharesSold * row.salePricePerShare).toFixed(2));
      const tax = computeSaleTax(batch, offeringFmv, saleDate, row.sharesSold, row.salePricePerShare);

      const id  = randomUUID();
      const now = new Date().toISOString();

      const { text, values } = sqlBind(
        `INSERT INTO espp_sale
           (id, batch_id, household_id, sale_date, shares_sold, sale_price_per_share,
            proceeds, disposition_type, ordinary_income, cap_gain_loss, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, row.batchId, householdId, saleDate,
         row.sharesSold, row.salePricePerShare,
         proceeds, tax.dispositionType, tax.ordinaryIncome, tax.capGainLoss, now]
      );
      await tx.unsafe(text, values as never[]);

      inserted.push({
        id, batchId: row.batchId, householdId, saleDate,
        sharesSold: row.sharesSold, salePricePerShare: row.salePricePerShare,
        proceeds, dispositionType: tax.dispositionType,
        ordinaryIncome: tax.ordinaryIncome, capGainLoss: tax.capGainLoss, createdAt: now,
      });
    }
  });

  return { ok: true, data: inserted };
}

export async function listOfferingPeriods(householdId: string): Promise<EsppOfferingPeriod[]> {
  const rows = await qAll<Record<string, unknown>>(
    `SELECT * FROM espp_offering_period WHERE household_id = ? ORDER BY offering_date DESC`,
    householdId
  );
  return rows.map(mapOfferingPeriod);
}

export async function upsertOfferingPeriodFmv(
  householdId: string,
  offeringDate: string,
  fmvPerShare: number
): Promise<{ ok: true; data: EsppOfferingPeriod } | { ok: false; code: string; message: string }> {
  const now = new Date().toISOString();
  const existing = await qGet<Record<string, unknown>>(
    `SELECT id FROM espp_offering_period WHERE household_id = ? AND offering_date = ?`,
    householdId, offeringDate
  );

  if (existing) {
    await qExec(
      `UPDATE espp_offering_period SET fmv_per_share = ?, updated_at = ? WHERE id = ?`,
      fmvPerShare, now, existing.id as string
    );
  } else {
    await qExec(
      `INSERT INTO espp_offering_period (id, household_id, offering_date, fmv_per_share, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(), householdId, offeringDate, fmvPerShare, now, now
    );
  }

  // Recompute any qualifying-disposition sales for batches in this offering period that
  // were left pending (ordinary_income/cap_gain_loss null) because the FMV wasn't known yet.
  const pendingSales = await qAll<Record<string, unknown>>(
    `SELECT s.*, b.offering_date, b.purchase_date, b.fmv_per_share AS batch_fmv,
            b.cost_basis_per_share, b.discount_per_share
     FROM espp_sale s
     JOIN espp_batch b ON b.id = s.batch_id
     WHERE b.household_id = ? AND b.offering_date = ? AND s.disposition_type = 'qualifying' AND s.ordinary_income IS NULL`,
    householdId, offeringDate
  );

  for (const s of pendingSales) {
    const batch = {
      offeringDate:      s.offering_date as string,
      purchaseDate:      s.purchase_date as string,
      fmvPerShare:       parseFloat(String(s.batch_fmv)),
      costBasisPerShare: parseFloat(String(s.cost_basis_per_share)),
      discountPerShare:  parseFloat(String(s.discount_per_share)),
    };
    const tax = computeSaleTax(
      batch, fmvPerShare, s.sale_date as string,
      parseFloat(String(s.shares_sold)), parseFloat(String(s.sale_price_per_share))
    );
    await qExec(
      `UPDATE espp_sale SET ordinary_income = ?, cap_gain_loss = ? WHERE id = ?`,
      tax.ordinaryIncome, tax.capGainLoss, s.id as string
    );
  }

  const saved = await qGet<Record<string, unknown>>(
    `SELECT * FROM espp_offering_period WHERE household_id = ? AND offering_date = ?`,
    householdId, offeringDate
  );
  return { ok: true, data: mapOfferingPeriod(saved!) };
}

export async function deleteSale(
  householdId: string,
  saleId: string
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const existing = await qGet<Record<string, unknown>>(
    `SELECT id FROM espp_sale WHERE id = ? AND household_id = ?`,
    saleId, householdId
  );
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Sale record not found.' };
  }
  await qExec(`DELETE FROM espp_sale WHERE id = ?`, saleId);
  return { ok: true };
}
