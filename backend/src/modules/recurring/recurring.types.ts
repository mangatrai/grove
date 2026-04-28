export interface RecurringOverride {
  id: string;
  householdId: string;
  merchantKey: string;
  displayName: string | null;
  verdict: "confirmed" | "dismissed";
  amountAnchor: number | null;
  amountTolerancePct: number;
  taggedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
