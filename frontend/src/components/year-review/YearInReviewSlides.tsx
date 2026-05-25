import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api";
import type { YearSummaryData } from "./types";

// ── Slide metadata ────────────────────────────────────────────────────────────

export const SLIDES = [
  { key: "s01", label: "",           glow: "radial-gradient(ellipse 70% 65% at 15% 85%, rgba(45,106,79,0.32) 0%, transparent 68%)" },
  { key: "s02", label: "Your Story", glow: "radial-gradient(ellipse 55% 55% at 85% 15%, rgba(200,134,10,0.07) 0%, transparent 62%)" },
  { key: "s03", label: "Income",     glow: "radial-gradient(ellipse 65% 60% at 8% 88%, rgba(200,134,10,0.24) 0%, transparent 65%)" },
  { key: "s04", label: "Savings",    glow: "radial-gradient(ellipse 65% 65% at 92% 12%, rgba(45,106,79,0.28) 0%, transparent 65%)" },
  { key: "s05", label: "Spending",   glow: "radial-gradient(ellipse 55% 55% at 88% 88%, rgba(139,58,38,0.22) 0%, transparent 65%)" },
  { key: "s06", label: "Taxes",      glow: "radial-gradient(ellipse 60% 60% at 15% 85%, rgba(139,58,38,0.18) 0%, transparent 65%)" },
  { key: "s07", label: "Months",     glow: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(28,40,30,0.8) 0%, transparent 100%)" },
  { key: "s08", label: "Net Worth",  glow: "radial-gradient(ellipse 65% 60% at 12% 88%, rgba(200,134,10,0.22) 0%, transparent 65%)" },
  { key: "s09", label: "Big Move",   glow: "radial-gradient(ellipse 45% 45% at 50% 50%, rgba(200,134,10,0.12) 0%, transparent 70%)" },
  { key: "s10", label: "Merchant",   glow: "radial-gradient(ellipse 60% 55% at 85% 15%, rgba(45,106,79,0.2) 0%, transparent 65%)" },
  { key: "s11", label: `vs prev`,    glow: "none" },
  { key: "s12", label: "Wrap-Up",    glow: "radial-gradient(ellipse 70% 70% at 50% 50%, rgba(45,106,79,0.22) 0%, transparent 68%)" },
];

// ── Shared types ──────────────────────────────────────────────────────────────

type SlideProps = {
  data: YearSummaryData;
  active: boolean;
  onNext?: () => void;
  onClose?: () => void;
  year?: number;
  narrative?: string[];
};

// ── Shared primitives ─────────────────────────────────────────────────────────

function GroveMark({ size = 32, color = "#f0e9d8", opacity = 1 }: { size?: number; color?: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <rect x="2"    y="12" width="9" height="22" rx="4.5" fill={color} fillOpacity={opacity} />
      <rect x="13.5" y="4"  width="9" height="30" rx="4.5" fill={color} fillOpacity={opacity} />
      <rect x="25"   y="16" width="9" height="18" rx="4.5" fill={color} fillOpacity={opacity} />
    </svg>
  );
}

function EyebrowLabel({ children, color = "rgba(240,233,216,0.38)" }: { children: React.ReactNode; color?: string }) {
  return (
    <p style={{
      fontFamily: "'Inter', sans-serif",
      fontSize: "0.68rem",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.16em",
      color,
      marginBottom: "0.6rem",
    }}>
      {children}
    </p>
  );
}

function Chip({ children, color = "#4a8a6e", bg = "rgba(45,106,79,0.18)", border }: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 11px",
      borderRadius: "999px",
      background: bg,
      color,
      fontSize: "0.76rem",
      fontWeight: 700,
      border: `1px solid ${border ?? color + "44"}`,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, color = "rgba(240,233,216,0.6)", small }: {
  label: string;
  value: string | number;
  color?: string;
  small?: boolean;
}) {
  return (
    <div style={{
      padding: "1.1rem 1.25rem",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "14px",
      flex: "1 1 110px",
    }}>
      <p style={{
        fontSize: "0.65rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: "rgba(240,233,216,0.3)",
        marginBottom: "0.3rem",
      }}>
        {label}
      </p>
      <p style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: small ? "1.1rem" : "1.75rem",
        fontWeight: 600,
        color,
        lineHeight: 1,
      }}>
        {value}
      </p>
    </div>
  );
}

// ── CountUp hook ──────────────────────────────────────────────────────────────

function useCountUp(target: number, active: boolean, duration = 1300): number {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) { setVal(0); return; }
    setVal(0);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(e * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [active, target, duration]);

  return val;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}
