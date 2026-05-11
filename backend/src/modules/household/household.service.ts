import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

import { isPgUniqueViolation, qAll, qBegin, qExec, qGet } from "../../db/query.js";
import { env } from "../../config/env.js";

import { isParserProfileId } from "../imports/profiles/profile-ids.js";
import { createPasswordResetToken } from "../auth/auth.service.js";
import { isEmailConfigured, sendMail } from "../mailer/mailer.service.js";
import { renderMemberInviteTemplate } from "../mailer/templates/member-invite.js";
import { renderPasswordResetTemplate } from "../mailer/templates/password-reset.js";
import { computeAgeFromDob, decryptDob, encryptDob } from "./dob-crypto.js";
import {
  employersPayloadSchema,
  type EmployerInput,
  type EmployerStub
} from "./household.types.js";

export async function getHouseholdMonthlySavingsTarget(householdId: string): Promise<number | null> {
  const row = await qGet<{ t: number | null }>(
    `SELECT monthly_savings_target_usd AS t FROM household WHERE id = ?`,
    householdId
  );
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
}

export type HouseholdSettings = {
  monthlySavingsTargetUsd: number | null;
  salaryDepositFinancialAccountId: string | null;
  employers: EmployerStub[];
  city: string | null;
  state: string | null;
  combinedGrossIncomeUsd: number | null;
};

export async function getHouseholdSettings(householdId: string, userId?: string): Promise<HouseholdSettings | null> {
  const base = await qGet<{
    monthlySavingsTargetUsd: number | null;
    city: string | null;
    state: string | null;
    combinedGrossIncomeUsd: number | null;
  }>(
    `SELECT monthly_savings_target_usd AS "monthlySavingsTargetUsd",
            city,
            state,
            combined_gross_income_usd AS "combinedGrossIncomeUsd"
         FROM household WHERE id = ?`,
    householdId
  );
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
    const profileRow = await qGet<{
      salaryDepositFinancialAccountId: string | null;
      employersJson: string | null;
    }>(
      `SELECT salary_deposit_financial_account_id AS "salaryDepositFinancialAccountId", employers_json AS "employersJson"
             FROM person_profile
             WHERE household_id = ? AND linked_user_id = ?
             LIMIT 1`,
      householdId,
      userId
    );

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
  }

  let combinedGrossIncomeUsd: number | null = null;
  if (base.combinedGrossIncomeUsd != null && Number.isFinite(Number(base.combinedGrossIncomeUsd))) {
    const g = Number(base.combinedGrossIncomeUsd);
    if (g >= 0) {
      combinedGrossIncomeUsd = Math.round(g * 100) / 100;
    }
  }

  return {
    monthlySavingsTargetUsd,
    salaryDepositFinancialAccountId,
    employers,
    city: base.city?.trim() ? String(base.city) : null,
    state: base.state?.trim() ? String(base.state) : null,
    combinedGrossIncomeUsd
  };
}

async function accountBelongsToHousehold(accountId: string, householdId: string): Promise<boolean> {
  const row = await qGet<{ ok: number }>(
    `SELECT 1 AS ok FROM financial_account WHERE id = ? AND household_id = ?`,
    accountId,
    householdId
  );
  return Boolean(row);
}

export async function updateHouseholdMonthlySavingsTarget(
  householdId: string,
  monthlySavingsTargetUsd: number | null
): Promise<{ ok: true } | { ok: false; code: "INVALID_AMOUNT" }> {
  if (monthlySavingsTargetUsd !== null) {
    if (!Number.isFinite(monthlySavingsTargetUsd) || monthlySavingsTargetUsd < 0) {
      return { ok: false, code: "INVALID_AMOUNT" };
    }
  }
  const value =
    monthlySavingsTargetUsd === null ? null : Math.round(monthlySavingsTargetUsd * 100) / 100;
  await qExec(`UPDATE household SET monthly_savings_target_usd = ? WHERE id = ?`, value, householdId);
  return { ok: true };
}

export type PatchHouseholdSettingsInput = {
  monthlySavingsTargetUsd?: number | null;
  city?: string | null;
  state?: string | null;
  combinedGrossIncomeUsd?: number | null;
};

