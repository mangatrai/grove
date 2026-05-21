import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Button,
  Collapse,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconPlus, IconX } from "@tabler/icons-react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { CurrencyInput } from "../components/CurrencyInput";
import type { PayslipLineItemSection, PayslipSnapshotDetail, ValidationWarning } from "../payslip/types";
import { formatUsd } from "../utils/format";

type EmployerRow = { id: string; displayName: string };
type HouseholdMemberResponse = {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
};
type HouseholdMembersPayload = { members: HouseholdMemberResponse[] };
type HouseholdProfileResponse = { profile: { id: string; fullName?: string } };

const PARSER_OPTIONS = [
  { value: "ibm_pay_contributions_pdf", label: "IBM Pay & Contributions" },
  { value: "deloitte_payslip_pdf", label: "Deloitte Pay Statement" }
] as const;

type LineRow = {
  draftId: string;
  name: string;
  current: string;
  ytd: string;
};

const mono: CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace"
};

const sectionCardTitle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "var(--color-text-muted)",
  marginBottom: 10
};

function parseNum(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function currencyFieldValue(raw: string): number | undefined {
  const parsed = parseNum(raw);
  return parsed == null ? undefined : parsed;
}

function parseDate(raw: string): string | null {
  const t = raw.trim();
  return t === "" ? null : t;
}

function makeDraftId(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function fmtMoney(n: number): string {
  return `$${formatUsd(n)}`;
}

function sumSectionRows(rows: LineRow[]): number {
  return rows.reduce((s, r) => s + (parseNum(r.current) ?? 0), 0);
}

function sumSectionYtd(rows: LineRow[]): number {
  return rows.reduce((s, r) => s + (parseNum(r.ytd) ?? 0), 0);
}

type EditableLineTableProps = {
  rows: LineRow[];
  onChange: (rows: LineRow[]) => void;
  footerLabel?: string;
  footerValue?: string;
};

function EditableLineTable({ rows, onChange, footerLabel, footerValue }: EditableLineTableProps) {
  const updateRow = (draftId: string, field: keyof LineRow, value: string) => {
    onChange(rows.map((r) => (r.draftId === draftId ? { ...r, [field]: value } : r)));
  };

  const gridCols = "1fr 100px 100px 32px";

  return (
    <Box>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          gap: 6,
          marginBottom: 5
        }}
      >
        {["Description", "Current", "YTD", ""].map((h) => (
          <div
            key={h || "actions"}
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--color-text-muted)"
            }}
          >
            {h}
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div
          key={r.draftId}
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            gap: 6,
            marginBottom: 5,
            alignItems: "center"
          }}
        >
          <TextInput
            value={r.name}
            onChange={(e) => updateRow(r.draftId, "name", e.target.value)}
            placeholder="Item name"
            size="xs"
            styles={{ input: { fontSize: 12.5 } }}
          />
          <TextInput
            value={r.current}
            onChange={(e) => updateRow(r.draftId, "current", e.target.value)}
            placeholder="0.00"
            size="xs"
            styles={{ input: { ...mono, textAlign: "right", fontSize: 12.5 } }}
            aria-label="Current amount"
          />
          <TextInput
            value={r.ytd}
            onChange={(e) => updateRow(r.draftId, "ytd", e.target.value)}
            placeholder="0.00"
            size="xs"
            styles={{ input: { ...mono, textAlign: "right", fontSize: 12.5 } }}
            aria-label="YTD amount"
          />
          <ActionIcon
            type="button"
            variant="subtle"
            color="gray"
            onClick={() => onChange(rows.filter((x) => x.draftId !== r.draftId))}
            aria-label="Remove row"
          >
            <IconX size={14} />
          </ActionIcon>
        </div>
      ))}
      <UnstyledButton
        type="button"
        onClick={() =>
          onChange([...rows, { draftId: makeDraftId(), name: "", current: "", ytd: "" }])
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 0",
          color: "var(--fs-forest-2)",
          fontSize: 12.5,
          fontWeight: 600
        }}
      >
        <IconPlus size={14} />
        Add row
      </UnstyledButton>
      {footerLabel && footerValue ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
            borderTop: "2px solid var(--color-border)",
            fontSize: 13.5,
            fontWeight: 700,
            marginTop: 8
          }}
        >
          <span>{footerLabel}</span>
          <span style={mono}>{footerValue}</span>
        </div>
      ) : null}
    </Box>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper
      withBorder
      p="md"
      style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
        borderRadius: 9
      }}
    >
      <div style={sectionCardTitle}>{title}</div>
      {children}
    </Paper>
  );
}

