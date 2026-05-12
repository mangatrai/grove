import { Input } from "@mantine/core";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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

function valueToCents(v: number | undefined): number {
  return v === undefined ? 0 : Math.round(v * 100);
}

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

  // Keys that should pass through without interception (navigation / modifiers)
  const PASSTHROUGH = new Set([
    "Tab", "Shift", "Control", "Alt", "Meta",
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "Home", "End", "Escape",
  ]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (PASSTHROUGH.has(e.key)) return;
    e.preventDefault();
    if (e.key >= "0" && e.key <= "9") {
      push(cents * 10 + parseInt(e.key, 10));
    } else if (e.key === "Backspace") {
      push(Math.floor(cents / 10));
    } else if (e.key === "Delete") {
      push(0);
    }
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