export type PatchHouseholdSettingsFailure = { ok: false; code: "INVALID_AMOUNT" };

export async function patchHouseholdSettings(
  householdId: string,
  input: PatchHouseholdSettingsInput
): Promise<{ ok: true } | PatchHouseholdSettingsFailure> {
  if (input.monthlySavingsTargetUsd !== undefined) {
    const out = await updateHouseholdMonthlySavingsTarget(householdId, input.monthlySavingsTargetUsd);
    if (!out.ok) {
      return out;
    }
  }

  if (input.city !== undefined) {
    await qExec(`UPDATE household SET city = ? WHERE id = ?`, input.city, householdId);
  }
  if (input.state !== undefined) {
    await qExec(`UPDATE household SET state = ? WHERE id = ?`, input.state, householdId);
  }
  if (input.combinedGrossIncomeUsd !== undefined) {
    if (input.combinedGrossIncomeUsd !== null) {
      if (!Number.isFinite(input.combinedGrossIncomeUsd) || input.combinedGrossIncomeUsd < 0) {
        return { ok: false, code: "INVALID_AMOUNT" };
      }
    }
    const v =
      input.combinedGrossIncomeUsd === null ? null : Math.round(input.combinedGrossIncomeUsd * 100) / 100;
    await qExec(`UPDATE household SET combined_gross_income_usd = ? WHERE id = ?`, v, householdId);
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
  /** Effective age — computed from DOB if set, otherwise the manual age column. */
  age: number | null;
  /** Decrypted YYYY-MM-DD. Only populated for own-profile responses; null otherwise. */
  dateOfBirth: string | null;
  /** True if a DOB has been set. Safe to return for any member. */
  hasDob: boolean;
  sex: "male" | "female" | "nonbinary" | "prefer_not_to_say" | null;
  individualGrossIncomeUsd: number | null;
  riskTolerance: "conservative" | "moderate" | "aggressive" | null;
  financialGoals: string[];
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
  age: number | null;
  date_of_birth_encrypted: string | null;
  sex: string | null;
  individual_gross_income_usd: number | null;
  risk_tolerance: string | null;
  financial_goals_json: string | null;
};

function parseFinancialGoalsJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) {
      return [];
    }
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Map a person_profile row to the API response shape.
 *
 * `revealDob` defaults to `false` so admin/member-list endpoints cannot leak
 * other members' raw DOBs by accident. Only own-profile call sites should
 * pass `true` (see `toOwnProfile`). DOB is decrypted exactly once per call —
 * the result drives both `hasDob`/`age` and (when revealed) `dateOfBirth`.
 */
function toHouseholdMemberProfile(row: MemberProfileRow, revealDob = false): HouseholdMemberProfile {
  const parts = row.full_name.trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  const sexVal = row.sex;
  const validSex =
    sexVal === "male" || sexVal === "female" || sexVal === "nonbinary" || sexVal === "prefer_not_to_say"
      ? sexVal
      : null;
  const rt = row.risk_tolerance;
  const validRt =
    rt === "conservative" || rt === "moderate" || rt === "aggressive" ? rt : null;
  const ig =
    row.individual_gross_income_usd != null && Number.isFinite(Number(row.individual_gross_income_usd))
      ? Math.round(Number(row.individual_gross_income_usd) * 100) / 100
      : null;
  // Effective age: computed from DOB when present (always fresh), manual fallback otherwise.
  const rawDob =
    row.date_of_birth_encrypted != null ? decryptDob(String(row.date_of_birth_encrypted)) : null;
  const computedAge = rawDob != null ? computeAgeFromDob(rawDob) : null;
  const manualAge =
    row.age != null && Number.isFinite(Number(row.age)) ? Number(row.age) : null;
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
    relationship: row.relationship,
    age: computedAge ?? manualAge,
    dateOfBirth: revealDob ? rawDob : null,
    hasDob: rawDob != null,
    sex: validSex,
    individualGrossIncomeUsd: ig,
    riskTolerance: validRt,
    financialGoals: parseFinancialGoalsJson(row.financial_goals_json)
  };
}

