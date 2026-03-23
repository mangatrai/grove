import { Router } from "express";
import { z } from "zod";

import { login } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.issues
    });
    return;
  }

  const token = login(parsed.data);
  if (!token) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  res.status(200).json({ token });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ user: req.authUser });
});

authRouter.get("/owner-only", requireAuth, requireRole(["owner", "admin"]), (_req, res) => {
  res.status(200).json({ message: "Owner/Admin access granted" });
});
