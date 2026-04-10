import { MultiSelect } from "@mantine/core";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useBlocker } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";

type BalanceSheetAccountRow = {
  financialAccountId: string;
  institution: string;
  accountMask: string | null;
  type: string;
  currency: string;
  side: "asset" | "liability";
  balance: number | null;
  balanceAsOf: string | null;
  balanceSource: "manual" | "import" | null;
  importFileId: string | null;
};

type BalanceSheetResponse = {
  asOf: string;
  assets: BalanceSheetAccountRow[];
  liabilities: BalanceSheetAccountRow[];
  totals: {
    assets: number | null;
    liabilities: number | null;
    netWorth: number | null;
  };
};

type AccountOption = {
  id: string;
  institution: string;
  type: string;
  currency: string;
  account_mask?: string | null;
};

type BalanceSheetHistoryAccountSlice = {
  financialAccountId: string;
  side: "asset" | "liability";
  balance: number | null;
  balanceAsOf: string | null;
};

type BalanceSheetHistoryResponse = {
  from: string;
  to: string;
  interval: "month" | "week" | "day";
  points: Array<{
    asOf: string;
    totals: {
      assets: number | null;
      liabilities: number | null;
      netWorth: number | null;
    };
    accounts?: BalanceSheetHistoryAccountSlice[];
  }>;
};

type PeriodPreset = "3m" | "6m" | "12m" | "ytd" | "custom";

type BelongsToFilter = "" | "household" | `person:${string}`;

const MAX_CHART_ACCOUNTS = 8;
const HISTORY_DEBOUNCE_MS = 280;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeForPreset(preset: PeriodPreset, custom: { from: string; to: string } | null): { from: string; to: string } {
  const to = new Date();
  const toStr = to.toISOString().slice(0, 10);
  if (preset === "custom" && custom) {
    return { from: custom.from, to: custom.to };
  }
  if (preset === "ytd") {
    return { from: `${to.getUTCFullYear()}-01-01`, to: toStr };
  }
  const months = preset === "3m" ? 3 : preset === "6m" ? 6 : 12;
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - months, to.getUTCDate()));
  return { from: from.toISOString().slice(0, 10), to: toStr };
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Display-only: liabilities negative, assets positive (matches net-worth intuition). */
function signedDisplayBalance(row: Pick<BalanceSheetAccountRow, "side" | "balance">): number | null {
  if (row.balance == null || !Number.isFinite(row.balance)) {
    return null;
  }
  return row.side === "liability" ? -row.balance : row.balance;
}

function storageAmountFromInput(raw: number, side: "asset" | "liability"): number {
  if (side === "asset") {
    return raw;
  }
  return Math.abs(raw);
}

function appendOwnerQuery(qs: URLSearchParams, belongsTo: BelongsToFilter): void {
  if (belongsTo === "household") {
    qs.set("ownerScope", "household");
  } else if (belongsTo.startsWith("person:")) {
    const id = belongsTo.slice("person:".length);
    if (id) {
      qs.set("ownerScope", "person");
      qs.set("ownerPersonProfileId", id);
    }
  }
}

function transactionsHref(opts: {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Ledger filter: transactions posted from this import file. */
  fileId?: string;
}): string {
  const q = new URLSearchParams();
  if (opts.accountId) {
    q.set("accountId", opts.accountId);
  }
  if (opts.dateFrom) {
    q.set("dateFrom", opts.dateFrom);
  }
  if (opts.dateTo) {
    q.set("dateTo", opts.dateTo);
  }
  if (opts.fileId) {
    q.set("fileId", opts.fileId);
  }
  const s = q.toString();
  return s ? `/transactions?${s}` : "/transactions";
}

