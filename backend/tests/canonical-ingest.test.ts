import { describe, expect, it } from "vitest";

import {
  computeTransactionFingerprint,
  descriptionsCompatibleForNearDuplicate,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "../src/modules/canonical/transaction-fingerprint.js";

describe("transaction fingerprint (Epic 4.2)", () => {
  it("normalizes amounts to cents deterministically", () => {
    expect(normalizeAmountForFingerprint(-4.5)).toBe(-4.5);
    expect(normalizeAmountForFingerprint(-4.501)).toBe(-4.5);
    expect(normalizeAmountForFingerprint(10.999)).toBe(11);
    expect(normalizeAmountForFingerprint(0.1 + 0.2)).toBe(0.3);
  });

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

  it("treats float noise within the same cent as same fingerprint input", () => {
    const desc = normalizeDescriptionForFingerprint("test");
    const a = computeTransactionFingerprint({
      householdId: "h",
      accountId: "a",
      txnDate: "2026-01-01",
      amount: normalizeAmountForFingerprint(1.234),
      normalizedDescription: desc
    });
    const b = computeTransactionFingerprint({
      householdId: "h",
      accountId: "a",
      txnDate: "2026-01-01",
      amount: normalizeAmountForFingerprint(1.234 + 1e-9),
      normalizedDescription: desc
    });
    expect(a).toBe(b);
  });

  it("detects compatible descriptions for near-duplicate review", () => {
    expect(descriptionsCompatibleForNearDuplicate("starbucks coffee", "starbucks coffee shop")).toBe(true);
    expect(descriptionsCompatibleForNearDuplicate("x", "y")).toBe(false);
    expect(descriptionsCompatibleForNearDuplicate("whole foods market", "whole foods")).toBe(true);
  });
});
