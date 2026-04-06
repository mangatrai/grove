import type { NextFunction, Request, Response } from "express";

import { verifyToken } from "./auth.service.js";
import type { AuthUser } from "./types.js";

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ message: "Missing bearer token" });
      return;
    }

    const token = authHeader.replace("Bearer ", "");
    const user = await verifyToken(token);
    if (!user) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    req.authUser = user;
    next();
  } catch (err) {
    next(err);
  }
}
