import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import type { AuthUser, Role } from "./types.js";

interface InMemoryUser extends AuthUser {
  email: string;
  passwordHash: string;
}

const seededUsers: InMemoryUser[] = [];

function ensureSeededUser(): void {
  if (seededUsers.length > 0) {
    return;
  }

  const passwordHash = bcrypt.hashSync(env.SEED_OWNER_PASSWORD, 10);
  seededUsers.push({
    userId: "seed-owner-1",
    householdId: "seed-household-1",
    role: "owner",
    email: env.SEED_OWNER_EMAIL,
    passwordHash
  });
}

export interface LoginPayload {
  email: string;
  password: string;
}

export function login(payload: LoginPayload): string | null {
  ensureSeededUser();

  const user = seededUsers.find((candidate) => candidate.email === payload.email);
  if (!user) {
    return null;
  }

  const isValid = bcrypt.compareSync(payload.password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  return jwt.sign(
    {
      sub: user.userId,
      householdId: user.householdId,
      role: user.role
    },
    env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      sub: string;
      householdId: string;
      role: Role;
    };

    return {
      userId: payload.sub,
      householdId: payload.householdId,
      role: payload.role
    };
  } catch {
    return null;
  }
}
