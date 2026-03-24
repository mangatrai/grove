import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /** One worker avoids two Vitest files fighting over the same on-disk test SQLite. */
    fileParallelism: false
  }
});
