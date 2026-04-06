import { Router } from "express";
import { z } from "zod";

import { changePassword, login } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { requireAuth } from "./auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
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

authRouter.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
  res.status(200).json({ user: req.authUser });
});

authRouter.get("/owner-only", requireAuth, requireRole(["owner", "admin"]), (_req, res) => {
  res.status(200).json({ message: "Owner/Admin access granted" });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
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
      res.status(401).json({ message: "Current password is incorrect", code: out.code });
      return;
    }
    res.status(404).json({ message: "User not found", code: out.code });
    return;
  }
  res.status(200).json({ message: "Password updated" });
});