export function AddPayslipPage() {
  const token = useAuthToken();
  const navigate = useNavigate();

  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [personOptions, setPersonOptions] = useState<Array<{ value: string; label: string }>>([]);

  const [personProfileId, setPersonProfileId] = useState<string | null>(null);
  const [employerText, setEmployerText] = useState("");
  const [parserProfileId, setParserProfileId] = useState<string>("ibm_pay_contributions_pdf");

  const [payPeriodStart, setPayPeriodStart] = useState("");
  const [payPeriodEnd, setPayPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState("");
  const [employmentRate, setEmploymentRate] = useState("");
  const [employmentRateType, setEmploymentRateType] = useState<string | null>(null);

  const [earningsRows, setEarningsRows] = useState<LineRow[]>([
    { draftId: makeDraftId(), name: "", current: "", ytd: "" }
  ]);
  const [taxRows, setTaxRows] = useState<LineRow[]>([
    { draftId: makeDraftId(), name: "", current: "", ytd: "" }
  ]);
  const [preTaxRows, setPreTaxRows] = useState<LineRow[]>([
    { draftId: makeDraftId(), name: "", current: "", ytd: "" }
  ]);
  const [postTaxRows, setPostTaxRows] = useState<LineRow[]>([
    { draftId: makeDraftId(), name: "", current: "", ytd: "" }
  ]);

  const [taxableEarningsCurrent, setTaxableEarningsCurrent] = useState("");
  const [taxableEarningsYtd, setTaxableEarningsYtd] = useState("");
  const [otherInformationCurrent, setOtherInformationCurrent] = useState("");
  const [otherInformationYtd, setOtherInformationYtd] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);

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
      apiJson<HouseholdMembersPayload>("/household/members").catch(() => ({
        members: [] as HouseholdMemberResponse[]
      })),
      apiJson<HouseholdProfileResponse>("/household/profile").catch(() => ({
        profile: { id: "", fullName: "Household" }
      }))
    ]).then(([membersRes, profileRes]) => {
      const members = membersRes.members ?? [];
      const profile = profileRes.profile;
      const mapped = members.map((m) => ({
        value: m.id,
        label:
          [m.fullName, [m.firstName, m.lastName].filter(Boolean).join(" ").trim()].find(
            (x) => x && x.trim()
          ) || m.id
      }));
      if (profile?.id && !mapped.some((m) => m.value === profile.id)) {
        mapped.unshift({ value: profile.id, label: profile.fullName?.trim() || "Me" });
      }
      setPersonOptions(mapped);
      if (mapped.length === 1) setPersonProfileId(mapped[0].value);
    });
  }, [token]);

  const hasEmployers = employers.length > 0;
  const needsEmployerPick = employers.length > 1;

  const gross = useMemo(() => sumSectionRows(earningsRows), [earningsRows]);
  const taxes = useMemo(() => sumSectionRows(taxRows), [taxRows]);
  const preTax = useMemo(() => sumSectionRows(preTaxRows), [preTaxRows]);
  const postTax = useMemo(() => sumSectionRows(postTaxRows), [postTaxRows]);
  const net = useMemo(
    () => Math.round((gross - taxes - preTax - postTax) * 100) / 100,
    [gross, taxes, preTax, postTax]
  );

  const balanceOk = Math.abs(gross - taxes - preTax - postTax - net) < 0.02;

  const resolveEmployerId = useCallback((): string | undefined => {
    if (!hasEmployers) return undefined;
    if (employers.length === 1) return employers[0].id;
    const text = employerText.trim().toLowerCase();
    if (!text) return undefined;
    const match = employers.find((e) => e.displayName.trim().toLowerCase() === text);
    return match?.id;
  }, [employers, employerText, hasEmployers]);

  const buildLineItems = useCallback(() => {
    const sections: Array<{ section: PayslipLineItemSection; rows: LineRow[] }> = [
      { section: "earnings", rows: earningsRows },
      { section: "tax_deductions", rows: taxRows },
      { section: "pre_tax_deductions", rows: preTaxRows },
      { section: "post_tax_deductions", rows: postTaxRows }
    ];
    return sections.flatMap(({ section, rows }) =>
      rows
        .filter((d) => d.name.trim() || d.current.trim() || d.ytd.trim())
        .map((d) => ({
          section,
          name: d.name.trim() || null,
          amountCurrent: parseNum(d.current),
          amountYtd: parseNum(d.ytd)
        }))
    );
  }, [earningsRows, taxRows, preTaxRows, postTaxRows]);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      setValidationWarnings([]);

      if (!personProfileId) {
        setSubmitError("Select a household member for this payslip.");
        return;
      }

      const pd = parseDate(payDate);
      if (pd == null && gross === 0 && net === 0) {
        setSubmitError("Enter at least pay date, gross pay, or net pay.");
        return;
      }

      if (needsEmployerPick && !employerText.trim()) {
        setSubmitError("Enter the employer name.");
        return;
      }

      const employerId = resolveEmployerId();
      if (needsEmployerPick && !employerId) {
        setSubmitError("Employer name must match a configured employer in household settings.");
        return;
      }

      const body: Record<string, unknown> = {
        payPeriodStart: parseDate(payPeriodStart),
        payPeriodEnd: parseDate(payPeriodEnd),
        payDate: pd,
        grossPayCurrent: gross || null,
        grossPayYtd: sumSectionYtd(earningsRows) || null,
        employeeTaxesCurrent: taxes || null,
        employeeTaxesYtd: sumSectionYtd(taxRows) || null,
        preTaxDeductionsCurrent: preTax || null,
        preTaxDeductionsYtd: sumSectionYtd(preTaxRows) || null,
        postTaxDeductionsCurrent: postTax || null,
        postTaxDeductionsYtd: sumSectionYtd(postTaxRows) || null,
        netPayCurrent: net || null,
        netPayYtd: null,
        taxableEarningsCurrent: parseNum(taxableEarningsCurrent),
        taxableEarningsYtd: parseNum(taxableEarningsYtd),
        otherInformationCurrent: parseNum(otherInformationCurrent),
        otherInformationYtd: parseNum(otherInformationYtd),
        employmentRate: parseNum(employmentRate),
        employmentRateType: employmentRateType?.trim() ? employmentRateType : null,
        ownerScope: "person",
        ownerPersonProfileId: personProfileId,
        lineItems: buildLineItems()
      };

      if (employerId) body.employerId = employerId;
      if (!hasEmployers) body.parserProfileId = parserProfileId;

      setSubmitting(true);
      try {
        const res = await apiJson<{
          snapshot: PayslipSnapshotDetail;
          validationWarnings?: ValidationWarning[];
        }>("/payslips/manual", { method: "POST", body: JSON.stringify(body) });
        if (res.validationWarnings?.length) {
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
      buildLineItems,
      earningsRows,
      employerText,
      employmentRate,
      employmentRateType,
      gross,
      hasEmployers,
      net,
      needsEmployerPick,
      parserProfileId,
      payDate,
      payPeriodEnd,
      payPeriodStart,
      personProfileId,
      postTax,
      postTaxRows,
      preTax,
      preTaxRows,
      resolveEmployerId,
      taxableEarningsCurrent,
      taxableEarningsYtd,
      otherInformationCurrent,
      otherInformationYtd,
      taxRows,
      navigate
    ]
  );

  if (!token) return <Navigate to="/" replace />;

  const formId = "add-payslip-form";

  return (
    <Stack gap="md" component="form" id={formId} onSubmit={onSubmit}>
      <Group justify="space-between" align="center" mb={4} style={{ fontSize: 12 }}>
        <Group gap={4} c="dimmed">
          <Anchor component={Link} to="/payslips" size="sm">
            Payslips
          </Anchor>
          <Text span c="dimmed">
            ›
          </Text>
          <Text span fw={600} c="var(--color-text)">
            Add Payslip
          </Text>
        </Group>
        <Group gap={7}>
          <Button variant="default" size="xs" type="button" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button size="xs" type="submit" form={formId} loading={submitting} disabled={submitting}>
            Save Payslip
          </Button>
        </Group>
      </Group>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 270px",
          gap: 14,
          alignItems: "start"
        }}
      >
        <Stack gap={10}>
          <SectionCard title="Person & Period">
            <Group grow align="flex-end" mb="md">
              <Select
                label="Person"
                placeholder="Select person…"
                data={personOptions}
                value={personProfileId}
                onChange={setPersonProfileId}
                required
                searchable
              />
              <TextInput
                label="Employer"
                placeholder="Company name"
                value={employerText}
                onChange={(e) => setEmployerText(e.target.value)}
                required={needsEmployerPick || hasEmployers}
              />
            </Group>
            <Group grow mb="md">
              <TextInput
                type="date"
                label="Period start"
                value={payPeriodStart}
                onChange={(e) => setPayPeriodStart(e.target.value)}
              />
              <TextInput
                type="date"
                label="Period end"
                value={payPeriodEnd}
                onChange={(e) => setPayPeriodEnd(e.target.value)}
              />
              <TextInput
                type="date"
                label="Pay date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </Group>
            <Group grow align="flex-end">
              <NumberInput
                label="Pay rate"
                description="Annual salary or hourly rate"
                value={employmentRate}
                onChange={(v) => setEmploymentRate(String(v ?? ""))}
                placeholder="e.g. 85000"
              />
              <Select
                label="Rate type"
                value={employmentRateType}
                onChange={setEmploymentRateType}
                data={[
                  { value: "annual", label: "Annual" },
                  { value: "biweekly", label: "Biweekly" },
                  { value: "hourly", label: "Hourly" }
                ]}
                placeholder="Select…"
                clearable
              />
            </Group>
            {!hasEmployers ? (
              <Select
                mt="md"
                label="Statement template"
                value={parserProfileId}
                onChange={(v) => setParserProfileId(v ?? "ibm_pay_contributions_pdf")}
                data={PARSER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            ) : null}
          </SectionCard>

          <SectionCard title="Earnings">
            <EditableLineTable
              rows={earningsRows}
              onChange={setEarningsRows}
              footerLabel="Gross Pay"
              footerValue={fmtMoney(gross)}
            />
          </SectionCard>

          <SectionCard title="Tax Deductions">
            <EditableLineTable
              rows={taxRows}
              onChange={setTaxRows}
              footerLabel="Total Taxes"
              footerValue={fmtMoney(taxes)}
            />
          </SectionCard>

          <SectionCard title="Pre-Tax Deductions">
            <EditableLineTable
              rows={preTaxRows}
              onChange={setPreTaxRows}
              footerLabel="Total Pre-Tax"
              footerValue={fmtMoney(preTax)}
            />
          </SectionCard>

          <SectionCard title="Post-Tax Deductions">
            <EditableLineTable
              rows={postTaxRows}
              onChange={setPostTaxRows}
              footerLabel="Total Post-Tax"
              footerValue={fmtMoney(postTax)}
            />
          </SectionCard>

          <Paper
            withBorder
            p="md"
            style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: 9 }}
          >
            <UnstyledButton
              type="button"
              onClick={() => setOtherOpen((v) => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minHeight: 44 }}
            >
              {otherOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              <span style={sectionCardTitle}>Other</span>
            </UnstyledButton>
            <Collapse in={otherOpen}>
              <Stack gap="sm" mt="sm">
                <Group grow>
                  <Box>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
                      Taxable earnings
                    </Text>
                    <Group grow>
                      <CurrencyInput
                        label="Current"
                        value={currencyFieldValue(taxableEarningsCurrent)}
                        onChange={(v) => setTaxableEarningsCurrent(v == null ? "" : String(v))}
                      />
                      <CurrencyInput
                        label="YTD"
                        value={currencyFieldValue(taxableEarningsYtd)}
                        onChange={(v) => setTaxableEarningsYtd(v == null ? "" : String(v))}
                      />
                    </Group>
                  </Box>
                  <Box>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
                      Other information
                    </Text>
                    <Group grow>
                      <CurrencyInput
                        label="Current"
                        value={currencyFieldValue(otherInformationCurrent)}
                        onChange={(v) => setOtherInformationCurrent(v == null ? "" : String(v))}
                      />
                      <CurrencyInput
                        label="YTD"
                        value={currencyFieldValue(otherInformationYtd)}
                        onChange={(v) => setOtherInformationYtd(v == null ? "" : String(v))}
                      />
                    </Group>
                  </Box>
                </Group>
              </Stack>
            </Collapse>
          </Paper>

          {submitError ? <Alert color="red">{submitError}</Alert> : null}
          {validationWarnings.length > 0 ? (
            <Alert color="yellow" variant="light">
              <Stack gap={4}>
                {validationWarnings.map((w, i) => (
                  <Text key={i} size="sm">
                    {w.message}
                  </Text>
                ))}
              </Stack>
            </Alert>
          ) : null}

        </Stack>

        <Box style={{ position: "sticky", top: 16 }}>
          <Paper
            withBorder
            p="md"
            style={{
              background: "var(--color-surface)",
              borderColor: "var(--color-border)",
              borderRadius: 9
            }}
          >
            <div style={sectionCardTitle}>Live Summary</div>
            {(
              [
                { k: "Gross Pay", v: gross, color: "var(--color-text)", bold: true },
                { k: "Tax Deductions", v: -taxes, color: "var(--fs-terracotta)", bold: false },
                { k: "Pre-Tax Ded.", v: -preTax, color: "#7c3aed", bold: false },
                { k: "Post-Tax Ded.", v: -postTax, color: "var(--color-text-muted)", bold: false }
              ] as const
            ).map(({ k, v, color, bold }) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "5px 0",
                  borderBottom: "1px solid var(--color-border)",
                  fontSize: 13
                }}
              >
                <span style={{ color: "var(--color-text-secondary)" }}>{k}</span>
                <span style={{ ...mono, fontWeight: bold ? 700 : 500, color }}>
                  {v < 0 ? `−${fmtMoney(Math.abs(v))}` : fmtMoney(v)}
                </span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "9px 0",
                fontSize: 16,
                fontWeight: 700
              }}
            >
              <span>Net Pay</span>
              <span style={{ ...mono, color: "var(--fs-forest)" }}>{fmtMoney(net)}</span>
            </div>
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                background: balanceOk ? "var(--color-accent-subtle)" : "var(--color-warm-subtle)",
                border: balanceOk
                  ? "1px solid rgba(45,106,79,0.2)"
                  : "1px solid rgba(200,134,10,0.3)",
                fontSize: 12,
                color: balanceOk ? "var(--fs-forest)" : "#6b4c0a"
              }}
              role="status"
            >
              {balanceOk ? "✓ Totals balance" : "⚠ Check totals before saving"}
            </div>
          </Paper>
        </Box>
      </div>
    </Stack>
  );
}
