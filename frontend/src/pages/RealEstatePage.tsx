import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconRefresh, IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { GrovePageLoader } from "../components/GroveLoader";
import { AddPropertyModal } from "../components/AddPropertyModal";

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
  valuationDetail?: unknown | null;
};

type PropertiesResponse = { properties: PropertyRecord[] };
type PropertyResponse = { property: PropertyRecord };

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function addressLabel(p: PropertyRecord): string {
  const a = p.addressLine1?.trim();
  return a && a.length > 0 ? a : "123 Example St";
}

function cityStateLabel(p: PropertyRecord): string {
  const c = p.city?.trim() || "Example City";
  const s = p.state?.trim() || "TX";
  return `${c}, ${s}`;
}

function typeMeta(propertyUse: PropertyUse): { label: string; color: string } {
  if (propertyUse === "rental") return { label: "Rental", color: "yellow" };
  if (propertyUse === "vacation") return { label: "Vacation", color: "grape" };
  return { label: "Primary", color: "green" };
}

function getValuationSubject(detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object") return null;
  const value = (detail as Record<string, unknown>).subject;
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function getAssessment(detail: unknown): number | null {
  if (!detail || typeof detail !== "object") return null;
  const taxCurrent = (detail as Record<string, unknown>).taxCurrent;
  if (!taxCurrent || typeof taxCurrent !== "object") return null;
  return asNumber((taxCurrent as Record<string, unknown>).assessedValue);
}

function getLatestTaxesPaid(detail: unknown): number | null {
  if (!detail || typeof detail !== "object") return null;
  const taxCurrent = (detail as Record<string, unknown>).taxCurrent;
  if (taxCurrent && typeof taxCurrent === "object") {
    const due = asNumber((taxCurrent as Record<string, unknown>).taxesDue);
    if (due != null) return due;
  }
  const taxHistory = (detail as Record<string, unknown>).taxHistory;
  if (!Array.isArray(taxHistory) || taxHistory.length === 0) return null;
  const first = taxHistory[0];
  if (!first || typeof first !== "object") return null;
  return asNumber((first as Record<string, unknown>).taxesDue);
}


function gainPct(current: number | null, purchase: number | null): number | null {
  if (!current || !purchase || purchase <= 0) return null;
  return ((current / purchase) - 1) * 100;
}

export function RealEstatePage() {
  const token = useAuthToken();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const loadProperties = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiJson<PropertiesResponse>("/household/properties");
      const detailed = await Promise.all(
        (list.properties ?? []).map(async (p) => {
          try {
            const detail = await apiJson<PropertyResponse>(`/household/properties/${encodeURIComponent(p.id)}`);
            return detail.property;
          } catch {
            return p;
          }
        })
      );
      setProperties(detailed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load properties");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadProperties();
  }, [token, loadProperties]);

  const kpis = useMemo(() => {
    let avm = 0;
    let assessed = 0;
    let taxes = 0;
    let rentAnnual = 0;
    let hasAssessed = false;
    let hasTaxes = false;
    for (const p of properties) {
      if (p.latestValueUsd != null) avm += p.latestValueUsd;
      const assessedValue = getAssessment(p.valuationDetail);
      if (assessedValue != null) {
        assessed += assessedValue;
        hasAssessed = true;
      }
      const taxesPaid = getLatestTaxesPaid(p.valuationDetail);
      if (taxesPaid != null) {
        taxes += taxesPaid;
        hasTaxes = true;
      }
      if (p.propertyUse === "rental" && p.monthlyRent != null) {
        rentAnnual += p.monthlyRent * 12;
      }
    }
    return {
      avm,
      assessed: hasAssessed ? assessed : null,
      taxes: hasTaxes ? taxes : null,
      rentAnnual,
    };
  }, [properties]);

  const refreshAll = useCallback(async () => {
    if (properties.length === 0) return;
    setRefreshingAll(true);
    setNotice(null);
    let refreshed = 0;
    let failed = 0;
    for (const p of properties) {
      try {
        const res = await apiFetch(`/household/properties/${encodeURIComponent(p.id)}/refresh-valuation`, { method: "POST" });
        if (res.ok) refreshed++;
        else failed++;
      } catch {
        failed++;
      }
    }
    if (failed === 0) {
      setNotice(`Refreshed ${refreshed} ${refreshed === 1 ? "property" : "properties"}.`);
      void loadProperties();
    } else {
      setNotice(`Refreshed ${refreshed}, failed ${failed}. Check RealtyAPI quota.`);
    }
    setRefreshingAll(false);
  }, [properties, loadProperties]);

  if (!token) return <Navigate to="/" replace />;

  if (loading) {
    return <GrovePageLoader label="Loading real estate portfolio…" />;
  }

  return (
    <Stack gap="md">
      <Paper withBorder shadow="sm" radius="md" p="md">
        <Group justify="space-between" align="center">
          <Title order={2} style={{ fontSize: 22, fontWeight: 700 }}>
            Real Estate Portfolio
          </Title>
          <Group>
            <Button
              leftSection={<IconRefresh size={16} />}
              variant="default"
              onClick={() => void refreshAll()}
              loading={refreshingAll}
            >
              Refresh All
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              variant="filled"
              color="green"
              onClick={() => setAddModalOpen(true)}
            >
              Add Property
            </Button>
          </Group>
        </Group>
      </Paper>

      {error ? <Alert color="red">{error}</Alert> : null}
      {notice ? <Alert color="green">{notice}</Alert> : null}

      <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="md">
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em">Portfolio AVM</Text>
          <Text size="xl" fw={700}>{money(kpis.avm)}</Text>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em">CAD Assessed</Text>
          <Text size="xl" fw={700}>{money(kpis.assessed)}</Text>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em">Annual Property Tax</Text>
          <Text size="xl" fw={700}>{money(kpis.taxes)}</Text>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em">Annual Rental Income</Text>
          <Text size="xl" fw={700}>{money(kpis.rentAnnual)}</Text>
        </Paper>
      </SimpleGrid>

      {properties.length === 0 && !loading ? (
        <Paper withBorder radius="md" p="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed" size="sm">No properties in your portfolio yet.</Text>
            <Text c="dimmed" size="xs">Add your first property to track valuation, assessment, and protest readiness.</Text>
          </Stack>
        </Paper>
      ) : null}

      <AddPropertyModal
        opened={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSaved={() => void loadProperties()}
      />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {properties.map((p) => {
          const t = typeMeta(p.propertyUse);
          const subject = getValuationSubject(p.valuationDetail);
          const beds = asNumber(subject?.beds);
          const baths = asNumber(subject?.baths);
          const sqft = asNumber(subject?.sqFt);
          const yearBuilt = asNumber(subject?.yearBuilt);
          const avm = p.latestValueUsd;
          const assessed = getAssessment(p.valuationDetail);
          const overPct = avm && assessed && assessed > avm * 1.03 ? ((assessed / avm) - 1) * 100 : null;
          const g = gainPct(p.latestValueUsd, p.purchasePrice);
          return (
            <Card withBorder radius="md" key={p.id} padding={0} style={{ overflow: "hidden" }}>
              {p.photoUrl ? (
                <img
                  src={p.photoUrl}
                  alt={addressLabel(p)}
                  style={{ width: "100%", height: 120, objectFit: "cover" }}
                />
              ) : (
                <Box
                  style={{
                    width: "100%",
                    height: 120,
                    background: "repeating-linear-gradient(45deg, #f0f0f0, #f0f0f0 10px, #e0e0e0 10px, #e0e0e0 20px)",
                  }}
                />
              )}
              <Stack gap={8} p="md">
                <Group justify="space-between" align="start">
                  <div>
                    <Text fw={700}>{addressLabel(p)}</Text>
                    <Text size="sm" c="dimmed">{cityStateLabel(p)}</Text>
                  </div>
                  <Badge color={t.color} variant="light">{t.label}</Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  {beds != null ? `${beds} bd` : "—"} · {baths != null ? `${baths} ba` : "—"} · {sqft != null ? `${sqft.toLocaleString()} sqft` : "—"} · {yearBuilt != null ? `Built ${yearBuilt}` : "Built —"}
                </Text>
                {p.propertyUse === "rental" && p.monthlyRent != null ? (
                  <Text size="sm">Monthly rent: <strong>{money(p.monthlyRent)}</strong></Text>
                ) : null}
                {g != null ? (
                  <Text size="sm" c={g >= 0 ? "green" : "red"}>
                    {g >= 0 ? "↑" : "↓"} {Math.abs(g).toFixed(1)}% since purchase
                  </Text>
                ) : null}
                {overPct != null ? (
                  <Badge color="orange" variant="light">Overassessed ~{overPct.toFixed(1)}%</Badge>
                ) : null}
                <Stack gap={6} mt="md">
                  <Button component={Link} to={`/real-estate/${p.id}`} variant="default" fullWidth>
                    View Details
                  </Button>
                  <Button component={Link} to={`/tax-protest?property=${encodeURIComponent(p.id)}`} color="orange" fullWidth>
                    Tax Protest
                  </Button>
                </Stack>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
