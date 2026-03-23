import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = buildApp();

app.listen(Number(env.PORT), () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});
