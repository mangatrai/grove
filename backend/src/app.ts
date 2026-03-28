import express from "express";

import { authRouter } from "./modules/auth/auth.routes.js";
import { categoriesRouter } from "./modules/category/categories.routes.js";
import { categoryRulesRouter } from "./modules/category/category-rules.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { householdRouter } from "./modules/household/household.routes.js";
import { importsRouter } from "./modules/imports/imports.routes.js";
import { ledgerRouter } from "./modules/ledger/ledger.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { resolutionRouter } from "./modules/resolution/resolution.routes.js";

/** Allow browser dev (Vite) and other local clients to call the API. */
function corsMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS, DELETE");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

export function buildApp() {
  const app = express();

  app.use(corsMiddleware());
  app.use(express.json());
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/household", householdRouter);
  app.use("/categories", categoriesRouter);
  app.use("/categories/rules", categoryRulesRouter);
  app.use("/imports", importsRouter);
  app.use("/transactions", ledgerRouter);
  app.use("/resolution", resolutionRouter);
  app.use("/reports", reportsRouter);

  return app;
}
