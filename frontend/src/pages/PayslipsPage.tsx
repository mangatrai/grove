import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
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
      if (!window.confirm("Delete this payslip permanently? This cannot be undone.")) {
        return;
      }
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

  return (
    <div className="payslips-page">
      <div className="card">
        <h1>Payslips</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          Add payslip PDFs via <Link to="/imports">New import</Link>, or{" "}
          <Link to="/payslips/new">add a stub manually</Link> (no PDF). Manage employers in{" "}
          <Link to="/settings/profile">Settings → Profile</Link>.
        </p>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <label className="field" style={{ display: "block", marginBottom: 0 }}>
          <span>Belongs-to</span>
          <HierarchicalSearchPicker
            value={ownerFilter}
            onChange={(v) => setOwnerFilter(v)}
            groups={belongsToGroups}
            placeholder="All household activity"
            ariaLabel="Filter payslips by belongs-to"
            clearable
          />
        </label>
        <p className="muted" style={{ marginTop: "0.65rem", marginBottom: 0, fontSize: "0.9rem" }}>
          Household: shared payslips only. Member: that person’s payslips. Clear the filter to include everyone.
        </p>
      </div>

      {!loading && data && data.items.length > 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Income &amp; payroll</h2>
          <PayslipIncomeCharts items={data.items} />
        </div>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Saved stubs</h2>
          <Link to="/payslips/new">Add manually</Link>
        </div>
        {loadError ? <p className="error">{loadError}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data && data.items.length === 0 ? (
          <p className="muted">No payslips uploaded yet.</p>
        ) : null}
        {!loading && data && data.items.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Pay period start</th>
                  <th>Pay period end</th>
                  <th>Gross (current)</th>
                  <th>Net (current)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.payPeriodStart ?? "—"}</td>
                    <td>{r.payPeriodEnd ?? "—"}</td>
                    <td>{formatMoney(r.grossPayCurrent)}</td>
                    <td>{formatMoney(r.netPayCurrent)}</td>
                    <td>
                      <Link to={`/payslips/${r.id}`}>View</Link>
                      {" · "}
                      <button
                        type="button"
                        className="secondary"
                        style={{ fontSize: "0.85rem" }}
                        disabled={deletingId === r.id}
                        onClick={() => void deletePayslip(r.id)}
                      >
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