function fmtFull(n: number): string {
  return "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Slide 01 – Title Hero ─────────────────────────────────────────────────────

function Slide01({ data, onNext }: SlideProps) {
  return (
    <div className="yr-slide-inner">
      <div style={{
        position: "absolute", right: "-60px", top: "50%",
        transform: "translateY(-55%)", opacity: 0.05, pointerEvents: "none", zIndex: 0,
      }}>
        <GroveMark size={500} color="#f0e9d8" />
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "3.5rem" }}>
          <GroveMark size={20} color="#4a8a6e" />
          <span style={{
            fontFamily: "'Inter Tight', sans-serif", fontWeight: 700, fontSize: "0.88rem",
            color: "#4a8a6e", letterSpacing: "0.01em",
          }}>Grove</span>
        </div>
        <p style={{
          fontFamily: "'Inter', sans-serif", fontSize: "0.72rem", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.18em", color: "#4a8a6e", marginBottom: "0.9rem",
        }}>
          {data.householdName}
        </p>
        <h1 style={{
          fontFamily: "'Inter Tight', sans-serif", fontWeight: 900, lineHeight: 0.88,
          letterSpacing: "-0.055em", color: "#f0e9d8", margin: "0 0 0.4rem",
          fontSize: "clamp(5.5rem,20vw,11rem)",
        }}>
          {data.year}
        </h1>
        <p style={{
          fontFamily: "'Inter Tight', sans-serif", fontWeight: 700,
          fontSize: "clamp(1.4rem,4vw,2.4rem)", letterSpacing: "-0.03em",
          color: "rgba(240,233,216,0.42)", marginBottom: "3.5rem",
        }}>
          Year in Review
        </p>
        <button className="yr-cta-btn" onClick={onNext}>
          View your year <span style={{ marginLeft: "0.3rem" }}>→</span>
        </button>
      </div>
    </div>
  );
}

// ── Slide 02 – At a Glance ────────────────────────────────────────────────────

