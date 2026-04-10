import crypto from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";

export type BalanceSheetSide = "asset" | "liability";

export type BalanceSheetAccountRow = {
  financialAccountId: string;
  institution: string;
  accountMask: string | null;
  type: string;
  currency: string;
  side: BalanceSheetSide;
  balance: number | null;
  balanceAsOf: string | null;
  balanceSource: "manual" | "import" | null;
  importFileId: string | null;
};

export type BalanceSheetResult = {
  asOf: string;
  assets: BalanceSheetAccountRow[];
  liabilities: BalanceSheetAccountRow[];
  totals: {
    assets: number | null;
    liabilities: number | null;
    netWorth: number | null;
  };
};

export type BalanceSheetHistoryInterval = "month" | "week" | "day";

/** Optional filter: restrict to accounts with matching belongs-to (household vs person). */
export type BalanceSheetQueryOptions = {
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string | null;
};

export type BalanceSheetHistoryAccountSlice = {
  financialAccountId: string;
  side: BalanceSheetSide;
  balance: number | null;
  balanceAsOf: string | null;
};

export type BalanceSheetHistoryPoint = {
  asOf: string;
  totals: {
    assets: number | null;
    liabilities: number | null;
    netWorth: number | null;
  };
  /** Present when `accountIds` was requested on history API (subset of accounts). */
  accounts?: BalanceSheetHistoryAccountSlice[];
};

export type BalanceSheetHistoryResult = {
  from: string;
  to: string;
  interval: BalanceSheetHistoryInterval;
  points: BalanceSheetHistoryPoint[];
};

const MAX_HISTORY_ACCOUNT_IDS = 8;

type ConfidenceSummary = {
  statementBalances?: {
    ending?: number | null;
    asOfEnd?: string | null;
  } | null;
};

function accountSide(type: string): BalanceSheetSide | null {
  if (type === "checking" || type === "savings" || type === "investment") {
    return "asset";
  }
  if (type === "credit_card" || type === "loan" || type === "mortgage") {
    return "liability";
  }
  return null;
}

/** SQL fragment + params for `financial_account` belongs-to filter. */
function financialAccountOwnerFragment(
  options: BalanceSheetQueryOptions | undefined
): { fragment: string; params: unknown[] } {
  if (!options?.ownerScope) {
    return { fragment: "", params: [] };
  }
  if (options.ownerScope === "household") {
    return { fragment: " AND owner_scope = 'household'", params: [] };
  }
  if (options.ownerScope === "person" && options.ownerPersonProfileId) {
    return {
      fragment: " AND owner_scope = 'person' AND owner_person_profile_id = ?",
      params: [options.ownerPersonProfileId]
    };
  }
  return { fragment: "", params: [] };
}

function parseConfidenceSummary(raw: string | null): ConfidenceSummary | null {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  try {
    return JSON.parse(String(raw)) as ConfidenceSummary;
  } catch {
    return null;
  }
}

async function latestManualSnapshot(
  householdId: string,
  financialAccountId: string,
  asOf: string
): Promise<{
  amount: number;
  currency: string;
  asOfDate: string;
  importFileId: string | null;
} | null> {
  const row = await qGet<Record<string, unknown>>(
    `SELECT amount, currency, as_of_date::text AS as_of_date, import_file_id
       FROM account_balance_snapshot
      WHERE household_id = ?
        AND financial_account_id = ?
        AND source = 'manual'
        AND as_of_date <= ?::date
      ORDER BY as_of_date DESC, updated_at DESC
      LIMIT 1`,
    householdId,
    financialAccountId,
    asOf
  );
  if (!row) {
    return null;
  }
  return {
    amount: Number(row.amount),
    currency: String(row.currency ?? "USD"),
    asOfDate: String(row.as_of_date).slice(0, 10),
    importFileId: row.import_file_id == null ? null : String(row.import_file_id)
  };
}

