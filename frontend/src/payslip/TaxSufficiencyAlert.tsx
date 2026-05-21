import type { CSSProperties } from "react";

export type TaxSufficiencyAlertProps = {
  rate: number | null;
};

export function TaxSufficiencyAlert({ rate }: TaxSufficiencyAlertProps) {
  if (rate == null || rate >= 20) return null;

  const wrap: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "9px 12px",
    borderRadius: 7,
    background: "var(--color-warm-subtle)",
    border: "1px solid rgba(200,134,10,0.3)",
    fontSize: 12,
    color: "#6b4c0a",
    lineHeight: 1.5
  };

  return (
    <div style={wrap} role="alert">
      <span style={{ fontSize: 13, flexShrink: 0 }} aria-hidden>
        ⚠
      </span>
      <span>
        <strong>Federal withholding {rate.toFixed(1)}% annualised</strong> — below the 20% general
        benchmark. This is a data signal only. Consider reviewing your W-4 if your effective rate is
        typically higher.
      </span>
    </div>
  );
}
