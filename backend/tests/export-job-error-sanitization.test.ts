import { describe, expect, it } from "vitest";

import { ExportUserFacingError } from "../src/modules/export/export-errors.js";

describe("ExportUserFacingError (SEC #188 — no raw exception text to client)", () => {
  it("is a distinct Error subclass usable with instanceof at the job-failure catch site", () => {
    const safe = new ExportUserFacingError("This backup is encrypted but BACKUP_ENCRYPTION_KEY is not configured.");
    expect(safe).toBeInstanceOf(Error);
    expect(safe).toBeInstanceOf(ExportUserFacingError);
    expect(safe.message).toBe("This backup is encrypted but BACKUP_ENCRYPTION_KEY is not configured.");
  });

  it("an ordinary Error (unexpected internal failure) is not an ExportUserFacingError", () => {
    const raw = new Error("ECONNREFUSED at /var/data/household-finance/exports/tmp-abc123.hfb");
    expect(raw).not.toBeInstanceOf(ExportUserFacingError);
  });
});
