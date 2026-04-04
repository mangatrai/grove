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

function isMissingProfileIncomeColumnError(e: unknown): boolean {
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

export function getHouseholdSettings(householdId: string, userId?: string): HouseholdSettings | null {
  try {
    const base = db
      .prepare(
        `SELECT monthly_savings_target_usd AS monthlySavingsTargetUsd
         FROM household WHERE id = ?`
      )
      .get(householdId) as
      | {
          monthlySavingsTargetUsd: number | null;
        }
      | undefined;
    if (!base) {
      return null;
    }
    let monthlySavingsTargetUsd: number | null = null;
    if (base.monthlySavingsTargetUsd != null && Number.isFinite(Number(base.monthlySavingsTargetUsd))) {
      const n = Number(base.monthlySavingsTargetUsd);
      if (n >= 0) {
        monthlySavingsTargetUsd = Math.round(n * 100) / 100;
      }
    }

    let salaryDepositFinancialAccountId: string | null = null;
    let employers: EmployerStub[] = [];

    if (userId) {
      try {
        const profileRow = db
          .prepare(
            `SELECT salary_deposit_financial_account_id AS salaryDepositFinancialAccountId, employers_json AS employersJson
             FROM person_profile
             WHERE household_id = ? AND linked_user_id = ?
             LIMIT 1`
          )
          .get(householdId, userId) as
          | {
              salaryDepositFinancialAccountId: string | null;
              employersJson: string | null;
            }
          | undefined;

        if (profileRow) {
          salaryDepositFinancialAccountId =
            profileRow.salaryDepositFinancialAccountId == null
              ? null
              : String(profileRow.salaryDepositFinancialAccountId);
          if (profileRow.employersJson?.trim()) {
            try {
              const parsed = JSON.parse(profileRow.employersJson) as unknown;
              const arr = employersPayloadSchema.safeParse(parsed);
              if (arr.success) {
                employers = arr.data;
              }
            } catch {
              employers = [];
            }
          }
        }
      } catch (e: unknown) {
        if (!isMissingProfileIncomeColumnError(e)) {
          throw e;
        }
      }
    }

    return {
      monthlySavingsTargetUsd,
      salaryDepositFinancialAccountId,
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
};

export type PatchHouseholdSettingsFailure = { ok: false; code: "INVALID_AMOUNT" | "MIGRATION_REQUIRED" };

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

  return { ok: true };
}

export type HouseholdMemberRole = "head" | "member";
export type HouseholdRelationship = "self" | "spouse" | "child" | "dependent" | "other";

export type HouseholdMemberProfile = {
  id: string;
  householdId: string;
  linkedUserId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  avatarKey: string | null;
  role: HouseholdMemberRole;
  relationship: HouseholdRelationship;
};

type MemberProfileRow = {
  id: string;
  household_id: string;
  linked_user_id: string | null;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  avatar_key: string | null;
  role: HouseholdMemberRole;
  relationship: HouseholdRelationship;
};

function toHouseholdMemberProfile(row: MemberProfileRow): HouseholdMemberProfile {
  const parts = row.full_name.trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return {
    id: row.id,
    householdId: row.household_id,
    linkedUserId: row.linked_user_id,
    firstName,
    lastName,
    fullName: row.full_name,
    email: row.email,
    phoneNumber: row.phone_number,
    avatarKey: row.avatar_key,
    role: row.role,
    relationship: row.relationship
  };
}

function isSqliteConstraintError(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code.includes("SQLITE_CONSTRAINT");
}

export type PatchProfileInput = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string | null;
  phoneNumber?: string | null;
  avatarKey?: string | null;
  salaryDepositFinancialAccountId?: string | null;
  employers?: EmployerInput[];
};

export type CreateMemberInput = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string | null;
  phoneNumber?: string | null;
  avatarKey?: string | null;
  role: HouseholdMemberRole;
  relationship: HouseholdRelationship;
};

export type PatchMemberInput = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string | null;
  phoneNumber?: string | null;
  avatarKey?: string | null;
  role?: HouseholdMemberRole;
  relationship?: HouseholdRelationship;
};

const getProfileByUserStmt = db.prepare<[string, string], MemberProfileRow>(`
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.linked_user_id = ?
  LIMIT 1
`);

const getMemberByIdStmt = db.prepare<[string, string], MemberProfileRow>(`
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.id = ?
  LIMIT 1
`);

