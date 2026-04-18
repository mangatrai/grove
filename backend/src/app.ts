import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { log } from "./logger.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { budgetRouter } from "./modules/budget/budget.routes.js";
import { categoriesRouter } from "./modules/category/categories.routes.js";
import { categoryRulesRouter } from "./modules/category/category-rules.routes.js";
import { exportsRouter } from "./modules/export/exports.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { householdRouter } from "./modules/household/household.routes.js";
import { importsRouter } from "./modules/imports/imports.routes.js";
import { ledgerRouter } from "./modules/ledger/ledger.routes.js";
import { payslipRouter } from "./modules/payslip/payslip.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { resolutionRouter } from "./modules/resolution/resolution.routes.js";

/**
 * CORS: allow the configured origin (or all origins in TEST mode).
 * Set ALLOWED_ORIGIN in production to your app's public URL, e.g. https://finance.example.com.
 * In TEST mode the header is left as "*" to keep the dev Vite proxy working.
 */
function corsMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const origin = env.ALLOWED_ORIGIN ?? (env.MODE === "PROD" ? "" : "*");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS, DELETE");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Built Vite output (served when `MODE=PROD` and this directory exists). */
const frontendDist = path.resolve(__dirname, "../../frontend/dist");

/** GET paths owned by the JSON API — do not serve SPA `index.html` for these. */
const API_PATH_PREFIXES = [
  "/health",
  "/auth",
  "/household",
  "/categories",
  "/imports",
  "/transactions",
  "/resolution",
  "/reports",
  "/payslips",
  "/exports",
  "/budget"
];

function isApiPath(urlPath: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`));
}

/**
 * Minimal request logger: logs method, path, status code, and duration.
 * Uses the existing `log` infrastructure (no extra dependency).
 * Skips static asset requests (files with an extension) to keep logs readable.
 */
function requestLoggerMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      // Skip static asset noise (JS chunks, CSS, images, favicon, etc.)
      if (/\.[a-z0-9]{1,6}$/i.test(req.path)) return;
      const ms = Date.now() - start;
      log.info(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    });
    next();
  };
}

export function buildApp() {
  const app = express();

  // Trust the first hop (reverse proxy / load balancer) so rate limiters and
  // IP-based logic see the real client IP from X-Forwarded-For rather than the
  // proxy address. Required on Oracle Cloud / any cloud load balancer.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(corsMiddleware());
  app.use(requestLoggerMiddleware());
  app.use(express.json({ limit: "50kb" }));
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/household", householdRouter);
  app.use("/categories", categoriesRouter);
  app.use("/categories/rules", categoryRulesRouter);
  app.use("/imports", importsRouter);
  app.use("/transactions", ledgerRouter);
  app.use("/resolution", resolutionRouter);
  app.use("/reports", reportsRouter);
  app.use("/payslips", payslipRouter);
  app.use("/exports", exportsRouter);
  app.use("/budget", budgetRouter);

  if (env.MODE === "PROD" && fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false }));
    app.get("*", (req, res, next) => {
      if (req.method !== "GET" || isApiPath(req.path)) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDist, "index.html"), (err) => {
        if (err) {
          next(err);
        }
      });
    });
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error(err instanceof Error ? err.stack ?? err.message : err);
    if (res.headersSent) {
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
