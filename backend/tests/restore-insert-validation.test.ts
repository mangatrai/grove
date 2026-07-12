import { describe, expect, it } from "vitest";

import {
  assertRestoreInsertColumnNames,
  assertRestoreTableName
} from "../src/modules/export/restore-insert-validation.js";

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

describe("assertRestoreTableName (SEC #187 — defense-in-depth allowlist)", () => {
  const known = new Set(["household", "app_user", "financial_account"]);

  it("accepts a table name present in the allowlist", () => {
    expect(() => assertRestoreTableName("household", known)).not.toThrow();
  });

  it("rejects a SQL-injection-shaped table name even if somehow passed", () => {
    expect(() => assertRestoreTableName('household; DROP TABLE household;--', known)).toThrow(
      /Invalid table name/
    );
  });

  it("rejects a well-formed identifier that isn't in the known EXPORT_REGISTRY set", () => {
    expect(() => assertRestoreTableName("not_a_real_table", known)).toThrow(/Invalid table name/);
  });
});
