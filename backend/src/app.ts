import express from "express";

import { authRouter } from "./modules/auth/auth.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { importsRouter } from "./modules/imports/imports.routes.js";
import { ledgerRouter } from "./modules/ledger/ledger.routes.js";

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
  app.use("/imports", importsRouter);
  app.use("/transactions", ledgerRouter);

  return app;
}
