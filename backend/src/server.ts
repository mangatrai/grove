import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { getSql } from "./db/query.js";
import { log } from "./logger.js";

const app = buildApp();

const port = Number(env.PORT);

void (async () => {
  await getSql();
  app.listen(port, () => {
    log.info(`Backend listening on http://localhost:${port}`);
    log.info(`Postgres: ${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`);
  });
})();
