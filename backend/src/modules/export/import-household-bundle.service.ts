import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import unzipper from "unzipper";

import { qBegin, qExec, qGet, sqlBind } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";

const IMPORTS_RESTORE_DIR = resolveDataPath("data/imports-restore");

export type ImportJobRow = {
  id: string;
  householdId: string;
  requestedByUserId: string;
  status: "queued" | "running" | "complete" | "failed";
  storagePath: string | null;
  errorText: string | null;
  statsJson: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** Counts of rows restored per table, returned on completion. */
export type ImportStats = Record<string, number>;

function mapRow(r: Record<string, unknown>): ImportJobRow {
  return {
    id: r.id as string,
    householdId: r.household_id as string,
    requestedByUserId: r.requested_by_user_id as string,
    status: r.status as ImportJobRow["status"],
    storagePath: (r.storage_path as string) ?? null,
    errorText: (r.error_text as string) ?? null,
    statsJson: (r.stats_json as string) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string) ?? null
  };
}

export async function queueHouseholdImport(
  householdId: string,
  userId: string,
  uploadedPath: string
): Promise<{ jobId: string }> {
  fs.mkdirSync(IMPORTS_RESTORE_DIR, { recursive: true });
  const jobId = randomUUID();
  const dest = path.join(IMPORTS_RESTORE_DIR, `${jobId}.zip`);
  fs.renameSync(uploadedPath, dest);
  await qExec(
    `INSERT INTO import_job (id, household_id, requested_by_user_id, status, storage_path)
     VALUES (?, ?, ?, 'queued', ?)`,
    jobId,
    householdId,
    userId,
    dest
  );
  return { jobId };
}

