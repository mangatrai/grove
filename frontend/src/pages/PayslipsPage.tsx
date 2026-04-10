import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { PayslipIncomeCharts } from "../payslip/PayslipIncomeCharts";
import type { PayslipSnapshotDetail } from "../payslip/types";

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: PayslipSnapshotDetail[];
};

type EmployerRow = { id: string; displayName: string };
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

function periodLabel(r: PayslipSnapshotDetail): string {
  const a = r.payPeriodStart;
  const b = r.payPeriodEnd;
  if (a && b) {
    return `${a} → ${b}`;
  }
  if (a) {
    return a;
  }
  if (b) {
    return b;
  }
  return "—";
}

export function PayslipsPage() {
  const token = useAuthToken();
  const [data, setData] = useState<ListResponse | null>(null);
  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<OwnerProfileOption[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    const [res, hs] = await Promise.all([
      apiJson<ListResponse>(`/payslips?${params.toString()}`),
      apiJson<{ employers: EmployerRow[] }>("/household/settings").catch(() => ({ employers: [] as EmployerRow[] }))
    ]);
    setData(res);
    setEmployers(hs.employers ?? []);
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
                  <th>Pay period</th>
                  <th>Pay date</th>
                  <th>Gross (current)</th>
                  <th>Net (current)</th>
                  <th>Employer</th>
                  <th>File</th>
                  <th>Uploaded</th>
                  <th>Parser</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/payslips/${r.id}`}>{periodLabel(r)}</Link>
                    </td>
                    <td>{r.payDate ?? "—"}</td>
                    <td>{formatMoney(r.grossPayCurrent)}</td>
                    <td>{formatMoney(r.netPayCurrent)}</td>
                    <td>
                      {r.employerId
                        ? employers.find((e) => e.id === r.employerId)?.displayName ?? r.employerId.slice(0, 8) + "…"
                        : "—"}
                    </td>
                    <td style={{ maxWidth: "14rem", wordBreak: "break-word" }}>
                      <Link to={`/payslips/${r.id}`}>{r.fileName}</Link>
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>{r.createdAt}</td>
                    <td>
                      <code style={{ fontSize: "0.8rem" }}>{r.parserProfileId}</code>
                    </td>
                    <td>
                      <Link to={`/payslips/${r.id}`}>View</Link>
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
