export type PaySummary = {
  staffProfileId: string;
  from: string;
  to: string;
  earned: {
    timesheetCents: number;
    expenseCents: number;
    totalCents: number;
  };
  paid: {
    salaryCents: number;
    bonusCents: number;
    reimbursementCents: number;
    totalCents: number;
  };
  balanceDueCents: number;
};
