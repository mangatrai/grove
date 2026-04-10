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
  const [employeeTaxesYtd, setEmployeeTaxesYtd] = useState("");
  const [preTaxCurrent, setPreTaxCurrent] = useState("");
  const [preTaxYtd, setPreTaxYtd] = useState("");
  const [postTaxCurrent, setPostTaxCurrent] = useState("");
  const [postTaxYtd, setPostTaxYtd] = useState("");
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
  const hasEmployers = employers.length > 0;

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
        employeeTaxesYtd: parseOptionalNumber(employeeTaxesYtd),
        preTaxDeductionsCurrent: parseOptionalNumber(preTaxCurrent),
        preTaxDeductionsYtd: parseOptionalNumber(preTaxYtd),
        postTaxDeductionsCurrent: parseOptionalNumber(postTaxCurrent),
        postTaxDeductionsYtd: parseOptionalNumber(postTaxYtd),
        hoursOrDaysCurrent: hoursOrDaysCurrent.trim() === "" ? null : hoursOrDaysCurrent.trim(),
        ownerScope,
        ownerPersonProfileId: ownerScope === "person" ? ownerPersonProfileId : null
      };

      if (needsEmployerPick) {
        body.employerId = employerId.trim();
      }
      if (!hasEmployers) {
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
      employeeTaxesYtd,
      employerId,
      employers.length,
      grossPayCurrent,
      grossPayYtd,
      hasEmployers,
      hoursOrDaysCurrent,
      navigate,
      needsEmployerPick,
      netPayCurrent,
      netPayYtd,
      parserProfileId,
      payDate,
      payPeriodEnd,
      payPeriodStart,
      postTaxCurrent,
      postTaxYtd,
      preTaxCurrent,
      preTaxYtd
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
          Creates a snapshot without PDF parsing — the same fields as after an upload. The file name is shown as{" "}
          <strong>Manual entry</strong>. When you have employers in Settings → Profile, the app uses their template; no PDF is
          read for manual entry.
        </p>
      </div>

      <form className="card" style={{ marginTop: "1rem" }} onSubmit={onSubmit}>
        <h2 style={{ marginTop: 0 }}>Pay stub</h2>

        {hasEmployers ? (
          <div
            className="row payslip-manual__scope-row"
            style={{ alignItems: "flex-end", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}
          >
            {needsEmployerPick ? (
              <label className="field" style={{ flex: "1 1 14rem", marginBottom: 0, minWidth: "min(100%, 14rem)" }}>
                <span>Employer</span>
                <select value={employerId} onChange={(ev) => setEmployerId(ev.target.value)} required aria-required>
                  <option value="">Select employer…</option>
                  {employers.map((em) => (
                    <option key={em.id} value={em.id}>
                      {em.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field" style={{ flex: "1 1 14rem", marginBottom: 0, minWidth: "min(100%, 14rem)" }}>
              <span>Belongs to</span>
              <HierarchicalSearchPicker
                value={belongsTo}
                onChange={(v) => setBelongsTo(v)}
                groups={belongsToGroups}
                placeholder="All household activity"
                ariaLabel="Belongs to scope"
                clearable
              />
            </label>
          </div>
        ) : null}

        {!hasEmployers ? (
          <details style={{ marginBottom: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: statement template</summary>
            <p className="muted" style={{ marginTop: "0.5rem", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
              Only used for metadata and compatibility with your household setup — nothing is parsed from a file here. Add
              employers under Settings → Profile to pick a template automatically.
            </p>
            <label className="field">
              <span>Template</span>
              <select value={parserProfileId} onChange={(ev) => setParserProfileId(ev.target.value)}>
                {PARSER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </details>
        ) : null}

        {!hasEmployers ? (
          <label className="field" style={{ marginBottom: "1rem" }}>
            <span>Belongs to</span>
            <HierarchicalSearchPicker
              value={belongsTo}
              onChange={(v) => setBelongsTo(v)}
              groups={belongsToGroups}
              placeholder="All household activity"
              ariaLabel="Belongs to scope"
              clearable
            />
          </label>
        ) : null}

        <h3 style={{ marginTop: "1rem", marginBottom: "0.5rem", fontSize: "1rem" }}>Pay period</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="ledger-table payslip-manual__table">
            <thead>
              <tr>
                <th scope="col" style={{ width: "33%" }}>
                  Pay period start
                </th>
                <th scope="col" style={{ width: "33%" }}>
                  Pay period end
                </th>
                <th scope="col" style={{ width: "34%" }}>
                  Pay date
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <input
                    id="payslip-pay-period-start"
                    type="date"
                    value={payPeriodStart}
                    onChange={(ev) => setPayPeriodStart(ev.target.value)}
                    aria-label="Pay period start"
                    style={{ width: "100%", maxWidth: "12rem" }}
                  />
                </td>
                <td>
                  <input
                    id="payslip-pay-period-end"
                    type="date"
                    value={payPeriodEnd}
                    onChange={(ev) => setPayPeriodEnd(ev.target.value)}
                    aria-label="Pay period end"
                    style={{ width: "100%", maxWidth: "12rem" }}
                  />
                </td>
                <td>
                  <input
                    id="payslip-pay-date"
                    type="date"
                    value={payDate}
                    onChange={(ev) => setPayDate(ev.target.value)}
                    aria-label="Pay date"
                    style={{ width: "100%", maxWidth: "12rem" }}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 style={{ marginTop: "1.25rem", marginBottom: "0.5rem", fontSize: "1rem" }}>Earnings, taxes & deductions</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "0.9rem" }}>
          Enter amounts for this pay period (Current) and year-to-date (YTD) where applicable.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="ledger-table payslip-manual__table">
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col">Current</th>
                <th scope="col">YTD</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Gross pay</th>
                <td>
                  <input
                    inputMode="decimal"
                    value={grossPayCurrent}
                    onChange={(ev) => setGrossPayCurrent(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Gross pay current"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={grossPayYtd}
                    onChange={(ev) => setGrossPayYtd(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Gross pay YTD"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">Net pay</th>
                <td>
                  <input
                    inputMode="decimal"
                    value={netPayCurrent}
                    onChange={(ev) => setNetPayCurrent(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Net pay current"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={netPayYtd}
                    onChange={(ev) => setNetPayYtd(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Net pay YTD"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">Employee taxes</th>
                <td>
                  <input
                    inputMode="decimal"
                    value={employeeTaxesCurrent}
                    onChange={(ev) => setEmployeeTaxesCurrent(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Employee taxes current"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={employeeTaxesYtd}
                    onChange={(ev) => setEmployeeTaxesYtd(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Employee taxes YTD"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">Pre-tax deductions</th>
                <td>
                  <input
                    inputMode="decimal"
                    value={preTaxCurrent}
                    onChange={(ev) => setPreTaxCurrent(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Pre-tax deductions current"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={preTaxYtd}
                    onChange={(ev) => setPreTaxYtd(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Pre-tax deductions YTD"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">Post-tax deductions</th>
                <td>
                  <input
                    inputMode="decimal"
                    value={postTaxCurrent}
                    onChange={(ev) => setPostTaxCurrent(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Post-tax deductions current"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={postTaxYtd}
                    onChange={(ev) => setPostTaxYtd(ev.target.value)}
                    placeholder="0.00"
                    aria-label="Post-tax deductions YTD"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">Hours / days</th>
                <td>
                  <input
                    value={hoursOrDaysCurrent}
                    onChange={(ev) => setHoursOrDaysCurrent(ev.target.value)}
                    aria-label="Hours or days for current period"
                    style={{ width: "100%", maxWidth: "11rem" }}
                  />
                </td>
                <td className="muted">—</td>
              </tr>
            </tbody>
          </table>
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
