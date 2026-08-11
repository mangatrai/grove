import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

import { isPgUniqueViolation, qAll, qBegin, qExec, qGet } from "../../db/query.js";
import { env } from "../../config/env.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { createPasswordResetToken } from "../auth/auth.service.js";
import { isEmailConfigured, sendMail } from "../mailer/mailer.service.js";
import { renderMemberInviteTemplate } from "../mailer/templates/member-invite.js";
import { createHouseholdCategory } from "../category/categories.service.js";
import { encryptDob } from "../household/dob-crypto.js";
import { createAvailability } from "../family/family-profiles.service.js";
import type {
  CreateStaffMemberInput,
  EmployeeCategoryIds,
  StaffProfile,
  UpdateStaffMemberInput
} from "./staff.types.js";

type StaffProfileRow = {
  id: string;
  household_id: string;
  person_profile_id: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  employment_start_date: string;
  is_active: boolean;
  linked_user_id: string | null;
  hourly_rate_cents: number | null;
};

function toStaffProfile(row: StaffProfileRow): StaffProfile {
  return {
    id: row.id,
    householdId: row.household_id,
    personProfileId: row.person_profile_id,
    fullName: row.full_name,
    email: row.email,
    phoneNumber: row.phone_number,
    employmentStartDate: row.employment_start_date,
    isActive: row.is_active,
    hourlyRateCents: row.hourly_rate_cents ?? 0,
    hasLogin: row.linked_user_id !== null
  };
}

const STAFF_PROFILE_SELECT = `
  SELECT sp.id, sp.household_id, sp.person_profile_id, p.full_name, p.email, p.phone_number,
         sp.employment_start_date, sp.is_active, p.linked_user_id,
         (SELECT r.hourly_rate_cents FROM staff_rate r
           WHERE r.staff_profile_id = sp.id AND r.effective_date <= to_char(NOW(), 'YYYY-MM-DD')
           ORDER BY r.effective_date DESC LIMIT 1) AS hourly_rate_cents
  FROM staff_profile sp
  JOIN person_profile p ON p.id = sp.person_profile_id
`;

export async function listStaffMembers(householdId: string): Promise<StaffProfile[]> {
  const rows = await qAll<StaffProfileRow>(
    `${STAFF_PROFILE_SELECT} WHERE sp.household_id = ? ORDER BY p.full_name`,
    householdId
  );
  return rows.map(toStaffProfile);
}

export async function getStaffMemberById(householdId: string, staffProfileId: string): Promise<StaffProfile | undefined> {
  const row = await qGet<StaffProfileRow>(
    `${STAFF_PROFILE_SELECT} WHERE sp.household_id = ? AND sp.id = ?`,
    householdId,
    staffProfileId
  );
  return row ? toStaffProfile(row) : undefined;
}

export async function getStaffMemberForUser(householdId: string, personProfileId: string): Promise<StaffProfile | undefined> {
  const row = await qGet<StaffProfileRow>(
    `${STAFF_PROFILE_SELECT} WHERE sp.household_id = ? AND sp.person_profile_id = ?`,
    householdId,
    personProfileId
  );
  return row ? toStaffProfile(row) : undefined;
}

/** Idempotently ensures the household-scoped "Employee" category tree exists (Salary/Bonus/Reimbursement). */
export async function ensureEmployeeCategoryTree(
  householdId: string,
  createdByUserId: string
): Promise<EmployeeCategoryIds> {
  async function findOrCreate(name: string, parentId: string | null): Promise<string> {
    const existing = await qGet<{ id: string }>(
      parentId === null
        ? `SELECT id FROM category WHERE household_id = ? AND name = ? AND parent_id IS NULL LIMIT 1`
        : `SELECT id FROM category WHERE household_id = ? AND name = ? AND parent_id = ? LIMIT 1`,
      ...(parentId === null ? [householdId, name] : [householdId, name, parentId])
    );
    if (existing) {
      return existing.id;
    }
    const created = await createHouseholdCategory(householdId, name, parentId, createdByUserId);
    if (!created.ok) {
      throw new Error(`Failed to create category "${name}": ${created.code}`);
    }
    return created.data.id;
  }

  const employeeId = await findOrCreate("Employee", null);
  const [salaryCategoryId, bonusCategoryId, reimbursementCategoryId] = await Promise.all([
    findOrCreate("Salary", employeeId),
    findOrCreate("Bonus", employeeId),
    findOrCreate("Reimbursement", employeeId)
  ]);
  return { salaryCategoryId, bonusCategoryId, reimbursementCategoryId };
}

const DEFAULT_STAFF_PASSWORD = "ChangeMe123!";

export async function createStaffMember(
  householdId: string,
  createdByUserId: string,
  input: CreateStaffMemberInput
): Promise<
  { ok: true; member: StaffProfile; inviteSent: boolean } | { ok: false; code: "EMAIL_CONFLICT" | "EMAIL_REQUIRED" }
