import { getHouseholdSettings } from "../household/household.service.js";
import type { EmployerStub } from "../household/household.types.js";
import { IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID } from "./payslip.types.js";

/** Employers are stored on the signed-in user’s `person_profile` (Epic 12.5). */
export function listHouseholdEmployers(householdId: string, userId: string): EmployerStub[] {
  return getHouseholdSettings(householdId, userId)?.employers ?? [];
}

export function findEmployerById(
  householdId: string,
  employerId: string,
  userId: string
): EmployerStub | null {
  return listHouseholdEmployers(householdId, userId).find((e) => e.id === employerId) ?? null;
}

export function employerParserProfileId(e: EmployerStub): string {
  return e.parserProfileId?.trim() || IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
}

/**
 * Direct payslip upload: which parser + employer row to attach.
 * - 0 employers → IBM, no employer_id
 * - 1 employer → that employer’s parser + id (no dropdown required)
 * - 2+ employers → `employerId` body field required
 */
export function resolvePayslipUploadContext(
  householdId: string,
  userId: string,
  employerIdRaw: string | undefined
):
  | { ok: true; parserProfileId: string; employerId: string | null }
  | { ok: false; code: "EMPLOYER_REQUIRED" | "INVALID_EMPLOYER"; message: string } {
  const employers = listHouseholdEmployers(householdId, userId);
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

  const employer = findEmployerById(householdId, trimmed, userId);
  if (!employer) {
    return { ok: false, code: "INVALID_EMPLOYER", message: "Employer not found in household settings" };
  }

  return { ok: true, parserProfileId: employerParserProfileId(employer), employerId: employer.id };
}

/** Import parse when `import_file.employer_id` is null: require explicit employer if multiple configured. */
export function requireEmployerForPayslipImport(
  householdId: string,
  userId: string,
  employerId: string | null | undefined
): boolean {
  return listHouseholdEmployers(householdId, userId).length <= 1 || Boolean(employerId?.trim());
}