function Slide02({ data, active, narrative }: SlideProps) {
  const net = data.monthlyIncome.map((inc, i) => inc - data.monthlySpending[i]);
  const maxAbs = Math.max(...net.map(Math.abs), 1);
  const W = 300, MID = 50, BAR_AREA = 42, barW = W / 12 - 2.5;

  const yoyIncome = data.priorYear && data.priorYear.income > 0
    ? ((data.income - data.priorYear.income) / data.priorYear.income * 100).toFixed(1)
    : null;

  const bestMonthIdx = net.indexOf(Math.max(...net));
  const worstMonthIdx = net.indexOf(Math.min(...net));

  return (
    <div className="yr-slide-inner">
      <EyebrowLabel>Your {data.year} at a glance</EyebrowLabel>

      <div style={{ display: "flex", gap: "0.65rem", marginBottom: "1.75rem", flexWrap: "wrap" }}>
        {[
          { label: "Income",       value: fmtShort(data.income),   sub: yoyIncome ? `+${yoyIncome}% vs ${data.year - 1}` : "total", color: "#c8860a" },
          { label: "Savings Rate", value: `${data.savingsRate.toFixed(1)}%`, sub: `${fmtFull(data.netSavings)} saved`, color: "#4a8a6e" },
          { label: "Net Worth",    value: fmtShort(data.netWorthEnd), sub: data.netWorthChange >= 0 ? `↑ ${fmtShort(data.netWorthChange)}` : `↓ ${fmtShort(Math.abs(data.netWorthChange))}`, color: "#f0e9d8" },
        ].map((ins) => (
          <div key={ins.label} style={{
            flex: "1 1 110px", padding: "0.9rem 1.1rem",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px",
          }}>
            <p style={{ fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(240,233,216,0.28)", marginBottom: "0.3rem" }}>
              {ins.label}
            </p>
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.45rem", fontWeight: 600, color: ins.color, lineHeight: 1, marginBottom: "0.2rem" }}>
              {ins.value}
            </p>
            <p style={{ fontSize: "0.68rem", color: "rgba(240,233,216,0.28)" }}>{ins.sub}</p>
          </div>
        ))}
      </div>

      <p style={{ fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(240,233,216,0.22)", marginBottom: "0.55rem" }}>
        Net savings · month by month
      </p>
      <svg viewBox={`0 0 ${W} ${MID * 2 + 20}`}
        style={{ width: "100%", maxWidth: 520, display: "block", marginBottom: "1.5rem", overflow: "visible" }}>
        <line x1="0" y1={MID} x2={W} y2={MID} stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
        {net.map((v, i) => {
          const isPos = v >= 0;
          const h = Math.max(3, (Math.abs(v) / maxAbs) * (BAR_AREA - 2));
          const x = i * (W / 12) + 1;
          const y = isPos ? MID - h : MID;
          const fill = isPos ? "#2d6a4f" : "#8b3a26";
          const isBest = i === bestMonthIdx;
          const isWorst = i === worstMonthIdx;
          return (
            <g key={i}>
              <rect x={x} y={active ? y : MID} width={barW}
                height={active ? h : 0} fill={fill}
                fillOpacity={isBest || isWorst ? 1 : 0.6} rx="2"
                style={{ transition: `y 0.65s cubic-bezier(0.34,1.2,0.64,1) ${i * 0.042}s, height 0.65s cubic-bezier(0.34,1.2,0.64,1) ${i * 0.042}s` }}
              />
              {isBest && active && <>
                <line x1={x + barW / 2} y1={y - 3} x2={x + barW / 2} y2={y - 12}
                  stroke="rgba(74,138,110,0.6)" strokeWidth="1" strokeDasharray="2 2" />
                <text x={x + barW / 2} y={y - 15} textAnchor="middle" fontSize="6"
                  fill="#4a8a6e" fontFamily="'Inter',sans-serif" fontWeight="700">Best ✓</text>
              </>}
              {isWorst && active && <>
                <line x1={x + barW / 2} y1={MID + h + 3} x2={x + barW / 2} y2={MID + h + 12}
                  stroke="rgba(139,58,38,0.6)" strokeWidth="1" strokeDasharray="2 2" />
                <text x={x + barW / 2} y={MID + h + 20} textAnchor="middle" fontSize="6"
                  fill="#c08070" fontFamily="'Inter',sans-serif" fontWeight="700">Tough</text>
              </>}
              <text x={x + barW / 2} y={MID * 2 + 14} textAnchor="middle" fontSize="6.5"
                fill="rgba(240,233,216,0.2)" fontFamily="'Inter',sans-serif">
                {MONTH_LABELS[i]}
              </text>
            </g>
          );
        })}
      </svg>

      {narrative?.[2] && (
        <>
          <p style={{ fontSize: "0.86rem", color: "rgba(240,233,216,0.42)", lineHeight: 1.65, maxWidth: 500, fontStyle: "italic" }}>
            "{narrative[2]}"
          </p>
          <div style={{ marginTop: "0.65rem", display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <GroveMark size={12} color="#4a8a6e" />
            <span style={{ fontSize: "0.65rem", color: "#4a8a6e", letterSpacing: "0.06em" }}>Grove AI</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Slide 03 – Income ─────────────────────────────────────────────────────────

function Slide03({ data, active }: SlideProps) {
  const count = useCountUp(data.income, active);
  const months = data.monthlyIncome;
  const mMax = Math.max(...months, 1);
  const W = 300, H = 44;
  const pts = months.map((v, i) => `${(i / 11) * W},${H - (v / mMax) * (H - 4) - 2}`).join(" ");
  const areaClose = `0,${H} ${pts} ${W},${H}`;

  const yoy = data.priorYear && data.priorYear.income > 0
    ? ((data.income - data.priorYear.income) / data.priorYear.income * 100).toFixed(1)
    : null;

  return (
    <div className="yr-slide-inner">
      <EyebrowLabel color="rgba(200,134,10,0.6)">Total Household Income</EyebrowLabel>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.3rem", marginBottom: "0.6rem" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, lineHeight: 1,
          letterSpacing: "-0.04em", color: "#f0e9d8",
          fontSize: "clamp(3rem,10vw,6rem)",
        }}>
          ${count.toLocaleString("en-US")}
        </span>
      </div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap" }}>
        {yoy && (
          <Chip color="#c8860a" bg="rgba(200,134,10,0.15)" border="#c8860a">
            ↑ {yoy}% vs {data.year - 1}
          </Chip>
        )}
        {data.priorYear && (
          <span style={{ fontSize: "0.82rem", color: "rgba(240,233,216,0.3)" }}>
            +{fmtFull(data.income - data.priorYear.income)} more than last year
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 480, height: H, overflow: "visible", display: "block" }}>
        <defs>
          <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c8860a" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#c8860a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaClose} fill="url(#goldFill)" />
        <polyline points={pts} fill="none" stroke="rgba(200,134,10,0.65)" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p style={{ fontSize: "0.68rem", color: "rgba(240,233,216,0.22)", letterSpacing: "0.05em", marginTop: "0.4rem" }}>
        monthly income · {data.year}
      </p>
    </div>
  );
}

// ── Slide 04 – Savings ────────────────────────────────────────────────────────

function Slide04({ data, active }: SlideProps) {
  const count = useCountUp(data.netSavings, active);
  const rate = data.savingsRate;
  const R = 52, cx = 70, cy = 70;
  const circ = 2 * Math.PI * R;
  const dash = circ * (1 - rate / 100);

  const kept = Math.round(rate / 10);

  return (
    <div className="yr-slide-inner">
      <div style={{ display: "flex", gap: "3rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <EyebrowLabel>You Saved</EyebrowLabel>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, lineHeight: 1,
            letterSpacing: "-0.045em", color: "#f0e9d8", marginBottom: "0.75rem",
            fontSize: "clamp(2.75rem,9vw,5rem)",
          }}>
            ${count.toLocaleString("en-US")}
          </div>
          {data.priorYear && (
            <Chip>↑ +{fmtFull(data.netSavings - data.priorYear.netSavings)} vs {data.year - 1}</Chip>
          )}
          <p style={{ marginTop: "1.5rem", fontSize: "1rem", color: "rgba(240,233,216,0.45)", lineHeight: 1.65 }}>
            For every dollar you earned,<br />
            <strong style={{ color: "#a8d4bc", fontSize: "1.1rem" }}>you kept {kept}¢.</strong>
          </p>
          {data.payslip && (
            <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <Chip color="#4a8a6e" bg="rgba(45,106,79,0.12)">
                {fmtFull(data.payslip.preTaxContributionsYtd)} pre-tax
              </Chip>
              <Chip color="#4a8a6e" bg="rgba(45,106,79,0.12)">
                {fmtFull(data.payslip.postTaxContributionsYtd)} post-tax
              </Chip>
            </div>
          )}
        </div>

        <div style={{ flex: "0 0 150px", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(45,106,79,0.14)" strokeWidth="10" />
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="#2d6a4f" strokeWidth="10"
              strokeDasharray={circ} strokeDashoffset={active ? dash : circ}
              strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.34,1.4,0.64,1) 0.15s" }}
            />
            <text x={cx} y={cy - 8} textAnchor="middle"
              fontFamily="'JetBrains Mono',monospace" fontSize="20" fontWeight="600" fill="#f0e9d8">
              {rate.toFixed(1)}%
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle"
              fontFamily="'Inter',sans-serif" fontSize="9.5" fill="rgba(240,233,216,0.38)">
              savings rate
            </text>
            {data.priorYear && (
              <text x={cx} y={cy + 26} textAnchor="middle"
                fontFamily="'Inter',sans-serif" fontSize="8.5" fill="rgba(240,233,216,0.22)">
                vs {data.priorYear.savingsRate.toFixed(1)}% in {data.year - 1}
              </text>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── Slide 05 – Categories ─────────────────────────────────────────────────────

const CAT_COLORS = ["#2d6a4f", "#c8860a", "#b86b4a", "#7a8a6e", "#8a7a68"];

function Slide05({ data, active }: SlideProps) {
  const shown = data.topCategories.reduce((s, c) => s + c.amount, 0);
  const maxAmt = data.topCategories[0]?.amount ?? 1;
  return (
    <div className="yr-slide-inner">
      <EyebrowLabel color="rgba(184,107,74,0.6)">Where It Went</EyebrowLabel>
      <h2 className="yr-heading" style={{ marginBottom: "1.75rem" }}>Top 5 spending categories</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 560 }}>
        {data.topCategories.map((cat, i) => (
          <div key={cat.name}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "rgba(240,233,216,0.8)" }}>
                {cat.name}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8rem", color: CAT_COLORS[i] }}>
                {fmtFull(cat.amount)} · {cat.pct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: "7px", background: "rgba(255,255,255,0.07)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "4px", background: CAT_COLORS[i],
                width: active ? `${(cat.amount / maxAmt) * 100}%` : "0%",
                transition: `width 0.9s cubic-bezier(0.34,1.1,0.64,1) ${i * 0.12}s`,
              }} />
            </div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: "1.5rem", fontSize: "0.76rem", color: "rgba(240,233,216,0.25)" }}>
        {fmtFull(shown)} of {fmtFull(data.spending)} total spend shown above
      </p>
    </div>
  );
}

// ── Slide 06 – Taxes ──────────────────────────────────────────────────────────

function Slide06({ data, active }: SlideProps) {
  const totalTax = useCountUp(data.payslip?.totalTaxYtd ?? 0, active);
  const p = data.payslip;

  if (!p) {
    return (
      <div className="yr-slide-inner" style={{ alignItems: "center", textAlign: "center", width: "100%" }}>
        <EyebrowLabel color="rgba(139,58,38,0.6)">Taxes Paid in {data.year}</EyebrowLabel>
        <p style={{ color: "rgba(240,233,216,0.38)", fontSize: "0.9rem", marginTop: "1rem" }}>
          No payslip data available for {data.year}.
        </p>
      </div>
    );
  }

  return (
    <div className="yr-slide-inner">
      <EyebrowLabel color="rgba(139,58,38,0.6)">Taxes Paid in {data.year}</EyebrowLabel>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, lineHeight: 1,
        letterSpacing: "-0.04em", color: "#f0e9d8", marginBottom: "0.75rem",
        fontSize: "clamp(2.75rem,9vw,5rem)",
      }}>
        ${totalTax.toLocaleString("en-US")}
      </div>
      <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        <Chip color="#c8860a" bg="rgba(200,134,10,0.15)" border="#c8860a">
          {p.effectiveFederalRatePct.toFixed(1)}% federal effective rate
        </Chip>
        {p.effectiveTotalRatePct > 0 && (
          <Chip color="#c08070" bg="rgba(139,58,38,0.15)" border="#c08070">
            {p.effectiveTotalRatePct.toFixed(1)}% total effective rate
          </Chip>
        )}
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <StatCard label="Federal" value={`$${Math.round(p.federalTaxYtd).toLocaleString("en-US")}`} color="#c08070" />
        {p.stateTaxYtd > 0 && (
          <StatCard label="State" value={`$${Math.round(p.stateTaxYtd).toLocaleString("en-US")}`} color="#c08070" />
        )}
        {p.socialSecurityYtd > 0 && (
          <StatCard label="Soc. Security" value={`$${Math.round(p.socialSecurityYtd).toLocaleString("en-US")}`} color="rgba(240,233,216,0.45)" small />
        )}
        {p.medicareTaxYtd > 0 && (
          <StatCard label="Medicare" value={`$${Math.round(p.medicareTaxYtd).toLocaleString("en-US")}`} color="rgba(240,233,216,0.45)" small />
        )}
      </div>
    </div>
  );
}

// ── Slide 07 – Best & Worst Months ───────────────────────────────────────────

function Slide07({ data, active }: SlideProps) {
  const bestSavings = Math.abs(data.bestMonth.netSavings);
  const worstSavings = Math.abs(data.worstMonth.netSavings);
  const best = useCountUp(bestSavings, active);
  const worst = useCountUp(worstSavings, active);
  const swing = data.bestMonth.netSavings - data.worstMonth.netSavings;

  return (
    <div className="yr-slide-inner">
      <EyebrowLabel>Your Months</EyebrowLabel>
      <h2 className="yr-heading" style={{ marginBottom: "2rem" }}>Peaks and valleys</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxWidth: 560 }}>
        <div style={{ padding: "1.5rem", background: "rgba(45,106,79,0.1)", border: "1px solid rgba(45,106,79,0.22)", borderRadius: "18px" }}>
          <p style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#4a8a6e", marginBottom: "0.6rem" }}>Best month</p>
          <p style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 800, fontSize: "1.5rem", color: "#f0e9d8", marginBottom: "0.35rem" }}>{data.bestMonth.month}</p>
          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.6rem", color: "#4a8a6e", fontWeight: 600, lineHeight: 1 }}>+${best.toLocaleString("en-US")}</p>
          <p style={{ fontSize: "0.72rem", color: "rgba(240,233,216,0.3)", marginTop: "0.5rem" }}>net savings</p>
        </div>
        <div style={{ padding: "1.5rem", background: "rgba(139,58,38,0.1)", border: "1px solid rgba(139,58,38,0.22)", borderRadius: "18px" }}>
          <p style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#c08070", marginBottom: "0.6rem" }}>Hardest month</p>
          <p style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 800, fontSize: "1.5rem", color: "#f0e9d8", marginBottom: "0.35rem" }}>{data.worstMonth.month}</p>
          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.6rem", color: "#c08070", fontWeight: 600, lineHeight: 1 }}>−${worst.toLocaleString("en-US")}</p>
          <p style={{ fontSize: "0.72rem", color: "rgba(240,233,216,0.3)", marginTop: "0.5rem" }}>net savings</p>
        </div>
      </div>
      <p style={{ marginTop: "1.5rem", fontSize: "0.88rem", color: "rgba(240,233,216,0.38)", lineHeight: 1.6, maxWidth: 500 }}>
        A <strong style={{ color: "rgba(240,233,216,0.65)" }}>{fmtFull(swing)} swing</strong> between your best and worst month — that's the full picture of {data.year}.
      </p>
    </div>
  );
}

// ── Slide 08 – Net Worth ──────────────────────────────────────────────────────

function Slide08({ data, active }: SlideProps) {
  const endCount = useCountUp(data.netWorthEnd, active, 1400);
  const growthPct = data.netWorthStart !== 0
    ? ((data.netWorthChange / Math.abs(data.netWorthStart)) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="yr-slide-inner">
      <EyebrowLabel color="rgba(200,134,10,0.55)">Net Worth Journey</EyebrowLabel>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: "0.72rem", color: "rgba(240,233,216,0.3)", marginBottom: "0.2rem" }}>Jan 1 · start</p>
          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.6rem", color: "rgba(240,233,216,0.35)", fontWeight: 500 }}>
            {fmtShort(data.netWorthStart)}
          </p>
        </div>
        <div style={{ flex: 1, minWidth: 60, height: "2px", background: "linear-gradient(90deg,rgba(200,134,10,0.25),rgba(200,134,10,0.7))" }} />
        <Chip color="#c8860a" bg="rgba(200,134,10,0.15)" border="#c8860a">
          {data.netWorthChange >= 0 ? "+" : ""}{fmtFull(data.netWorthChange)} · {data.netWorthChange >= 0 ? "+" : ""}{growthPct}%
        </Chip>
        <div style={{ flex: 1, minWidth: 60, height: "2px", background: "linear-gradient(90deg,rgba(200,134,10,0.7),rgba(200,134,10,0.25))" }} />
      </div>

      <p style={{
        fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, lineHeight: 1,
        letterSpacing: "-0.045em", color: "#f0e9d8", margin: "0.5rem 0 0.35rem",
        fontSize: "clamp(2.75rem,9vw,5rem)",
      }}>
        ${endCount.toLocaleString("en-US")}
      </p>
      <p style={{ fontSize: "0.72rem", color: "rgba(240,233,216,0.3)", marginBottom: "2.25rem" }}>Dec 31 · end</p>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {data.investments && (
          <>
            <StatCard label="Investments grew" value={`+${fmtFull(data.investments.growth)}`} color="#4a8a6e" />
            <StatCard label="Return rate" value={`+${data.investments.growthPct.toFixed(1)}%`} color="#4a8a6e" />
          </>
        )}
        <StatCard label="Total gain" value={fmtShort(data.netWorthChange)} color="#c8860a" />
      </div>
    </div>
  );
}

