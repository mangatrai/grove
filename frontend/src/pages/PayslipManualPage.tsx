import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Anchor, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import type { PayslipLineItemSection, PayslipSnapshotDetail, ValidationWarning } from "../payslip/types";

type EmployerRow = { id: string; displayName: string };
type HouseholdMemberResponse = { id: string; fullName?: string; firstName?: string; lastName?: string };
type HouseholdMembersPayload = { members: HouseholdMemberResponse[] };
type HouseholdProfileResponse = { profile: { id: string; fullName?: string } };

const PARSER_OPTIONS = [
  { value: "ibm_pay_contributions_pdf", label: "IBM Pay & Contributions" },
  { value: "deloitte_payslip_pdf", label: "Deloitte Pay Statement" }
] as const;

const SECTION_OPTIONS: { value: PayslipLineItemSection; label: string }[] = [
  { value: "earnings", label: "Earnings" },
  { value: "pre_tax_deductions", label: "Pre-tax deductions" },
  { value: "tax_deductions", label: "Tax deductions" },
  { value: "post_tax_deductions", label: "Post-tax deductions" },
  { value: "other_information", label: "Other information" },
  { value: "taxable_earnings", label: "Taxable earnings" },
];

function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | null {
  const t = raw.trim();
  return t === "" ? null : t;
}

function fmtMoney(n: number | null): string {
  if (n == null) return "";
  return `$${n.toFixed(2)}`;
}

