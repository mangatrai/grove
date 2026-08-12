export type TimesheetPeriodStatus = "draft" | "submitted" | "approved" | "rejected";

export type TimesheetEntryInput = {
  workDate: string;
  hoursWorked: number;
  note?: string | null;
};

export type TimesheetEntry = {
  id: string;
  workDate: string;
  hoursWorked: number;
  note: string | null;
};

export type TimesheetPeriod = {
  id: string;
  householdId: string;
  staffProfileId: string;
  weekStartDate: string;
  status: TimesheetPeriodStatus;
  submittedAt: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  entries: TimesheetEntry[];
  totalHours: number;
};

export type TimesheetPeriodSummary = {
  id: string;
  staffProfileId: string;
  staffFullName: string;
  weekStartDate: string;
  status: TimesheetPeriodStatus;
  submittedAt: string | null;
  totalHours: number;
};
