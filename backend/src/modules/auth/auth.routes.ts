import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { env } from "../../config/env.js";
import { changePassword, getForcePasswordChange, login, logoutUser } from "./auth.service.js";
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

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

/**
 * Minimum password strength for new passwords.
 * Requires at least one uppercase, one lowercase, one digit, and one special character.
 * Min 10 characters (OWASP 2021 recommendation for bcrypt-protected passwords).
 */
const PASSWORD_STRENGTH_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$/;
const strongPassword = z
  .string()
  .min(10, "Password must be at least 10 characters")
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

  const token = await login(parsed.data);
  if (!token) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  res.status(200).json({ token });
});

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const forcePasswordChange = await getForcePasswordChange(req.authUser!.userId);
  res.status(200).json({ user: { ...req.authUser, forcePasswordChange } });
});

authRouter.get("/owner-only", requireAuth, requireRole(["owner", "admin"]), (_req, res) => {
  res.status(200).json({ message: "Owner/Admin access granted" });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: strongPassword
});

authRouter.post("/change-password", requireAuth, async (req: AuthenticatedRequest, res) => {
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
    res.status(404).json({ message: "User not found", code: out.code });
    return;
  }
  res.status(200).json({ message: "Password updated" });
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
