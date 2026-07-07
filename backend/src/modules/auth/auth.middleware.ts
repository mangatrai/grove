import type { NextFunction, Request, Response } from "express";

import { isTokenStale, recordActivity } from "./activity-tracker.js";
import { verifyToken } from "./auth.service.js";
import type { AuthUser } from "./types.js";

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

/** Set by the frontend on passive polls (e.g. /notifications/unread-count) — see FIX #221. */
const BACKGROUND_POLL_HEADER = "x-background-poll";

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

    if (req.header(BACKGROUND_POLL_HEADER)) {
      if (isTokenStale(user.userId)) {
        res.status(401).json({ message: "Session idle", code: "token_stale" });
        return;
      }
    } else {
      recordActivity(user.userId);
    }

    req.authUser = user;
    next();
  } catch (err) {
    next(err);
  }
}