// ── Slide 09 – Biggest Transaction ───────────────────────────────────────────

function Slide09({ data, active }: SlideProps) {
  const count = useCountUp(data.largestTransaction?.amount ?? 0, active);

  if (!data.largestTransaction) {
    return (
      <div className="yr-slide-inner" style={{ alignItems: "center", textAlign: "center", width: "100%" }}>
        <EyebrowLabel>Biggest Moment</EyebrowLabel>
        <p style={{ color: "rgba(240,233,216,0.38)", fontSize: "0.9rem", marginTop: "1rem" }}>No transactions found.</p>
      </div>
    );
  }

  const tx = data.largestTransaction;
  return (
    <div className="yr-slide-inner" style={{ alignItems: "center", textAlign: "center", width: "100%" }}>
      <EyebrowLabel>Biggest Moment</EyebrowLabel>
      <p style={{ fontSize: "0.86rem", color: "rgba(240,233,216,0.32)", marginBottom: "2rem" }}>
        Your largest single transaction of {data.year}
      </p>
      <div style={{
        display: "inline-flex", flexDirection: "column", alignItems: "center",
        padding: "2.25rem 2.75rem",
        background: "rgba(200,134,10,0.07)",
        border: "1px solid rgba(200,134,10,0.18)", borderRadius: "24px", marginBottom: "1.5rem",
      }}>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, lineHeight: 1,
          letterSpacing: "-0.045em", color: "#f0e9d8", marginBottom: "0.6rem",
          fontSize: "clamp(2.75rem,9vw,5rem)",
        }}>
          ${count.toLocaleString("en-US")}
        </p>
        <p style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 700, fontSize: "1.2rem", color: "rgba(240,233,216,0.7)", marginBottom: "0.3rem" }}>
          {tx.description}
        </p>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,233,216,0.3)" }}>{tx.date}</p>
      </div>
      {tx.category && (
        <Chip color="#c8860a" bg="rgba(200,134,10,0.15)" border="#c8860a">
          {tx.category}
        </Chip>
      )}
    </div>
  );
}

