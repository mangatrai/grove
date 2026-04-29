import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
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
    <Stack className="payslips-page">
      {/* Page header */}
      <Paper withBorder p="lg">
        <Group align="center" gap={8} wrap="wrap">
          <Title order={2} m={0}>Payslips</Title>
          <HelpIcon label="Add payslip PDFs via New Import, or add a manual stub with no PDF. Manage employers in Settings → Profile." />
          <Group ml="auto" gap={8}>
            <Button component={Link} to="/imports" variant="default" leftSection={<IconFilePlus size={14} />}>
              Import PDF
            </Button>
            <Button component={Link} to="/payslips/new" leftSection={<IconPlus size={14} />}>
              Add manually
            </Button>
          </Group>
        </Group>
      </Paper>

      {/* Hero KPI cards — latest payslip stats */}
      {latest ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {([
            { label: "Latest gross", value: formatMoney(latest.grossPayCurrent), accent: "var(--color-accent)" },
            { label: "Latest net",   value: formatMoney(latest.netPayCurrent),   accent: "var(--color-success, #16a34a)" },
            { label: "YTD gross",    value: formatMoney(latest.grossPayYtd),     accent: "var(--color-text-muted)" },
            { label: "YTD net",      value: formatMoney(latest.netPayYtd),       accent: "var(--color-text-muted)" },
          ] as const).map(({ label, value, accent }) => (
            <Paper key={label} withBorder p="md" style={{ textAlign: "center", borderTop: `3px solid ${accent}` }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>{label}</Text>
              <Text size="xl" fw={700} style={{ color: accent }}>{value}</Text>
            </Paper>
          ))}
        </SimpleGrid>
      ) : null}

      {/* Belongs-to filter */}
      <Paper withBorder p="lg">
        <Group align="center" gap={8}>
          <Text size="sm" fw={500}>Belongs-to</Text>
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
        </Group>
      </Paper>

      {/* Income charts */}
      {!loading && data && data.items.length > 0 ? (
        <Paper withBorder p="lg">
          <Group align="center" gap={8} mb="md">
            <Title order={4} m={0}>Income &amp; payroll</Title>
            <HelpIcon label="Charts derived from all payslips matching the current filter. Area chart shows gross vs net over time. Bar chart shows monthly breakdown." />
          </Group>
          <PayslipIncomeCharts items={data.items} />
        </Paper>
      ) : null}

      {/* Payslip list */}
      <Paper withBorder p="lg">
        <Group align="center" gap={8} mb="md">
          <Title order={4} m={0}>Saved stubs</Title>
          {data ? <Badge variant="light">{data.total} total</Badge> : null}
        </Group>
        {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}
        {loading ? <Text c="dimmed">Loading…</Text> : null}
        {!loading && data && data.items.length === 0 ? (
          <Text c="dimmed">No payslips yet. Use "Import PDF" or "Add manually" above.</Text>
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
                  <ActionIcon
                    component={Link}
                    to={`/payslips/${r.id}`}
                    title="View payslip"
                    variant="default"
                  >
                    <IconEye size={14} />
                  </ActionIcon>
                  <ActionIcon
                    title="Delete payslip"
                    disabled={deletingId === r.id}
                    onClick={() => setDeleteConfirmId(r.id)}
                    variant="default"
                    color="red"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Paper>

      <ConfirmDialog
        opened={deleteConfirmId !== null}
        title="Delete payslip"
        message="Delete this payslip permanently? This cannot be undone."
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deletePayslip(deleteConfirmId!)}
      />
    </Stack>
  );
}
