import { Input } from "@mantine/core";
import type { CSSProperties } from "react";
import CurrencyInputField from "react-currency-input-field";

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

export function CurrencyInput({
  value,
  onChange,
  label,
  description,
  placeholder,
  disabled,
  error,
  size,
  style,
  "aria-label": ariaLabel
}: CurrencyInputProps) {
  return (
    <Input.Wrapper label={label} description={description} error={error}>
      <Input
        component={CurrencyInputField}
        size={size}
        style={style}
        aria-label={ariaLabel}
        decimalsLimit={2}
        fixedDecimalLength={2}
        disableAbbreviations
        placeholder={placeholder}
        disabled={disabled}
        value={value === undefined ? "" : value}
        onValueChange={(next) => {
          if (next == null || next === "") {
            onChange(undefined);
            return;
          }
          const parsed = Number(next);
          onChange(Number.isFinite(parsed) ? parsed : undefined);
        }}
      />
    </Input.Wrapper>
  );
}
