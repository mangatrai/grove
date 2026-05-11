import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash } from "@tabler/icons-react";

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
  const [lineItemsOpen, setLineItemsOpen] = useState(false);

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
  let netColor: string = "dimmed";
  if (impliedNet != null && statedNet != null) {
    if (netDelta! <= 1) netColor = "green";
    else if (netDelta! <= 50) netColor = "yellow";
    else netColor = "red";
  }

  return (
    <Stack>
      {/* Header */}
      <Paper withBorder p="lg">
        <Anchor component={Link} to="/payslips">← Payslips</Anchor>
        <Title order={2} mt="xs" mb={4}>Add payslip manually</Title>
        <Text c="dimmed" size="sm">Enter totals from any pay stub — no PDF required.</Text>
      </Paper>

      <Stack component="form" onSubmit={onSubmit} gap="md">
        {/* Section 1: Context */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb="md">Who / employer</Title>
          <Group align="end" grow>
            {hasEmployers && needsEmployerPick ? (
              <Select
                label="Employer"
                value={employerId}
                onChange={(value) => setEmployerId(value ?? "")}
                data={employers.map((em) => ({ value: em.id, label: em.displayName }))}
                placeholder="Select employer..."
                required
              />
            ) : null}
            <Box>
              <Text size="sm" fw={500} mb={6}>Belongs to</Text>
              <HierarchicalSearchPicker
                value={belongsTo}
                onChange={(v) => setBelongsTo(v)}
                groups={belongsToGroups}
                placeholder="All household activity"
                ariaLabel="Belongs to scope"
                clearable
              />
            </Box>
            {!hasEmployers ? (
              <Select
                label="Statement template"
                value={parserProfileId}
                onChange={(value) => setParserProfileId(value ?? "")}
                data={PARSER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            ) : null}
          </Group>
        </Paper>

        {/* Section 2: Pay period */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb="md">Pay period</Title>
          <Group grow align="end">
            <TextInput
              type="date"
              label="Period start"
              value={payPeriodStart}
              onChange={(e) => setPayPeriodStart(e.target.value)}
              aria-label="Pay period start"
              maw={220}
            />
            <TextInput
              type="date"
              label="Period end"
              value={payPeriodEnd}
              onChange={(e) => setPayPeriodEnd(e.target.value)}
              aria-label="Pay period end"
              maw={220}
            />
            <TextInput
              type="date"
              label="Pay date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              aria-label="Pay date"
              maw={220}
            />
          </Group>
        </Paper>

        {/* Section 3: Summary amounts */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb={4}>Earnings, taxes & deductions</Title>
          <Text c="dimmed" size="sm" mt={0} mb="md">
            Current = this pay period. YTD = year-to-date total. Leave blank if unknown.
          </Text>
          <Table withTableBorder striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th miw={170}>Description</Table.Th>
                <Table.Th>Current</Table.Th>
                <Table.Th>YTD</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td><Text fw={500}>Gross pay</Text></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={grossPayCurrent} onChange={(v) => setGrossPayCurrent(String(v ?? ""))} placeholder="0.00" aria-label="Gross pay current" /></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={grossPayYtd} onChange={(v) => setGrossPayYtd(String(v ?? ""))} placeholder="0.00" aria-label="Gross pay YTD" /></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text fw={500}>Pre-tax deductions</Text></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={preTaxCurrent} onChange={(v) => setPreTaxCurrent(String(v ?? ""))} placeholder="0.00" aria-label="Pre-tax deductions current" /></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={preTaxYtd} onChange={(v) => setPreTaxYtd(String(v ?? ""))} placeholder="0.00" aria-label="Pre-tax deductions YTD" /></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text fw={500}>Employee taxes</Text></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={employeeTaxesCurrent} onChange={(v) => setEmployeeTaxesCurrent(String(v ?? ""))} placeholder="0.00" aria-label="Employee taxes current" /></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={employeeTaxesYtd} onChange={(v) => setEmployeeTaxesYtd(String(v ?? ""))} placeholder="0.00" aria-label="Employee taxes YTD" /></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text fw={500}>Post-tax deductions</Text></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={postTaxCurrent} onChange={(v) => setPostTaxCurrent(String(v ?? ""))} placeholder="0.00" aria-label="Post-tax deductions current" /></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={postTaxYtd} onChange={(v) => setPostTaxYtd(String(v ?? ""))} placeholder="0.00" aria-label="Post-tax deductions YTD" /></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text fw={500}>Net pay</Text></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={netPayCurrent} onChange={(v) => setNetPayCurrent(String(v ?? ""))} placeholder="0.00" aria-label="Net pay current" /></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={netPayYtd} onChange={(v) => setNetPayYtd(String(v ?? ""))} placeholder="0.00" aria-label="Net pay YTD" /></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text c="dimmed" size="sm">Hours / days</Text></Table.Td>
                <Table.Td><TextInput value={hoursOrDaysCurrent} onChange={(e) => setHoursOrDaysCurrent(e.target.value)} aria-label="Hours or days current" /></Table.Td>
                <Table.Td><TextInput value={hoursOrDaysYtd} onChange={(e) => setHoursOrDaysYtd(e.target.value)} aria-label="Hours or days YTD" /></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text c="dimmed" size="sm">Taxable earnings</Text></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={taxableEarningsCurrent} onChange={(v) => setTaxableEarningsCurrent(String(v ?? ""))} placeholder="0.00" aria-label="Taxable earnings current" /></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={taxableEarningsYtd} onChange={(v) => setTaxableEarningsYtd(String(v ?? ""))} placeholder="0.00" aria-label="Taxable earnings YTD" /></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text c="dimmed" size="sm">Other information</Text></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={otherInformationCurrent} onChange={(v) => setOtherInformationCurrent(String(v ?? ""))} placeholder="0.00" aria-label="Other information current" /></Table.Td>
                <Table.Td><NumberInput decimalScale={2} value={otherInformationYtd} onChange={(v) => setOtherInformationYtd(String(v ?? ""))} placeholder="0.00" aria-label="Other information YTD" /></Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          {/* Live arithmetic check */}
          {impliedNet != null ? (
            <Group mt="md" gap="xs">
              <Text size="sm" c="dimmed">Implied net (gross - deductions):</Text>
              <Text size="sm" fw={600} c={netColor}>{fmtMoney(impliedNet)}</Text>
              {statedNet != null && netDelta != null && netDelta > 0.01 ? (
                <Text size="sm" c={netColor}>
                  (stated net {fmtMoney(statedNet)}, diff ${netDelta.toFixed(2)})
                </Text>
              ) : statedNet != null && netDelta != null && netDelta <= 0.01 ? (
                <Text size="sm" c={netColor}>matches stated net</Text>
              ) : null}
            </Group>
          ) : null}
        </Paper>

        {/* Section 4: Line items (optional) */}
        <Paper withBorder p="lg">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Button
                type="button"
                variant="subtle"
                onClick={() => setLineItemsOpen((v) => !v)}
                leftSection={lineItemsOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              >
                Line items
              </Button>
              <Text size="sm" c="dimmed">optional - individual earnings and deduction rows</Text>
              {draftLineItems.length > 0 ? <Text size="sm" style={{ color: "var(--fs-forest)" }}>({draftLineItems.length} added)</Text> : null}
            </Group>
          </Group>
          {lineItemsOpen ? (
            <Stack mt="md">
              <Text c="dimmed" size="sm">
                Add individual rows (e.g. Regular Pay, 401k, Federal Tax). The matching summary totals above will auto-calculate from these when you save.
              </Text>
              {draftLineItems.length > 0 ? (
                <Table withTableBorder striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th miw={140}>Section</Table.Th>
                      <Table.Th miw={180}>Name</Table.Th>
                      <Table.Th miw={120}>Current</Table.Th>
                      <Table.Th miw={120}>YTD</Table.Th>
                      <Table.Th w={48} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {draftLineItems.map((d) => (
                      <Table.Tr key={d.draftId}>
                        <Table.Td>
                          <Select
                            value={d.section}
                            onChange={(value) => updateLineItem(d.draftId, "section", value ?? d.section)}
                            data={SECTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                          />
                        </Table.Td>
                        <Table.Td>
                          <TextInput
                            value={d.name}
                            onChange={(e) => updateLineItem(d.draftId, "name", e.target.value)}
                            placeholder="e.g. Regular Pay"
                          />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput
                            decimalScale={2}
                            value={d.amountCurrent}
                            onChange={(v) => updateLineItem(d.draftId, "amountCurrent", String(v ?? ""))}
                            placeholder="0.00"
                          />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput
                            decimalScale={2}
                            value={d.amountYtd}
                            onChange={(v) => updateLineItem(d.draftId, "amountYtd", String(v ?? ""))}
                            placeholder="0.00"
                          />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            type="button"
                            variant="subtle"
                            color="red"
                            onClick={() => removeLineItem(d.draftId)}
                            title="Remove row"
                            aria-label="Remove row"
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : null}
              <Button type="button" variant="default" onClick={addLineItem} size="xs" leftSection={<IconPlus size={14} />}>
                Add line item
              </Button>
            </Stack>
          ) : null}
        </Paper>

        {/* Section 5: Employment info */}
        <Paper withBorder p="lg">
          <Title order={4} mt={0} mb="md">
            Salary / rate
            <Text span c="dimmed" size="sm" fw={400} ml={6}>(optional)</Text>
          </Title>
          <Group align="end" grow>
            <NumberInput
              label="Annual salary or hourly rate"
              value={employmentRate}
              onChange={(v) => setEmploymentRate(String(v ?? ""))}
              placeholder="e.g. 180000"
              aria-label="Employment rate or salary"
            />
            <Select
              label="Rate type"
              value={employmentRateType}
              onChange={(value) => setEmploymentRateType(value ?? "")}
              aria-label="Employment rate type"
              data={[
                { value: "", label: "-" },
                { value: "annual", label: "Annual" },
                { value: "biweekly", label: "Biweekly" },
                { value: "hourly", label: "Hourly" }
              ]}
            />
          </Group>
        </Paper>

        {/* Submit */}
        <Paper withBorder p="lg">
          {submitError ? <Alert color="red" mb="sm">{submitError}</Alert> : null}
          {validationWarnings.length > 0 ? (
            <Alert color="yellow" mb="sm">
              <Stack gap={4}>
                {validationWarnings.map((w, i) => (
                  <Text key={i} size="sm" c={w.code === "ARITHMETIC_IMBALANCE" ? "red" : "yellow"}>
                    {w.message}
                  </Text>
                ))}
              </Stack>
            </Alert>
          ) : null}
          <Group gap="md" align="center">
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? "Saving…" : "Save payslip"}
            </Button>
            <Button component={Link} to="/payslips" variant="default">Cancel</Button>
          </Group>
        </Paper>
      </Stack>
    </Stack>
  );
}
