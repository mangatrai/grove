export type Role = "owner" | "admin" | "member";

export interface AuthUser {
  userId: string;
  householdId: string;
  role: Role;
}
