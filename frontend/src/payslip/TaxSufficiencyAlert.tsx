import type { CSSProperties } from "react";

export type TaxSufficiencyAlertProps = {
  federalRateYtd: number | null;
  federalRateCurrent: number | null;
  totalTaxRateYtd: number | null;
  totalTaxRateCurrent: number | null;
};

type Tier = {
  icon: string;
  label: string;
  hint: string;
  bg: string;
  border: string;
  textColor: string;
  strongColor: string;
};

function getTier(fedYtd: number): Tier {
  if (fedYtd < 10) {
    return {
      icon: "⚠",
      label: "Under-withheld",
      hint: "below 10% — you may owe a significant balance at filing. Review your W-4.",
      bg: "var(--color-warm-subtle, #fffbeb)",
      border: "rgba(217,119,6,0.3)",
      textColor: "#78350f",
      strongColor: "#92400e",
    };
  }
  if (fedYtd < 16) {
    return {
      icon: "⚠",
      label: "Below average",
      hint: "below the typical 16–22% range. You may owe at year-end — worth a W-4 check.",
      bg: "var(--color-warm-subtle, #fffbeb)",
      border: "rgba(217,119,6,0.25)",
      textColor: "#78350f",
      strongColor: "#92400e",
    };
  }
  if (fedYtd <= 28) {
    return {
      icon: "✓",
      label: "On track",
      hint: "in the typical 16–28% range. Likely near break-even at filing.",
      bg: "var(--color-forest-subtle, #f0fdf4)",
      border: "rgba(22,163,74,0.2)",
      textColor: "#14532d",
      strongColor: "#166534",
    };
  }
  return {
    icon: "↑",
    label: "Over-withheld",
    hint: "above 28% — you'll likely receive a refund. Consider adjusting your W-4.",
    bg: "var(--color-info-subtle, #eff6ff)",
    border: "rgba(37,99,235,0.2)",
    textColor: "#1e3a5f",
    strongColor: "#1e40af",
  };
}

const mono: CSSProperties = { fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" };

export function TaxSufficiencyAlert({
  federalRateYtd,
  federalRateCurrent,
  totalTaxRateYtd,
  totalTaxRateCurrent: _totalTaxRateCurrent,
}: TaxSufficiencyAlertProps) {
  if (federalRateYtd == null && totalTaxRateYtd == null) return null;

  const tier = federalRateYtd != null ? getTier(federalRateYtd) : null;

  const wrap: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    padding: "8px 12px",
    borderRadius: 7,
    background: tier?.bg ?? "var(--color-surface-secondary)",
    border: `1px solid ${tier?.border ?? "var(--color-border)"}`,
    fontSize: 12,
    lineHeight: 1.5,
    color: tier?.textColor ?? "var(--color-text-secondary)",
  };

  const rateStr = federalRateYtd != null
    ? federalRateYtd.toFixed(1) + "% YTD"
    : totalTaxRateYtd != null
      ? totalTaxRateYtd.toFixed(1) + "% YTD (all taxes)"
      : null;

  const currentStr = federalRateCurrent != null
    ? ` · ${federalRateCurrent.toFixed(1)}% this period`
    : "";

  return (
    <div style={wrap} role="status" aria-label="Tax withholding signal">
      <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }} aria-hidden>
        {tier?.icon ?? "·"}
      </span>
      <span>
        <strong style={{ color: tier?.strongColor ?? "inherit", ...mono }}>
          Federal {rateStr}
          {currentStr}
        </strong>
        {totalTaxRateYtd != null && federalRateYtd != null ? (
          <span style={{ color: tier?.textColor, opacity: 0.7 }}>
            {" "}· all taxes {totalTaxRateYtd.toFixed(1)}%
          </span>
        ) : null}
        {tier ? (
          <span> — {tier.hint}</span>
        ) : (
          <span> — tax withholding data signal only.</span>
        )}
      </span>
    </div>
  );
}
