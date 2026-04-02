import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { dbPath } from "./db/sqlite.js";
import { log } from "./logger.js";

const app = buildApp();

app.listen(Number(env.PORT), () => {
  log.info(`Backend listening on http://localhost:${env.PORT}`);
  log.info(`SQLite: ${dbPath}`);
});
