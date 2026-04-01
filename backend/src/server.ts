import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { dbPath } from "./db/sqlite.js";

const app = buildApp();

app.listen(Number(env.PORT), () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${env.PORT}`);
  // eslint-disable-next-line no-console
  console.log(`SQLite: ${dbPath}`);
});
