import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    env: {
      GOOGLE_CLIENT_ID: "vitest-google-client-id",
      GOOGLE_CLIENT_SECRET: "vitest-google-client-secret",
      GOOGLE_REDIRECT_URI: "http://127.0.0.1:4000/gdrive/oauth/callback"
    },
    include: ["tests/**/*.test.ts"],
    /** One worker avoids parallel tests sharing the same Postgres database. */
    fileParallelism: false,
    /** After all tests: remove data/imports/<uuid>/ (see tests/global-setup.ts teardown). */
    globalSetup: path.join(__dirname, "tests/global-setup.ts")
  }
});