> {
  const email = input.email.trim();
  if (!email) {
    return { ok: false, code: "EMAIL_REQUIRED" };
  }

  const profileId = randomUUID();
  const membershipId = randomUUID();
  const staffProfileId = randomUUID();
  const staffRateId = randomUUID();
  const userId = randomUUID();
  const fullName = [input.firstName.trim(), input.lastName?.trim() ?? ""].filter(Boolean).join(" ").trim();
  const phoneNumber = input.phoneNumber ?? null;
  const dobEncrypted = input.dateOfBirth ? encryptDob(input.dateOfBirth) : null;
  const emailConfigured = isEmailConfigured();
  const passwordHash = emailConfigured
    ? await bcrypt.hash(randomUUID(), 12)
    : await bcrypt.hash(DEFAULT_STAFF_PASSWORD, 12);

  try {
    await qBegin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO person_profile (id, household_id, full_name, email, phone_number, date_of_birth_encrypted)
  VALUES ($1, $2, $3, $4, $5, $6)`,
        [profileId, householdId, fullName, email, phoneNumber, dobEncrypted] as never[]
      );
      await tx.unsafe(
        `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
  VALUES ($1, $2, $3, 'member', 'employee')`,
        [membershipId, householdId, profileId] as never[]
      );
      await tx.unsafe(
        `INSERT INTO app_user (id, household_id, email, role, password_hash, force_password_change)
  VALUES ($1, $2, $3, 'staff', $4, true)`,
        [userId, householdId, email, passwordHash] as never[]
      );
      await tx.unsafe(`UPDATE person_profile SET linked_user_id = $1 WHERE id = $2`, [userId, profileId] as never[]);
      await tx.unsafe(
        `INSERT INTO staff_profile (id, household_id, person_profile_id, employment_start_date)
  VALUES ($1, $2, $3, $4)`,
        [staffProfileId, householdId, profileId, input.employmentStartDate] as never[]
      );
      await tx.unsafe(
        `INSERT INTO staff_rate (id, household_id, staff_profile_id, hourly_rate_cents, effective_date)
  VALUES ($1, $2, $3, $4, $5)`,
        [staffRateId, householdId, staffProfileId, input.hourlyRateCents, input.employmentStartDate] as never[]
      );
    });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return { ok: false, code: "EMAIL_CONFLICT" };
    }
    throw err;
  }

  await ensureEmployeeCategoryTree(householdId, createdByUserId);

  if (input.schedule && input.schedule.daysOfWeek.length > 0) {
    await createAvailability(householdId, {
      personProfileId: profileId,
      slotType: "regular",
      serviceType: "nanny",
      daysOfWeek: input.schedule.daysOfWeek,
      startTime: input.schedule.startTime,
      endTime: input.schedule.endTime
    });
  }

  const created = await getStaffMemberById(householdId, staffProfileId);
  if (!created) {
    throw new Error("Created staff member could not be loaded");
  }

  const inviteSent = emailConfigured;
  if (inviteSent) {
    const rawToken = await createPasswordResetToken(userId, 24);
    const resetLink = `${env.PUBLIC_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
    void sendMail({
      to: email,
      ...renderMemberInviteTemplate({ resetLink })
    });
  }

  return { ok: true, member: created, inviteSent };
}

export async function updateStaffMember(
  householdId: string,
  staffProfileId: string,
  input: UpdateStaffMemberInput
): Promise<{ ok: true; member: StaffProfile } | { ok: false; code: "NOT_FOUND" }> {
  const existing = await getStaffMemberById(householdId, staffProfileId);
  if (!existing) {
    return { ok: false, code: "NOT_FOUND" };
  }

  if (input.isActive !== undefined) {
    await qExec(
      `UPDATE staff_profile SET is_active = ? WHERE household_id = ? AND id = ?`,
      input.isActive,
      householdId,
      staffProfileId
    );
  }
  if (input.newHourlyRateCents !== undefined && input.newRateEffectiveDate) {
    await qExec(
      `INSERT INTO staff_rate (id, household_id, staff_profile_id, hourly_rate_cents, effective_date) VALUES (?, ?, ?, ?, ?)`,
      randomUUID(),
      householdId,
      staffProfileId,
      input.newHourlyRateCents,
      input.newRateEffectiveDate
    );
  }

  const updated = await getStaffMemberById(householdId, staffProfileId);
  return { ok: true, member: updated! };
}

/**
 * Staff callers are always locked to their own record (staffId, if given, must match).
 * Owner/admin callers must supply staffId and may select any household staff member.
 * Returns null on access denial.
 */
export async function resolveAccessibleStaffMember(req: AuthenticatedRequest, staffId?: string): Promise<StaffProfile | null> {
  const { householdId, role, personProfileId } = req.authUser!;
  if (role === "staff") {
    if (!personProfileId) return null;
    const own = await getStaffMemberForUser(householdId, personProfileId);
    if (!own) return null;
    if (staffId && staffId !== own.id) return null;
    return own;
  }
  if (!staffId) return null;
  const member = await getStaffMemberById(householdId, staffId);
  return member ?? null;
}
