import { createElement, type CSSProperties, type ReactNode } from "react";

export type DeltaResult = {
  abs: number;
  pct: number;
  up: boolean;
};

export function computeDelta(
  current: number,
  prior: number | null | undefined,
  inverseSign = false
): DeltaResult | null {
  if (prior == null || prior === 0) return null;
  const abs = current - prior;
  const pct = (abs / prior) * 100;
  const up = inverseSign ? abs < 0 : abs > 0;
  return { abs, pct, up };
}

export type DeltaBadgeProps = {
  current: number | null | undefined;
  prior: number | null | undefined;
  inverseSign?: boolean;
};

const mutedStyle: CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: 11
};

const forest = "var(--fs-forest)";
const terracotta = "var(--fs-terracotta)";

export function DeltaBadge({ current, prior, inverseSign = false }: DeltaBadgeProps): ReactNode {
  if (current == null) {
    return createElement("span", { style: mutedStyle }, "—");
  }
  const d = computeDelta(current, prior, inverseSign);
  if (!d) {
    return createElement("span", { style: mutedStyle }, "—");
  }
  const { abs, pct, up } = d;
  const color = up ? forest : terracotta;
  const bg = up ? "rgba(45,106,79,0.11)" : "rgba(139,58,38,0.11)";
  const arrow = abs > 0 ? "↑" : "↓";
  const pillStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    background: bg,
    color,
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap"
  };
  return createElement(
    "span",
    { style: pillStyle, role: "text" },
    `${arrow} $${Math.abs(abs).toFixed(0)}`,
    createElement(
      "span",
      { style: { opacity: 0.65, marginLeft: 2 } },
      `· ${Math.abs(pct).toFixed(1)}%`
    )
  );
}
