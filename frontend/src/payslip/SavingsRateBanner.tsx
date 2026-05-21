import type { CSSProperties } from "react";

export type SavingsRateBannerProps = {
  rate: number | null;
  rateYtd: number | null;
};

export function SavingsRateBanner({ rate, rateYtd }: SavingsRateBannerProps) {
  if (rate == null) return null;

  const wrap: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 12px",
    borderRadius: 7,
    background: "var(--color-accent-subtle)",
    border: "1px solid rgba(45,106,79,0.2)",
    fontSize: 12
  };

  return (
    <div style={wrap} role="status">
      <span style={{ fontSize: 14 }} aria-hidden>
        🌱
      </span>
      <span style={{ color: "var(--fs-forest)", fontWeight: 700 }}>{rate.toFixed(1)}%</span>
      <span style={{ color: "var(--color-text-secondary)" }}>
        of gross to pre-tax contributions this period
      </span>
      {rateYtd != null ? (
        <span style={{ marginLeft: "auto", color: "var(--color-text-muted)" }}>
          {rateYtd.toFixed(1)}% YTD rate
        </span>
      ) : null}
    </div>
  );
}
