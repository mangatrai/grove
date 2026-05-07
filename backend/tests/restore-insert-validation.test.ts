import { describe, expect, it } from "vitest";

import { assertRestoreInsertColumnNames } from "../src/modules/export/restore-insert-validation.js";

describe("assertRestoreInsertColumnNames", () => {
  it("accepts snake_case keys", () => {
    expect(() =>
      assertRestoreInsertColumnNames("household", { id: "x", monthly_savings_target_usd: null })
    ).not.toThrow();
  });

  it("rejects SQL injection-shaped keys", () => {
    const malicious: Record<string, unknown> = {};
    malicious['id"); DROP TABLE household;--'] = "x";
    expect(() => assertRestoreInsertColumnNames("household", malicious)).toThrow(/Invalid column name/);
  });

  it("rejects uppercase and spaces", () => {
    expect(() => assertRestoreInsertColumnNames("app_user", { Email: "a" })).toThrow(/Invalid column name/);
    expect(() => assertRestoreInsertColumnNames("app_user", { "first name": "a" })).toThrow(/Invalid column name/);
  });
});