/**
 * Same as toHouseholdMemberProfile but reveals the decrypted DOB. Use ONLY for
 * own-profile responses (the authenticated user's own profile). Other members'
 * raw DOBs must never leak through admin/list endpoints.
 */
function toOwnProfile(row: MemberProfileRow): HouseholdMemberProfile {
  return toHouseholdMemberProfile(row, true);
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
  age?: number | null;
  /** YYYY-MM-DD or null. Setting clears manual age; clearing keeps manual age input editable again. */
  dateOfBirth?: string | null;
  sex?: "male" | "female" | "nonbinary" | "prefer_not_to_say" | null;
  individualGrossIncomeUsd?: number | null;
  riskTolerance?: "conservative" | "moderate" | "aggressive" | null;
  financialGoals?: string[];
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
  /** If true, also create an app_user login account with default password. Email is required. */
  createLogin?: boolean;
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

async function ensureCurrentUserProfile(
  householdId: string,
  userId: string,
  role: "owner" | "admin" | "member"
): Promise<HouseholdMemberProfile | null> {
  const existing = await qGet<MemberProfileRow>(
    `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.linked_user_id = ?
  LIMIT 1
`,
    householdId,
    userId
  );
  if (existing) {
    return toOwnProfile(existing);
  }

  const user = await qGet<{ email: string; role: "owner" | "admin" | "member" }>(
    `
  SELECT email, role
  FROM app_user
  WHERE household_id = ? AND id = ?
  LIMIT 1
`,
    householdId,
    userId
  );
  if (!user) {
    return null;
  }

  const profileId = randomUUID();
  const membershipId = randomUUID();
  const membershipRole: HouseholdMemberRole = role === "owner" ? "head" : "member";
  const relationship: HouseholdRelationship = role === "owner" ? "self" : "other";

  try {
    await qBegin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO person_profile (id, household_id, full_name, email, phone_number, avatar_key)
  VALUES ($1, $2, $3, $4, $5, $6)`,
        [profileId, householdId, "", user.email, null, null] as never[]
      );
      await tx.unsafe(
        `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
  VALUES ($1, $2, $3, $4, $5)`,
        [membershipId, householdId, profileId, membershipRole, relationship] as never[]
      );
      await tx.unsafe(`UPDATE person_profile SET linked_user_id = $1 WHERE household_id = $2 AND id = $3`, [
        userId,
        householdId,
        profileId
      ] as never[]);
    });
  } catch (err: unknown) {
    if (!isPgUniqueViolation(err)) {
      throw err;
    }
  }

  const created = await qGet<MemberProfileRow>(
    `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.linked_user_id = ?
  LIMIT 1
`,
    householdId,
    userId
  );
  return created ? toOwnProfile(created) : null;
}

export async function getCurrentUserProfile(
  householdId: string,
  userId: string,
  role: "owner" | "admin" | "member"
): Promise<HouseholdMemberProfile | null> {
  return ensureCurrentUserProfile(householdId, userId, role);
}

export async function patchCurrentUserProfile(
  householdId: string,
  userId: string,
  role: "owner" | "admin" | "member",
  input: PatchProfileInput
): Promise<{ ok: true; profile: HouseholdMemberProfile } | { ok: false; code: "NOT_FOUND" | "EMAIL_CONFLICT" }> {
  const ensured = await ensureCurrentUserProfile(householdId, userId, role);
  const existing = ensured
    ? await qGet<MemberProfileRow>(
        `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.linked_user_id = ?
  LIMIT 1
`,
        householdId,
        userId
      )
    : undefined;
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
    if (id !== null && !(await accountBelongsToHousehold(id, householdId))) {
      return { ok: false, code: "NOT_FOUND" };
    }
    await qExec(
      `UPDATE person_profile SET salary_deposit_financial_account_id = ? WHERE household_id = ? AND linked_user_id = ?`,
      id,
      householdId,
      userId
    );
  }
  if (input.employers !== undefined) {
    for (const e of input.employers) {
      const pid = e.parserProfileId ?? "ibm_pay_contributions_pdf";
      if (!isParserProfileId(pid)) {
        return { ok: false, code: "NOT_FOUND" };
      }
      const sal = e.salaryDepositFinancialAccountId;
      if (sal != null && !(await accountBelongsToHousehold(sal, householdId))) {
        return { ok: false, code: "NOT_FOUND" };
      }
    }
    const normalized: EmployerStub[] = input.employers.map((e) => {
      const pid = e.parserProfileId ?? "ibm_pay_contributions_pdf";
      const stub: EmployerStub = {
        id: e.id?.trim() ? e.id : randomUUID(),
        displayName: e.displayName.trim(),
        parserProfileId: pid,
        parserMapping: e.parserMapping ?? {}
      };
      if (e.salaryDepositFinancialAccountId !== undefined) {
        stub.salaryDepositFinancialAccountId = e.salaryDepositFinancialAccountId;
      }
      return stub;
    });
    const parsed = employersPayloadSchema.safeParse(normalized);
    if (!parsed.success) {
      return { ok: false, code: "NOT_FOUND" };
    }
    await qExec(`UPDATE person_profile SET employers_json = ? WHERE household_id = ? AND linked_user_id = ?`, JSON.stringify(parsed.data), householdId, userId);
    if (input.salaryDepositFinancialAccountId === undefined) {
      const first = parsed.data[0];
      if (first !== undefined && Object.prototype.hasOwnProperty.call(first, "salaryDepositFinancialAccountId")) {
        await qExec(
          `UPDATE person_profile SET salary_deposit_financial_account_id = ? WHERE household_id = ? AND linked_user_id = ?`,
          first.salaryDepositFinancialAccountId ?? null,
          householdId,
          userId
        );
      }
    }
  }

  if (input.age !== undefined) {
    await qExec(`UPDATE person_profile SET age = ? WHERE household_id = ? AND linked_user_id = ?`, input.age, householdId, userId);
  }
  if (input.dateOfBirth !== undefined) {
    if (input.dateOfBirth === null) {
      // Clear DOB — manual age becomes editable again.
      await qExec(
        `UPDATE person_profile SET date_of_birth_encrypted = NULL WHERE household_id = ? AND linked_user_id = ?`,
        householdId,
        userId
      );
    } else {
      // Set DOB — encrypt and store; clear manual age (computed age replaces it).
      const encrypted = encryptDob(input.dateOfBirth);
      await qExec(
        `UPDATE person_profile SET date_of_birth_encrypted = ?, age = NULL WHERE household_id = ? AND linked_user_id = ?`,
        encrypted,
        householdId,
        userId
      );
    }
  }
  if (input.sex !== undefined) {
    await qExec(`UPDATE person_profile SET sex = ? WHERE household_id = ? AND linked_user_id = ?`, input.sex, householdId, userId);
  }
  if (input.individualGrossIncomeUsd !== undefined) {
    const v =
      input.individualGrossIncomeUsd === null
        ? null
        : Math.round(input.individualGrossIncomeUsd * 100) / 100;
    await qExec(
      `UPDATE person_profile SET individual_gross_income_usd = ? WHERE household_id = ? AND linked_user_id = ?`,
      v,
      householdId,
      userId
    );
  }
  if (input.riskTolerance !== undefined) {
    await qExec(
      `UPDATE person_profile SET risk_tolerance = ? WHERE household_id = ? AND linked_user_id = ?`,
      input.riskTolerance,
      householdId,
      userId
    );
  }
  if (input.financialGoals !== undefined) {
    await qExec(
      `UPDATE person_profile SET financial_goals_json = ? WHERE household_id = ? AND linked_user_id = ?`,
      JSON.stringify(input.financialGoals),
      householdId,
      userId
    );
  }

  const nextPhone = input.phoneNumber !== undefined ? input.phoneNumber : existing.phone_number;
  const nextAvatar = input.avatarKey !== undefined ? input.avatarKey : existing.avatar_key;

  try {
    await qBegin(async (tx) => {
      await tx.unsafe(
        `UPDATE person_profile
  SET full_name = $1, email = $2, phone_number = $3, avatar_key = $4
  WHERE household_id = $5 AND id = $6`,
        [nextFullName, nextEmail, nextPhone, nextAvatar, householdId, existing.id] as never[]
      );
      if (input.email !== undefined && existing.linked_user_id && nextEmail !== null) {
        await tx.unsafe(`UPDATE app_user SET email = $1 WHERE id = $2`, [nextEmail, existing.linked_user_id] as never[]);
      }
    });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return { ok: false, code: "EMAIL_CONFLICT" };
    }
    throw err;
  }

  const updated = await qGet<MemberProfileRow>(
    `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.id = ?
  LIMIT 1
`,
    householdId,
    existing.id
  );
  if (!updated) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true, profile: toOwnProfile(updated) };
}

export async function listHouseholdMembers(householdId: string): Promise<HouseholdMemberProfile[]> {
  const rows = await qAll<MemberProfileRow>(
    `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM household_membership m
  JOIN person_profile p
    ON p.id = m.person_profile_id
   AND p.household_id = m.household_id
  WHERE m.household_id = ?
  ORDER BY p.created_at ASC, p.id ASC
`,
    householdId
  );
  return rows.map((row) => toHouseholdMemberProfile(row));
}

const DEFAULT_MEMBER_PASSWORD = "ChangeMe123!";

export async function createHouseholdMember(
  householdId: string,
  input: CreateMemberInput
): Promise<
  { ok: true; member: HouseholdMemberProfile; inviteSent: boolean } | { ok: false; code: "EMAIL_CONFLICT" | "EMAIL_REQUIRED" }
> {
  const profileId = randomUUID();
  const membershipId = randomUUID();
  const email = input.email ?? null;
  const phoneNumber = input.phoneNumber ?? null;
  const avatarKey = input.avatarKey ?? null;

  if (input.createLogin && !email?.trim()) {
    return { ok: false, code: "EMAIL_REQUIRED" };
  }

  const fullName =
    input.fullName?.trim() ||
    [input.firstName?.trim() ?? "", input.lastName?.trim() ?? ""].filter(Boolean).join(" ").trim();

  const userId = input.createLogin ? randomUUID() : null;
  const emailConfigured = isEmailConfigured();
  const useInviteFlow = Boolean(input.createLogin && emailConfigured);
  const passwordHash = input.createLogin
    ? useInviteFlow
      ? await bcrypt.hash(randomUUID(), 12)
      : await bcrypt.hash(DEFAULT_MEMBER_PASSWORD, 12)
    : null;

  try {
    await qBegin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO person_profile (id, household_id, full_name, email, phone_number, avatar_key)
  VALUES ($1, $2, $3, $4, $5, $6)`,
        [profileId, householdId, fullName, email, phoneNumber, avatarKey] as never[]
      );
      await tx.unsafe(
        `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
  VALUES ($1, $2, $3, $4, $5)`,
        [membershipId, householdId, profileId, input.role, input.relationship] as never[]
      );
      if (userId && passwordHash) {
        await tx.unsafe(
          `INSERT INTO app_user (id, household_id, email, role, password_hash, force_password_change)
  VALUES ($1, $2, $3, 'member', $4, true)`,
          [userId, householdId, email, passwordHash] as never[]
        );
        await tx.unsafe(
          `UPDATE person_profile SET linked_user_id = $1 WHERE id = $2`,
          [userId, profileId] as never[]
        );
      }
    });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return { ok: false, code: "EMAIL_CONFLICT" };
    }
    throw err;
  }

  const created = await qGet<MemberProfileRow>(
    `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.id = ?
  LIMIT 1
`,
    householdId,
    profileId
  );
  if (!created) {
    throw new Error("Created member could not be loaded");
  }
  if (userId && useInviteFlow) {
    const rawToken = await createPasswordResetToken(userId, 24);
    const resetLink = `${env.PUBLIC_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
    void sendMail({
      to: email!,
      ...renderMemberInviteTemplate({ resetLink })
    });
  }
  return { ok: true, member: toHouseholdMemberProfile(created), inviteSent: Boolean(userId && useInviteFlow) };
}

export async function patchHouseholdMember(
  householdId: string,
  memberId: string,
  input: PatchMemberInput
): Promise<{ ok: true; member: HouseholdMemberProfile } | { ok: false; code: "NOT_FOUND" | "EMAIL_CONFLICT" }> {
  const existing = await qGet<MemberProfileRow>(
    `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.id = ?
  LIMIT 1
`,
    householdId,
    memberId
  );
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
    await qBegin(async (tx) => {
      await tx.unsafe(
        `UPDATE person_profile
  SET full_name = $1, email = $2, phone_number = $3, avatar_key = $4
  WHERE household_id = $5 AND id = $6`,
        [nextFullName, nextEmail, nextPhone, nextAvatar, householdId, memberId] as never[]
      );
      await tx.unsafe(
        `UPDATE household_membership
  SET role = $1, relationship = $2
  WHERE household_id = $3 AND person_profile_id = $4`,
        [nextRole, nextRelationship, householdId, memberId] as never[]
      );
      if (input.email !== undefined && existing.linked_user_id && nextEmail !== null) {
        await tx.unsafe(`UPDATE app_user SET email = $1 WHERE id = $2`, [nextEmail, existing.linked_user_id] as never[]);
      }
    });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return { ok: false, code: "EMAIL_CONFLICT" };
    }
    throw err;
  }

  const updated = await qGet<MemberProfileRow>(
    `
  SELECT p.id, p.household_id, p.linked_user_id, p.full_name, p.email, p.phone_number, p.avatar_key, m.role, m.relationship,
         p.age, p.date_of_birth_encrypted, p.sex, p.individual_gross_income_usd, p.risk_tolerance, p.financial_goals_json
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.id = ?
  LIMIT 1
`,
    householdId,
    memberId
  );
  if (!updated) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true, member: toHouseholdMemberProfile(updated) };
}

export async function getHouseholdMemberDataCount(
  householdId: string,
  memberId: string
): Promise<{ transactions: number; payslips: number }> {
  const txRow = await qGet<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM transaction_canonical
     WHERE household_id = ? AND owner_scope = 'person' AND owner_person_profile_id = ?`,
    householdId,
    memberId
  );
  const psRow = await qGet<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM payslip_snapshot
     WHERE household_id = ? AND owner_scope = 'person' AND owner_person_profile_id = ?`,
    householdId,
    memberId
  );
  return {
    transactions: Number(txRow?.cnt ?? 0),
    payslips: Number(psRow?.cnt ?? 0)
  };
}

export async function deleteHouseholdMember(
  householdId: string,
  memberId: string,
  opts: { deleteLogin?: boolean } = {}
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "HAS_LOGIN_ACCOUNT" }> {
  const existing = await qGet<{ id: string; linked_user_id: string | null }>(
    `
  SELECT p.id, p.linked_user_id
  FROM person_profile p
  JOIN household_membership m
    ON m.person_profile_id = p.id
   AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.id = ?
  LIMIT 1
