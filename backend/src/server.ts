import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { checkExportCoverage } from "./db/export-coverage-check.js";
import { closeSql, getSql } from "./db/query.js";
import { log } from "./logger.js";
import { startBackupScheduler } from "./modules/gdrive/gdrive-scheduler.service.js";
import { startStockQuoteScheduler } from "./modules/espp/espp-stock.service.js";
import { startRealtyScheduler } from "./modules/household/realty-scheduler.service.js";
import { startImportCleanupScheduler } from "./modules/imports/import-session.service.js";
import { startPayslipAsyncScheduler } from "./modules/imports/payslip-async-scheduler.service.js";
import { startFamilyAgentScheduler } from "./modules/family/family-agent.scheduler.js";
import { reconcileOrphanedPaTaskRuns } from "./modules/family/pa-task-runner.js";
import { purgeOldNotifications } from "./modules/notifications/notification.service.js";

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");

// Refuse to start in PROD with the default JWT_SECRET — it's a known string in the repo.
const DEFAULT_JWT_SECRET = "local-dev-jwt-secret-do-not-use-in-prod-change-me!";
if (env.MODE === "PROD" && env.JWT_SECRET === DEFAULT_JWT_SECRET) {
  log.error(
    "FATAL: JWT_SECRET is set to the default development value. Set a strong random secret (≥ 32 chars) before running in PROD. Generate one with: openssl rand -base64 48"
  );
  process.exit(1);
}

const app = buildApp();

if (process.env.NODE_ENV === "production" && env.MODE !== "PROD") {
  log.warn(
    `NODE_ENV=production but MODE=${env.MODE} — SPA is not served (static UI requires MODE=PROD). Fix: set MODE=PROD for this process (e.g. docker run -e MODE=PROD if .env overrides the image).`
  );
}
if (env.MODE === "PROD" && !fs.existsSync(frontendDist)) {
  log.warn(
    `MODE=PROD but frontend/dist is missing at ${frontendDist} — GET / will return "Cannot GET /". Rebuild so the frontend stage copies dist into the image.`
  );
}

const port = Number(env.PORT);

void (async () => {
  try {
    await getSql();
    await checkExportCoverage();
    await reconcileOrphanedPaTaskRuns();
    startStockQuoteScheduler();
    if (env.MODE !== "TEST") {
      startBackupScheduler();
      startRealtyScheduler();
      startImportCleanupScheduler();
      startPayslipAsyncScheduler();
      startFamilyAgentScheduler();
      void purgeOldNotifications();
    }
    const server = app.listen(port, () => {
      log.info(`Backend listening on http://localhost:${port}`);
      log.info(`Postgres: ${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`);
    });

    function shutdown(signal: string) {
      log.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        await closeSql();
        log.info("Server closed, process exiting");
        process.exit(0);
      });
      // Force-exit if graceful drain takes too long (e.g. hung websocket or keep-alive)
      setTimeout(() => {
        log.warn("Graceful shutdown timed out — forcing exit");
        process.exit(1);
      }, 10_000).unref();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    log.error("Backend startup failed", err);
    process.exit(1);
  }
})();
