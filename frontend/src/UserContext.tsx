import { createContext, useContext } from "react";

export interface UserContextValue {
  /** The authenticated user's role, or null if not yet loaded. */
  role: string | null;
  /** The authenticated user's linked person_profile.id, or null if not yet loaded or not linked. */
  personProfileId: string | null;
}

export const UserContext = createContext<UserContextValue>({ role: null, personProfileId: null });

export function useCurrentUser(): UserContextValue {
  return useContext(UserContext);
}
