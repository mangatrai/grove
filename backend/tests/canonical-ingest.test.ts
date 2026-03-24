import { describe, expect, it } from "vitest";

import {
  computeTransactionFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "../src/modules/canonical/canonical-ingest.service.js";

describe("canonical fingerprint helpers", () => {
  it("normalizes dates to YYYY-MM-DD", () => {
    expect(normalizeTxnDateForFingerprint("2026-03-01")).toBe("2026-03-01");
    expect(normalizeTxnDateForFingerprint("03/01/26")).toBe("2026-03-01");
    expect(normalizeTxnDateForFingerprint("12/31/2025")).toBe("2025-12-31");
  });

  it("strips noise from descriptions for fingerprinting", () => {
    expect(normalizeDescriptionForFingerprint("  Coffee #123 ")).toBe("coffee 123");
  });

  it("produces stable fingerprint for same logical transaction", () => {
    const a = computeTransactionFingerprint({
      householdId: "h1",
      accountId: "a1",
      txnDate: "2026-03-01",
      amount: -4.5,
      normalizedDescription: "coffee"
    });
    const b = computeTransactionFingerprint({
      householdId: "h1",
      accountId: "a1",
      txnDate: "2026-03-01",
      amount: -4.5,
      normalizedDescription: "coffee"
    });
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });
});
