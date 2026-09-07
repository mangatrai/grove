import { Input } from "@mantine/core";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CURRENCY_INPUT_PASSTHROUGH_KEYS, reduceCurrencyKey, valueToCents } from "./currencyInputLogic";

export type CurrencyInputProps = {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label?: string;
  description?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  style?: CSSProperties;
  "aria-label"?: string;
};

const fmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function CurrencyInput({
  value,
  onChange,
  label,
  description,
  placeholder = "0.00",
  disabled,
  error,
  size,
  style,
  "aria-label": ariaLabel
}: CurrencyInputProps) {
  const [cents, setCents] = useState(() => valueToCents(value));
  const lastPushedRef = useRef<number | undefined>(value);

  // Sync when parent resets the value externally (e.g. form cleared after submit)
  useEffect(() => {
    if (value !== lastPushedRef.current) {
      lastPushedRef.current = value;
      setCents(valueToCents(value));
    }
  }, [value]);

  const displayed = useMemo(() => (cents === 0 ? "" : fmt.format(cents / 100)), [cents]);

  function push(newCents: number) {
    setCents(newCents);
    const num = newCents === 0 ? undefined : newCents / 100;
    lastPushedRef.current = num;
    onChange(num);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (CURRENCY_INPUT_PASSTHROUGH_KEYS.has(e.key)) return;
    e.preventDefault();
    const hasSelection = e.currentTarget.selectionStart !== e.currentTarget.selectionEnd;
    const next = reduceCurrencyKey(cents, e.key, hasSelection);
    if (next !== null) push(next);
  }

  return (
    <Input.Wrapper label={label} description={description} error={error}>
      <Input
        size={size}
        style={style}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={displayed}
        onChange={() => { /* controlled via onKeyDown */ }}
        onKeyDown={handleKeyDown}
        onPaste={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
      />
    </Input.Wrapper>
  );
}
