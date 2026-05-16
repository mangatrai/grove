import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { GroveLoader } from "../components/GroveLoader";
import { IconEye, IconFilePlus, IconPlus, IconTrash } from "@tabler/icons-react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { PayslipIncomeCharts } from "../payslip/PayslipIncomeCharts";
import type { PayslipSnapshotDetail } from "../payslip/types";
import { formatUsd } from "../utils/format";

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
  return `$${formatUsd(n)}`;
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
    <Stack>
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
            { label: "Latest gross", value: formatMoney(latest.grossPayCurrent), borderColor: "var(--fs-forest)", c: "fsForest" as const },
            { label: "Latest net",   value: formatMoney(latest.netPayCurrent),   borderColor: "var(--fs-gold)", c: "fsGold" as const },
            { label: "YTD gross",    value: formatMoney(latest.grossPayYtd),     borderColor: "var(--mantine-color-gray-4)", c: "dimmed" as const },
            { label: "YTD net",      value: formatMoney(latest.netPayYtd),       borderColor: "var(--mantine-color-gray-4)", c: "dimmed" as const },
          ] as const).map(({ label, value, borderColor, c }) => (
            <Paper key={label} withBorder p="md" ta="center" style={{ borderTop: `3px solid ${borderColor}` }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>{label}</Text>
              <Text size="xl" fw={700} c={c}>{value}</Text>
            </Paper>
          ))}
        </SimpleGrid>
      ) : null}

      {/* Belongs-to filter */}
      <Paper withBorder p="lg">
        <Group align="center" gap={8}>
          <Text size="sm" fw={500}>Belongs-to</Text>
          <HelpIcon label="Household: shared payslips only. Member: that person’s payslips. Clear to include everyone." />
          <Box style={{ flex: 1, maxWidth: 260 }}>
            <HierarchicalSearchPicker
              value={ownerFilter}
              onChange={(v) => setOwnerFilter(v)}
              groups={belongsToGroups}
              placeholder="All household activity"
              ariaLabel="Filter payslips by belongs-to"
              clearable
            />
          </Box>
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
        {loading ? (
          <Group gap="sm" py="sm">
            <GroveLoader size="sm" color="muted" />
            <Text size="sm" c="dimmed">Loading payslips…</Text>
          </Group>
        ) : null}
        {!loading && data && data.items.length === 0 ? (
          <Text c="dimmed">No payslips yet. Use "Import PDF" or "Add manually" above.</Text>
        ) : null}
        {!loading && data && data.items.length > 0 ? (
          <Stack gap={6}>
            {data.items.map((r) => (
              <Paper key={r.id} withBorder p="xs" radius="sm">
                <Group gap="md" wrap="nowrap" align="center">
                  {/* Period */}
                  <Text size="sm" fw={600} style={{ minWidth: 90 }}>
                    {r.payPeriodStart ?? "—"}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                    {r.payPeriodEnd ? `→ ${r.payPeriodEnd}` : ""}
                    {r.payDate ? ` · paid ${r.payDate}` : null}
                  </Text>
                  {/* Gross / Net */}
                  <Group gap="xl">
                    <Box>
                      <Text size="xs" c="dimmed" lh={1.2}>Gross</Text>
                      <Text size="sm" fw={600}>{formatMoney(r.grossPayCurrent)}</Text>
                    </Box>
                    <Box>
                      <Text size="xs" c="dimmed" lh={1.2}>Net</Text>
                      <Text size="sm" fw={600} style={{ color: "var(--fs-forest)" }}>{formatMoney(r.netPayCurrent)}</Text>
                    </Box>
                  </Group>
                  {/* Actions */}
                  <Group gap={6} wrap="nowrap">
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
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
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
