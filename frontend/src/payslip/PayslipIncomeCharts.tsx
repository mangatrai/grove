import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { PayslipSnapshotDetail } from "./types";
import {
  aggregatePayrollByCalendarMonth,
  latestSnapshotForBreakdown,
  payslipBreakdownSlices,
  toPaycheckSeries,
  type PaycheckChartPoint
} from "./payslipChartsModel";
import { formatUsd } from "../utils/format";

function moneyTick(v: number): string {
  if (v >= 1000 || v <= -1000) {
    return `$${(v / 1000).toFixed(1)}k`;
  }
  return `$${v}`;
}

function moneyTooltip(v: number): string {
  return `$${formatUsd(Number(v))}`;
}

type Props = {
  items: PayslipSnapshotDetail[];
};

export function PayslipIncomeCharts({ items }: Props) {
  if (items.length === 0) {
    return null;
  }

  const paycheckSeries = toPaycheckSeries(items);
  const nPoints = paycheckSeries.length;
  const monthly = aggregatePayrollByCalendarMonth(items);
  const latest = latestSnapshotForBreakdown(items);
  const breakdown = latest ? payslipBreakdownSlices(latest) : [];

  return (
    <div className="payslip-charts">
      <div className="chart-section">
        <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Gross & net by pay date</h2>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          <strong>One point per calendar day</strong> (pay date, else period end, else upload date). Multiple stubs on
          the same day — e.g. re-uploads or two employers — are <strong>combined</strong>. This shows how each payday
          moves over time (including several paydays in one month).
        </p>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={paycheckSeries} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                interval={nPoints > 10 ? "preserveStartEnd" : 0}
                angle={nPoints > 7 ? -32 : 0}
                textAnchor={nPoints > 7 ? "end" : "middle"}
                height={nPoints > 7 ? 72 : 36}
              />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={moneyTick} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) {
                    return null;
                  }
                  const row = payload[0]?.payload as PaycheckChartPoint;
                  return (
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid var(--color-border, #e2e8f0)",
                        borderRadius: 8,
                        padding: "8px 12px",
                        fontSize: 13,
                        boxShadow: "var(--shadow-sm, 0 1px 2px rgba(15,23,42,0.06))"
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: row.stubCount > 1 ? 4 : 6 }}>{label}</div>
                      {row.stubCount > 1 ? (
                        <div style={{ fontSize: 12, color: "var(--color-text-muted, #64748b)", marginBottom: 6 }}>
                          {row.stubCount} payslips on this date (totals combined)
                        </div>
                      ) : null}
                      {payload.map((p) => (
                        <div
                          key={String(p.dataKey)}
                          style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
                        >
                          <span>{p.name}</span>
                          <span>{moneyTooltip(Number(p.value))}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="gross" name="Gross pay" stroke="#0b5fff" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="net" name="Net pay" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
              <Line
                type="monotone"
                dataKey="taxes"
                name="Taxes withheld"
                stroke="#d97706"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {monthly.length > 0 ? (
        <div className="chart-section" style={{ marginTop: "1.25rem" }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Totals by calendar month</h2>
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
            <strong>One point per month</strong> — total gross and net for that month (all paydays combined). Use this
            for <strong>budgeting</strong> and comparing months; the chart above shows <strong>individual paydays</strong>{" "}
            across the timeline.
          </p>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthly} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={moneyTick} />
                <Tooltip formatter={(v: number) => moneyTooltip(v)} />
                <Legend />
                <Line type="monotone" dataKey="gross" name="Gross (sum)" stroke="#0b5fff" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="net" name="Net (sum)" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {breakdown.length > 0 ? (
        <div className="chart-section" style={{ marginTop: "1.25rem" }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Latest stub — where pay went (current period)</h2>
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
            Employer-reported buckets from the most recent payslip (not bank cash).{" "}
            {latest?.payDate ? (
              <>
                Pay date <strong>{latest.payDate}</strong>.
              </>
            ) : null}
          </p>
          <div className="chart-wrap" style={{ maxWidth: "420px" }}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={breakdown}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={96}
                  paddingAngle={2}
                >
                  {breakdown.map((s, i) => (
                    <Cell key={i} fill={s.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => moneyTooltip(v)} />
                <Legend layout="horizontal" verticalAlign="bottom" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
