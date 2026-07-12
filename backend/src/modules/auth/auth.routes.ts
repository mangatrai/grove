import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { env } from "../../config/env.js";
import { isEmailConfigured } from "../mailer/mailer.service.js";
import {
  changePassword,
  getForcePasswordChange,
  issueSetupToken,
  login,
  logoutUser,
  requestPasswordReset,
  resetPassword
} from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { requireAuth } from "./auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";

/**
 * Rate limit: 12 attempts per 15 minutes per IP.
 * Skipped in TEST mode so integration tests can log in freely without hitting 429.
 */
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." },
  skip: () => env.MODE === "TEST"
});

const changePasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password change attempts. Please try again later." },
  skip: () => env.MODE === "TEST"
});

const forgotPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset requests. Please try again later." },
  skip: () => env.MODE === "TEST"
});

const resetPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset attempts. Please try again later." },
  skip: () => env.MODE === "TEST"
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

/**
 * Minimum password strength for new passwords.
 * Requires at least one uppercase, one lowercase, one digit, and one special character.
 * Min 12 characters.
 */
const PASSWORD_STRENGTH_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}$/;
const strongPassword = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .regex(
    PASSWORD_STRENGTH_REGEX,
    "Password must include uppercase, lowercase, a number, and a special character"
  );

export const authRouter = Router();

authRouter.post("/login", loginRateLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.issues
    });
    return;
  }

  const result = await login(parsed.data);
  if (!result) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  res.status(200).json({ token: result.token, forcePasswordChange: result.forcePasswordChange });
});

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const forcePasswordChange = await getForcePasswordChange(req.authUser!.userId);
  res.status(200).json({ user: { ...req.authUser, forcePasswordChange } });
});

authRouter.post("/setup-forced-change-token", requireAuth, forgotPasswordRateLimit, async (req: AuthenticatedRequest, res) => {
  const token = await issueSetupToken(req.authUser!.userId);
  if (!token) {
    res.status(403).json({ code: "NOT_FORCED", message: "No forced password change pending." });
    return;
  }
  res.status(200).json({ token });
});

authRouter.get("/owner-only", requireAuth, requireRole(["owner", "admin"]), (_req, res) => {
  res.status(200).json({ message: "Owner/Admin access granted" });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: strongPassword
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: strongPassword
});

authRouter.get("/capabilities", (_req, res) => {
  res.status(200).json({ emailEnabled: isEmailConfigured() });
});

authRouter.post("/change-password", requireAuth, changePasswordRateLimit, async (req: AuthenticatedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.issues
    });
    return;
  }
  const out = await changePassword(
    req.authUser!.userId,
    parsed.data.currentPassword,
    parsed.data.newPassword
  );
  if (!out.ok) {
    if (out.code === "INVALID_CURRENT_PASSWORD") {
      res.status(400).json({ message: "Current password is incorrect", code: out.code });
      return;
    }
    if (out.code === "SAME_AS_CURRENT") {
      res.status(400).json({ message: "New password must be different from current password", code: out.code });
      return;
    }
    res.status(404).json({ message: "User not found", code: out.code });
    return;
  }
  res.status(200).json({ message: "Password updated" });
});

authRouter.post("/forgot-password", forgotPasswordRateLimit, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }

  await requestPasswordReset(parsed.data.email);
  res.status(200).json({ message: "If that address is registered, a reset link is on its way." });
});

authRouter.post("/reset-password", resetPasswordRateLimit, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }

  const out = await resetPassword(parsed.data.token, parsed.data.newPassword);
  if (!out.ok) {
    if (out.code === "INVALID_TOKEN") {
      res.status(400).json({ code: out.code, message: "This link has expired or already been used." });
      return;
    }
    res.status(400).json({
      code: out.code,
      message: "New password must be different from your current password."
    });
    return;
  }

  res.status(200).json({ message: "Password updated. Please sign in." });
});

/**
 * POST /auth/logout
 * Invalidates all existing JWTs for the current user by incrementing token_version.
 * The client must also clear its stored token.
 */
authRouter.post("/logout", requireAuth, async (req: AuthenticatedRequest, res) => {
  await logoutUser(req.authUser!.userId);
  res.status(204).send();
});
