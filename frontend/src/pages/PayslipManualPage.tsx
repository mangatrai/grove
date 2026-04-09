import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import type { PayslipSnapshotDetail } from "../payslip/types";

type EmployerRow = { id: string; displayName: string };
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

const PARSER_OPTIONS = [
  { value: "ibm_pay_contributions_pdf", label: "IBM Pay & Contributions (PDF)" },
  { value: "deloitte_payslip_pdf", label: "Deloitte Pay Statement (PDF)" }
] as const;

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") {
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalDate(raw: string): string | null {
  const t = raw.trim();
  return t === "" ? null : t;
}

export function PayslipManualPage() {
  const token = useAuthToken();
  const navigate = useNavigate();
  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<Array<{ id: string; label: string }>>([]);
  const [belongsTo, setBelongsTo] = useState<string | null>(null);
  const [employerId, setEmployerId] = useState<string>("");
  const [parserProfileId, setParserProfileId] = useState<string>("ibm_pay_contributions_pdf");
  const [payPeriodStart, setPayPeriodStart] = useState("");
  const [payPeriodEnd, setPayPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState("");
  const [grossPayCurrent, setGrossPayCurrent] = useState("");
  const [netPayCurrent, setNetPayCurrent] = useState("");
  const [grossPayYtd, setGrossPayYtd] = useState("");
  const [netPayYtd, setNetPayYtd] = useState("");
  const [employeeTaxesCurrent, setEmployeeTaxesCurrent] = useState("");
  const [hoursOrDaysCurrent, setHoursOrDaysCurrent] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ employers: EmployerRow[] }>("/household/settings")
      .then((r) => setEmployers(r.employers ?? []))
      .catch(() => setEmployers([]));
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void Promise.all([
      apiJson<HouseholdMembersPayload>("/household/members").catch(
        () => ({ members: [] as HouseholdMemberResponse[] }) as HouseholdMembersPayload
      ),
      apiJson<HouseholdProfileResponse>("/household/profile").catch(
        () => ({ profile: { id: "", fullName: "Household" } }) as HouseholdProfileResponse
      )
    ]).then(([membersRes, profileRes]) => {
      const members = membersRes.members ?? [];
      const profile = profileRes.profile;
      const mapped = members.map((m) => ({
        id: m.id,
        label:
          [m.fullName, [m.firstName, m.lastName].filter(Boolean).join(" ").trim()].find((x) => x && x.trim()) || m.id
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
    });
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

  const needsEmployerPick = employers.length > 1;

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      const pd = parseOptionalDate(payDate);
      const gc = parseOptionalNumber(grossPayCurrent);
      const nc = parseOptionalNumber(netPayCurrent);
      if (pd == null && gc == null && nc == null) {
        setSubmitError("Enter at least pay date, gross pay, or net pay.");
        return;
      }
      if (needsEmployerPick && !employerId.trim()) {
        setSubmitError("Choose which employer this stub is for.");
        return;
      }

      const ownerScope = belongsTo?.startsWith("person:") ? "person" : "household";
      const ownerPersonProfileId = ownerScope === "person" ? belongsTo!.slice("person:".length) : null;
      if (ownerScope === "person" && !ownerPersonProfileId) {
        setSubmitError("Choose a household member for “belongs to”.");
        return;
      }

      const body: Record<string, unknown> = {
        payPeriodStart: parseOptionalDate(payPeriodStart),
        payPeriodEnd: parseOptionalDate(payPeriodEnd),
        payDate: pd,
        grossPayCurrent: gc,
        netPayCurrent: nc,
        grossPayYtd: parseOptionalNumber(grossPayYtd),
        netPayYtd: parseOptionalNumber(netPayYtd),
        employeeTaxesCurrent: parseOptionalNumber(employeeTaxesCurrent),
        hoursOrDaysCurrent: hoursOrDaysCurrent.trim() === "" ? null : hoursOrDaysCurrent.trim(),
        ownerScope,
        ownerPersonProfileId: ownerScope === "person" ? ownerPersonProfileId : null
      };

      if (needsEmployerPick) {
        body.employerId = employerId.trim();
      }
      if (employers.length === 0) {
        body.parserProfileId = parserProfileId;
      }

      setSubmitting(true);
      try {
        const res = await apiJson<{ snapshot: PayslipSnapshotDetail }>("/payslips/manual", {
          method: "POST",
          body: JSON.stringify(body)
        });
        navigate(`/payslips/${res.snapshot.id}`, { replace: true });
      } catch (err: unknown) {
        setSubmitError(err instanceof Error ? err.message : "Could not save payslip");
      } finally {
        setSubmitting(false);
      }
    },
    [
      belongsTo,
      employeeTaxesCurrent,
      employerId,
      employers.length,
      grossPayCurrent,
      grossPayYtd,
      hoursOrDaysCurrent,
      navigate,
      needsEmployerPick,
      netPayCurrent,
      netPayYtd,
      parserProfileId,
      payDate,
      payPeriodEnd,
      payPeriodStart
    ]
  );

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="payslips-page">
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <Link to="/payslips">← Payslips</Link>
        </p>
        <h1 style={{ marginTop: "0.25rem" }}>Add payslip manually</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          Creates a snapshot without PDF parsing — same fields as upload/import. File name is shown as{" "}
          <strong>Manual entry</strong>.
        </p>
      </div>

      <form className="card" style={{ marginTop: "1rem" }} onSubmit={onSubmit}>
        <h2 style={{ marginTop: 0 }}>Stub</h2>

        {needsEmployerPick ? (
          <label className="field">
            <span>Employer</span>
            <select
              value={employerId}
              onChange={(ev) => setEmployerId(ev.target.value)}
              required
              aria-required
            >
              <option value="">Select employer…</option>
              {employers.map((em) => (
                <option key={em.id} value={em.id}>
                  {em.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {employers.length === 0 ? (
          <label className="field">
            <span>Payslip format</span>
            <select value={parserProfileId} onChange={(ev) => setParserProfileId(ev.target.value)}>
              {PARSER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              Add employers under Settings → Profile to tie a stub to a specific employer.
            </span>
          </label>
        ) : null}

        <div className="row" style={{ gap: "1rem", flexWrap: "wrap" }}>
          <label className="field" style={{ flex: "1 1 10rem" }}>
            <span>Pay period start</span>
            <input type="date" value={payPeriodStart} onChange={(ev) => setPayPeriodStart(ev.target.value)} />
          </label>
          <label className="field" style={{ flex: "1 1 10rem" }}>
            <span>Pay period end</span>
            <input type="date" value={payPeriodEnd} onChange={(ev) => setPayPeriodEnd(ev.target.value)} />
          </label>
          <label className="field" style={{ flex: "1 1 10rem" }}>
            <span>Pay date</span>
            <input type="date" value={payDate} onChange={(ev) => setPayDate(ev.target.value)} />
          </label>
        </div>

        <div className="row" style={{ gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            <span>Gross (current)</span>
            <input
              inputMode="decimal"
              value={grossPayCurrent}
              onChange={(ev) => setGrossPayCurrent(ev.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            <span>Net (current)</span>
            <input
              inputMode="decimal"
              value={netPayCurrent}
              onChange={(ev) => setNetPayCurrent(ev.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            <span>Employee taxes (current)</span>
            <input
              inputMode="decimal"
              value={employeeTaxesCurrent}
              onChange={(ev) => setEmployeeTaxesCurrent(ev.target.value)}
              placeholder="0.00"
            />
          </label>
        </div>

        <div className="row" style={{ gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            <span>Gross YTD</span>
            <input
              inputMode="decimal"
              value={grossPayYtd}
              onChange={(ev) => setGrossPayYtd(ev.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            <span>Net YTD</span>
            <input
              inputMode="decimal"
              value={netPayYtd}
              onChange={(ev) => setNetPayYtd(ev.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            <span>Hours / days</span>
            <input value={hoursOrDaysCurrent} onChange={(ev) => setHoursOrDaysCurrent(ev.target.value)} />
          </label>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Belongs to</h3>
          </div>
          <HierarchicalSearchPicker
            value={belongsTo}
            onChange={(v) => setBelongsTo(v)}
            groups={belongsToGroups}
            placeholder="Whole household"
            ariaLabel="Belongs to scope"
            clearable
          />
        </div>

        {submitError ? <p className="error">{submitError}</p> : null}

        <div className="row" style={{ marginTop: "1rem", gap: "0.75rem" }}>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save payslip"}
          </button>
          <Link to="/payslips" className="button ghost">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
