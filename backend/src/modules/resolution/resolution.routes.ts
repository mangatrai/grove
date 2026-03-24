import { Router } from "express";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { listResolutionItemsForHousehold } from "./resolution.service.js";

export const resolutionRouter = Router();
resolutionRouter.use(requireAuth);

resolutionRouter.get("/", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const items = listResolutionItemsForHousehold(householdId);
  res.status(200).json({ items });
});
