export type RegularScheduleJson = Record<string, number>;

export type StaffProfile = {
  id: string;
  householdId: string;
  personProfileId: string;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  employmentStartDate: string;
  regularScheduleJson: RegularScheduleJson;
  isActive: boolean;
  hourlyRateCents: number;
  hasLogin: boolean;
};

export type CreateStaffMemberInput = {
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber?: string | null;
  dateOfBirth?: string | null;
  employmentStartDate: string;
  regularScheduleJson?: RegularScheduleJson;
  hourlyRateCents: number;
};

export type UpdateStaffMemberInput = {
  regularScheduleJson?: RegularScheduleJson;
  isActive?: boolean;
  /** Effective-dated: inserts a new staff_rate row rather than mutating history. */
  newHourlyRateCents?: number;
  newRateEffectiveDate?: string;
};

export type EmployeeCategoryIds = {
  salaryCategoryId: string;
  bonusCategoryId: string;
  reimbursementCategoryId: string;
};
