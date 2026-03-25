import { Router } from "express";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { listCategoriesForHousehold } from "./categories.service.js";

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get("/", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const categories = listCategoriesForHousehold(householdId);
  res.status(200).json({ categories });
});