export function NetWorthPage() {
  const token = useAuthToken();
  const [tableAsOf, setTableAsOf] = useState(() => todayIso());
  const [data, setData] = useState<BalanceSheetResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<Array<{ id: string; label: string }>>([]);
  const [belongsTo, setBelongsTo] = useState<BelongsToFilter>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("12m");
  const [customFrom, setCustomFrom] = useState(() => {
    const t = new Date();
    const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 12, t.getUTCDate()));
    return from.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => todayIso());

  const histRange = useMemo(() => {
    if (periodPreset === "custom") {
      return { from: customFrom, to: customTo };
    }
    return rangeForPreset(periodPreset, null);
  }, [periodPreset, customFrom, customTo]);

  const [histInterval, setHistInterval] = useState<"month" | "week" | "day">("month");
  const [historyData, setHistoryData] = useState<BalanceSheetHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [chartAccountIds, setChartAccountIds] = useState<string[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editAsOf, setEditAsOf] = useState("");
  const [rowSaveError, setRowSaveError] = useState<string | null>(null);
  const [rowSaving, setRowSaving] = useState(false);

  const [bulkAsOfDraft, setBulkAsOfDraft] = useState(() => tableAsOf);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const [editBaseline, setEditBaseline] = useState<{ amount: string; asOf: string } | null>(null);
  const editDirty = Boolean(
    editingId &&
      editBaseline &&
      (editAmount.trim() !== editBaseline.amount.trim() || editAsOf !== editBaseline.asOf)
  );

  const navBlocker = useBlocker(editDirty);

  const belongsToGroups = useMemo<HierarchicalPickerGroup[]>(
    () => [
      {
        group: "Scope",
        items: [
          {
            value: "",
            label: "All accounts",
            displayLabel: "All accounts",
            searchText: "all accounts household"
          }
        ]
      },
      {
        group: "Household",
        items: [
          {
            value: "household",
            label: "Household-owned accounts",
            displayLabel: "Household-owned",
            searchText: "household"
          }
        ]
      },
      {
        group: "Members",
        items: ownerProfiles.map((p) => ({
          value: `person:${p.id}`,
          label: `Household > ${p.label}`,
          displayLabel: p.label,
          searchText: p.label
        }))
      }
    ],
    [ownerProfiles]
  );

  const loadSheet = useCallback(async () => {
    const qs = new URLSearchParams({ asOf: tableAsOf });
    appendOwnerQuery(qs, belongsTo);
    const res = await apiJson<BalanceSheetResponse>(`/reports/balance-sheet?${qs.toString()}`);
    setData(res);
  }, [tableAsOf, belongsTo]);

  const loadHistoryImmediate = useCallback(async () => {
    const qs = new URLSearchParams({
      from: histRange.from,
      to: histRange.to,
      interval: histInterval
    });
    appendOwnerQuery(qs, belongsTo);
    if (chartAccountIds.length > 0) {
      qs.set("accountIds", chartAccountIds.slice(0, MAX_CHART_ACCOUNTS).join(","));
    }
    const res = await apiJson<BalanceSheetHistoryResponse>(`/reports/balance-sheet/history?${qs.toString()}`);
    setHistoryData(res);
  }, [histRange.from, histRange.to, histInterval, belongsTo, chartAccountIds]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ accounts: AccountOption[] }>("/imports/accounts")
      .then((r) => {
        const list = (r.accounts ?? []).filter((a) => a.type !== "payslip");
        setAccounts(list);
      })
      .catch(() => setAccounts([]));
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void Promise.all([
      apiJson<{ members: Array<{ id: string; fullName: string; relationship?: string }> }>("/household/members").catch(
        () => ({ members: [] })
      ),
      apiJson<{ profile: { id: string; fullName: string } }>("/household/profile").catch(
        () => ({ profile: { id: "", fullName: "" } })
      )
    ]).then(([membersRes, profileRes]) => {
      const members = membersRes.members ?? [];
      const mapped = members.map((m) => ({
        id: m.id,
        label: `${m.fullName}${m.relationship ? ` (${m.relationship})` : ""}`.trim() || m.id
      }));
      const pid = profileRes.profile?.id;
      if (pid && !mapped.some((m) => m.id === pid)) {
        mapped.unshift({ id: pid, label: profileRes.profile.fullName || "Me" });
      }
      setOwnerProfiles(mapped);
    });
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    void loadSheet()
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load balance sheet");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, loadSheet]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const t = window.setTimeout(() => {
      setHistoryLoading(true);
      setHistoryError(null);
      void loadHistoryImmediate()
        .catch((e: unknown) => {
          setHistoryError(e instanceof Error ? e.message : "Failed to load history");
          setHistoryData(null);
        })
        .finally(() => setHistoryLoading(false));
    }, HISTORY_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [token, loadHistoryImmediate]);

  const chartRows = useMemo(() => {
    const accountLabel = (id: string) => {
      const a = accounts.find((x) => x.id === id);
      return a ? `${a.institution}${a.account_mask ? ` · ${a.account_mask}` : ""}` : id.slice(0, 8);
    };

    return (historyData?.points ?? []).map((p) => {
      const row: Record<string, string | number | undefined> = {
        asOf: p.asOf,
        assets: p.totals.assets ?? undefined,
        liabilities: p.totals.liabilities ?? undefined,
        netWorth: p.totals.netWorth ?? undefined
      };
      if (p.accounts?.length) {
        for (const slice of p.accounts) {
          const signed =
            slice.balance == null
              ? undefined
              : slice.side === "liability"
                ? -slice.balance
                : slice.balance;
          row[`acc_${slice.financialAccountId}`] = signed;
          row[`acc_${slice.financialAccountId}_label`] = accountLabel(slice.financialAccountId);
        }
      }
      return row;
    });
  }, [historyData?.points, accounts]);

  const chartLineKeys = useMemo(() => {
    if (!chartAccountIds.length || !historyData?.points?.length) {
      return [];
    }
    const keys = new Set<string>();
    for (const p of historyData.points) {
      for (const a of p.accounts ?? []) {
        keys.add(`acc_${a.financialAccountId}`);
      }
    }
    return chartAccountIds.filter((id) => keys.has(`acc_${id}`));
  }, [chartAccountIds, historyData?.points]);

  const periodSummary = useMemo(() => {
    const pts = historyData?.points ?? [];
    if (pts.length === 0) {
      return null;
    }
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const fa = first.totals.assets;
    const fl = first.totals.liabilities;
    const fn = first.totals.netWorth;
    const la = last.totals.assets;
    const ll = last.totals.liabilities;
    const ln = last.totals.netWorth;
    return {
      startLabel: first.asOf,
      endLabel: last.asOf,
      start: { assets: fa, liabilities: fl, net: fn },
      end: { assets: la, liabilities: ll, net: ln },
      delta:
        fa != null && la != null
          ? { assets: la - fa, liabilities: (ll ?? 0) - (fl ?? 0), net: (ln ?? 0) - (fn ?? 0) }
          : null
    };
  }, [historyData?.points]);

  const allTableRows = useMemo(() => {
    const a = data?.assets ?? [];
    const l = data?.liabilities ?? [];
    return [...a, ...l];
  }, [data?.assets, data?.liabilities]);

  const multiSelectData = useMemo(
    () =>
      allTableRows.map((r) => ({
        value: r.financialAccountId,
        label: `${r.institution}${r.accountMask ? ` · ${r.accountMask}` : ""} (${r.type})`
      })),
    [allTableRows]
  );

  useEffect(() => {
    setBulkAsOfDraft(tableAsOf);
  }, [tableAsOf]);

  const reloadAll = useCallback(async () => {
    setLoadError(null);
    setHistoryError(null);
    setLoading(true);
    setHistoryLoading(true);
    try {
      await loadSheet();
      await loadHistoryImmediate();
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Reload failed");
    } finally {
      setLoading(false);
      setHistoryLoading(false);
    }
  }, [loadSheet, loadHistoryImmediate]);

  const startEdit = useCallback((row: BalanceSheetAccountRow) => {
    setEditingId(row.financialAccountId);
    setRowSaveError(null);
    const stored = row.balance;
    const display = signedDisplayBalance(row);
    const amt = stored == null ? "" : String(display ?? "");
    const asOf = row.balanceAsOf ?? tableAsOf;
    setEditAmount(amt);
    setEditAsOf(asOf);
    setEditBaseline({ amount: amt, asOf });
  }, [tableAsOf]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditAmount("");
    setEditAsOf("");
    setEditBaseline(null);
    setRowSaveError(null);
  }, []);

  const saveRow = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!editingId) {
        return;
      }
      const row = allTableRows.find((r) => r.financialAccountId === editingId);
      if (!row) {
        return;
      }
      const amountParsed = Number(String(editAmount).replace(/,/g, ""));
      if (!editAsOf || !Number.isFinite(amountParsed)) {
        setRowSaveError("Enter a valid amount and as-of date.");
        return;
      }
      const currency = accounts.find((a) => a.id === editingId)?.currency ?? row.currency ?? "USD";
      setRowSaving(true);
      setRowSaveError(null);
      try {
        await apiJson<{ id: string }>("/reports/balance-sheet/manual", {
          method: "POST",
          body: JSON.stringify({
            financialAccountId: editingId,
            asOfDate: editAsOf,
            amount: storageAmountFromInput(amountParsed, row.side),
            currency
          })
        });
        cancelEdit();
        await loadSheet();
        await loadHistoryImmediate();
      } catch (err: unknown) {
        setRowSaveError(err instanceof Error ? err.message : "Could not save balance");
      } finally {
        setRowSaving(false);
      }
    },
    [accounts, allTableRows, cancelEdit, editAmount, editAsOf, editingId, loadHistoryImmediate, loadSheet]
  );

  const runBulkAsOf = useCallback(async () => {
    if (!bulkAsOfDraft || !data) {
      return;
    }
    setBulkWorking(true);
    setBulkSummary(null);
    let okCount = 0;
    let fail = 0;
    let skipped = 0;
    for (const row of allTableRows) {
      if (row.balance == null) {
        skipped += 1;
        continue;
      }
      try {
        await apiJson("/reports/balance-sheet/manual", {
          method: "POST",
          body: JSON.stringify({
            financialAccountId: row.financialAccountId,
            asOfDate: bulkAsOfDraft,
            amount: row.balance,
            currency: row.currency
          })
        });
        okCount += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkWorking(false);
    setBulkSummary(`Updated ${okCount} account(s). Failed: ${fail}. Skipped (no balance): ${skipped}.`);
    await loadSheet();
    await loadHistoryImmediate();
  }, [allTableRows, bulkAsOfDraft, data, loadHistoryImmediate, loadSheet]);

  const onPresetChange = (next: PeriodPreset) => {
    setPeriodPreset(next);
    if (next !== "custom") {
      const r = rangeForPreset(next, null);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  };

  useEffect(() => {
    if (!editDirty) {
      return;
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editDirty]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  const palette = ["#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#0891b2", "#4f46e5", "#be123c", "#0d9488"];

  return (
    <div className="net-worth-page">
      <div className="card">
        <h1>Net worth</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          Trend and balance sheet use the same rules per account: <strong>manual balance</strong> wins, then a balance saved from
          an import, then a read-only hint from a parsed statement when nothing else exists. The chart samples those totals
          across the dates you choose. The balance sheet table below shows <strong>liabilities as negative</strong> so net worth
          reads clearly.{" "}
          <Link to="/settings?tab=accounts">Manage accounts</Link>.
        </p>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Trend</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Chart updates automatically when you change period, interval, or belongs-to.
        </p>
        <div className="row net-worth__control-band" style={{ alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Period</span>
            <select value={periodPreset} onChange={(ev) => onPresetChange(ev.target.value as PeriodPreset)}>
              <option value="3m">Last 3 months</option>
              <option value="6m">Last 6 months</option>
              <option value="12m">Last 12 months</option>
              <option value="ytd">Year to date</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {periodPreset === "custom" ? (
            <>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>From</span>
                <input type="date" value={customFrom} onChange={(ev) => setCustomFrom(ev.target.value)} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>To</span>
                <input type="date" value={customTo} onChange={(ev) => setCustomTo(ev.target.value)} />
              </label>
            </>
          ) : null}
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Interval</span>
            <select value={histInterval} onChange={(ev) => setHistInterval(ev.target.value as "month" | "week" | "day")}>
              <option value="month">Month-end</option>
              <option value="week">Every 7 days</option>
              <option value="day">Daily (max 120 points)</option>
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0, minWidth: "12rem" }}>
            <span>Belongs to</span>
            <HierarchicalSearchPicker
              value={belongsTo || null}
              onChange={(v) => setBelongsTo((v ?? "") as BelongsToFilter)}
              groups={belongsToGroups}
              placeholder="All household activity"
              ariaLabel="Balance sheet owner filter"
              clearable
            />
          </label>
        </div>

        <div className="net-worth__overlay-band" style={{ marginTop: "0.75rem" }}>
          <MultiSelect
            label="Overlay accounts on chart"
            description="Optional — adds lines for the accounts you pick (up to 8)."
            placeholder="Pick up to 8 accounts"
            data={multiSelectData}
            value={chartAccountIds}
            onChange={(v) => setChartAccountIds(v.slice(0, MAX_CHART_ACCOUNTS))}
            searchable
            clearable
            maxValues={MAX_CHART_ACCOUNTS}
          />
        </div>

        {(loadError || historyError) ? (
          <div className="net-worth__retry-band" style={{ marginTop: "0.75rem" }}>
            {historyError ? <p className="error" style={{ marginTop: 0 }}>{historyError}</p> : null}
            <div className="row" style={{ alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <button type="button" className="secondary" onClick={() => void reloadAll()} disabled={loading || historyLoading}>
                {loading || historyLoading ? "Loading…" : "Retry load"}
              </button>
              <span className="muted" style={{ fontSize: "0.9rem" }}>
                Refetches the balance sheet and trend chart.
              </span>
            </div>
          </div>
        ) : null}

        {periodSummary ? (
          <div style={{ marginTop: "1rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.35rem", fontSize: "1rem" }}>Period summary</h3>
            <p className="muted" style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "0.85rem" }}>
              First and last rows match the endpoints of the chart below. Ledger opens transactions for that calendar day only.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th scope="col">Sample</th>
                    <th scope="col">Assets</th>
                    <th scope="col">Liabilities</th>
                    <th scope="col">Net worth</th>
                    <th scope="col">Ledger</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">
                      First ({periodSummary.startLabel})
                    </th>
                    <td>{formatMoney(periodSummary.start.assets)}</td>
                    <td>{formatMoney(periodSummary.start.liabilities)}</td>
                    <td>{formatMoney(periodSummary.start.net)}</td>
                    <td>
                      <Link
                        to={transactionsHref({
                          dateFrom: periodSummary.startLabel,
                          dateTo: periodSummary.startLabel
                        })}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      Last ({periodSummary.endLabel})
                    </th>
                    <td>{formatMoney(periodSummary.end.assets)}</td>
                    <td>{formatMoney(periodSummary.end.liabilities)}</td>
                    <td>{formatMoney(periodSummary.end.net)}</td>
                    <td>
                      <Link
                        to={transactionsHref({
                          dateFrom: periodSummary.endLabel,
                          dateTo: periodSummary.endLabel
                        })}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                  {periodSummary.delta ? (
                    <tr>
                      <th scope="row">Change (last − first)</th>
                      <td>{formatMoney(periodSummary.delta.assets)}</td>
                      <td>{formatMoney(periodSummary.delta.liabilities)}</td>
                      <td>{formatMoney(periodSummary.delta.net)}</td>
                      <td className="muted">—</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {historyLoading ? <p className="muted">Loading chart…</p> : null}
        {!historyLoading && chartRows.length > 0 ? (
          <div style={{ width: "100%", height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                <XAxis dataKey="asOf" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={52} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) =>
                    `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  }
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) {
                      return null;
                    }
                    const asOf = String(label ?? "");
                    const href = transactionsHref({ dateFrom: asOf, dateTo: asOf });
                    return (
                      <div className="card" style={{ padding: "0.5rem 0.75rem", fontSize: "0.85rem" }}>
                        <div style={{ fontWeight: 600 }}>{asOf}</div>
                        {payload.map((p) => (
                          <div key={String(p.name ?? p.dataKey)}>
                            {p.name}: {p.value == null || !Number.isFinite(Number(p.value)) ? "—" : formatMoney(Number(p.value))}
                          </div>
                        ))}
                        <div style={{ marginTop: "0.35rem" }}>
                          <Link to={href}>Open transactions for this date</Link>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="assets" name="Assets" stroke="#2563eb" dot={false} strokeWidth={2} connectNulls />
                <Line
                  type="monotone"
                  dataKey="liabilities"
                  name="Liabilities"
                  stroke="#dc2626"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="netWorth"
                  name="Net worth"
                  stroke="#059669"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
                {chartLineKeys.map((id, idx) => (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={`acc_${id}`}
                    name={multiSelectData.find((m) => m.value === id)?.label ?? id}
                    stroke={palette[idx % palette.length]!}
                    dot={false}
                    strokeWidth={1.5}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {!historyLoading && chartRows.length === 0 && !historyError ? (
          <p className="muted">No history points in this range (add manual or import balances to see a line).</p>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Balance sheet</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Snapshot date selects which balances to load; use the pencil on a row to post or change a manual balance for that
          account.
        </p>
        <div style={{ marginBottom: "0.75rem" }}>
          <label className="field" style={{ marginBottom: 0, maxWidth: "12rem" }}>
            <span>Snapshot date</span>
            <input type="date" value={tableAsOf} onChange={(ev) => setTableAsOf(ev.target.value)} />
          </label>
          <p className="muted" style={{ marginTop: "0.35rem", marginBottom: 0, fontSize: "0.85rem", maxWidth: "36rem" }}>
            One date for this table request (the API snapshot). Each row can still show its own stored as-of.
          </p>
        </div>
        <details className="net-worth-page__bulk-asof" style={{ marginBottom: "0.75rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>Re-date all manual balances</summary>
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.35rem", marginBottom: 0, maxWidth: "36rem" }}>
            Set the same as-of on every manual snapshot without changing amounts — useful when aligning reporting dates.
          </p>
          <div className="row" style={{ alignItems: "flex-end", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>New as-of date</span>
              <input type="date" value={bulkAsOfDraft} onChange={(ev) => setBulkAsOfDraft(ev.target.value)} />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={bulkWorking || allTableRows.length === 0}
              onClick={() => setBulkConfirmOpen(true)}
            >
              {bulkWorking ? "Applying…" : "Apply to all rows"}
            </button>
          </div>
        </details>
        {bulkSummary ? <p className="muted">{bulkSummary}</p> : null}
        {loadError ? <p className="error">{loadError}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data ? (
          <div className="row" style={{ gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                Total assets
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{formatMoney(data.totals.assets)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                Total liabilities
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{formatMoney(data.totals.liabilities)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                Net worth
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{formatMoney(data.totals.netWorth)}</div>
            </div>
          </div>
        ) : null}

        {!loading && data ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Balance</th>
                  <th>As of</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {allTableRows.map((r) => {
                  const signed = signedDisplayBalance(r);
                  const drill = transactionsHref({
                    accountId: r.financialAccountId,
                    dateFrom: r.balanceAsOf ?? tableAsOf,
                    dateTo: r.balanceAsOf ?? tableAsOf
                  });
                  const isEditing = editingId === r.financialAccountId;
                  return (
                    <tr key={r.financialAccountId}>
                      <td>
                        <Link to={drill}>{r.institution}{r.accountMask ? ` · ${r.accountMask}` : ""}</Link>
                        {r.importFileId ? (
                          <span className="muted" style={{ fontSize: "0.8rem", display: "block", marginTop: "0.2rem" }}>
                            <Link to={transactionsHref({ fileId: r.importFileId })}>Transactions from import file</Link>
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <code style={{ fontSize: "0.8rem" }}>{r.type}</code>
                      </td>
                      <td>
                        {isEditing ? (
                          <form className="row" style={{ gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }} onSubmit={saveRow}>
                            <input
                              style={{ width: "7rem" }}
                              inputMode="decimal"
                              value={editAmount}
                              onChange={(ev) => setEditAmount(ev.target.value)}
                              aria-label="Balance amount"
                            />
                            <input type="date" value={editAsOf} onChange={(ev) => setEditAsOf(ev.target.value)} aria-label="As-of date" />
                            <button type="submit" className="primary" disabled={rowSaving}>
                              Save
                            </button>
                            <button type="button" className="secondary" onClick={cancelEdit}>
                              Cancel
                            </button>
                          </form>
                        ) : (
                          formatMoney(signed)
                        )}
                      </td>
                      <td>{r.balanceAsOf ?? "—"}</td>
                      <td>
                        {!isEditing ? (
                          <button
                            type="button"
                            className="net-worth-page__edit-icon"
                            onClick={() => startEdit(r)}
                            aria-label="Edit balance"
                            title="Edit balance"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path
                                d="M4 20.5a.5.5 0 0 1-.5-.5v-3.5a.5.5 0 0 1 .15-.35L15.3 4.2a1.5 1.5 0 0 1 2.1 0l2.4 2.4a1.5 1.5 0 0 1 0 2.1L8.65 19.35a.5.5 0 0 1-.35.15H4Z"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                              />
                              <path d="M13 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rowSaveError ? <p className="error">{rowSaveError}</p> : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        opened={bulkConfirmOpen}
        title="Apply as-of date to all rows?"
        message={`Set manual balance as-of date to ${bulkAsOfDraft} for every row that has a balance? New snapshots use the same amounts as shown.`}
        confirmLabel="Apply to all"
        closeOnClickOutside={false}
        onClose={() => setBulkConfirmOpen(false)}
        onConfirm={runBulkAsOf}
      />

      <ConfirmDialog
        opened={navBlocker.state === "blocked"}
        title="Discard unsaved edits?"
        message="You have unsaved balance changes. Leave without saving?"
        confirmLabel="Discard and leave"
        cancelLabel="Stay"
        danger
        closeOnClickOutside={false}
        onClose={() => {
          navBlocker.reset?.();
        }}
        onConfirm={() => {
          cancelEdit();
          navBlocker.proceed?.();
        }}
      />
    </div>
  );
}
