import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { qExec, qGet } from "../../db/query.js";
import { env } from "../../config/env.js";
import type { AuthUser, Role } from "./types.js";

interface DbLoginUser extends AuthUser {
  email: string;
  passwordHash: string;
  tokenVersion: number;
}

async function findUserByEmail(email: string): Promise<DbLoginUser | null> {
  const row = await qGet<{
    id: string;
    household_id: string;
    role: Role;
    email: string;
    password_hash: string;
    token_version: number;
  }>(
    `
  SELECT id, household_id, role, email, password_hash, token_version
  FROM app_user
  WHERE lower(email) = lower(?)
  LIMIT 1
`,
    email
  );
  if (!row) {
    return null;
  }
  return {
    userId: row.id,
    householdId: row.household_id,
    role: row.role,
    email: row.email,
    passwordHash: row.password_hash,
    tokenVersion: row.token_version
  };
}

export interface LoginPayload {
  email: string;
  password: string;
}

export async function login(payload: LoginPayload): Promise<string | null> {
  const user = await findUserByEmail(payload.email);
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
      role: user.role,
      tokenVersion: user.tokenVersion
    },
    env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      sub: string;
      householdId: string;
      role: Role;
      tokenVersion?: number;
    };
    const row = await qGet<{ token_version: number }>(
      `
  SELECT token_version
  FROM app_user
  WHERE id = ?
  LIMIT 1
`,
      payload.sub
    );
    if (!row) {
      return null;
    }
    if ((payload.tokenVersion ?? -1) !== row.token_version) {
      return null;
    }

    return {
      userId: payload.sub,
      householdId: payload.householdId,
      role: payload.role
    };
  } catch {
    return null;
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; code: "INVALID_CURRENT_PASSWORD" | "NOT_FOUND" }> {
  const row = await qGet<{ password_hash: string }>(
    `
  SELECT password_hash
  FROM app_user
  WHERE id = ?
  LIMIT 1
`,
    userId
  );
  if (!row) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const matches = bcrypt.compareSync(currentPassword, row.password_hash);
  if (!matches) {
    return { ok: false, code: "INVALID_CURRENT_PASSWORD" };
  }
  const nextHash = bcrypt.hashSync(newPassword, 10);
  await qExec(
    `
  UPDATE app_user
  SET password_hash = ?, token_version = token_version + 1
  WHERE id = ?
`,
    nextHash,
    userId
  );
  return { ok: true };
}
