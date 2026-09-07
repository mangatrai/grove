// Pure key-reduction logic for CurrencyInput's digit-shift (cash-register) editing
// model, split out so it's unit-testable without a DOM/React-testing setup.

// Matches the NUMERIC(12,2) precision used for amount/balance columns —
// keeps the field from accepting a value the backend would reject on submit.
export const MAX_CENTS = 999_999_999_999;

export const CURRENCY_INPUT_PASSTHROUGH_KEYS = new Set([
  "Tab", "Shift", "Control", "Alt", "Meta",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Home", "End", "Escape", "Enter",
]);

export function valueToCents(v: number | undefined): number {
  return v === undefined ? 0 : Math.round(v * 100);
}

/**
 * Given the current cents value and a keydown, returns the next cents value,
 * or null if the key isn't one this input handles.
 *
 * This is a digit-shift model with no meaningful cursor position, so any
 * active selection — full or partial — is treated as "start over" rather
 * than shifted onto the existing value.
 */
export function reduceCurrencyKey(cents: number, key: string, hasSelection: boolean): number | null {
  if (key >= "0" && key <= "9") {
    const base = hasSelection ? 0 : cents;
    return Math.min(base * 10 + parseInt(key, 10), MAX_CENTS);
  }
  if (key === "Backspace") {
    return hasSelection ? 0 : Math.trunc(cents / 10) || 0; // normalize -0 to 0
  }
  if (key === "Delete") {
    return 0;
  }
  return null;
}
