import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { AddPropertyModal } from "../components/AddPropertyModal";
import { GrovePageLoader } from "../components/GroveLoader";

type PropertyUse = "primary" | "rental" | "vacation" | null;

type PropertyRecord = {
  id: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  propertyUse: PropertyUse;
  latestValueUsd: number | null;
  latestValueAsOf: string | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  monthlyRent: number | null;
  propertyNotes: string | null;
  photoUrl: string | null;
  valuationFetchedAt?: string | null;
  valuationDetail?: unknown | null;
  linkedMortgageId: string | null;
  linkedMortgageInstitution: string | null;
  linkedMortgageMask: string | null;
  cadAccountId?: number | null;
  cadLandValueUsd?: number | null;
  cadImprovementValueUsd?: number | null;
};

type EquityPoint = { date: string; avm: number; mortgageBalance: number; equity: number };
type PropertyResponse = { property: PropertyRecord };
type EquityHistoryResponse = { history: EquityPoint[] };

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function typeMeta(propertyUse: PropertyUse): { label: string; color: string } {
  if (propertyUse === "rental") return { label: "Rental", color: "yellow" };
  if (propertyUse === "vacation") return { label: "Vacation", color: "grape" };
  return { label: "Primary Home", color: "green" };
}

function cadInfo(state: string | null, county: string | null): { cadName: string; appealProcess: string } {
  const st = state?.toUpperCase() ?? "";
  const co = county?.toLowerCase() ?? "";
  if (st === "TX") {
    if (co === "denton") return { cadName: "Denton County, TX · DCAD", appealProcess: "ARB (Appraisal Review Board)" };
    if (co === "harris") return { cadName: "Harris County, TX · HCAD", appealProcess: "ARB (Appraisal Review Board)" };
    if (co === "travis") return { cadName: "Travis County, TX · TCAD", appealProcess: "ARB (Appraisal Review Board)" };
    if (co === "collin") return { cadName: "Collin County, TX · CCAD", appealProcess: "ARB (Appraisal Review Board)" };
    const coName = county ? `${county} County, TX` : "TX";
    return { cadName: `${coName} · CAD`, appealProcess: "ARB (Appraisal Review Board)" };
  }
  if (st === "TN") {
    if (co === "shelby") return { cadName: "Shelby County, TN · Shelby Assessor", appealProcess: "Board of Equalization" };
    const coName = county ? `${county} County, TN` : "TN";
    return { cadName: `${coName} Assessor`, appealProcess: "County Assessment Appeal" };
  }
  return { cadName: "—", appealProcess: "—" };
}

function getDetail(d: unknown): Record<string, unknown> | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  return d as Record<string, unknown>;
}

