import type { CSSProperties } from "react";
import { DeltaBadge } from "./deltaUtils";
import { formatUsd } from "../utils/format";

export type KpiStripItem = {
  label: string;
  value: number | null;
  prior: number | null | undefined;
  inverseSign?: boolean;
  accent?: boolean;
};

export type KpiStripProps = {
  kpis: KpiStripItem[];
};

const mono: CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace"
};

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `$${formatUsd(n)}`;
}

export function KpiStrip({ kpis }: KpiStripProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
        marginBottom: 10
      }}
    >
      {kpis.map(({ label, value, prior, inverseSign, accent }) => (
        <div
          key={label}
          style={{
            padding: "12px 14px",
            borderRadius: 9,
            background: accent ? "var(--fs-forest)" : "var(--color-surface)",
            border: accent ? "1px solid transparent" : "1px solid var(--color-border)",
            boxShadow: "0 1px 3px rgba(28,25,23,0.05)"
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: accent ? "rgba(240,233,216,0.6)" : "var(--color-text-muted)",
              marginBottom: 4
            }}
          >
            {label}
          </div>
          <div
            style={{
              ...mono,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: accent ? "#f0e9d8" : "var(--color-text)",
              marginBottom: 5
            }}
            role="text"
          >
            {fmtMoney(value)}
          </div>
          <DeltaBadge current={value} prior={prior} inverseSign={inverseSign} />
        </div>
      ))}
    </div>
  );
}
