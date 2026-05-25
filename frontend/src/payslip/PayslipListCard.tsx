import type { CSSProperties } from "react";
import type { PayslipSnapshotDetail } from "./types";
import { DeltaBadge } from "./deltaUtils";
import { formatUsd } from "../utils/format";

export type PayslipListCardProps = {
  payslip: PayslipSnapshotDetail;
  personName: string;
  personInitials: string;
  personColor: string;
  employerName: string | null;
  onClick: () => void;
};

const mono: CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace"
};

const headingFont: CSSProperties = {
  fontFamily: "var(--font-heading)"
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${formatUsd(n)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const parsed = new Date(`${d}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function PayslipListCard({
  payslip,
  personName,
  personInitials,
  personColor,
  employerName,
  onClick
}: PayslipListCardProps) {
  const prior = payslip.prior;
  const gross = payslip.grossPayCurrent;
  const net = payslip.netPayCurrent;
  const taxes = payslip.employeeTaxesCurrent;

  const baseCard: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "11px 16px",
    marginBottom: 6,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 9,
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(28,25,23,0.05)",
    transition: "box-shadow 0.15s ease"
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={baseCard}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "var(--shadow-card)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(28,25,23,0.05)";
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: personColor,
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              flexShrink: 0,
              ...headingFont
            }}
            aria-hidden
          >
            {personInitials}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", ...headingFont }}>
            {personName}
          </span>
          {employerName ? (
            <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>· {employerName}</span>
          ) : null}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
          {fmtDate(payslip.payPeriodStart)} – {fmtDate(payslip.payPeriodEnd)}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 1 }}>
          Pay date:{" "}
          <strong style={{ color: "var(--color-text-secondary)" }}>{fmtDate(payslip.payDate)}</strong>
        </div>
      </div>

      <div style={{ display: "flex", gap: 22, alignItems: "center", flexShrink: 0 }}>
        {[
          { label: "Gross", value: gross, priorVal: prior?.grossPayCurrent, color: "var(--color-text)", inv: false },
          { label: "Net", value: net, priorVal: prior?.netPayCurrent, color: "var(--fs-forest)", inv: false },
          {
            label: "Taxes",
            value: taxes,
            priorVal: prior?.employeeTaxesCurrent,
            color: "var(--color-text-secondary)",
            inv: true
          }
        ].map(({ label, value, priorVal, color, inv }) => (
          <div key={label} style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--color-text-muted)",
                marginBottom: 2
              }}
            >
              {label}
            </div>
            <div style={{ ...mono, fontSize: 14, fontWeight: 500, color }} role="text">
              {fmtMoney(value)}
            </div>
            <div style={{ marginTop: 2 }}>
              <DeltaBadge current={value} prior={priorVal} inverseSign={!!inv} />
            </div>
          </div>
        ))}
      </div>

      <span style={{ color: "var(--color-text-muted)", fontSize: 16, marginLeft: 4 }} aria-hidden>
        ›
      </span>
    </div>
  );
}