`,
    householdId,
    memberId
  );
  if (!existing) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (existing.linked_user_id && !opts.deleteLogin) {
    return { ok: false, code: "HAS_LOGIN_ACCOUNT" };
  }
  await qBegin(async (tx) => {
    await tx.unsafe(`DELETE FROM household_membership WHERE household_id = $1 AND person_profile_id = $2`, [
      householdId,
      memberId
    ] as never[]);
    await tx.unsafe(`DELETE FROM person_profile WHERE household_id = $1 AND id = $2`, [
      householdId,
      memberId
    ] as never[]);
    if (opts.deleteLogin && existing.linked_user_id) {
      await tx.unsafe(`DELETE FROM app_user WHERE id = $1 AND household_id = $2`, [
        existing.linked_user_id,
        householdId
      ] as never[]);
    }
  });
  return { ok: true };
}

export async function createLoginForMember(
  householdId: string,
  memberId: string
): Promise<
  { ok: true; inviteSent: boolean } | { ok: false; code: "NOT_FOUND" | "ALREADY_HAS_LOGIN" | "EMAIL_REQUIRED" | "EMAIL_CONFLICT" }
> {
  const existing = await qGet<{ id: string; linked_user_id: string | null; email: string | null }>(
    `
  SELECT p.id, p.linked_user_id, p.email
  FROM person_profile p
  JOIN household_membership m ON m.person_profile_id = p.id AND m.household_id = p.household_id
  WHERE p.household_id = ? AND p.id = ?
  LIMIT 1
