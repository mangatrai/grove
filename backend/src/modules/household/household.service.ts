import { db } from "../../db/sqlite.js";

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
