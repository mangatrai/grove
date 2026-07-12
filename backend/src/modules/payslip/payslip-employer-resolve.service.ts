import { getHouseholdSettings, getEmployersByPersonProfileId, findEmployerAcrossHousehold } from "../household/household.service.js";
export { findEmployerAcrossHousehold };
import type { EmployerStub } from "../household/household.types.js";
import { IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID } from "./payslip.types.js";

/** Employers are stored on the signed-in user’s `person_profile` (Epic 12.5). */
export async function listHouseholdEmployers(householdId: string, userId: string): Promise<EmployerStub[]> {
  const settings = await getHouseholdSettings(householdId, userId);
  return settings?.employers ?? [];
}

export async function findEmployerById(
  householdId: string,
  employerId: string,
  userId: string
): Promise<EmployerStub | null> {
  const employers = await listHouseholdEmployers(householdId, userId);
  return employers.find((e) => e.id === employerId) ?? null;
}

/** Look up an employer by the owner’s person_profile.id — used when Head imports on behalf of a member. */
export async function findEmployerByPersonProfileId(
  householdId: string,
  employerId: string,
  personProfileId: string
): Promise<EmployerStub | null> {
  const employers = await getEmployersByPersonProfileId(householdId, personProfileId);
  return employers.find((e) => e.id === employerId) ?? null;
}

export function employerParserProfileId(e: EmployerStub): string {
  return e.parserProfileId?.trim() || IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
}

/** Label for the household `payslip` import bucket row — driven by Profile → Employer Setup, not a fixed IBM string. */
export function payslipBucketInstitutionFromEmployers(employers: EmployerStub[]): string {
  const names = employers.map((e) => e.displayName.trim()).filter(Boolean);
  if (names.length === 0) {
    return "Employer payslips — add employer name(s) above";
  }
  if (names.length === 1) {
    return `Payslip — ${names[0]}`;
  }
  return `Payslip — ${names[0]!} (+${names.length - 1} more)`;
}

/**
 * Direct payslip upload: which parser + employer row to attach.
 * - 0 employers → IBM, no employer_id
 * - 1 employer → that employer’s parser + id (no dropdown required)
 * - 2+ employers → `employerId` body field required
 *
 * When `ownerPersonProfileId` is provided (Head importing on behalf of a member), employers are
 * read from that profile’s `employers_json` rather than from the session user’s profile.
 */
export async function resolvePayslipUploadContext(
  householdId: string,
  userId: string,
  employerIdRaw: string | undefined,
  ownerPersonProfileId?: string | null
): Promise<
  | { ok: true; parserProfileId: string; employerId: string | null }
  | { ok: false; code: "EMPLOYER_REQUIRED" | "INVALID_EMPLOYER"; message: string }
> {
  const employers = ownerPersonProfileId
    ? await getEmployersByPersonProfileId(householdId, ownerPersonProfileId)
    : await listHouseholdEmployers(householdId, userId);
  const trimmed = employerIdRaw?.trim();

  if (employers.length === 0) {
    return { ok: true, parserProfileId: IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID, employerId: null };
  }

  if (!trimmed) {
    if (employers.length === 1) {
      const e = employers[0]!;
      return { ok: true, parserProfileId: employerParserProfileId(e), employerId: e.id };
    }
    return {
      ok: false,
      code: "EMPLOYER_REQUIRED",
      message: "Multiple employers are configured — choose which employer this payslip is from."
    };
  }

  const employer = ownerPersonProfileId
    ? await findEmployerByPersonProfileId(householdId, trimmed, ownerPersonProfileId)
    : await findEmployerById(householdId, trimmed, userId);
  if (!employer) {
    return { ok: false, code: "INVALID_EMPLOYER", message: "Employer not found in household settings" };
  }

  return { ok: true, parserProfileId: employerParserProfileId(employer), employerId: employer.id };
}
