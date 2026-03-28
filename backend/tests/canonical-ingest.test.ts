import { describe, expect, it } from "vitest";

import { transferPairScore } from "../src/modules/canonical/canonical-ingest.service.js";
import {
  computeTransactionFingerprint,
  descriptionsCompatibleForNearDuplicate,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "../src/modules/canonical/transaction-fingerprint.js";

function sameDayDiff(_a: string, _b: string): number {
  return 0;
}

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

describe("transfer pair score (Epic 5.2)", () => {
  const d = "2026-03-01";

  it("scores asymmetric card payoff when credit leg omits PAYMENT (THANK YOU only)", () => {
    expect(
      transferPairScore("ONLINE PAYMENT TO VISA", "THANK YOU", d, d, sameDayDiff)
    ).toBe(88);
    expect(
      transferPairScore("ACH PAYMENT TO DISCOVER CARD", "CREDITED", d, d, sameDayDiff)
    ).toBe(88);
  });

  it("does not treat ACH + THANK YOU as card payoff without card/loan cues on the debit", () => {
    expect(transferPairScore("ACH PAYMENT", "THANK YOU", d, d, sameDayDiff)).toBe(0);
  });

  it("scores full-alignment card payment memos at 92", () => {
    expect(
      transferPairScore(
        "AUTOPAY ACH PAYMENT TO CHASE CARD",
        "PAYMENT RECEIVED - THANK YOU",
        d,
        d,
        sameDayDiff
      )
    ).toBe(92);
  });

  it("scores loan-tagged payment legs with directional memos at 92", () => {
    expect(
      transferPairScore(
        "ONLINE PAYMENT TO HELOC",
        "PAYMENT RECEIVED - THANK YOU HELOC",
        d,
        d,
        sameDayDiff
      )
    ).toBe(92);
  });

  it("scores mortgage and escrow payment memos with directional alignment", () => {
    expect(
      transferPairScore(
        "ONLINE PAYMENT MORTGAGE",
        "PAYMENT APPLIED ESCROW",
        d,
        d,
        sameDayDiff
      )
    ).toBe(92);
  });

  it("keeps generic payment wording at 0 without transfer-like direction and context", () => {
    expect(transferPairScore("AUTOMATIC PAYMENT", "PAYMENT POSTED", d, d, sameDayDiff)).toBe(0);
  });

  it("still prefers identical normalized descriptions at 100", () => {
    const label = "INTERNAL XFER SAVINGS";
    expect(transferPairScore(label, label, d, d, sameDayDiff)).toBe(100);
  });
});