export function PropertyDetailPage() {
  const token = useAuthToken();
  const { propertyId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);
  const [dcadValueHistory, setDcadValueHistory] = useState<{ year: number; assessedValue: number | null }[]>([]);
  const [dcadEstimatedTaxes, setDcadEstimatedTaxes] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<PropertyResponse>(`/household/properties/${encodeURIComponent(propertyId)}`);
      setProperty(res.property);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load property");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  const loadEquityHistory = useCallback(async () => {
    if (!propertyId) return;
    try {
      const res = await apiJson<EquityHistoryResponse>(`/household/properties/${encodeURIComponent(propertyId)}/equity-history`);
      setEquityHistory(res.history ?? []);
    } catch {
      // non-critical
    }
  }, [propertyId]);

  const loadDcadValueHistory = useCallback(async (_pAccountId: number) => {
    if (!propertyId) return;
    try {
      const res = await apiJson<{ history: { year: number; assessedValue: number | null }[] }>(
        `/api/protest/${encodeURIComponent(propertyId)}/dcad/value-history`
      );
      if (Array.isArray(res.history)) setDcadValueHistory(res.history);
    } catch {
      // non-critical — chart falls back to Redfin data
    }
  }, [propertyId]);

  const loadDcadTaxable = useCallback(async () => {
    if (!propertyId) return;
    try {
      const res = await apiJson<{ taxable: { estimatedTaxes: number | null } | null }>(
        `/api/protest/${encodeURIComponent(propertyId)}/dcad/taxable`
      );
      if (res.taxable?.estimatedTaxes != null) setDcadEstimatedTaxes(res.taxable.estimatedTaxes);
    } catch {
      // non-critical
    }
  }, [propertyId]);

  useEffect(() => {
    if (!token) return;
    void load();
    void loadEquityHistory();
  }, [token, load, loadEquityHistory]);

  useEffect(() => {
    if (!token || !property?.cadAccountId) return;
    void loadDcadValueHistory(property.cadAccountId);
    void loadDcadTaxable();
  }, [token, property?.cadAccountId, loadDcadValueHistory, loadDcadTaxable]);

  const refreshValuation = useCallback(async () => {
    if (!propertyId || refreshing) return;
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/household/properties/${encodeURIComponent(propertyId)}/refresh-valuation`, { method: "POST" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Could not refresh valuation");
      }
      setNotice("Valuation refreshed.");
      await load();
      await loadEquityHistory();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not refresh valuation");
    } finally {
      setRefreshing(false);
    }
  }, [propertyId, refreshing, load, loadEquityHistory]);

  const chartData = useMemo(() => {
    const d = getDetail(property?.valuationDetail);
    const history: { year: number; assessedValue: number | null; taxesDue: number | null }[] =
      Array.isArray(d?.taxHistory)
        ? (d!.taxHistory as { year: number; assessedValue: number | null; taxesDue: number | null }[])
        : [];
    const current = d ? getDetail(d.taxCurrent) : null;
    if (current && typeof current.year === "number") {
      if (!history.some((h) => h.year === (current.year as number))) {
        history.unshift({
          year: current.year as number,
          assessedValue: asNumber(current.assessedValue),
          taxesDue: asNumber(current.taxesDue)
        });
      }
    }
    // DCAD is authoritative for assessed values (all years) and estimated taxes (current year).
    const dcadMap = new Map(dcadValueHistory.map((e) => [e.year, e.assessedValue]));
    for (const entry of dcadValueHistory) {
      if (!history.some((h) => h.year === entry.year)) {
        history.push({ year: entry.year, assessedValue: entry.assessedValue, taxesDue: null });
      }
    }
    for (const row of history) {
      const dcadVal = dcadMap.get(row.year);
      if (dcadVal != null) row.assessedValue = dcadVal;
    }
    // Use DCAD taxable estimatedTaxes for the most recent DCAD year (current assessment year)
    if (dcadEstimatedTaxes != null && dcadValueHistory.length > 0) {
      const maxYear = Math.max(...dcadValueHistory.map((e) => e.year));
      const curRow = history.find((h) => h.year === maxYear);
      if (curRow) curRow.taxesDue = dcadEstimatedTaxes;
    }
    return [...history]
      .sort((a, b) => a.year - b.year)
      .slice(-7)
      .map((row, idx, arr) => {
        const prev = idx > 0 ? arr[idx - 1].assessedValue : null;
        const yoy = prev != null && prev > 0 && row.assessedValue != null
          ? ((row.assessedValue / prev) - 1) * 100 : null;
        return {
          year: String(row.year),
          assessedValue: row.assessedValue ?? 0,
          taxesDue: row.taxesDue ?? null,
          yoyLabel: yoy == null ? "" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`
        };
      });
  }, [property?.valuationDetail, dcadValueHistory, dcadEstimatedTaxes]);

  if (!token) return <Navigate to="/" replace />;
  if (!propertyId) return <Navigate to="/real-estate" replace />;
  if (loading) return <GrovePageLoader label="Loading property detail…" />;
  if (!property) return <Alert color="red">Property not found.</Alert>;

  const d = getDetail(property.valuationDetail);
  const subject = d ? getDetail(d.subject) : null;
  const taxCurrentRec = d ? getDetail(d.taxCurrent) : null;

  const beds = asNumber(subject?.beds);
  const baths = asNumber(subject?.baths);
  const sqFt = asNumber(subject?.sqFt);
  const lotSqFt = asNumber(subject?.lotSqFt);
  const yearBuilt = asNumber(subject?.yearBuilt);
  const stories = asNumber(subject?.stories);
  const apn = typeof subject?.apn === "string" ? subject.apn : null;
  const propertyType = typeof subject?.propertyType === "string" ? subject.propertyType : null;
  const county = typeof d?.county === "string" ? d.county : null;
  const estimateRange = d?.estimateRange as { low: number; high: number } | null | undefined;

  const dcadMaxYear = dcadValueHistory.length > 0 ? Math.max(...dcadValueHistory.map(e => e.year)) : null;
  const dcadCurrentAssessed = dcadMaxYear != null
    ? (dcadValueHistory.find(e => e.year === dcadMaxYear)?.assessedValue ?? null)
    : null;
  const cadAssessed = dcadCurrentAssessed ?? asNumber(taxCurrentRec?.assessedValue);
  const taxesDue = dcadEstimatedTaxes ?? asNumber(taxCurrentRec?.taxesDue);
  const taxYear = dcadMaxYear ?? (typeof taxCurrentRec?.year === "number" ? (taxCurrentRec.year as number) : null);
  const avm = property.latestValueUsd;
  const overAmt = avm != null && cadAssessed != null ? cadAssessed - avm : null;
  const isOverAssessed = overAmt != null && overAmt > (avm ?? 0) * 0.03;
  const overPct = isOverAssessed && avm ? (overAmt! / avm) * 100 : null;
  const estimatedSavings =
    overAmt != null && overAmt > 0 && property.state?.toUpperCase() === "TX" ? overAmt * 0.02 : null;
  const gainAmt = avm != null && property.purchasePrice != null ? avm - property.purchasePrice : null;
  const gainPctVal = gainAmt != null && property.purchasePrice ? (gainAmt / property.purchasePrice) * 100 : null;

  const { cadName, appealProcess } = cadInfo(property.state, county);
  const t = typeMeta(property.propertyUse);
  const fullAddress = [property.addressLine1, property.city, property.state, property.zip].filter(Boolean).join(", ");
  const hasMortgage = equityHistory.some((p) => p.mortgageBalance > 0);

  const linkedMortgageLabel = property.linkedMortgageId != null
    ? property.linkedMortgageMask
      ? `${property.linkedMortgageInstitution} ····${property.linkedMortgageMask}`
      : (property.linkedMortgageInstitution ?? "Mortgage")
    : null;
  const latestMortgageBalance = equityHistory.length > 0 && equityHistory[equityHistory.length - 1].mortgageBalance > 0
    ? equityHistory[equityHistory.length - 1].mortgageBalance
    : null;

  const detailRows: [string, string][] = [
    ["Property Type", propertyType ?? t.label],
    ["Address", fullAddress || "—"],
    ["Beds / Baths", beds != null && baths != null ? `${beds} bed · ${baths} bath` : "—"],
    ["Above-Grade Sqft", sqFt != null ? `${sqFt.toLocaleString()} sqft` : "—"],
    ["Lot Size", lotSqFt != null ? `${lotSqFt.toLocaleString()} sqft` : "—"],
    ["Year Built", yearBuilt != null ? String(yearBuilt) : "—"],
    ["Stories", stories != null ? String(stories) : "—"],
    ["APN", apn ?? "—"],
    ["County / CAD", cadName],
    ["Appeal Process", appealProcess],
    ...(linkedMortgageLabel ? [["Linked Mortgage", linkedMortgageLabel] as [string, string]] : []),
    ...(latestMortgageBalance != null ? [["Mortgage Balance", money(latestMortgageBalance)] as [string, string]] : []),
    ...(property.propertyUse === "rental" && property.monthlyRent != null
      ? [["Monthly Rent", `${money(property.monthlyRent)}/mo · ${money(property.monthlyRent * 12)}/yr`] as [string, string]]
      : []),
    ...(property.propertyNotes ? [["Notes", property.propertyNotes] as [string, string]] : []),
  ];

  return (
    <Stack gap="md">
      <Group>
        <Button component={Link} to="/real-estate" variant="subtle">← Back to Real Estate</Button>
        <Badge color={t.color} variant="light" ml="auto">{t.label}</Badge>
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}
      {notice ? <Alert color="green">{notice}</Alert> : null}

      <Grid>
        {/* LEFT COLUMN */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="md">
            {/* Property image */}
            {property.photoUrl ? (
              <img
                src={property.photoUrl}
                alt={property.addressLine1 ?? "Property"}
                style={{
                  width: "100%",
                  height: 200,
                  objectFit: "cover",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)"
                }}
              />
            ) : (
              <Box
                h={200}
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-surface-alt)",
                  backgroundImage: "repeating-linear-gradient(135deg, rgba(45,106,79,0.12), rgba(45,106,79,0.12) 8px, rgba(0,0,0,0) 8px, rgba(0,0,0,0) 16px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text c="dimmed" size="sm">No photo — click Refresh to fetch</Text>
              </Box>
            )}

            {/* Property Details */}
            <Card withBorder radius="md" p="md">
              <Group justify="space-between" mb={4}>
                <Text size="xs" tt="uppercase" fw={600} lts="0.06em" c="dimmed">Property Details</Text>
                <Button variant="subtle" size="xs" onClick={() => setEditModalOpen(true)}>Edit</Button>
              </Group>
              <Divider mb={4} />
              <Stack gap={0}>
                {detailRows.map(([label, value], idx) => (
                  <Box
                    key={label}
                    py={8}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "148px 1fr",
                      gap: 8,
                      borderTop: idx === 0 ? undefined : "1px solid var(--mantine-color-default-border)",
                    }}
                  >
                    <Text size="sm" c="dimmed">{label}</Text>
                    <Text size="sm" fw={500} style={{ wordBreak: "break-word" }}>{value}</Text>
                  </Box>
                ))}
              </Stack>
            </Card>

          </Stack>
        </Grid.Col>

        {/* RIGHT COLUMN */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="md">
            {/* Valuation */}
            <Card withBorder radius="md" p="md">
              <Text size="xs" tt="uppercase" fw={600} lts="0.06em" c="dimmed" mb="sm">Valuation</Text>
              <Stack gap={0}>
                <Box py={10}>
                  <Text size="xs" c="dimmed">Purchased</Text>
                  <Text fw={700}>{money(property.purchasePrice)}</Text>
                  {property.purchaseDate ? <Text size="xs" c="dimmed">{property.purchaseDate}</Text> : null}
                </Box>
                <Divider />
                <Box py={10}>
                  <Text size="xs" c="dimmed">
                    {avm != null
                      ? `Current AVM${property.latestValueAsOf ? ` (${property.latestValueAsOf})` : ""}`
                      : "Purchase Price (no AVM yet)"}
                  </Text>
                  <Text fw={700}>{money(avm ?? property.purchasePrice)}</Text>
                  {avm != null && estimateRange ? (
                    <Text size="xs" c="dimmed">Range {money(estimateRange.low)}–{money(estimateRange.high)}</Text>
                  ) : null}
                </Box>
                <Divider />
                <Box py={10}>
                  <Text size="xs" c="dimmed">CAD Assessed{taxYear ? ` ${taxYear}` : ""}</Text>
                  <Text fw={700} c={isOverAssessed ? "orange" : undefined}>{money(cadAssessed)}</Text>
                  {taxesDue != null ? <Text size="xs" c="dimmed">Taxes: {money(taxesDue)}</Text> : null}
                  {(property.cadLandValueUsd != null || property.cadImprovementValueUsd != null) && (
                    <Text size="xs" c="dimmed" mt={2}>
                      Land {money(property.cadLandValueUsd)} · Impr {money(property.cadImprovementValueUsd)}
                    </Text>
                  )}
                </Box>
                <Divider />
                <Box py={10}>
                  <Text size="xs" c="dimmed">Gain since purchase</Text>
                  <Text fw={700} c={gainAmt != null && gainAmt >= 0 ? "green" : "red"}>
                    {gainAmt != null && gainPctVal != null
                      ? `${money(gainAmt)} (${gainPctVal >= 0 ? "+" : ""}${gainPctVal.toFixed(1)}%)`
                      : "—"}
                  </Text>
                </Box>
              </Stack>
            </Card>

            {/* Protest Readiness */}
            <Card withBorder radius="md" p="md">
              <Text size="xs" tt="uppercase" fw={600} lts="0.06em" c="dimmed" mb="sm">Protest Readiness</Text>
              {isOverAssessed && overPct != null ? (
                <Stack gap="xs">
                  <Badge color="orange" variant="light" size="sm">Consider Protesting</Badge>
                  <Text size="sm">
                    CAD overassessed by <strong>{money(overAmt)}</strong> ({overPct.toFixed(1)}%) above AVM.
                  </Text>
                  {estimatedSavings != null ? (
                    <Text size="sm">Est. savings: <strong>{money(estimatedSavings)}/yr</strong></Text>
                  ) : null}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">CAD assessed value is within 3% of AVM. No protest signal.</Text>
              )}
              <Button
                component={Link}
                to={`/tax-protest?property=${encodeURIComponent(property.id)}`}
                color="orange"
                fullWidth
                mt="md"
              >
                Prepare Tax Protest
              </Button>
            </Card>

            {/* Data Sources — compact */}
            <Card withBorder radius="md" p="sm">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">AVM · RealtyAPI.io / Redfin</Text>
                  {county ? <Text size="xs" c="dimmed">{cadName}</Text> : null}
                  <Text size="xs" c="dimmed">Refreshed: {property.valuationFetchedAt ?? "—"}</Text>
                </Stack>
                <Button
                  variant="subtle"
                  size="xs"
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => void refreshValuation()}
                  loading={refreshing}
                >
                  Refresh
                </Button>
              </Group>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="md" h="100%">
            <Text size="xs" tt="uppercase" fw={600} lts="0.06em" c="dimmed" mb="sm">Value · Mortgage · Equity</Text>
            {equityHistory.length >= 1 ? (
              <Box h={240}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityHistory} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(0, 7)} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} width={48} />
                    <Tooltip formatter={(v: number | string, name: string) => [money(Number(v)), name]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="avm" stroke="var(--mantine-color-green-7)" strokeWidth={2} dot={{ r: 4 }} name="AVM" />
                    {hasMortgage ? (
                      <Line type="monotone" dataKey="mortgageBalance" stroke="var(--mantine-color-red-5)" strokeWidth={2} dot={{ r: 4 }} name="Mortgage" />
                    ) : null}
                    <Line type="monotone" dataKey="equity" stroke="var(--mantine-color-blue-5)" strokeWidth={2} dot={{ r: 4 }} name="Equity" />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            ) : (
              <Text c="dimmed" size="sm">Refresh valuation to start tracking equity over time.</Text>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="md" h="100%">
            <Text size="xs" tt="uppercase" fw={600} lts="0.06em" c="dimmed" mb="sm">Assessment History</Text>
            {chartData.length === 0 ? (
              <Text c="dimmed" size="sm">No assessment history available.</Text>
            ) : (
              <Box h={240}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 20, right: 44, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                    <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} width={48} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} width={44} />
                    <Tooltip
                      formatter={(v: number | string, name: string) => [
                        money(Number(v)),
                        name === "assessedValue" ? "CAD Assessed" : "Taxes Due"
                      ]}
                    />
                    <Bar dataKey="assessedValue" yAxisId="left" fill="var(--color-warm)" name="assessedValue">
                      <LabelList dataKey="yoyLabel" position="top" style={{ fill: "var(--color-text-muted)", fontSize: 10 }} />
                    </Bar>
                    <Line
                      dataKey="taxesDue"
                      yAxisId="right"
                      stroke="var(--mantine-color-blue-5)"
                      strokeWidth={2}
                      dot={{ r: 4, fill: "var(--mantine-color-blue-5)" }}
                      name="taxesDue"
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <AddPropertyModal
        opened={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSaved={() => { void load(); void loadEquityHistory(); }}
        existingPropertyId={property.id}
      />
    </Stack>
  );
}
