import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { getSql } from "./db/query.js";
import { log } from "./logger.js";

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");

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
  await getSql();
  app.listen(port, () => {
    log.info(`Backend listening on http://localhost:${port}`);
    log.info(`Postgres: ${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`);
  });
})();
