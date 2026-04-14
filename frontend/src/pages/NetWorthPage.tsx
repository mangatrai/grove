import { IconEye, IconPencil } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";
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

type PeriodPreset = "3m" | "6m" | "12m" | "2y" | "3y" | "ytd" | "custom";

type BelongsToFilter = "" | "household" | `person:${string}`;

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
  const months = preset === "3m" ? 3 : preset === "6m" ? 6 : preset === "2y" ? 24 : preset === "3y" ? 36 : 12;
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

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("3m");
  const [customFrom, setCustomFrom] = useState(() => {
    const t = new Date();
    const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 3, t.getUTCDate()));
    return from.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => todayIso());

  const histRange = useMemo(() => {
    if (periodPreset === "custom") {
      return { from: customFrom, to: customTo };
    }
    return rangeForPreset(periodPreset, null);
  }, [periodPreset, customFrom, customTo]);

  const [histInterval, setHistInterval] = useState<"month" | "quarter" | "week" | "day">("month");
  const [historyData, setHistoryData] = useState<BalanceSheetHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const belongsToGroups = useMemo<HierarchicalPickerGroup[]>(
    () => [
      {
        group: "Household",
        items: [{ value: "household", label: "Household", searchText: "household" }]
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
    const res = await apiJson<BalanceSheetHistoryResponse>(`/reports/balance-sheet/history?${qs.toString()}`);
    setHistoryData(res);
  }, [histRange.from, histRange.to, histInterval, belongsTo]);

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

  const chartRows = useMemo(
    () =>
      (historyData?.points ?? []).map((p) => ({
        asOf: p.asOf,
        assets: p.totals.assets ?? undefined,
        liabilities: p.totals.liabilities ?? undefined,
        netWorth: p.totals.netWorth ?? undefined
      })),
    [historyData?.points]
  );

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

  const topAssets = useMemo(
    () =>
      [...(data?.assets ?? [])]
        .filter((r) => r.balance != null)
        .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
        .slice(0, 5)
        .map((r) => ({
          id: r.financialAccountId,
          name: `${r.institution}${r.accountMask ? ` · ${r.accountMask}` : ""}`,
          balance: r.balance ?? 0
        })),
    [data?.assets]
  );

  const topLiabilities = useMemo(
    () =>
      [...(data?.liabilities ?? [])]
        .filter((r) => r.balance != null)
        .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
        .slice(0, 5)
        .map((r) => ({
          id: r.financialAccountId,
          name: `${r.institution}${r.accountMask ? ` · ${r.accountMask}` : ""}`,
          balance: r.balance ?? 0
        })),
    [data?.liabilities]
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
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editDirty]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="net-worth-page">
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Net worth</h1>
          <HelpIcon label="Balances show the most recent known value — manual entry or import, whichever is more current. Liabilities show as negative so net worth reads clearly. Manage accounts in Settings → Accounts." />
          <Link to="/settings?tab=accounts" style={{ marginLeft: "auto", fontSize: 13 }}>Manage accounts</Link>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Trend</h2>
          <HelpIcon label="Chart updates automatically when you change period, interval, or belongs-to filter." />
        </div>
        <div className="row net-worth__control-band" style={{ alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Period</span>
            <select value={periodPreset} onChange={(ev) => onPresetChange(ev.target.value as PeriodPreset)}>
              <option value="3m">Last 3 months</option>
              <option value="6m">Last 6 months</option>
              <option value="12m">Last 12 months</option>
              <option value="2y">Last 2 years</option>
              <option value="3y">Last 3 years</option>
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
            <select value={histInterval} onChange={(ev) => setHistInterval(ev.target.value as "month" | "quarter" | "week" | "day")}>
              <option value="month">Month-end</option>
              <option value="quarter">Quarter-end</option>
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.6rem" }}>
              <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-muted)" }}>Period summary</h3>
              <HelpIcon label="Start and end snapshots in the selected range. The eye icon opens transactions for that date." />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Assets</th>
                    <th scope="col">Liabilities</th>
                    <th scope="col">Net worth</th>
                    <th scope="col" aria-label="Ledger" />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" style={{ fontWeight: 500 }}>Start ({periodSummary.startLabel})</th>
                    <td>{formatMoney(periodSummary.start.assets)}</td>
                    <td>{formatMoney(periodSummary.start.liabilities)}</td>
                    <td style={{ fontWeight: 600 }}>{formatMoney(periodSummary.start.net)}</td>
                    <td>
                      <Link
                        to={transactionsHref({ dateFrom: periodSummary.startLabel, dateTo: periodSummary.startLabel })}
                        title="View transactions for this date"
                        style={{ display: "inline-flex", alignItems: "center", color: "var(--color-text-muted)" }}
                      >
                        <IconEye size={15} />
                      </Link>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" style={{ fontWeight: 500 }}>End ({periodSummary.endLabel})</th>
                    <td>{formatMoney(periodSummary.end.assets)}</td>
                    <td>{formatMoney(periodSummary.end.liabilities)}</td>
                    <td style={{ fontWeight: 600 }}>{formatMoney(periodSummary.end.net)}</td>
                    <td>
                      <Link
                        to={transactionsHref({ dateFrom: periodSummary.endLabel, dateTo: periodSummary.endLabel })}
                        title="View transactions for this date"
                        style={{ display: "inline-flex", alignItems: "center", color: "var(--color-text-muted)" }}
                      >
                        <IconEye size={15} />
                      </Link>
                    </td>
                  </tr>
                  {periodSummary.delta ? (
                    <tr style={{ borderTop: "2px solid var(--color-border)" }}>
                      <th scope="row" style={{ fontWeight: 600, color: "var(--color-text-muted)", fontSize: 12 }}>Change</th>
                      <td style={{ color: (periodSummary.delta.assets ?? 0) >= 0 ? "var(--color-success)" : "var(--color-danger)", fontWeight: 600 }}>{formatMoney(periodSummary.delta.assets)}</td>
                      <td style={{ color: (periodSummary.delta.liabilities ?? 0) <= 0 ? "var(--color-success)" : "var(--color-danger)", fontWeight: 600 }}>{formatMoney(periodSummary.delta.liabilities)}</td>
                      <td style={{ color: (periodSummary.delta.net ?? 0) >= 0 ? "var(--color-success)" : "var(--color-danger)", fontWeight: 700 }}>{formatMoney(periodSummary.delta.net)}</td>
                      <td />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {historyLoading ? <p className="muted">Loading chart…</p> : null}
        {!historyLoading && chartRows.length > 0 ? (
          <div style={{ width: "100%", height: 340, marginTop: "0.75rem" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <defs>
                  <linearGradient id="nwGradientGreen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#15803d" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#15803d" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="nwGradientAmber" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
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
                            <span style={{ color: String(p.color ?? "inherit") }}>{p.name}</span>:{" "}
                            {p.value == null || !Number.isFinite(Number(p.value)) ? "—" : formatMoney(Number(p.value))}
                          </div>
                        ))}
                        <div style={{ marginTop: "0.35rem" }}>
                          <Link to={href}>View transactions →</Link>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="assets" name="Assets" stroke="#22c55e" fill="url(#nwGradientGreen)" strokeWidth={1.5} dot={false} connectNulls />
                <Area type="monotone" dataKey="liabilities" name="Liabilities" stroke="#f59e0b" fill="url(#nwGradientAmber)" strokeWidth={1.5} dot={false} connectNulls />
                <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="#15803d" fill="url(#nwGradientGreen)" strokeWidth={2.5} dot={false} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {!historyLoading && chartRows.length === 0 && !historyError ? (
          <p className="muted">No history points in this range (add manual or import balances to see a line).</p>
        ) : null}

        {!loading && (topAssets.length > 0 || topLiabilities.length > 0) ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--color-border)" }}>
            {topAssets.length > 0 ? (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>Top Assets</div>
                <ResponsiveContainer width="100%" height={topAssets.length * 34 + 8}>
                  <BarChart layout="vertical" data={topAssets} margin={{ top: 0, right: 72, left: 0, bottom: 0 }} barCategoryGap="25%">
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 11, fill: "var(--color-text)" }}
                      tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v}
                    />
                    <Bar dataKey="balance" fill="#22c55e" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                      <LabelList
                        dataKey="balance"
                        position="right"
                        formatter={(v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        style={{ fontSize: 11, fill: "var(--color-text-muted)", fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
            {topLiabilities.length > 0 ? (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>Top Liabilities</div>
                <ResponsiveContainer width="100%" height={topLiabilities.length * 34 + 8}>
                  <BarChart layout="vertical" data={topLiabilities} margin={{ top: 0, right: 72, left: 0, bottom: 0 }} barCategoryGap="25%">
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 11, fill: "var(--color-text)" }}
                      tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v}
                    />
                    <Bar dataKey="balance" fill="#f59e0b" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                      <LabelList
                        dataKey="balance"
                        position="right"
                        formatter={(v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        style={{ fontSize: 11, fill: "var(--color-text-muted)", fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Balance sheet</h2>
          <HelpIcon label="Snapshot date selects which balances to show. Use the pencil on a row to post or update a manual balance. Each row can still carry its own stored as-of date." />
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label className="field" style={{ marginBottom: 0, maxWidth: "12rem" }}>
            <span>Snapshot date</span>
            <input type="date" value={tableAsOf} onChange={(ev) => setTableAsOf(ev.target.value)} />
          </label>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
            <div className="card" style={{ marginBottom: 0, textAlign: "center", borderTop: "3px solid var(--color-success)" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Assets</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-success)" }}>{formatMoney(data.totals.assets)}</div>
            </div>
            <div className="card" style={{ marginBottom: 0, textAlign: "center", borderTop: "3px solid var(--color-warm)" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Liabilities</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-warm-dark, #d97706)" }}>{formatMoney(data.totals.liabilities)}</div>
            </div>
            <div className="card" style={{ marginBottom: 0, textAlign: "center", borderTop: `3px solid ${(data.totals.netWorth ?? 0) >= 0 ? "var(--color-accent)" : "var(--color-danger)"}` }}>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Net worth</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: (data.totals.netWorth ?? 0) >= 0 ? "var(--color-accent)" : "var(--color-danger)" }}>{formatMoney(data.totals.netWorth)}</div>
            </div>
          </div>
        ) : null}

        {!loading && data ? (
          <div style={{ overflowX: "auto" }}>
            {editDirty ? (
              <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.5rem", maxWidth: "40rem" }}>
                Unsaved balance changes — use <strong>Save</strong> or <strong>Cancel</strong> before leaving this page. Closing
                or refreshing the tab may show a browser warning.
              </p>
            ) : null}
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
                            <IconPencil size={15} />
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
    </div>
  );
}