`,
    householdId,
    memberId
  );
  if (!existing) return { ok: false, code: "NOT_FOUND" };
  if (existing.linked_user_id) return { ok: false, code: "ALREADY_HAS_LOGIN" };
  if (!existing.email?.trim()) return { ok: false, code: "EMAIL_REQUIRED" };

  const userId = randomUUID();
  const inviteEnabled = isEmailConfigured();
  const passwordHash = inviteEnabled
    ? await bcrypt.hash(randomUUID(), 12)
    : await bcrypt.hash(DEFAULT_MEMBER_PASSWORD, 12);
  try {
    await qBegin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO app_user (id, household_id, email, role, password_hash, force_password_change)
  VALUES ($1, $2, $3, 'member', $4, true)`,
        [userId, householdId, existing.email, passwordHash] as never[]
      );
      await tx.unsafe(`UPDATE person_profile SET linked_user_id = $1 WHERE household_id = $2 AND id = $3`, [
        userId,
        householdId,
        memberId
      ] as never[]);
    });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) return { ok: false, code: "EMAIL_CONFLICT" };
    throw err;
  }
  if (inviteEnabled) {
    const rawToken = await createPasswordResetToken(userId, 24);
    const resetLink = `${env.PUBLIC_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
    void sendMail({
      to: existing.email,
      ...renderMemberInviteTemplate({ resetLink })
    });
  }
  return { ok: true, inviteSent: inviteEnabled };
}

/**
 * Generate a random temporary password: 3 groups of 4 alphanumeric chars joined by '-'.
 * e.g. "aB3x-Kp7z-M2wQ". Satisfies the strength regex (upper+lower+digit+special via '-').
 */
function generateTempPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from(randomBytes(4), (b) => chars[b % chars.length]).join("");
  let pw: string;
  do {
    pw = `${pick()}-${pick()}-${pick()}`;
  } while (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw));
  return pw;
}

export async function resetMemberPassword(
  householdId: string,
  memberId: string
): Promise<
  | { ok: true; emailSent: true }
  | { ok: true; emailSent: false; tempPassword: string }
  | { ok: false; code: "NOT_FOUND" | "NO_LOGIN" }
> {
  const row = await qGet<{ linked_user_id: string | null; login_email: string | null }>(
    `SELECT p.linked_user_id, u.email AS login_email
     FROM person_profile p
     LEFT JOIN app_user u ON u.id = p.linked_user_id AND u.household_id = p.household_id
     WHERE p.household_id = ? AND p.id = ?
     LIMIT 1`,
    householdId,
    memberId
  );
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (!row.linked_user_id) return { ok: false, code: "NO_LOGIN" };
  if (!row.login_email?.trim()) return { ok: false, code: "NO_LOGIN" };
  const emailConfigured = isEmailConfigured();

  if (emailConfigured) {
    await qExec(
      `UPDATE app_user
       SET token_version = token_version + 1
       WHERE id = ? AND household_id = ?`,
      row.linked_user_id,
      householdId
    );
    const rawToken = await createPasswordResetToken(row.linked_user_id, 1);
    const resetLink = `${env.PUBLIC_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
    void sendMail({
      to: row.login_email,
      ...renderPasswordResetTemplate({ resetLink })
    });
    return { ok: true, emailSent: true };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await qExec(
    `UPDATE app_user
     SET password_hash = ?, force_password_change = true, token_version = token_version + 1
     WHERE id = ? AND household_id = ?`,
    passwordHash,
    row.linked_user_id,
    householdId
  );
  return { ok: true, emailSent: false, tempPassword };
}
