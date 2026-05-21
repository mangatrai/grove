import { useState } from "react";
import type { CSSProperties } from "react";
import { formatUsd } from "../utils/format";

export type ContribBucketItem = {
  name: string;
  amountCurrent: number | null;
  amountYtd: number | null;
};

export type ContribBucketProps = {
  label: string;
  colorDot: string;
  items: ContribBucketItem[];
};

const mono: CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace"
};

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `$${formatUsd(n)}`;
}

export function ContribBucket({ label, colorDot, items }: ContribBucketProps) {
  const [open, setOpen] = useState(true);

  if (items.length === 0) return null;

  const tot = items.reduce((s, i) => s + (i.amountCurrent ?? 0), 0);
  const totYtd = items.reduce((s, i) => s + (i.amountYtd ?? 0), 0);

  const toggleStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "4px 0",
    background: "none",
    border: "none",
    cursor: "pointer",
    gap: 7,
    minHeight: 44
  };

  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} style={toggleStyle} aria-expanded={open}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 2,
            background: colorDot,
            flexShrink: 0
          }}
          aria-hidden
        />
        <span style={{ flex: 1, textAlign: "left", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
          {label}
        </span>
        <span style={{ ...mono, fontSize: 12.5, minWidth: 72, textAlign: "right" }} role="text">
          {fmtMoney(tot)}
        </span>
        <span
          style={{
            ...mono,
            fontSize: 11.5,
            color: "var(--color-text-muted)",
            minWidth: 72,
            textAlign: "right"
          }}
          role="text"
        >
          {fmtMoney(totYtd)}
        </span>
        <span style={{ color: "var(--color-text-muted)", fontSize: 9, marginLeft: 2 }} aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open
        ? items.map((item, i) => (
            <div
              key={`${item.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "2px 0 2px 16px",
                fontSize: 12,
                color: "var(--color-text-secondary)"
              }}
            >
              <span style={{ flex: 1 }}>{item.name}</span>
              <span style={{ ...mono, fontSize: 12, minWidth: 72, textAlign: "right" }} role="text">
                {fmtMoney(item.amountCurrent)}
              </span>
              <span
                style={{
                  ...mono,
                  fontSize: 11.5,
                  color: "var(--color-text-muted)",
                  minWidth: 72,
                  textAlign: "right"
                }}
                role="text"
              >
                {fmtMoney(item.amountYtd)}
              </span>
            </div>
          ))
        : null}
    </div>
  );
}