const listMembersStmt = db.prepare<[string], MemberProfileRow>(`
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship
  FROM household_membership m
  JOIN person_profile p
    ON p.id = m.person_profile_id
   AND p.household_id = m.household_id
  WHERE m.household_id = ?
  ORDER BY p.created_at ASC, p.id ASC
`);

const updateProfileByIdStmt = db.prepare<
  [string, string | null, string | null, string | null, string, string]
>(`
  UPDATE person_profile
  SET full_name = ?, email = ?, phone_number = ?, avatar_key = ?
  WHERE household_id = ? AND id = ?
`);

const updateLinkedUserEmailStmt = db.prepare<[string, string]>(`
  UPDATE app_user
  SET email = ?
  WHERE id = ?
`);

const insertProfileStmt = db.prepare<[string, string, string, string | null, string | null, string | null]>(`
  INSERT INTO person_profile (id, household_id, full_name, email, phone_number, avatar_key)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertMembershipStmt = db.prepare<[string, string, string, HouseholdMemberRole, HouseholdRelationship]>(`
  INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
  VALUES (?, ?, ?, ?, ?)
`);

const updateMembershipStmt = db.prepare<[HouseholdMemberRole, HouseholdRelationship, string, string]>(`
  UPDATE household_membership
  SET role = ?, relationship = ?
  WHERE household_id = ? AND person_profile_id = ?
`);

const getAppUserStmt = db.prepare<[string, string], { email: string; role: "owner" | "admin" | "member" }>(`
  SELECT email, role
  FROM app_user
  WHERE household_id = ? AND id = ?
  LIMIT 1
`);

function ensureCurrentUserProfile(
  householdId: string,
  userId: string,
  role: "owner" | "admin" | "member"
): HouseholdMemberProfile | null {
  const existing = getProfileByUserStmt.get(householdId, userId);
  if (existing) {
    return toHouseholdMemberProfile(existing);
  }

  const user = getAppUserStmt.get(householdId, userId);
  if (!user) {
    return null;
  }

  const profileId = randomUUID();
  const membershipId = randomUUID();
  const membershipRole: HouseholdMemberRole = role === "owner" ? "head" : "member";
  const relationship: HouseholdRelationship = role === "owner" ? "self" : "other";

  try {
    db.transaction(() => {
      insertProfileStmt.run(profileId, householdId, "", user.email, null, null);
      insertMembershipStmt.run(membershipId, householdId, profileId, membershipRole, relationship);
      db.prepare(`UPDATE person_profile SET linked_user_id = ? WHERE household_id = ? AND id = ?`).run(
        userId,
        householdId,
        profileId
      );
    })();
  } catch (err: unknown) {
    if (!isSqliteConstraintError(err)) {
      throw err;
    }
  }

  const created = getProfileByUserStmt.get(householdId, userId);
  return created ? toHouseholdMemberProfile(created) : null;
}

export function getCurrentUserProfile(
  householdId: string,
  userId: string,
  role: "owner" | "admin" | "member"
): HouseholdMemberProfile | null {
  return ensureCurrentUserProfile(householdId, userId, role);
}

export function patchCurrentUserProfile(
  householdId: string,
  userId: string,
  role: "owner" | "admin" | "member",
  input: PatchProfileInput
): { ok: true; profile: HouseholdMemberProfile } | { ok: false; code: "NOT_FOUND" | "EMAIL_CONFLICT" } {
  const ensured = ensureCurrentUserProfile(householdId, userId, role);
  const existing = ensured ? getProfileByUserStmt.get(householdId, userId) : undefined;
  if (!existing) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const nextFullName =
    input.fullName ??
    ([input.firstName?.trim() ?? "", input.lastName?.trim() ?? ""].filter(Boolean).join(" ") ||
      existing.full_name);
  const nextEmail = input.email !== undefined ? input.email : existing.email;
  if (input.salaryDepositFinancialAccountId !== undefined) {
    const id = input.salaryDepositFinancialAccountId;
    if (id !== null && !accountBelongsToHousehold(id, householdId)) {
      return { ok: false, code: "NOT_FOUND" };
    }
    try {
      db.prepare(
        `UPDATE person_profile SET salary_deposit_financial_account_id = ? WHERE household_id = ? AND linked_user_id = ?`
      ).run(id, householdId, userId);
    } catch (err: unknown) {
      if (!isMissingProfileIncomeColumnError(err)) {
        throw err;
      }
    }
  }
  if (input.employers !== undefined) {
    for (const e of input.employers) {
      const pid = e.parserProfileId ?? "ibm_pay_contributions_pdf";
      if (!isParserProfileId(pid)) {
        return { ok: false, code: "NOT_FOUND" };
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
      return { ok: false, code: "NOT_FOUND" };
    }
    try {
      db.prepare(`UPDATE person_profile SET employers_json = ? WHERE household_id = ? AND linked_user_id = ?`).run(
        JSON.stringify(parsed.data),
        householdId,
        userId
      );
    } catch (err: unknown) {
      if (!isMissingProfileIncomeColumnError(err)) {
        throw err;
      }
    }
  }

  const nextPhone = input.phoneNumber !== undefined ? input.phoneNumber : existing.phone_number;
  const nextAvatar = input.avatarKey !== undefined ? input.avatarKey : existing.avatar_key;

  try {
    db.transaction(() => {
      updateProfileByIdStmt.run(nextFullName, nextEmail, nextPhone, nextAvatar, householdId, existing.id);
      if (input.email !== undefined && existing.linked_user_id && nextEmail !== null) {
        updateLinkedUserEmailStmt.run(nextEmail, existing.linked_user_id);
      }
    })();
  } catch (err: unknown) {
    if (isSqliteConstraintError(err)) {
      return { ok: false, code: "EMAIL_CONFLICT" };
    }
    throw err;
  }

  const updated = getMemberByIdStmt.get(householdId, existing.id);
  if (!updated) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true, profile: toHouseholdMemberProfile(updated) };
}

export function listHouseholdMembers(householdId: string): HouseholdMemberProfile[] {
  return listMembersStmt.all(householdId).map(toHouseholdMemberProfile);
}

export function createHouseholdMember(
  householdId: string,
  input: CreateMemberInput
): { ok: true; member: HouseholdMemberProfile } | { ok: false; code: "EMAIL_CONFLICT" } {
  const profileId = randomUUID();
  const membershipId = randomUUID();
  const email = input.email ?? null;
  const phoneNumber = input.phoneNumber ?? null;
  const avatarKey = input.avatarKey ?? null;

  const fullName =
    input.fullName?.trim() ||
    [input.firstName?.trim() ?? "", input.lastName?.trim() ?? ""].filter(Boolean).join(" ").trim();
  try {
    db.transaction(() => {
      insertProfileStmt.run(profileId, householdId, fullName, email, phoneNumber, avatarKey);
      insertMembershipStmt.run(membershipId, householdId, profileId, input.role, input.relationship);
    })();
  } catch (err: unknown) {
    if (isSqliteConstraintError(err)) {
      return { ok: false, code: "EMAIL_CONFLICT" };
    }
    throw err;
  }

  const created = getMemberByIdStmt.get(householdId, profileId);
  if (!created) {
    throw new Error("Created member could not be loaded");
  }
  return { ok: true, member: toHouseholdMemberProfile(created) };
}

export function patchHouseholdMember(
  householdId: string,
  memberId: string,
  input: PatchMemberInput
): { ok: true; member: HouseholdMemberProfile } | { ok: false; code: "NOT_FOUND" | "EMAIL_CONFLICT" } {
  const existing = getMemberByIdStmt.get(householdId, memberId);
  if (!existing) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const nextFullName =
    input.fullName ??
    ([input.firstName?.trim() ?? "", input.lastName?.trim() ?? ""].filter(Boolean).join(" ") ||
      existing.full_name);
  const nextEmail = input.email !== undefined ? input.email : existing.email;
  const nextPhone = input.phoneNumber !== undefined ? input.phoneNumber : existing.phone_number;
  const nextAvatar = input.avatarKey !== undefined ? input.avatarKey : existing.avatar_key;
  const nextRole = input.role ?? existing.role;
  const nextRelationship = input.relationship ?? existing.relationship;

  try {
    db.transaction(() => {
      updateProfileByIdStmt.run(nextFullName, nextEmail, nextPhone, nextAvatar, householdId, memberId);
      updateMembershipStmt.run(nextRole, nextRelationship, householdId, memberId);
      if (input.email !== undefined && existing.linked_user_id && nextEmail !== null) {
        updateLinkedUserEmailStmt.run(nextEmail, existing.linked_user_id);
      }
    })();
  } catch (err: unknown) {
    if (isSqliteConstraintError(err)) {
      return { ok: false, code: "EMAIL_CONFLICT" };
    }
    throw err;
  }

  const updated = getMemberByIdStmt.get(householdId, memberId);
  if (!updated) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true, member: toHouseholdMemberProfile(updated) };
}
