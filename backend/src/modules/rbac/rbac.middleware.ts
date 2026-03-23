import type { NextFunction, Response } from "express";

import type { Role } from "../auth/types.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";

export function requireRole(allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const role = req.authUser?.role;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ message: "Insufficient permissions" });
      return;
    }

    next();
  };
}
