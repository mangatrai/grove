import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /** One worker avoids two Vitest files fighting over the same on-disk test SQLite. */
    fileParallelism: false,
    /** After all tests: remove data/imports/<uuid>/ (see tests/global-setup.ts teardown). */
    globalSetup: path.join(__dirname, "tests/global-setup.ts")
  }
});
