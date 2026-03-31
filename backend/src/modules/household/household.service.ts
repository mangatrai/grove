import { randomUUID } from "node:crypto";

import { db } from "../../db/sqlite.js";

import { isParserProfileId } from "../imports/profiles/profile-ids.js";
import {
  employersPayloadSchema,
  type EmployerInput,
  type EmployerStub
} from "./household.types.js";

function isMissingSavingsTargetColumnError(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === "object" &&
    "message" in e &&
    typeof (e as { message?: string }).message === "string" &&
    (e as { message: string }).message.includes("no such column") &&
    (e as { message: string }).message.includes("monthly_savings_target_usd")
  );
}

function isMissingIncomeOnboardingColumnError(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === "object" &&
    "message" in e &&
    typeof (e as { message?: string }).message === "string" &&
    (e as { message: string }).message.includes("no such column") &&
    ((e as { message: string }).message.includes("salary_deposit_financial_account_id") ||
      (e as { message: string }).message.includes("employers_json"))
  );
}

export function getHouseholdMonthlySavingsTarget(householdId: string): number | null {
  try {
    const row = db
      .prepare(`SELECT monthly_savings_target_usd AS t FROM household WHERE id = ?`)
      .get(householdId) as { t: number | null } | undefined;
    if (!row) {
      return null;
    }
    if (row.t === null || row.t === undefined) {
      return null;
    }
    const n = Number(row.t);
    if (!Number.isFinite(n) || n < 0) {
      return null;
    }
    return Math.round(n * 100) / 100;
  } catch (e: unknown) {
    if (isMissingSavingsTargetColumnError(e)) {
      return null;
    }
    throw e;
  }
}

export type HouseholdSettings = {
  monthlySavingsTargetUsd: number | null;
  salaryDepositFinancialAccountId: string | null;
  employers: EmployerStub[];
};

export function getHouseholdSettings(householdId: string): HouseholdSettings | null {
  try {
    const row = db
      .prepare(
        `SELECT monthly_savings_target_usd AS monthlySavingsTargetUsd,
                salary_deposit_financial_account_id AS salaryDepositFinancialAccountId,
                employers_json AS employersJson
         FROM household WHERE id = ?`
      )
      .get(householdId) as
      | {
          monthlySavingsTargetUsd: number | null;
          salaryDepositFinancialAccountId: string | null;
          employersJson: string | null;
        }
      | undefined;
    if (!row) {
      return null;
    }
    let monthlySavingsTargetUsd: number | null = null;
    if (row.monthlySavingsTargetUsd != null && Number.isFinite(Number(row.monthlySavingsTargetUsd))) {
      const n = Number(row.monthlySavingsTargetUsd);
      if (n >= 0) {
        monthlySavingsTargetUsd = Math.round(n * 100) / 100;
      }
    }
    let employers: EmployerStub[] = [];
    if (row.employersJson?.trim()) {
      try {
        const parsed = JSON.parse(row.employersJson) as unknown;
        const arr = employersPayloadSchema.safeParse(parsed);
        if (arr.success) {
          employers = arr.data;
        }
      } catch {
        employers = [];
      }
    }
    return {
      monthlySavingsTargetUsd,
      salaryDepositFinancialAccountId:
        row.salaryDepositFinancialAccountId == null ? null : String(row.salaryDepositFinancialAccountId),
      employers
    };
  } catch (e: unknown) {
    if (isMissingIncomeOnboardingColumnError(e)) {
      return {
        monthlySavingsTargetUsd: getHouseholdMonthlySavingsTarget(householdId),
        salaryDepositFinancialAccountId: null,
        employers: []
      };
    }
    throw e;
  }
}

function accountBelongsToHousehold(accountId: string, householdId: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM financial_account WHERE id = ? AND household_id = ?`)
    .get(accountId, householdId) as { ok: number } | undefined;
  return Boolean(row);
}

export function updateHouseholdMonthlySavingsTarget(
  householdId: string,
  monthlySavingsTargetUsd: number | null
): { ok: true } | { ok: false; code: "INVALID_AMOUNT" | "MIGRATION_REQUIRED" } {
  if (monthlySavingsTargetUsd !== null) {
    if (!Number.isFinite(monthlySavingsTargetUsd) || monthlySavingsTargetUsd < 0) {
      return { ok: false, code: "INVALID_AMOUNT" };
    }
  }
  const value =
    monthlySavingsTargetUsd === null ? null : Math.round(monthlySavingsTargetUsd * 100) / 100;
  try {
    db.prepare(`UPDATE household SET monthly_savings_target_usd = ? WHERE id = ?`).run(value, householdId);
    return { ok: true };
  } catch (e: unknown) {
    if (isMissingSavingsTargetColumnError(e)) {
      return { ok: false, code: "MIGRATION_REQUIRED" };
    }
    throw e;
  }
}

export type PatchHouseholdSettingsInput = {
  monthlySavingsTargetUsd?: number | null;
  salaryDepositFinancialAccountId?: string | null;
  employers?: EmployerInput[];
};

export type PatchHouseholdSettingsFailure =
  | { ok: false; code: "INVALID_AMOUNT" | "MIGRATION_REQUIRED" | "INVALID_ACCOUNT" | "INVALID_EMPLOYERS" };

export function patchHouseholdSettings(
  householdId: string,
  input: PatchHouseholdSettingsInput
): { ok: true } | PatchHouseholdSettingsFailure {
  if (input.monthlySavingsTargetUsd !== undefined) {
    const out = updateHouseholdMonthlySavingsTarget(householdId, input.monthlySavingsTargetUsd);
    if (!out.ok) {
      return out;
    }
  }

  if (input.salaryDepositFinancialAccountId !== undefined) {
    const id = input.salaryDepositFinancialAccountId;
    if (id !== null && !accountBelongsToHousehold(id, householdId)) {
      return { ok: false, code: "INVALID_ACCOUNT" };
    }
    try {
      db.prepare(`UPDATE household SET salary_deposit_financial_account_id = ? WHERE id = ?`).run(id, householdId);
    } catch (e: unknown) {
      if (isMissingIncomeOnboardingColumnError(e)) {
        return { ok: false, code: "MIGRATION_REQUIRED" };
      }
      throw e;
    }
  }

  if (input.employers !== undefined) {
    for (const e of input.employers) {
      const pid = e.parserProfileId ?? "ibm_pay_contributions_pdf";
      if (!isParserProfileId(pid)) {
        return { ok: false, code: "INVALID_EMPLOYERS" };
      }
    }
    const normalized: EmployerStub[] = input.employers.map((e) => ({
      id: e.id?.trim() ? e.id : randomUUID(),
      displayName: e.displayName.trim(),
      parserProfileId: e.parserProfileId ?? "ibm_pay_contributions_pdf",
      parserMapping: e.parserMapping ?? {}
    }));
    const parsed = employersPayloadSchema.safeParse(normalized);
    if (!parsed.success) {
      return { ok: false, code: "INVALID_EMPLOYERS" };
    }
    const json = JSON.stringify(parsed.data);
    try {
      db.prepare(`UPDATE household SET employers_json = ? WHERE id = ?`).run(json, householdId);
    } catch (e: unknown) {
      if (isMissingIncomeOnboardingColumnError(e)) {
        return { ok: false, code: "MIGRATION_REQUIRED" };
      }
      throw e;
    }
  }

  return { ok: true };
}