export async function getImportJob(householdId: string, jobId: string): Promise<ImportJobRow | null> {
  const r = (await qGet(
    `SELECT id, household_id, requested_by_user_id, status, storage_path, error_text, stats_json, created_at, completed_at
       FROM import_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  )) as Record<string, unknown> | undefined;
  return r ? mapRow(r) : null;
}

export function scheduleImportJobProcessing(jobId: string, householdId: string): void {
  setImmediate(() => {
    void runImportJob(jobId, householdId);
  });
}

/** Read and extract both JSON files from the ZIP. */
async function readZipEntries(zipPath: string): Promise<{ manifest: Record<string, unknown>; bundle: Record<string, unknown> }> {
  const directory = await unzipper.Open.file(zipPath);
  const manifestEntry = directory.files.find((f) => f.path === "manifest.json");
  const bundleEntry = directory.files.find((f) => f.path === "household-bundle.json");
  if (!manifestEntry) throw new Error("ZIP is missing manifest.json");
  if (!bundleEntry) throw new Error("ZIP is missing household-bundle.json");
  const manifest = JSON.parse((await manifestEntry.buffer()).toString("utf-8")) as Record<string, unknown>;
  const bundle = JSON.parse((await bundleEntry.buffer()).toString("utf-8")) as Record<string, unknown>;
  return { manifest, bundle };
}

async function runImportJob(jobId: string, householdId: string): Promise<void> {
  const row = (await qGet<{ storage_path: string }>(
    `SELECT storage_path FROM import_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  )) as { storage_path: string } | undefined;
  if (!row?.storage_path) return;

  await qExec(`UPDATE import_job SET status = 'running' WHERE id = ?`, jobId);

  try {
    const { manifest, bundle } = await readZipEntries(row.storage_path);

    const exportVersion = manifest.exportVersion as number;
    if (exportVersion !== 1 && exportVersion !== 2) {
      throw new Error(`Unsupported export version: ${String(exportVersion)}. Expected 1 or 2.`);
    }

    const bundleHouseholdId = bundle.householdId as string;
    if (!bundleHouseholdId) throw new Error("Bundle is missing householdId");

    /** Replace the source household id with the current instance's id in every column of a row. */
    function remap<T extends Record<string, unknown>>(r: T): T {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(r)) {
        out[key] = r[key] === bundleHouseholdId ? householdId : r[key];
      }
      return out as T;
    }

    type Row = Record<string, unknown>;
    const appUsers = ((bundle.appUsers as Row[] | undefined) ?? []).map(remap);
    const accounts = ((bundle.financialAccounts as Row[] | undefined) ?? []).map(remap);
    // Only restore household-specific categories (skip global seed categories)
    const categories = ((bundle.categories as Row[] | undefined) ?? [])
      .filter((c) => c.household_id != null)
      .map(remap);
    const rules = ((bundle.categoryRulesHousehold as Row[] | undefined) ?? []).map(remap);
    const transactions = ((bundle.transactionCanonical as Row[] | undefined) ?? []).map(remap);
    const profiles = ((bundle.personProfiles as Row[] | undefined) ?? []).map(remap);
    const memberships = ((bundle.householdMemberships as Row[] | undefined) ?? []).map(remap);
    const balanceSnapshots = ((bundle.accountBalanceSnapshots as Row[] | undefined) ?? []).map(remap);
    const payslips = ((bundle.payslipSnapshots as Row[] | undefined) ?? []).map(remap);
    const customInstitutions = ((bundle.householdCustomInstitutions as Row[] | undefined) ?? []).map(remap);
    const householdRow = bundle.household as Row | undefined;

    const stats: ImportStats = {};

    await qBegin(async (tx) => {
      const txExec = async (sqlStr: string, ...params: unknown[]): Promise<void> => {
        const { text, values } = sqlBind(sqlStr, params);
        await tx.unsafe(text, values as never[]);
      };

      // ── WIPE current household data in reverse FK order ──────────────────
      await txExec(`DELETE FROM resolution_item WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM transaction_canonical WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM account_balance_snapshot WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM payslip_snapshot WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM category_rule WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM household_membership WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM person_profile WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM financial_account WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM household_custom_institution WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM category WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM app_user WHERE household_id = ?`, householdId);

      // ── RESTORE: app_user (bump token_version to force re-login on next request) ──
      for (const u of appUsers) {
        await txExec(
          `INSERT INTO app_user (id, household_id, email, role, password_hash, token_version, visibility_scope, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          u.id,
          householdId,
          u.email,
          u.role,
          u.password_hash,
          ((u.token_version as number | null) ?? 0) + 1,
          (u.visibility_scope as string | null) ?? null,
          (u.created_at as string) ?? new Date().toISOString()
        );
      }
      stats.appUsers = appUsers.length;

      // ── RESTORE: household settings (UPDATE only — never re-create) ───────
      if (householdRow) {
        await txExec(
          `UPDATE household SET
             name = ?,
             monthly_savings_target_usd = ?,
             salary_deposit_financial_account_id = ?,
             employers_json = ?
           WHERE id = ?`,
          householdRow.name,
          (householdRow.monthly_savings_target_usd as number | null) ?? null,
          (householdRow.salary_deposit_financial_account_id as string | null) ?? null,
          (householdRow.employers_json as string | null) ?? null,
          householdId
        );
      }

      // ── RESTORE: household_custom_institution ────────────────────────────
      for (const ci of customInstitutions) {
        await txExec(
          `INSERT INTO household_custom_institution (id, household_id, display_name, created_at)
           VALUES (?, ?, ?, ?)`,
          ci.id,
          householdId,
          ci.display_name,
          (ci.created_at as string) ?? new Date().toISOString()
        );
      }
      stats.householdCustomInstitutions = customInstitutions.length;

      // ── RESTORE: financial_account ───────────────────────────────────────
      for (const a of accounts) {
        await txExec(
          `INSERT INTO financial_account
             (id, household_id, owner_user_id, type, institution, account_mask, currency,
              owner_scope, owner_person_profile_id, default_parser_profile_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          a.id,
          householdId,
          (a.owner_user_id as string | null) ?? null,
          a.type,
          a.institution,
          (a.account_mask as string | null) ?? null,
          (a.currency as string) ?? "USD",
          (a.owner_scope as string | null) ?? null,
          (a.owner_person_profile_id as string | null) ?? null,
          (a.default_parser_profile_id as string | null) ?? null,
          (a.created_at as string) ?? new Date().toISOString()
        );
      }
      stats.financialAccounts = accounts.length;

      // ── RESTORE: category (household-specific; parents before children) ──
      const parents = categories.filter((c) => c.parent_id == null);
      const children = categories.filter((c) => c.parent_id != null);
      for (const c of [...parents, ...children]) {
        await txExec(
          `INSERT INTO category (id, household_id, parent_id, name, is_default)
           VALUES (?, ?, ?, ?, ?)`,
          c.id,
          householdId,
          (c.parent_id as string | null) ?? null,
          c.name,
          (c.is_default as boolean) ?? false
        );
      }
      stats.categories = categories.length;

      // ── RESTORE: person_profile ──────────────────────────────────────────
      for (const p of profiles) {
        await txExec(
          `INSERT INTO person_profile
             (id, household_id, linked_user_id, full_name, email, phone_number, avatar_key,
              salary_deposit_financial_account_id, employers_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          p.id,
          householdId,
          (p.linked_user_id as string | null) ?? null,
          (p.full_name as string | null) ?? null,
          (p.email as string | null) ?? null,
          (p.phone_number as string | null) ?? null,
          (p.avatar_key as string | null) ?? null,
          (p.salary_deposit_financial_account_id as string | null) ?? null,
          (p.employers_json as string | null) ?? null,
          (p.created_at as string) ?? new Date().toISOString()
        );
      }
      stats.personProfiles = profiles.length;

      // ── RESTORE: household_membership ────────────────────────────────────
      for (const m of memberships) {
        await txExec(
          `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          m.id,
          householdId,
          m.person_profile_id,
          (m.role as string | null) ?? null,
          (m.relationship as string | null) ?? null,
          (m.created_at as string) ?? new Date().toISOString()
        );
      }
      stats.householdMemberships = memberships.length;

      // ── RESTORE: category_rule ───────────────────────────────────────────
      for (const r of rules) {
        await txExec(
          `INSERT INTO category_rule
             (id, household_id, pattern, match_type, category_id, confidence, amount_scope, priority, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.id,
          householdId,
          r.pattern,
          r.match_type,
          (r.category_id as string | null) ?? null,
          (r.confidence as number | null) ?? null,
          (r.amount_scope as string) ?? "any",
          (r.priority as number) ?? 50,
          (r.enabled as boolean) ?? true,
          (r.created_at as string) ?? new Date().toISOString(),
          (r.updated_at as string) ?? new Date().toISOString()
        );
      }
      stats.categoryRules = rules.length;

      // ── RESTORE: transaction_canonical ───────────────────────────────────
      for (const t of transactions) {
        await txExec(
          `INSERT INTO transaction_canonical
             (id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
              merchant, memo, transfer_group_id, fingerprint, source_ref, reference_id,
              status, classification_meta, owner_scope, owner_person_profile_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          t.id,
          householdId,
          t.account_id,
          (t.user_id as string | null) ?? null,
          (t.category_id as string | null) ?? null,
          t.txn_date,
          t.amount,
          (t.direction as string | null) ?? null,
          (t.merchant as string | null) ?? null,
          (t.memo as string | null) ?? null,
          (t.transfer_group_id as string | null) ?? null,
          (t.fingerprint as string | null) ?? null,
          (t.source_ref as string | null) ?? null,
          (t.reference_id as string | null) ?? null,
          (t.status as string) ?? "posted",
          (t.classification_meta as string | null) ?? null,
          (t.owner_scope as string | null) ?? null,
          (t.owner_person_profile_id as string | null) ?? null,
          (t.created_at as string) ?? new Date().toISOString()
        );
      }
      stats.transactions = transactions.length;

      // ── RESTORE: account_balance_snapshot (import_file_id set to NULL) ───
      for (const b of balanceSnapshots) {
        await txExec(
          `INSERT INTO account_balance_snapshot
             (id, household_id, financial_account_id, as_of_date, amount, currency, source, import_file_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          b.id,
          householdId,
          b.financial_account_id,
          b.as_of_date,
          b.amount,
          (b.currency as string) ?? "USD",
          (b.source as string) ?? "manual",
          (b.created_at as string) ?? new Date().toISOString(),
          (b.updated_at as string) ?? new Date().toISOString()
        );
      }
      stats.balanceSnapshots = balanceSnapshots.length;

      // ── RESTORE: payslip_snapshot (import_file_id set to NULL) ───────────
      for (const ps of payslips) {
        await txExec(
          `INSERT INTO payslip_snapshot
             (id, household_id, file_name, file_checksum, parser_profile_id,
              pay_period_start, pay_period_end, pay_date,
              gross_pay_current, gross_pay_ytd,
              employee_taxes_current, employee_taxes_ytd,
              pre_tax_deductions_current, pre_tax_deductions_ytd,
              post_tax_deductions_current, post_tax_deductions_ytd,
              net_pay_current, net_pay_ytd, hours_or_days_current,
              raw_extract_json, created_at, import_file_id, employer_id,
              owner_scope, owner_person_profile_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
          ps.id,
          householdId,
          (ps.file_name as string | null) ?? null,
          (ps.file_checksum as string | null) ?? null,
          (ps.parser_profile_id as string | null) ?? null,
          (ps.pay_period_start as string | null) ?? null,
          (ps.pay_period_end as string | null) ?? null,
          (ps.pay_date as string | null) ?? null,
          (ps.gross_pay_current as number | null) ?? null,
          (ps.gross_pay_ytd as number | null) ?? null,
          (ps.employee_taxes_current as number | null) ?? null,
          (ps.employee_taxes_ytd as number | null) ?? null,
          (ps.pre_tax_deductions_current as number | null) ?? null,
          (ps.pre_tax_deductions_ytd as number | null) ?? null,
          (ps.post_tax_deductions_current as number | null) ?? null,
          (ps.post_tax_deductions_ytd as number | null) ?? null,
          (ps.net_pay_current as number | null) ?? null,
          (ps.net_pay_ytd as number | null) ?? null,
          (ps.hours_or_days_current as number | null) ?? null,
          (ps.raw_extract_json as string | null) ?? null,
          (ps.created_at as string) ?? new Date().toISOString(),
          (ps.employer_id as string | null) ?? null,
          (ps.owner_scope as string | null) ?? null,
          (ps.owner_person_profile_id as string | null) ?? null
        );
      }
      stats.payslipSnapshots = payslips.length;
    });

    await qExec(
      `UPDATE import_job SET status = 'complete', completed_at = NOW(), stats_json = ?, error_text = NULL WHERE id = ?`,
      JSON.stringify(stats),
      jobId
    );
    log.info(`Import job ${jobId} complete for household ${householdId}: ${JSON.stringify(stats)}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await qExec(`UPDATE import_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`, msg, jobId);
    log.error(`Import job ${jobId} failed: ${msg}`);
  }
}
