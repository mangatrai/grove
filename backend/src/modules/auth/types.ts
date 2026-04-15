export type Role = "owner" | "admin" | "member";

export interface AuthUser {
  userId: string;
  householdId: string;
  role: Role;
  /** Linked person_profile.id for this user, or null if none exists. Always resolved fresh from DB on each request — not stored in the JWT. */
  personProfileId: string | null;
}
