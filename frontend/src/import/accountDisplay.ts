type AccountRow = {
  institution: string;
  type: string;
  account_mask: string | null;
  last_uploaded_at?: string | null;
  last_statement_end_date?: string | null;
};

/** Extract last 4 digits from mask (digits only). Requires at least 4 digit chars total. */
function lastFourFromMask(mask: string | null | undefined): string | null {
  if (!mask?.trim()) {
    return null;
  }
  const digits = mask.replace(/\D/g, "");
  if (digits.length >= 4) {
    return digits.slice(-4);
  }
  return null;
}

/** e.g. "Bank of America — savings ****2002" */
export function formatAccountForSelect(a: AccountRow): string {
  if (a.type === "payslip") {
    return a.institution;
  }
  const last4 = lastFourFromMask(a.account_mask);
  const suffix = last4 ? ` ****${last4}` : "";
  const typeLabel = a.type.replace(/_/g, " ");
  return `${a.institution} — ${typeLabel}${suffix}`;
}

function formatShortDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatAccountFreshness(a: AccountRow): { lastUpload: string; statementEnding: string } {
  const lastUpload = formatShortDate(a.last_uploaded_at ?? null) ?? "Never";
  const statementEnding = formatShortDate(a.last_statement_end_date ?? null) ?? "Not detected";
  return { lastUpload, statementEnding };
}
