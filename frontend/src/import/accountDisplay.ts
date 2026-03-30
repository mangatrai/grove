type AccountRow = {
  institution: string;
  type: string;
  account_mask: string | null;
};

/** Extract last 4 digits from mask (digits only). Requires at least 4 digit chars total. */
export function lastFourFromMask(mask: string | null | undefined): string | null {
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
