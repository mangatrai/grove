import { describe, expect, it } from "vitest";

import {
  accountMaskMatches,
  confirmedOutsideLines,
  depositLineAccountLabel,
  depositStatusBadge,
  remainderBadge,
  shiftIsoDate
} from "./depositLines";
import type { DepositLineMatch, MatchedDeposit } from "./types";

const deposit = (id: string, amount: number): MatchedDeposit => ({
  id,
  txnDate: "2026-06-15",
  amount,
  direction: "credit",
  merchant: "Acme Payroll",
  memo: null,
  accountId: "acc-1",
  institution: "Test Bank",
  accountType: "checking",
  accountMask: "1111",
  dateDelta: 0,
  amountDelta: 0
});

const line = (over: Partial<DepositLineMatch>): DepositLineMatch => ({
  accountSuffix: "111",
  amount: 100,
  trace: null,
  status: "not_found",
  linked: null,
  candidates: [],
  ...over
});

describe("depositLines helpers", () => {
  it("labels a line by its printed digits", () => {
    expect(depositLineAccountLabel({ accountSuffix: "111" })).toBe("Account ···111");
    expect(depositLineAccountLabel({ accountSuffix: null })).toBe("Account not printed");
  });

  it("matches masks on the common tail like the backend", () => {
    expect(accountMaskMatches("9111", "111")).toBe(true);
    expect(accountMaskMatches("x9111", "12349111")).toBe(true);
    expect(accountMaskMatches("9111", "222")).toBe(false);
    expect(accountMaskMatches("9111", "11")).toBe(false);
    expect(accountMaskMatches(null, "111")).toBe(false);
  });

  it("status badge tells auto links from manual ones", () => {
    expect(depositStatusBadge(line({ status: "linked", linked: { ...deposit("a", 100), linkSource: "auto" } }))).toEqual({
      label: "Auto-linked",
      color: "teal"
    });
    expect(depositStatusBadge(line({ status: "linked", linked: { ...deposit("a", 100), linkSource: "manual" } })).label).toBe("Linked");
    expect(depositStatusBadge(line({ status: "linked", linked: deposit("a", 100) })).label).toBe("Linked");
    expect(depositStatusBadge(line({ status: "suggested" })).label).toBe("Suggested");
    expect(depositStatusBadge(line({ status: "not_found" })).label).toBe("Not found");
  });

  it("lists confirmed deposits that fill no printed line", () => {
    const a = deposit("a", 100);
    const b = deposit("b", 42);
    expect(confirmedOutsideLines([a, b], [line({ status: "linked", linked: a })])).toEqual([b]);
  });

  it("remainder badge stays hidden until something is linked", () => {
    expect(remainderBadge(0, 3000)).toBeNull();
    expect(remainderBadge(2500, null)).toBeNull();
    expect(remainderBadge(3000, 0)).toEqual({ color: "green", label: "Fully linked" });
    expect(remainderBadge(2500, 500)).toEqual({ color: "yellow", label: "$500.00 not linked" });
    expect(remainderBadge(3100, -100)).toEqual({ color: "yellow", label: "$100.00 over net pay" });
  });

  it("shifts ISO dates across month ends", () => {
    expect(shiftIsoDate("2026-06-30", 7)).toBe("2026-07-07");
    expect(shiftIsoDate("2026-03-03", -7)).toBe("2026-02-24");
  });
});
