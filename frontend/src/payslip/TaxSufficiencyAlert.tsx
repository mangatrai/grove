import type { CSSProperties } from "react";

export type TaxSufficiencyAlertProps = {
  federalRateYtd: number | null;
  federalRateCurrent: number | null;
  totalTaxRateYtd: number | null;
  totalTaxRateCurrent: number | null;
};

type TaxTier = {
  icon: string;
  label: string;
  commentary: string;
  accentColor: string;
  bg: string;
  border: string;
  textColor: string;
  badgeBg: string;
  badgeColor: string;
};

function getTier(fedYtd: number): TaxTier {
  if (fedYtd < 10) {
    return {
      icon: "⚠",
      label: "Under-withheld",
      commentary:
        "Federal withholding is below 10% of gross YTD. You may owe a significant balance at filing — and possibly an underpayment penalty. Review your W-4.",
      accentColor: "#d97706",
      bg: "var(--color-warm-subtle, #fffbeb)",
      border: "rgba(217,119,6,0.3)",
      textColor: "#78350f",
      badgeBg: "#fef3c7",
      badgeColor: "#92400e",
    };
  }
  if (fedYtd < 16) {
    return {
      icon: "↘",
      label: "Below average",
      commentary:
        "Running below the typical 16–22% federal range. You may still owe at year-end depending on deductions and filing status. Worth a quick W-4 check.",
      accentColor: "#d97706",
      bg: "var(--color-warm-subtle, #fffbeb)",
      border: "rgba(217,119,6,0.2)",
      textColor: "#78350f",
      badgeBg: "#fef3c7",
      badgeColor: "#92400e",
    };
  }
  if (fedYtd <= 28) {
    return {
      icon: "✓",
      label: "On track",
      commentary:
        "Federal withholding is in the typical 16–28% range. You're likely to land near break-even at filing.",
      accentColor: "#16a34a",
      bg: "var(--color-forest-subtle, #f0fdf4)",
      border: "rgba(22,163,74,0.2)",
      textColor: "#14532d",
      badgeBg: "#dcfce7",
      badgeColor: "#166534",
    };
  }
  return {
    icon: "↑",
    label: "Over-withheld",
    commentary:
      "Federal withholding exceeds 28% of gross. You'll likely receive a refund — but that's an interest-free loan to the IRS. Consider adjusting your W-4 to increase take-home pay.",
    accentColor: "#2563eb",
    bg: "var(--color-info-subtle, #eff6ff)",
    border: "rgba(37,99,235,0.2)",
    textColor: "#1e3a5f",
    badgeBg: "#dbeafe",
    badgeColor: "#1e40af",
  };
}

function StatBlock({
  label,
  ytd,
  current,
  accentColor,
}: {
  label: string;
  ytd: number | null;
  current: number | null;
  accentColor: string;
}) {
  const mono: CSSProperties = { fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" };
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.6 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...mono, fontSize: 22, fontWeight: 700, lineHeight: 1, color: accentColor }}>
          {ytd != null ? `${ytd.toFixed(1)}%` : "—"}
        </span>
        <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 600 }}>YTD</span>
      </div>
      <div style={{ ...mono, fontSize: 11, opacity: 0.55 }}>
        {current != null ? `${current.toFixed(1)}% this period` : "no current data"}
      </div>
    </div>
  );
}

export function TaxSufficiencyAlert({
  federalRateYtd,
  federalRateCurrent,
  totalTaxRateYtd,
  totalTaxRateCurrent,
}: TaxSufficiencyAlertProps) {
  if (federalRateYtd == null && totalTaxRateYtd == null) return null;

  const tier = federalRateYtd != null ? getTier(federalRateYtd) : null;
  const accentColor = tier?.accentColor ?? "var(--color-text-secondary)";

  const wrap: CSSProperties = {
    borderRadius: 8,
    background: tier?.bg ?? "var(--color-surface-secondary)",
    border: `1px solid ${tier?.border ?? "var(--color-border)"}`,
    borderLeft: `3px solid ${accentColor}`,
    overflow: "hidden",
  };

  const inner: CSSProperties = {
    padding: "11px 14px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  const badge: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.02em",
    background: tier?.badgeBg ?? "var(--color-surface)",
    color: tier?.badgeColor ?? "var(--color-text-secondary)",
  };

  return (
    <div style={wrap} role="status" aria-label="Tax withholding summary">
      <div style={inner}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: tier?.textColor ?? "var(--color-text)" }}>
            Tax Withholding
          </span>
          {tier && (
            <span style={badge}>
              <span aria-hidden>{tier.icon}</span>
              {tier.label}
            </span>
          )}
        </div>

        {/* Stat blocks */}
        <div style={{ display: "flex", gap: 20 }}>
          <StatBlock
            label="Federal"
            ytd={federalRateYtd}
            current={federalRateCurrent}
            accentColor={accentColor}
          />
          <div style={{ width: 1, background: tier?.border ?? "var(--color-border)", flexShrink: 0 }} />
          <StatBlock
            label="All taxes"
            ytd={totalTaxRateYtd}
            current={totalTaxRateCurrent}
            accentColor="var(--color-text-secondary)"
          />
        </div>

        {/* Commentary */}
        {tier && (
          <div
            style={{
              fontSize: 11.5,
              lineHeight: 1.55,
              color: tier.textColor,
              opacity: 0.85,
              borderTop: `1px solid ${tier.border}`,
              paddingTop: 8,
            }}
          >
            {tier.commentary}
          </div>
        )}
      </div>
    </div>
  );
}