// ── Slide 10 – Top Merchant ───────────────────────────────────────────────────

function Slide10({ data, active }: SlideProps) {
  const visits = useCountUp(data.topMerchant?.visits ?? 0, active, 900);
  const spent = useCountUp(data.topMerchant?.totalSpent ?? 0, active, 1100);

  if (!data.topMerchant) {
    return (
      <div className="yr-slide-inner">
        <EyebrowLabel>Your Go-To</EyebrowLabel>
        <p style={{ color: "rgba(240,233,216,0.38)", fontSize: "0.9rem", marginTop: "1rem" }}>No merchant data found.</p>
      </div>
    );
  }

  const m = data.topMerchant;
  const avg = m.visits > 0 ? Math.round(m.totalSpent / m.visits) : 0;
  const perMonth = Math.round((m.visits / 12) * 10) / 10;

  return (
    <div className="yr-slide-inner">
      <EyebrowLabel>Your Go-To</EyebrowLabel>
      <h2 style={{
        fontFamily: "'Inter Tight', sans-serif", fontWeight: 900, lineHeight: 0.9,
        letterSpacing: "-0.05em", color: "#f0e9d8", margin: "0 0 0.6rem",
        fontSize: "clamp(3rem,12vw,5.5rem)",
      }}>
        {m.name}
      </h2>
      <p style={{ fontSize: "0.9rem", color: "rgba(240,233,216,0.4)", marginBottom: "2rem" }}>
        Your most-visited merchant in {data.year}
      </p>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <StatCard label="Visits" value={visits} color="#4a8a6e" />
        <StatCard label="Total spent" value={`$${Math.round(spent).toLocaleString("en-US")}`} color="#c8860a" />
        <StatCard label="Avg per visit" value={`$${avg}`} color="rgba(240,233,216,0.55)" />
      </div>
      <p style={{ fontSize: "0.86rem", color: "rgba(240,233,216,0.32)", lineHeight: 1.6 }}>
        That's roughly <strong style={{ color: "rgba(240,233,216,0.55)" }}>{perMonth} visits/month</strong>.
      </p>
    </div>
  );
}