async function latestImportSnapshotFromTable(
  householdId: string,
  financialAccountId: string,
  asOf: string
): Promise<{ amount: number; asOfDate: string | null; importFileId: string | null } | null> {
  const row = await qGet<Record<string, unknown>>(
    `SELECT amount, as_of_date::text AS as_of_date, import_file_id
       FROM account_balance_snapshot
      WHERE household_id = ?
        AND financial_account_id = ?
        AND source = 'import'
        AND as_of_date <= ?::date
      ORDER BY as_of_date DESC, updated_at DESC
      LIMIT 1`,
    householdId,
    financialAccountId,
    asOf
  );
  if (!row) {
    return null;
  }
  return {
    amount: Number(row.amount),
    asOfDate: row.as_of_date == null ? null : String(row.as_of_date).slice(0, 10),
    importFileId: row.import_file_id == null ? null : String(row.import_file_id)
  };
}

async function latestImportBalanceHint(
  financialAccountId: string,
  asOf: string
): Promise<{ amount: number; asOfDate: string | null; importFileId: string } | null> {
  const files = await qAll<Record<string, unknown>>(
    `SELECT id, confidence_summary
       FROM import_file
      WHERE financial_account_id = ?
        AND status = 'parsed'
      ORDER BY uploaded_at DESC
      LIMIT 20`,
    financialAccountId
  );
  for (const f of files) {
    const cs = parseConfidenceSummary(
      f.confidence_summary == null ? null : String(f.confidence_summary)
    );
    const sb = cs?.statementBalances;
    if (sb == null || sb.ending == null || !Number.isFinite(Number(sb.ending))) {
      continue;
    }
    const asOfEnd = sb.asOfEnd?.trim() ? String(sb.asOfEnd).slice(0, 10) : null;
    if (asOfEnd && asOfEnd > asOf) {
      continue;
    }
    return {
      amount: Number(sb.ending),
      asOfDate: asOfEnd,
      importFileId: String(f.id)
    };
  }
  return null;
}

export async function getBalanceSheet(
  householdId: string,
  asOf: string,
  options?: BalanceSheetQueryOptions
): Promise<BalanceSheetResult> {
  const own = financialAccountOwnerFragment(options);
  const accounts = await qAll<Record<string, unknown>>(
    `SELECT id, institution, account_mask, type, currency
       FROM financial_account
      WHERE household_id = ?
        AND type <> 'payslip'${own.fragment}
      ORDER BY institution, type, id`,
    householdId,
    ...own.params
  );

  const assets: BalanceSheetAccountRow[] = [];
  const liabilities: BalanceSheetAccountRow[] = [];

  let assetSum = 0;
  let liabilitySum = 0;
  let assetHasAny = false;
  let liabilityHasAny = false;

  for (const a of accounts) {
    const id = String(a.id);
    const type = String(a.type);
    const side = accountSide(type);
    if (!side) {
      continue;
    }

    const manual = await latestManualSnapshot(householdId, id, asOf);
    let balance: number | null = null;
    let balanceAsOf: string | null = null;
    let balanceSource: "manual" | "import" | null = null;
    let importFileId: string | null = null;

    if (manual) {
      balance = manual.amount;
      balanceAsOf = manual.asOfDate;
      balanceSource = "manual";
      importFileId = manual.importFileId;
    } else {
      const fromTable = await latestImportSnapshotFromTable(householdId, id, asOf);
      if (fromTable) {
        balance = fromTable.amount;
        balanceAsOf = fromTable.asOfDate;
        balanceSource = "import";
        importFileId = fromTable.importFileId;
      } else {
        const imp = await latestImportBalanceHint(id, asOf);
        if (imp) {
          balance = imp.amount;
          balanceAsOf = imp.asOfDate;
          balanceSource = "import";
          importFileId = imp.importFileId;
        }
      }
    }

    const row: BalanceSheetAccountRow = {
      financialAccountId: id,
      institution: String(a.institution),
      accountMask: a.account_mask == null ? null : String(a.account_mask),
      type,
      currency: String(a.currency ?? "USD"),
      side,
      balance,
      balanceAsOf,
      balanceSource,
      importFileId
    };

    if (side === "asset") {
      assets.push(row);
      if (balance != null) {
        assetSum += balance;
        assetHasAny = true;
      }
    } else {
      liabilities.push(row);
      if (balance != null) {
        liabilitySum += balance;
        liabilityHasAny = true;
      }
    }
  }

  return {
    asOf,
    assets,
    liabilities,
    totals: {
      assets: assetHasAny ? assetSum : null,
      liabilities: liabilityHasAny ? liabilitySum : null,
      netWorth: assetHasAny || liabilityHasAny ? assetSum - liabilitySum : null
    }
  };
}

