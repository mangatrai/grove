import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomUUID, webcrypto } from "node:crypto";

import { qBegin, qExec, qGet, sqlBind } from "../../db/query.js";
import { env } from "../../config/env.js";
import { recordActivity } from "./activity-tracker.js";
import { isEmailConfigured, sendMail } from "../mailer/mailer.service.js";
import { renderPasswordChangedTemplate } from "../mailer/templates/password-changed.js";
import { renderPasswordResetTemplate } from "../mailer/templates/password-reset.js";
import type { AuthUser, Role } from "./types.js";

interface DbLoginUser extends AuthUser {
  email: string;
  passwordHash: string;
  tokenVersion: number;
  forcePasswordChange: boolean;
}

async function findUserByEmail(email: string): Promise<DbLoginUser | null> {
  const row = await qGet<{
    id: string;
    household_id: string;
    role: Role;
    email: string;
    password_hash: string;
    token_version: number;
    force_password_change: boolean;
    person_profile_id: string | null;
  }>(
    `
  SELECT u.id, u.household_id, u.role, u.email, u.password_hash, u.token_version,
         u.force_password_change,
         p.id AS person_profile_id
  FROM app_user u
  LEFT JOIN person_profile p ON p.linked_user_id = u.id AND p.household_id = u.household_id
  WHERE lower(u.email) = lower(?)
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
    personProfileId: row.person_profile_id ?? null,
    email: row.email,
    passwordHash: row.password_hash,
    tokenVersion: row.token_version,
    forcePasswordChange: Boolean(row.force_password_change)
  };
}

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * Dummy hash used for constant-time comparison when the email is not found.
 * Prevents user enumeration via response-time differences.
 * Must use the same cost factor (12) as real hashes so compare timing stays consistent.
 */
const DUMMY_HASH = "$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";

export async function login(payload: LoginPayload): Promise<{ token: string; forcePasswordChange: boolean } | null> {
  const user = await findUserByEmail(payload.email);

  // Always run bcrypt (async) so response time is the same whether the email exists or not.
  // This prevents timing-based user enumeration.
  const isValid = await bcrypt.compare(payload.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !isValid) {
    return null;
  }

  const token = jwt.sign(
    {
      sub: user.userId,
      householdId: user.householdId,
      role: user.role,
      tokenVersion: user.tokenVersion
    },
    env.JWT_SECRET,
    { expiresIn: "8h", algorithm: "HS256" }
  );
  recordActivity(user.userId);
  return { token, forcePasswordChange: user.forcePasswordChange };
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as {
      sub: string;
      householdId: string;
      role: Role;
      tokenVersion?: number;
    };
    const row = await qGet<{ token_version: number; person_profile_id: string | null }>(
      `
  SELECT u.token_version, p.id AS person_profile_id
  FROM app_user u
  LEFT JOIN person_profile p ON p.linked_user_id = u.id AND p.household_id = u.household_id
  WHERE u.id = ?
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
      role: payload.role,
      personProfileId: row.person_profile_id ?? null
    };
  } catch {
    return null;
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; code: "INVALID_CURRENT_PASSWORD" | "SAME_AS_CURRENT" | "NOT_FOUND" }> {
  const row = await qGet<{ password_hash: string; email: string }>(
    `
  SELECT password_hash, email
  FROM app_user
  WHERE id = ?
  LIMIT 1
`,
    userId
  );
  if (!row) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) {
    return { ok: false, code: "INVALID_CURRENT_PASSWORD" };
  }
  const sameAsCurrent = await bcrypt.compare(newPassword, row.password_hash);
  if (sameAsCurrent) {
    return { ok: false, code: "SAME_AS_CURRENT" };
  }
  const nextHash = await bcrypt.hash(newPassword, 12);
  await qExec(
    `
  UPDATE app_user
  SET password_hash = ?, token_version = token_version + 1, force_password_change = false
  WHERE id = ?
`,
    nextHash,
    userId
  );
  if (isEmailConfigured()) {
    void sendMail({
      to: row.email,
      ...renderPasswordChangedTemplate()
    });
  }
  return { ok: true };
}

