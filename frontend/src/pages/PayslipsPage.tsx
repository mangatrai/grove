import { useCallback, useEffect, useMemo, useState } from "react";
import { IconEye, IconFilePlus, IconPlus, IconTrash } from "@tabler/icons-react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { PayslipIncomeCharts } from "../payslip/PayslipIncomeCharts";
import type { PayslipSnapshotDetail } from "../payslip/types";

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: PayslipSnapshotDetail[];
};

type OwnerProfileOption = { id: string; label: string };
type HouseholdMemberResponse = { id: string; fullName?: string; firstName?: string; lastName?: string };
type HouseholdMembersPayload = { members: HouseholdMemberResponse[] };
type HouseholdProfileResponse = {
  profile: {
    id: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
  };
};

function formatMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  return `$${n.toFixed(2)}`;
}

export function PayslipsPage() {
  const token = useAuthToken();
  const [data, setData] = useState<ListResponse | null>(null);
  const [ownerProfiles, setOwnerProfiles] = useState<OwnerProfileOption[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200", offset: "0" });
    if (ownerFilter === "household") {
      params.set("ownerScope", "household");
    } else if (ownerFilter?.startsWith("person:")) {
      const id = ownerFilter.slice("person:".length);
      if (id) {
        params.set("ownerScope", "person");
        params.set("ownerPersonProfileId", id);
      }
    }
    const res = await apiJson<ListResponse>(`/payslips?${params.toString()}`);
    setData(res);
  }, [ownerFilter]);

  const loadOwners = useCallback(async () => {
    if (!token) {
      return;
    }
    const [membersRes, profileRes] = await Promise.all([
      apiJson<HouseholdMembersPayload>("/household/members").catch(
        () => ({ members: [] as HouseholdMemberResponse[] }) as HouseholdMembersPayload
      ),
      apiJson<HouseholdProfileResponse>("/household/profile").catch(
        () => ({ profile: { id: "", fullName: "Household" } }) as HouseholdProfileResponse
      )
    ]);
    const members = membersRes.members ?? [];
    const profile = profileRes.profile;
    const mapped = members.map((m) => ({
      id: m.id,
      label: [m.fullName, [m.firstName, m.lastName].filter(Boolean).join(" ").trim()].find((x) => x && x.trim()) || m.id
    }));
    if (profile?.id && !mapped.some((m) => m.id === profile.id)) {
      mapped.unshift({
        id: profile.id,
        label:
          [profile.fullName, [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim()].find(
            (x) => x && x.trim()
          ) || "Me"
      });
    }
    setOwnerProfiles(mapped);
  }, [token]);

  const deletePayslip = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await apiFetch(`/payslips/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const text = await res.text();
          let msg = text || res.statusText;
          try {
            const j = JSON.parse(text) as { message?: string };
            if (j.message) {
              msg = j.message;
            }
          } catch {
            /* use raw */
          }
          setLoadError(msg);
          return;
        }
        await load();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setDeletingId(null);
      }
    },
    [load]
  );

  const belongsToGroups = useMemo<HierarchicalPickerGroup[]>(
    () => [
      {
        group: "Household",
        items: [{ value: "household", label: "Household", displayLabel: "Household", searchText: "household" }]
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

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    void Promise.all([load(), loadOwners()])
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load payslips");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, load, loadOwners]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  const latest = data?.items[0] ?? null;

  return (
    <div className="payslips-page">
      {/* Page header */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Payslips</h1>
          <HelpIcon label="Add payslip PDFs via New Import, or add a manual stub with no PDF. Manage employers in Settings → Profile." />
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Link
              to="/imports"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.3rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 13, textDecoration: "none", color: "var(--color-text)" }}
            >
              <IconFilePlus size={14} />
              Import PDF
            </Link>
            <Link
              to="/payslips/new"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.3rem 0.75rem", background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, textDecoration: "none", fontWeight: 600 }}
            >
              <IconPlus size={14} />
              Add manually
            </Link>
          </div>
        </div>
      </div>

      {/* Hero KPI cards — latest payslip stats */}
      {latest ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginTop: "1rem" }}>
          {([
            { label: "Latest gross", value: formatMoney(latest.grossPayCurrent), accent: "var(--color-accent)" },
            { label: "Latest net",   value: formatMoney(latest.netPayCurrent),   accent: "var(--color-success, #16a34a)" },
            { label: "YTD gross",    value: formatMoney(latest.grossPayYtd),     accent: "var(--color-text-muted)" },
            { label: "YTD net",      value: formatMoney(latest.netPayYtd),       accent: "var(--color-text-muted)" },
          ] as const).map(({ label, value, accent }) => (
            <div key={label} className="card" style={{ marginBottom: 0, textAlign: "center", borderTop: `3px solid ${accent}` }}>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Belongs-to filter */}
      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>Belongs-to</label>
          <HelpIcon label="Household: shared payslips only. Member: that person’s payslips. Clear to include everyone." />
          <div style={{ flex: 1, maxWidth: 260 }}>
            <HierarchicalSearchPicker
              value={ownerFilter}
              onChange={(v) => setOwnerFilter(v)}
              groups={belongsToGroups}
              placeholder="All household activity"
              ariaLabel="Filter payslips by belongs-to"
              clearable
            />
          </div>
        </div>
      </div>

      {/* Income charts */}
      {!loading && data && data.items.length > 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Income &amp; payroll</h2>
            <HelpIcon label="Charts derived from all payslips matching the current filter. Area chart shows gross vs net over time. Bar chart shows monthly breakdown." />
          </div>
          <PayslipIncomeCharts items={data.items} />
        </div>
      ) : null}

      {/* Payslip list */}
      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Saved stubs</h2>
          {data ? <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{data.total} total</span> : null}
        </div>
        {loadError ? <p className="error">{loadError}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data && data.items.length === 0 ? (
          <p className="muted">No payslips yet. Use "Import PDF" or "Add manually" above.</p>
        ) : null}
        {!loading && data && data.items.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {data.items.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.65rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                {/* Period badge */}
                <div style={{ minWidth: 90, fontSize: 13, fontWeight: 600 }}>
                  {r.payPeriodStart ?? "—"}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", flex: 1 }}>
                  {r.payPeriodEnd ? `→ ${r.payPeriodEnd}` : ""}
                  {r.payDate ? <span style={{ marginLeft: 8 }}>· paid {r.payDate}</span> : null}
                </div>
                {/* Gross / Net */}
                <div style={{ display: "flex", gap: "1.5rem", fontSize: 13 }}>
                  <div>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block" }}>Gross</span>
                    <span style={{ fontWeight: 600 }}>{formatMoney(r.grossPayCurrent)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block" }}>Net</span>
                    <span style={{ fontWeight: 600, color: "var(--color-success, #16a34a)" }}>{formatMoney(r.netPayCurrent)}</span>
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: "flex", gap: 6 }}>
                  <Link
                    to={`/payslips/${r.id}`}
                    title="View payslip"
                    style={{ display: "inline-flex", alignItems: "center", padding: "0.25rem 0.5rem", border: "1px solid var(--color-border)", borderRadius: 4, color: "var(--color-text-muted)" }}
                  >
                    <IconEye size={14} />
                  </Link>
                  <button
                    type="button"
                    title="Delete payslip"
                    disabled={deletingId === r.id}
                    onClick={() => setDeleteConfirmId(r.id)}
                    style={{ display: "inline-flex", alignItems: "center", padding: "0.25rem 0.5rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "none", cursor: "pointer", color: "var(--color-danger, #dc2626)" }}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        opened={deleteConfirmId !== null}
        title="Delete payslip"
        message="Delete this payslip permanently? This cannot be undone."
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deletePayslip(deleteConfirmId!)}
      />
    </div>
  );
}