export async function upsertManualBalanceSnapshot(
  householdId: string,
  input: { financialAccountId: string; asOfDate: string; amount: number; currency: string }
): Promise<{ id: string }> {
  const acc = await qGet<{ type: string }>(
    `SELECT type FROM financial_account WHERE id = ? AND household_id = ? LIMIT 1`,
    input.financialAccountId,
    householdId
  );
  if (!acc) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }
  if (acc.type === "payslip") {
    throw new Error("PAYSLIP_ACCOUNT_NOT_ALLOWED");
  }

  const existing = await qGet<{ id: string }>(
    `SELECT id FROM account_balance_snapshot
      WHERE household_id = ?
        AND financial_account_id = ?
        AND source = 'manual'
        AND as_of_date = ?::date
      LIMIT 1`,
    householdId,
    input.financialAccountId,
    input.asOfDate
  );

  if (existing) {
    await qExec(
      `UPDATE account_balance_snapshot
          SET amount = ?, currency = ?, updated_at = NOW()
        WHERE id = ?`,
      input.amount,
      input.currency,
      existing.id
    );
    return { id: existing.id };
  }

  const id = crypto.randomUUID();
  await qExec(
    `INSERT INTO account_balance_snapshot (
       id, household_id, financial_account_id, as_of_date, amount, currency, source, import_file_id, updated_at
     ) VALUES (?, ?, ?, ?::date, ?, ?, 'manual', NULL, NOW())`,
    id,
    householdId,
    input.financialAccountId,
    input.asOfDate,
    input.amount,
    input.currency
  );
  return { id };
}

export type UpsertImportBalanceResult =
  | { ok: true }
  | { ok: false; code: "ACCOUNT_NOT_FOUND" | "PAYSLIP_ACCOUNT_NOT_ALLOWED" };

/**
 * Persists statement-ending balance from bank parse into `account_balance_snapshot` (`source = import`).
 * Call only when `asOfDate` is a valid `YYYY-MM-DD` (statement period end).
 */
export async function upsertImportBalanceSnapshotFromStatement(
  householdId: string,
  input: {
    financialAccountId: string;
    importFileId: string;
    asOfDate: string;
    amount: number;
    currency: string;
  }
): Promise<UpsertImportBalanceResult> {
  const acc = await qGet<{ type: string; household_id: string }>(
    `SELECT type, household_id FROM financial_account WHERE id = ? LIMIT 1`,
    input.financialAccountId
  );
  if (!acc || acc.household_id !== householdId) {
    return { ok: false, code: "ACCOUNT_NOT_FOUND" };
  }
  if (acc.type === "payslip") {
    return { ok: false, code: "PAYSLIP_ACCOUNT_NOT_ALLOWED" };
  }

  const existing = await qGet<{ id: string }>(
    `SELECT id FROM account_balance_snapshot
      WHERE household_id = ?
        AND financial_account_id = ?
        AND source = 'import'
        AND as_of_date = ?::date
      LIMIT 1`,
    householdId,
    input.financialAccountId,
    input.asOfDate
  );

  if (existing) {
    await qExec(
      `UPDATE account_balance_snapshot
          SET amount = ?, currency = ?, import_file_id = ?, updated_at = NOW()
        WHERE id = ?`,
      input.amount,
      input.currency,
      input.importFileId,
      existing.id
    );
  } else {
    const id = crypto.randomUUID();
    await qExec(
      `INSERT INTO account_balance_snapshot (
         id, household_id, financial_account_id, as_of_date, amount, currency, source, import_file_id, updated_at
       ) VALUES (?, ?, ?, ?::date, ?, ?, 'import', ?, NOW())`,
      id,
      householdId,
      input.financialAccountId,
      input.asOfDate,
      input.amount,
      input.currency,
      input.importFileId
    );
  }
  return { ok: true };
}