function makeDraftId(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type DraftLineItem = {
  draftId: string;
  section: PayslipLineItemSection;
  name: string;
  amountCurrent: string;
  amountYtd: string;
};

export function PayslipManualPage() {
  const token = useAuthToken();
  const navigate = useNavigate();
  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<Array<{ id: string; label: string }>>([]);

  // Context
  const [belongsTo, setBelongsTo] = useState<string | null>(null);
  const [employerId, setEmployerId] = useState<string>("");
  const [parserProfileId, setParserProfileId] = useState<string>("ibm_pay_contributions_pdf");

  // Pay period
  const [payPeriodStart, setPayPeriodStart] = useState("");
  const [payPeriodEnd, setPayPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState("");

  // Summary amounts
  const [grossPayCurrent, setGrossPayCurrent] = useState("");
  const [grossPayYtd, setGrossPayYtd] = useState("");
  const [preTaxCurrent, setPreTaxCurrent] = useState("");
  const [preTaxYtd, setPreTaxYtd] = useState("");
  const [employeeTaxesCurrent, setEmployeeTaxesCurrent] = useState("");
  const [employeeTaxesYtd, setEmployeeTaxesYtd] = useState("");
  const [postTaxCurrent, setPostTaxCurrent] = useState("");
  const [postTaxYtd, setPostTaxYtd] = useState("");
  const [netPayCurrent, setNetPayCurrent] = useState("");
  const [netPayYtd, setNetPayYtd] = useState("");
  const [hoursOrDaysCurrent, setHoursOrDaysCurrent] = useState("");
  const [hoursOrDaysYtd, setHoursOrDaysYtd] = useState("");
  const [taxableEarningsCurrent, setTaxableEarningsCurrent] = useState("");
  const [taxableEarningsYtd, setTaxableEarningsYtd] = useState("");
  const [otherInformationCurrent, setOtherInformationCurrent] = useState("");
  const [otherInformationYtd, setOtherInformationYtd] = useState("");
  const [employmentRate, setEmploymentRate] = useState("");
  const [employmentRateType, setEmploymentRateType] = useState("");

  // Line items
  const [draftLineItems, setDraftLineItems] = useState<DraftLineItem[]>([]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([]);

  useEffect(() => {
    if (!token) return;
    void apiJson<{ employers: EmployerRow[] }>("/household/settings")
      .then((r) => setEmployers(r.employers ?? []))
      .catch(() => setEmployers([]));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void Promise.all([
      apiJson<HouseholdMembersPayload>("/household/members").catch(() => ({ members: [] as HouseholdMemberResponse[] })),
      apiJson<HouseholdProfileResponse>("/household/profile").catch(() => ({ profile: { id: "", fullName: "Household" } }))
    ]).then(([membersRes, profileRes]) => {
      const members = membersRes.members ?? [];
      const profile = profileRes.profile;
      const mapped = members.map((m) => ({
        id: m.id,
        label: [m.fullName, [m.firstName, m.lastName].filter(Boolean).join(" ").trim()].find((x) => x && x.trim()) || m.id
      }));
      if (profile?.id && !mapped.some((m) => m.id === profile.id)) {
        mapped.unshift({
          id: profile.id,
          label: profile.fullName?.trim() || "Me"
        });
      }
      setOwnerProfiles(mapped);
    });
  }, [token]);

  const belongsToGroups = useMemo<HierarchicalPickerGroup[]>(
    () => [
      { group: "Household", items: [{ value: "household", label: "Household", displayLabel: "Household", searchText: "household" }] },
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

  // Live arithmetic: implied net = gross - preTax - taxes - postTax
  const impliedNet = useMemo(() => {
    const g = parseNum(grossPayCurrent);
    if (g == null) return null;
    const pre = parseNum(preTaxCurrent) ?? 0;
    const taxes = parseNum(employeeTaxesCurrent) ?? 0;
    const post = parseNum(postTaxCurrent) ?? 0;
    return Math.round((g - pre - taxes - post) * 100) / 100;
  }, [grossPayCurrent, preTaxCurrent, employeeTaxesCurrent, postTaxCurrent]);

  const statedNet = parseNum(netPayCurrent);
  const netDelta = impliedNet != null && statedNet != null ? Math.abs(impliedNet - statedNet) : null;

  // Line item helpers
  const addLineItem = () => {
    setDraftLineItems((prev) => [
      ...prev,
      { draftId: makeDraftId(), section: "earnings", name: "", amountCurrent: "", amountYtd: "" }
    ]);
  };

  const removeLineItem = (draftId: string) => {
    setDraftLineItems((prev) => prev.filter((d) => d.draftId !== draftId));
  };

  const updateLineItem = (draftId: string, field: keyof DraftLineItem, value: string) => {
    setDraftLineItems((prev) =>
      prev.map((d) => d.draftId === draftId ? { ...d, [field]: value } : d)
    );
  };

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      setValidationWarnings([]);

      const pd = parseDate(payDate);
      const gc = parseNum(grossPayCurrent);
      const nc = parseNum(netPayCurrent);
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
        setSubmitError('Choose a household member for "belongs to".');
        return;
      }

      const lineItemsPayload = draftLineItems
        .filter((d) => d.name.trim() || d.amountCurrent.trim() || d.amountYtd.trim())
        .map((d) => ({
          section: d.section,
          name: d.name.trim() || null,
          amountCurrent: parseNum(d.amountCurrent),
          amountYtd: parseNum(d.amountYtd)
        }));

      const body: Record<string, unknown> = {
        payPeriodStart: parseDate(payPeriodStart),
        payPeriodEnd: parseDate(payPeriodEnd),
        payDate: pd,
        grossPayCurrent: gc,
        grossPayYtd: parseNum(grossPayYtd),
        preTaxDeductionsCurrent: parseNum(preTaxCurrent),
        preTaxDeductionsYtd: parseNum(preTaxYtd),
        employeeTaxesCurrent: parseNum(employeeTaxesCurrent),
        employeeTaxesYtd: parseNum(employeeTaxesYtd),
        postTaxDeductionsCurrent: parseNum(postTaxCurrent),
        postTaxDeductionsYtd: parseNum(postTaxYtd),
        netPayCurrent: nc,
        netPayYtd: parseNum(netPayYtd),
        hoursOrDaysCurrent: hoursOrDaysCurrent.trim() === "" ? null : hoursOrDaysCurrent.trim(),
        hoursOrDaysYtd: hoursOrDaysYtd.trim() === "" ? null : hoursOrDaysYtd.trim(),
        taxableEarningsCurrent: parseNum(taxableEarningsCurrent),
        taxableEarningsYtd: parseNum(taxableEarningsYtd),
        otherInformationCurrent: parseNum(otherInformationCurrent),
        otherInformationYtd: parseNum(otherInformationYtd),
        employmentRate: parseNum(employmentRate),
        employmentRateType: employmentRateType.trim() === "" ? null : employmentRateType.trim(),
        ownerScope,
        ownerPersonProfileId: ownerScope === "person" ? ownerPersonProfileId : null,
        lineItems: lineItemsPayload
      };

      if (needsEmployerPick) body.employerId = employerId.trim();
      if (!hasEmployers) body.parserProfileId = parserProfileId;

      setSubmitting(true);
      try {
        const res = await apiJson<{ snapshot: PayslipSnapshotDetail; validationWarnings?: ValidationWarning[] }>(
          "/payslips/manual",
          { method: "POST", body: JSON.stringify(body) }
        );
        if (res.validationWarnings && res.validationWarnings.length > 0) {
          // Show warnings briefly then navigate — user can review on detail page
          setValidationWarnings(res.validationWarnings);
        }
        navigate(`/payslips/${res.snapshot.id}`, { replace: true });
      } catch (err: unknown) {
        setSubmitError(err instanceof Error ? err.message : "Could not save payslip");
      } finally {
        setSubmitting(false);
      }
    },
    [
      belongsTo, draftLineItems, employeeTaxesCurrent, employeeTaxesYtd,
      employerId, employers.length, employmentRate, employmentRateType,
      grossPayCurrent, grossPayYtd, hasEmployers, hoursOrDaysCurrent, hoursOrDaysYtd,
      navigate, needsEmployerPick, netPayCurrent, netPayYtd,
      otherInformationCurrent, otherInformationYtd, parserProfileId,
      payDate, payPeriodEnd, payPeriodStart,
      postTaxCurrent, postTaxYtd, preTaxCurrent, preTaxYtd,
      taxableEarningsCurrent, taxableEarningsYtd
    ]
  );

  if (!token) return <Navigate to="/" replace />;

  // Implied net color
  let netColor = "var(--color-text-muted)";
  if (impliedNet != null && statedNet != null) {
    if (netDelta! <= 1) netColor = "var(--color-success, #16a34a)";
    else if (netDelta! <= 50) netColor = "#d97706";
    else netColor = "var(--color-danger, #dc2626)";
  }

  const inputStyle: React.CSSProperties = { width: "100%", maxWidth: "11rem" };
  const dateStyle: React.CSSProperties = { width: "100%", maxWidth: "12rem" };

  return (
    <Stack className="payslips-page">
      {/* Header */}
      <Paper withBorder p="lg">
        <Anchor component={Link} to="/payslips">← Payslips</Anchor>
        <Title order={2} mt="xs" mb={4}>Add payslip manually</Title>
        <Text c="dimmed" size="sm">Enter totals from any pay stub — no PDF required.</Text>
      </Paper>

      <form onSubmit={onSubmit}>
        {/* Section 1: Context */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb="md">Who / employer</Title>
          <Group align="end" grow>
            {hasEmployers && needsEmployerPick ? (
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Employer</span>
                <select value={employerId} onChange={(ev) => setEmployerId(ev.target.value)} required aria-required style={{ minHeight: 36 }}>
                  <option value="">Select employer…</option>
                  {employers.map((em) => (
                    <option key={em.id} value={em.id}>{em.displayName}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field" style={{ marginBottom: 0 }}>
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
            {!hasEmployers ? (
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Statement template</span>
                <select value={parserProfileId} onChange={(ev) => setParserProfileId(ev.target.value)} style={{ minHeight: 36 }}>
                  {PARSER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </Group>
        </Paper>

        {/* Section 2: Pay period */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb="md">Pay period</Title>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 10rem", marginBottom: 0 }}>
              <span>Period start</span>
              <input type="date" value={payPeriodStart} onChange={(e) => setPayPeriodStart(e.target.value)}
                aria-label="Pay period start" style={dateStyle} />
            </label>
            <label className="field" style={{ flex: "1 1 10rem", marginBottom: 0 }}>
              <span>Period end</span>
              <input type="date" value={payPeriodEnd} onChange={(e) => setPayPeriodEnd(e.target.value)}
                aria-label="Pay period end" style={dateStyle} />
            </label>
            <label className="field" style={{ flex: "1 1 10rem", marginBottom: 0 }}>
              <span>Pay date</span>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                aria-label="Pay date" style={dateStyle} />
            </label>
          </div>
        </Paper>

        {/* Section 3: Summary amounts */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb={4}>Earnings, taxes & deductions</Title>
          <Text c="dimmed" size="sm" mt={0} mb="md">
            Current = this pay period. YTD = year-to-date total. Leave blank if unknown.
          </Text>
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table payslip-manual__table">
              <thead>
                <tr>
                  <th scope="col" style={{ minWidth: "11rem" }}>Description</th>
                  <th scope="col">Current</th>
                  <th scope="col">YTD</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" style={{ fontWeight: 500 }}>Gross pay</th>
                  <td><input inputMode="decimal" value={grossPayCurrent} onChange={(e) => setGrossPayCurrent(e.target.value)} placeholder="0.00" aria-label="Gross pay current" style={inputStyle} /></td>
                  <td><input inputMode="decimal" value={grossPayYtd} onChange={(e) => setGrossPayYtd(e.target.value)} placeholder="0.00" aria-label="Gross pay YTD" style={inputStyle} /></td>
                </tr>
                <tr>
                  <th scope="row" style={{ fontWeight: 500 }}>Pre-tax deductions</th>
                  <td><input inputMode="decimal" value={preTaxCurrent} onChange={(e) => setPreTaxCurrent(e.target.value)} placeholder="0.00" aria-label="Pre-tax deductions current" style={inputStyle} /></td>
                  <td><input inputMode="decimal" value={preTaxYtd} onChange={(e) => setPreTaxYtd(e.target.value)} placeholder="0.00" aria-label="Pre-tax deductions YTD" style={inputStyle} /></td>
                </tr>
                <tr>
                  <th scope="row" style={{ fontWeight: 500 }}>Employee taxes</th>
                  <td><input inputMode="decimal" value={employeeTaxesCurrent} onChange={(e) => setEmployeeTaxesCurrent(e.target.value)} placeholder="0.00" aria-label="Employee taxes current" style={inputStyle} /></td>
                  <td><input inputMode="decimal" value={employeeTaxesYtd} onChange={(e) => setEmployeeTaxesYtd(e.target.value)} placeholder="0.00" aria-label="Employee taxes YTD" style={inputStyle} /></td>
                </tr>
                <tr>
                  <th scope="row" style={{ fontWeight: 500 }}>Post-tax deductions</th>
                  <td><input inputMode="decimal" value={postTaxCurrent} onChange={(e) => setPostTaxCurrent(e.target.value)} placeholder="0.00" aria-label="Post-tax deductions current" style={inputStyle} /></td>
                  <td><input inputMode="decimal" value={postTaxYtd} onChange={(e) => setPostTaxYtd(e.target.value)} placeholder="0.00" aria-label="Post-tax deductions YTD" style={inputStyle} /></td>
                </tr>
                <tr>
                  <th scope="row" style={{ fontWeight: 500 }}>Net pay</th>
                  <td><input inputMode="decimal" value={netPayCurrent} onChange={(e) => setNetPayCurrent(e.target.value)} placeholder="0.00" aria-label="Net pay current" style={inputStyle} /></td>
                  <td><input inputMode="decimal" value={netPayYtd} onChange={(e) => setNetPayYtd(e.target.value)} placeholder="0.00" aria-label="Net pay YTD" style={inputStyle} /></td>
                </tr>
                {/* Supplemental rows */}
                <tr style={{ borderTop: "2px solid var(--color-border)" }}>
                  <th scope="row" style={{ fontWeight: 400, color: "var(--color-text-muted)", fontSize: "0.9rem" }}>Hours / days</th>
                  <td><input value={hoursOrDaysCurrent} onChange={(e) => setHoursOrDaysCurrent(e.target.value)} aria-label="Hours or days current" style={inputStyle} /></td>
                  <td><input value={hoursOrDaysYtd} onChange={(e) => setHoursOrDaysYtd(e.target.value)} aria-label="Hours or days YTD" style={inputStyle} /></td>
                </tr>
                <tr>
                  <th scope="row" style={{ fontWeight: 400, color: "var(--color-text-muted)", fontSize: "0.9rem" }}>Taxable earnings</th>
                  <td><input inputMode="decimal" value={taxableEarningsCurrent} onChange={(e) => setTaxableEarningsCurrent(e.target.value)} placeholder="0.00" aria-label="Taxable earnings current" style={inputStyle} /></td>
                  <td><input inputMode="decimal" value={taxableEarningsYtd} onChange={(e) => setTaxableEarningsYtd(e.target.value)} placeholder="0.00" aria-label="Taxable earnings YTD" style={inputStyle} /></td>
                </tr>
                <tr>
                  <th scope="row" style={{ fontWeight: 400, color: "var(--color-text-muted)", fontSize: "0.9rem" }}>Other information</th>
                  <td><input inputMode="decimal" value={otherInformationCurrent} onChange={(e) => setOtherInformationCurrent(e.target.value)} placeholder="0.00" aria-label="Other information current" style={inputStyle} /></td>
                  <td><input inputMode="decimal" value={otherInformationYtd} onChange={(e) => setOtherInformationYtd(e.target.value)} placeholder="0.00" aria-label="Other information YTD" style={inputStyle} /></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Live arithmetic check */}
          {impliedNet != null ? (
            <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Text span c="dimmed">Implied net (gross − deductions):</Text>
              <span style={{ fontWeight: 600, color: netColor }}>{fmtMoney(impliedNet)}</span>
              {statedNet != null && netDelta != null && netDelta > 0.01 ? (
                <span style={{ color: netColor, fontSize: "0.8rem" }}>
                  (stated net {fmtMoney(statedNet)}, diff ${netDelta.toFixed(2)})
                </span>
              ) : statedNet != null && netDelta != null && netDelta <= 0.01 ? (
                <span style={{ color: netColor, fontSize: "0.8rem" }}>✓ matches stated net</span>
              ) : null}
            </div>
          ) : null}
        </Paper>

        {/* Section 4: Line items (optional) */}
        <Paper withBorder p="lg">
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, padding: "0.1rem 0" }}>
              Line items
              <Text span c="dimmed" style={{ fontWeight: 400, marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                optional — individual earnings and deduction rows
              </Text>
              {draftLineItems.length > 0 ? (
                <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--color-accent)" }}>
                  ({draftLineItems.length} added)
                </span>
              ) : null}
            </summary>
            <div style={{ marginTop: "0.75rem" }}>
              <Text c="dimmed" size="sm" mt={0} mb="md">
                Add individual rows (e.g. Regular Pay, 401k, Federal Tax). The matching summary totals above will auto-calculate from these when you save.
              </Text>
              {draftLineItems.length > 0 ? (
                <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
                  <table className="ledger-table" style={{ fontSize: "0.85rem" }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: "9rem" }}>Section</th>
                        <th style={{ minWidth: "10rem" }}>Name</th>
                        <th style={{ minWidth: "7rem" }}>Current</th>
                        <th style={{ minWidth: "7rem" }}>YTD</th>
                        <th style={{ width: "2rem" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {draftLineItems.map((d) => (
                        <tr key={d.draftId}>
                          <td>
                            <select
                              value={d.section}
                              onChange={(e) => updateLineItem(d.draftId, "section", e.target.value)}
                              style={{ fontSize: "0.83rem", padding: "0.15rem 0.3rem", width: "100%" }}
                            >
                              {SECTION_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={d.name}
                              onChange={(e) => updateLineItem(d.draftId, "name", e.target.value)}
                              placeholder="e.g. Regular Pay"
                              style={{ width: "100%", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
                            />
                          </td>
                          <td>
                            <input
                              inputMode="decimal"
                              value={d.amountCurrent}
                              onChange={(e) => updateLineItem(d.draftId, "amountCurrent", e.target.value)}
                              placeholder="0.00"
                              style={{ width: "100%", maxWidth: "7rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
                            />
                          </td>
                          <td>
                            <input
                              inputMode="decimal"
                              value={d.amountYtd}
                              onChange={(e) => updateLineItem(d.draftId, "amountYtd", e.target.value)}
                              placeholder="0.00"
                              style={{ width: "100%", maxWidth: "7rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
                            />
                          </td>
                          <td>
                            <Button type="button" variant="subtle" color="red"
                              onClick={() => removeLineItem(d.draftId)}
                              title="Remove row"
                              style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem", color: "var(--color-danger, #dc2626)" }}>
                              ✕
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <Button type="button" variant="default" onClick={addLineItem} size="xs">
                + Add line item
              </Button>
            </div>
          </details>
        </Paper>

        {/* Section 5: Employment info */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb="md">
            Salary / rate
            <Text span c="dimmed" style={{ fontWeight: 400, marginLeft: "0.4rem", fontSize: "0.85rem" }}>(optional)</Text>
          </Title>
          <Group align="end" grow>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Annual salary or hourly rate</span>
              <input inputMode="decimal" value={employmentRate} onChange={(e) => setEmploymentRate(e.target.value)}
                placeholder="e.g. 180000" aria-label="Employment rate or salary" style={{ width: "100%" }} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Rate type</span>
              <select value={employmentRateType} onChange={(e) => setEmploymentRateType(e.target.value)} aria-label="Employment rate type" style={{ minHeight: 36 }}>
                <option value="">—</option>
                <option value="annual">Annual</option>
                <option value="biweekly">Biweekly</option>
                <option value="hourly">Hourly</option>
              </select>
            </label>
          </Group>
        </Paper>

        {/* Submit */}
        <Paper withBorder p="lg">
          {submitError ? <Alert color="red" mb="sm">{submitError}</Alert> : null}
          {validationWarnings.length > 0 ? (
            <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "rgba(234,179,8,0.07)", border: "1px solid rgba(234,179,8,0.4)", borderRadius: 6 }}>
              {validationWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: "0.82rem", color: w.code === "ARITHMETIC_IMBALANCE" ? "var(--color-danger, #dc2626)" : "#92400e" }}>
                  {w.message}
                </div>
              ))}
            </div>
          ) : null}
          <Group gap="md" align="center">
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? "Saving…" : "Save payslip"}
            </Button>
            <Button component={Link} to="/payslips" variant="default">Cancel</Button>
          </Group>
        </Paper>
      </form>
    </Stack>
  );
}