/**
 * Invalidate all existing JWTs for a user by bumping token_version.
 * Any token carrying the old version is rejected by verifyToken.
 */
export async function logoutUser(userId: string): Promise<void> {
  await qExec(
    `UPDATE app_user SET token_version = token_version + 1 WHERE id = ?`,
    userId
  );
}

export async function getForcePasswordChange(userId: string): Promise<boolean> {
  const row = await qGet<{ force_password_change: boolean }>(
    `SELECT force_password_change FROM app_user WHERE id = ? LIMIT 1`,
    userId
  );
  return Boolean(row?.force_password_change);
}

/**
 * Issues a short-lived password reset token for a user who has force_password_change = true.
 * Used by the frontend forced-change gate to hand off to the existing reset-password flow.
 * Returns null if the flag is not set (caller should 403).
 */
export async function issueSetupToken(userId: string): Promise<string | null> {
  const forced = await getForcePasswordChange(userId);
  if (!forced) return null;
  return createPasswordResetToken(userId, 1); // 1-hour TTL — same as email reset
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Delete used or expired password reset tokens. Safe to call repeatedly. */
export async function purgeStalePasswordResetTokens(): Promise<void> {
  await qExec(
    `
    DELETE FROM password_reset_token
    WHERE used_at IS NOT NULL OR expires_at < NOW()
    `
  );
}

export async function createPasswordResetToken(userId: string, ttlHours: number): Promise<string> {
  await qExec(
    `
    DELETE FROM password_reset_token
    WHERE user_id = ? AND used_at IS NULL
    `,
    userId
  );

  const rawTokenBytes = webcrypto.getRandomValues(new Uint8Array(32));
  const rawToken = bytesToBase64Url(rawTokenBytes);
  const tokenHash = sha256Hex(rawToken);

  await qExec(
    `
    INSERT INTO password_reset_token (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, NOW() + (? || ' hours')::interval)
    `,
    randomUUID(),
    userId,
    tokenHash,
    String(ttlHours)
  );

  return rawToken;
}

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  if (!isEmailConfigured()) {
    return { ok: true };
  }
  const user = await findUserByEmail(email);
  if (!user) {
    return { ok: true };
  }

  const rawToken = await createPasswordResetToken(user.userId, 1);

  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim() ?? "";
  const resetLink = publicBaseUrl
    ? `${publicBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`
    : rawToken;
  const template = renderPasswordResetTemplate({ resetLink });

  void sendMail({
    to: user.email,
    ...template
  });

  return { ok: true };
}

export async function resetPassword(
  rawToken: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; code: "INVALID_TOKEN" | "SAME_AS_CURRENT" }> {
  const tokenHash = sha256Hex(rawToken);
  const tokenRow = await qGet<{ id: string; user_id: string }>(
    `
    SELECT id, user_id
    FROM password_reset_token
    WHERE token_hash = ?
      AND used_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
    `,
    tokenHash
  );
  if (!tokenRow) {
    return { ok: false, code: "INVALID_TOKEN" };
  }

  const userRow = await qGet<{ password_hash: string }>(
    `
    SELECT password_hash
    FROM app_user
    WHERE id = ?
    LIMIT 1
    `,
    tokenRow.user_id
  );
  if (!userRow) {
    return { ok: false, code: "INVALID_TOKEN" };
  }

  const sameAsCurrent = await bcrypt.compare(newPassword, userRow.password_hash);
  if (sameAsCurrent) {
    return { ok: false, code: "SAME_AS_CURRENT" };
  }

  const nextHash = await bcrypt.hash(newPassword, 12);
  await qBegin(async (tx) => {
    const usedStmt = sqlBind(
      `
      UPDATE password_reset_token
      SET used_at = NOW()
      WHERE id = ?
      `,
      [tokenRow.id]
    );
    await tx.unsafe(usedStmt.text, usedStmt.values as never[]);

    const updateUserStmt = sqlBind(
      `
      UPDATE app_user
      SET password_hash = ?, token_version = token_version + 1, force_password_change = false
      WHERE id = ?
      `,
      [nextHash, tokenRow.user_id]
    );
    await tx.unsafe(updateUserStmt.text, updateUserStmt.values as never[]);
  });

  return { ok: true };
}