// ── Slide 11 – Year-over-Year ─────────────────────────────────────────────────

function Slide11({ data }: SlideProps) {
  if (!data.priorYear) {
    return (
      <div className="yr-slide-inner">
        <EyebrowLabel>Then vs Now</EyebrowLabel>
        <p style={{ color: "rgba(240,233,216,0.38)", fontSize: "0.9rem", marginTop: "1rem" }}>
          No prior year data available for comparison.
        </p>
      </div>
    );
  }

  const rows = [
    { label: "Income",       cur: data.income,      prev: data.priorYear.income,      fmt: (v: number) => `$${Math.round(v / 1000)}k`, invert: false },
    { label: "Spending",     cur: data.spending,    prev: data.priorYear.spending,    fmt: (v: number) => `$${Math.round(v / 1000)}k`, invert: true  },
    { label: "Net Savings",  cur: data.netSavings,  prev: data.priorYear.netSavings,  fmt: (v: number) => `$${Math.round(v / 1000)}k`, invert: false },
    { label: "Savings Rate", cur: data.savingsRate, prev: data.priorYear.savingsRate, fmt: (v: number) => `${v.toFixed(1)}%`,           invert: false },
  ];

  return (
    <div className="yr-slide-inner">
      <EyebrowLabel>Then vs Now</EyebrowLabel>
      <h2 className="yr-heading" style={{ marginBottom: "2rem" }}>
        {data.year - 1} <span style={{ color: "rgba(240,233,216,0.25)" }}>→</span> {data.year}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 560 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr 68px", gap: "0.5rem",
          padding: "0 0.75rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "0.25rem",
        }}>
          {["Metric", String(data.year - 1), String(data.year), "Δ"].map((h, i) => (
            <span key={h} style={{
              fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.1em", color: "rgba(240,233,216,0.22)",
              textAlign: i > 0 ? "right" : "left",
            }}>{h}</span>
          ))}
        </div>
        {rows.map((row, i) => {
          const delta = row.cur - row.prev;
          const deltaPct = row.prev !== 0 ? ((delta / Math.abs(row.prev)) * 100).toFixed(1) : "–";
          const good = row.invert ? delta <= 0 : delta > 0;
          const dc = good ? "#4a8a6e" : "#c08070";
          return (
            <div key={row.label} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 68px",
              gap: "0.5rem", padding: "0.85rem 0.75rem", alignItems: "center",
              background: i % 2 === 0 ? "rgba(255,255,255,0.025)" : "transparent",
              borderRadius: "8px",
            }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "rgba(240,233,216,0.68)" }}>{row.label}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.84rem", color: "rgba(240,233,216,0.32)", textAlign: "right" }}>{row.fmt(row.prev)}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.9rem", color: "#f0e9d8", fontWeight: 600, textAlign: "right" }}>{row.fmt(row.cur)}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.76rem", color: dc, fontWeight: 700, textAlign: "right" }}>
                {delta > 0 ? "+" : ""}{deltaPct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Slide 12 – Closing ────────────────────────────────────────────────────────

function Slide12({ data, onClose, year }: SlideProps) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const growthPct = data.netWorthStart !== 0
    ? Math.round((data.netWorthChange / Math.abs(data.netWorthStart)) * 100)
    : 0;

  async function handleSend() {
    if (!email || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const res = await apiFetch(`/reports/year-summary/${year ?? data.year}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as Record<string, unknown>;
        setSendErr((j as { message?: string }).message ?? "Failed to send");
      } else {
        setSent(true);
      }
    } catch {
      setSendErr("Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="yr-slide-inner" style={{ alignItems: "center", textAlign: "center", width: "100%" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 80, height: 80,
        background: "rgba(45,106,79,0.18)", border: "1px solid rgba(45,106,79,0.32)",
        borderRadius: "24px", marginBottom: "2rem",
      }}>
        <GroveMark size={40} color="#4a8a6e" />
      </div>
      <h2 style={{
        fontFamily: "'Inter Tight', sans-serif", fontWeight: 900, lineHeight: 1.08,
        letterSpacing: "-0.045em", color: "#f0e9d8", marginBottom: "1rem",
        fontSize: "clamp(1.8rem,5vw,3rem)",
      }}>
        That's {data.year}.<br />What a year.
      </h2>
      <p style={{ fontSize: "0.96rem", color: "rgba(240,233,216,0.45)", lineHeight: 1.7, maxWidth: 420, marginBottom: "2.5rem" }}>
        You saved <strong style={{ color: "#a8d4bc" }}>{fmtFull(data.netSavings)}</strong> and
        {" "}grew your net worth by <strong style={{ color: "#c8860a" }}>{growthPct}%</strong>.
        Here's to an even stronger {data.year + 1}.
      </p>

      {!sent ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.65rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <input
              className="yr-email-input"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSend(); }}
            />
            <button className="yr-cta-btn" onClick={() => void handleSend()} disabled={!email || sending}>
              {sending ? "Sending…" : "✉ Email summary"}
            </button>
          </div>
          {sendErr && (
            <p style={{ fontSize: "0.78rem", color: "#c08070" }}>{sendErr}</p>
          )}
        </div>
      ) : (
        <p style={{ fontSize: "0.88rem", color: "#4a8a6e", marginBottom: "1.5rem" }}>
          ✓ Summary sent to {email}
        </p>
      )}

      <button className="yr-cta-btn yr-cta-btn--ghost" onClick={onClose}>
        ← Back to dashboard
      </button>
    </div>
  );
}

// ── Slide list ────────────────────────────────────────────────────────────────

const SLIDE_COMPONENTS = [
  Slide01, Slide02, Slide03, Slide04, Slide05,
  Slide06, Slide07, Slide08, Slide09, Slide10,
  Slide11, Slide12,
];

// ── Main export ───────────────────────────────────────────────────────────────

type YearInReviewSlidesProps = {
  idx: number;
  data: YearSummaryData;
  narrative: string[];
  onClose: () => void;
  onNext: () => void;
  year: number;
};

export function YearInReviewSlides({ idx, data, narrative, onClose, onNext, year }: YearInReviewSlidesProps) {
  return (
    <>
      {SLIDES.map((s, i) => {
        const Comp = SLIDE_COMPONENTS[i];
        const state = i === idx ? "active" : i < idx ? "before" : "after";
        return (
          <div
            key={s.key}
            className={`yr-slide yr-slide--${state}`}
            aria-hidden={i !== idx}
          >
            <Comp
              data={data}
              active={i === idx}
              onNext={onNext}
              onClose={onClose}
              year={year}
              narrative={narrative}
            />
          </div>
        );
      })}
    </>
  );
}