export async function patchManualBalanceSnapshot(
  householdId: string,
  snapshotId: string,
  patch: { amount?: number; currency?: string }
): Promise<{ id: string } | null> {
  const row = await qGet<{ id: string }>(
    `SELECT id FROM account_balance_snapshot WHERE id = ? AND household_id = ? AND source = 'manual' LIMIT 1`,
    snapshotId,
    householdId
  );
  if (!row) {
    return null;
  }
  if (patch.amount !== undefined) {
    await qExec(`UPDATE account_balance_snapshot SET amount = ?, updated_at = NOW() WHERE id = ?`, patch.amount, row.id);
  }
  if (patch.currency !== undefined) {
    await qExec(`UPDATE account_balance_snapshot SET currency = ?, updated_at = NOW() WHERE id = ?`, patch.currency, row.id);
  }
  return { id: row.id };
}

const HISTORY_MAX_POINTS = 120;

function addUtcDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function compareIsoDate(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function generateHistorySampleDates(
  from: string,
  to: string,
  interval: BalanceSheetHistoryInterval
): string[] {
  if (compareIsoDate(from, to) > 0) {
    return [];
  }
  if (interval === "day") {
    const out: string[] = [];
    let cur = from;
    while (compareIsoDate(cur, to) <= 0) {
      out.push(cur);
      cur = addUtcDays(cur, 1);
    }
    return out;
  }
  if (interval === "week") {
    const out: string[] = [];
    let cur = from;
    while (compareIsoDate(cur, to) <= 0) {
      out.push(cur);
      cur = addUtcDays(cur, 7);
    }
    return out;
  }
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7)) - 1;
  const toY = Number(to.slice(0, 4));
  const toM = Number(to.slice(5, 7)) - 1;
  while (y < toY || (y === toY && m <= toM)) {
    const last = new Date(Date.UTC(y, m + 1, 0));
    const iso = last.toISOString().slice(0, 10);
    if (compareIsoDate(iso, from) >= 0 && compareIsoDate(iso, to) <= 0) {
      out.push(iso);
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export async function getBalanceSheetHistory(
  householdId: string,
  from: string,
  to: string,
  interval: BalanceSheetHistoryInterval,
  options?: BalanceSheetQueryOptions & { accountIds?: string[] }
): Promise<BalanceSheetHistoryResult> {
  const dates = generateHistorySampleDates(from, to, interval);
  if (dates.length > HISTORY_MAX_POINTS) {
    throw new Error("BALANCE_HISTORY_TOO_MANY_POINTS");
  }
  const cappedAccountIds = (options?.accountIds ?? []).slice(0, MAX_HISTORY_ACCOUNT_IDS);
  const accountIdSet = cappedAccountIds.length > 0 ? new Set(cappedAccountIds) : null;
  const balanceOpts: BalanceSheetQueryOptions | undefined = options
    ? { ownerScope: options.ownerScope, ownerPersonProfileId: options.ownerPersonProfileId }
    : undefined;
  const points: BalanceSheetHistoryPoint[] = [];
  for (const asOf of dates) {
    const sheet = await getBalanceSheet(householdId, asOf, balanceOpts);
    const point: BalanceSheetHistoryPoint = {
      asOf,
      totals: { ...sheet.totals }
    };
    if (accountIdSet) {
      const slices: BalanceSheetHistoryAccountSlice[] = [];
      for (const r of sheet.assets) {
        if (accountIdSet.has(r.financialAccountId)) {
          slices.push({
            financialAccountId: r.financialAccountId,
            side: r.side,
            balance: r.balance,
            balanceAsOf: r.balanceAsOf
          });
        }
      }
      for (const r of sheet.liabilities) {
        if (accountIdSet.has(r.financialAccountId)) {
          slices.push({
            financialAccountId: r.financialAccountId,
            side: r.side,
            balance: r.balance,
            balanceAsOf: r.balanceAsOf
          });
        }
      }
      point.accounts = slices;
    }
    points.push(point);
  }
  return { from, to, interval, points };
}
