import { describe, expect, it } from "vitest";

import { MAX_CENTS, reduceCurrencyKey, valueToCents } from "./currencyInputLogic.js";

describe("valueToCents", () => {
  it("converts a dollar value to cents", () => {
    expect(valueToCents(123.45)).toBe(12345);
  });

  it("treats undefined as zero", () => {
    expect(valueToCents(undefined)).toBe(0);
  });
});

describe("reduceCurrencyKey — blank/no-selection entry", () => {
  it("builds up digits left to right as if typed on a cash register", () => {
    let cents = 0;
    for (const digit of ["1", "2", "3", "4", "5"]) {
      cents = reduceCurrencyKey(cents, digit, false)!;
    }
    expect(cents).toBe(12345); // $123.45
  });

  it("Backspace trims the last digit", () => {
    expect(reduceCurrencyKey(12345, "Backspace", false)).toBe(1234);
  });

  it("Backspace converges to zero on a negative value instead of getting stuck", () => {
    expect(reduceCurrencyKey(-1, "Backspace", false)).toBe(0);
  });

  it("Delete always clears to zero", () => {
    expect(reduceCurrencyKey(12345, "Delete", false)).toBe(0);
  });
});

describe("reduceCurrencyKey — editing with an active selection", () => {
  it("a digit typed over a selection replaces the whole value instead of appending", () => {
    expect(reduceCurrencyKey(12345, "7", true)).toBe(7);
  });

  it("Backspace over a selection clears the whole value, not just the last digit", () => {
    expect(reduceCurrencyKey(12345, "Backspace", true)).toBe(0);
  });

  it("Delete over a selection clears the whole value", () => {
    expect(reduceCurrencyKey(12345, "Delete", true)).toBe(0);
  });
});

describe("reduceCurrencyKey — bounds and unhandled keys", () => {
  it("caps growth at the NUMERIC(12,2) schema precision", () => {
    expect(reduceCurrencyKey(MAX_CENTS, "9", false)).toBe(MAX_CENTS);
  });

  it("returns null for keys it doesn't handle", () => {
    expect(reduceCurrencyKey(12345, "a", false)).toBeNull();
    expect(reduceCurrencyKey(12345, ".", false)).toBeNull();
  });
});
