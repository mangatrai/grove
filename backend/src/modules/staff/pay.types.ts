export type StaffPayAdjustment = {
  id: string;
  householdId: string;
  staffProfileId: string;
  adjustmentDate: string;
  amountCents: number;
  reason: string;
  createdByUserId: string | null;
  createdAt: string;
};

export type StaffPayAdjustmentInput = {
  adjustmentDate: string;
  amountCents: number;
  reason: string;
};

export type PaySummary = {
  staffProfileId: string;
  from: string;
  to: string;
  earned: {
    timesheetCents: number;
    expenseCents: number;
    adjustmentCents: number;
    totalCents: number;
  };
  paid: {
    salaryCents: number;
    bonusCents: number;
    reimbursementCents: number;
    totalCents: number;
  };
  balanceDueCents: number;
  adjustments: StaffPayAdjustment[];
};
