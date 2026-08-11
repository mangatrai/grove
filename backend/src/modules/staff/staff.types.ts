export type StaffProfile = {
  id: string;
  householdId: string;
  personProfileId: string;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  employmentStartDate: string;
  isActive: boolean;
  hourlyRateCents: number;
  hasLogin: boolean;
};

/** Regular weekly schedule collected at onboarding; persisted as a household_help_availability slot (slot_type='regular'), not on staff_profile. */
export type StaffScheduleInput = {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
};

export type CreateStaffMemberInput = {
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber?: string | null;
  dateOfBirth?: string | null;
  employmentStartDate: string;
  schedule?: StaffScheduleInput | null;
  hourlyRateCents: number;
};

export type UpdateStaffMemberInput = {
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
