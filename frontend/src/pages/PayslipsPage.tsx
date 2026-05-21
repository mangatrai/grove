import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Alert, Button, Collapse, Group, Stack, Text, Title } from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconFilePlus, IconPlus } from "@tabler/icons-react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GroveLoader } from "../components/GroveLoader";
import { PayslipIncomeCharts } from "../payslip/PayslipIncomeCharts";
import { PayslipListCard } from "../payslip/PayslipListCard";
import { SparklineMini } from "../payslip/SparklineMini";
import type { PayslipSnapshotDetail } from "../payslip/types";
import { formatUsd } from "../utils/format";

// ─── Types ──────────────────────────────────────────────────────────────────

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: PayslipSnapshotDetail[];
};

type OwnerProfileOption = { id: string; label: string };
type HouseholdMemberResponse = { id: string; fullName?: string; firstName?: string; lastName?: string };
type HouseholdMembersPayload = { members: HouseholdMemberResponse[] };
type HouseholdProfileResponse = { profile: { id: string; fullName?: string; firstName?: string; lastName?: string } };

type PersonInfo = { id: string; name: string; initials: string; color: string };

// ─── Constants ──────────────────────────────────────────────────────────────

const PERSON_COLORS = ["#2d6a4f", "#c8860a", "#7a8a6e", "#8b3a26", "#4a8a6e", "#7c3aed"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return "?";
}

function monthOf(ps: PayslipSnapshotDetail): string {
  const d = ps.payDate ?? ps.payPeriodEnd;
  if (!d) return "Unknown";
  const parsed = new Date(`${d}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return d.slice(0, 7);
  return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${formatUsd(n)}`;
}

type MonthGroup = { key: string; items: PayslipSnapshotDetail[] };

function groupByMonth(items: PayslipSnapshotDetail[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  const seen = new Map<string, MonthGroup>();
  for (const item of items) {
    const key = monthOf(item);
    if (!seen.has(key)) {
      const g: MonthGroup = { key, items: [] };
      groups.push(g);
      seen.set(key, g);
    }
    seen.get(key)!.items.push(item);
  }
  return groups;
}

function getPersonNetSeries(items: PayslipSnapshotDetail[], personId: string): number[] {
  return items
    .filter((p) => p.ownerPersonProfileId === personId)
    .sort((a, b) => {
      const da = a.payDate ?? a.payPeriodEnd ?? a.createdAt;
      const db = b.payDate ?? b.payPeriodEnd ?? b.createdAt;
      return da < db ? -1 : 1;
    })
    .slice(-10)
    .map((p) => p.netPayCurrent ?? 0);
}

function getPersonYtdNet(items: PayslipSnapshotDetail[], personId: string): number | null {
  // latest payslip for person, use its netPayYtd
  const latest = items
    .filter((p) => p.ownerPersonProfileId === personId)
    .sort((a, b) => {
      const da = a.payDate ?? a.payPeriodEnd ?? a.createdAt;
      const db = b.payDate ?? b.payPeriodEnd ?? b.createdAt;
      return da > db ? -1 : 1;
    })[0];
  return latest?.netPayYtd ?? null;
}

// ─── TrendCard ───────────────────────────────────────────────────────────────

const mono: CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

function TrendCard({
  person,
  netSeries,
  ytdNet,
}: {
  person: PersonInfo;
  netSeries: number[];
  ytdNet: number | null;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        padding: "12px 14px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 9,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: person.color,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
            fontFamily: "'Inter Tight', 'Inter', sans-serif",
          }}
          aria-hidden
        >
          {person.initials}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>{person.name}</span>
      </div>
      <SparklineMini data={netSeries} width={120} height={30} color={person.color} />
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted)",
            marginBottom: 2,
          }}
        >
          Net YTD
        </div>
        <div style={{ ...mono, fontSize: 15, fontWeight: 600, color: person.color }}>
          {formatMoney(ytdNet)}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function PayslipsPage() {
  const token = useAuthToken();
  const navigate = useNavigate();
  const [data, setData] = useState<ListResponse | null>(null);
  const [ownerProfiles, setOwnerProfiles] = useState<OwnerProfileOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [_deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null); // null = all
  const [chartsOpen, setChartsOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await apiJson<ListResponse>("/payslips?limit=200&offset=0");
    setData(res);
  }, []);

  const loadOwners = useCallback(async () => {
    if (!token) return;
    const [membersRes, profileRes] = await Promise.all([
      apiJson<HouseholdMembersPayload>("/household/members").catch(
        () => ({ members: [] as HouseholdMemberResponse[] }) as HouseholdMembersPayload
      ),
      apiJson<HouseholdProfileResponse>("/household/profile").catch(
        () => ({ profile: { id: "", fullName: "Household" } }) as HouseholdProfileResponse
      ),
    ]);
    const members = membersRes.members ?? [];
    const profile = profileRes.profile;
    const mapped: OwnerProfileOption[] = members.map((m) => ({
      id: m.id,
      label:
        [m.fullName, [m.firstName, m.lastName].filter(Boolean).join(" ").trim()].find(
          (x) => x && x.trim()
        ) || m.id,
    }));
    if (profile?.id && !mapped.some((m) => m.id === profile.id)) {
      mapped.unshift({
        id: profile.id,
        label:
          [profile.fullName, [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim()].find(
            (x) => x && x.trim()
          ) || "Me",
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
            if (j.message) msg = j.message;
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

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    void Promise.all([load(), loadOwners()])
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load payslips");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, load, loadOwners]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const personMap = useMemo((): Map<string, PersonInfo> => {
    const map = new Map<string, PersonInfo>();
    ownerProfiles.forEach((p, idx) => {
      map.set(p.id, {
        id: p.id,
        name: p.label,
        initials: getInitials(p.label),
        color: PERSON_COLORS[idx % PERSON_COLORS.length]!,
      });
    });
    return map;
  }, [ownerProfiles]);

  const allItems = data?.items ?? [];

  const filteredItems = useMemo(
    () =>
      selectedPerson
        ? allItems.filter((ps) => ps.ownerPersonProfileId === selectedPerson)
        : allItems,
    [allItems, selectedPerson]
  );

  const householdGrossYtd = useMemo(() => {
    const latestByPerson = new Map<string, number>();
    for (const item of allItems) {
      const pid = item.ownerPersonProfileId ?? "__household__";
      if (!latestByPerson.has(pid) && item.grossPayYtd != null) {
        latestByPerson.set(pid, item.grossPayYtd);
      }
    }
    return Array.from(latestByPerson.values()).reduce((s, v) => s + v, 0);
  }, [allItems]);

  const personIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const item of allItems) {
      if (item.ownerPersonProfileId && !seen.has(item.ownerPersonProfileId)) {
        seen.add(item.ownerPersonProfileId);
        ids.push(item.ownerPersonProfileId);
      }
    }
    return ids;
  }, [allItems]);

  const monthGroups = useMemo(() => groupByMonth(filteredItems), [filteredItems]);

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (!token) return <Navigate to="/" replace />;

  // ── Styles ────────────────────────────────────────────────────────────────

  const pillBase: CSSProperties = {
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text-secondary)",
    transition: "background 0.12s, border-color 0.12s",
    minHeight: 30,
  };

  const pillActive: CSSProperties = {
    ...pillBase,
    background: "var(--color-accent-subtle)",
    borderColor: "var(--fs-forest)",
    color: "var(--fs-forest)",
    fontWeight: 600,
  };

  return (
    <Stack gap={12}>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div>
          <Title order={1} style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", marginBottom: 2 }}>
            Payslips
          </Title>
          {!loading && data ? (
            <Text size="sm" c="dimmed">
              {data.total} payslip{data.total !== 1 ? "s" : ""}
              {householdGrossYtd > 0 ? ` · ${formatMoney(householdGrossYtd)} gross YTD` : ""}
            </Text>
          ) : null}
        </div>
        <Group gap={8} ml="auto" wrap="nowrap">
          <Button
            component={Link}
            to="/imports"
            variant="default"
            size="sm"
            leftSection={<IconFilePlus size={14} />}
          >
            Import PDF
          </Button>
          <Button
            component={Link}
            to="/payslips/new"
            size="sm"
            leftSection={<IconPlus size={14} />}
          >
            + Add Payslip
          </Button>
        </Group>
      </div>

      {loadError ? <Alert color="red">{loadError}</Alert> : null}

      {loading ? (
        <Group gap="sm" py="md">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading payslips…</Text>
        </Group>
      ) : null}

      {!loading && data ? (
        <>
          {/* ── Person filter pills ──────────────────────────────────────── */}
          {personIds.length > 1 ? (
            <Group gap={6} wrap="wrap">
              <button
                type="button"
                style={selectedPerson === null ? pillActive : pillBase}
                onClick={() => setSelectedPerson(null)}
              >
                All people
              </button>
              {personIds.map((pid) => {
                const info = personMap.get(pid);
                if (!info) return null;
                return (
                  <button
                    key={pid}
                    type="button"
                    style={selectedPerson === pid ? pillActive : pillBase}
                    onClick={() => setSelectedPerson(pid === selectedPerson ? null : pid)}
                  >
                    {info.name}
                  </button>
                );
              })}
            </Group>
          ) : null}

          {/* ── Trend row ────────────────────────────────────────────────── */}
          {personIds.length > 0 ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {(selectedPerson ? [selectedPerson] : personIds).map((pid) => {
                const info = personMap.get(pid);
                if (!info) return null;
                const netSeries = getPersonNetSeries(allItems, pid);
                const ytdNet = getPersonYtdNet(allItems, pid);
                return (
                  <TrendCard
                    key={pid}
                    person={info}
                    netSeries={netSeries}
                    ytdNet={ytdNet}
                  />
                );
              })}
            </div>
          ) : null}

          {/* ── Month-grouped list ───────────────────────────────────────── */}
          {filteredItems.length === 0 ? (
            <Text c="dimmed" py="sm">
              No payslips yet.{" "}
              <Text component={Link} to="/imports" c="var(--fs-forest)">
                Import a PDF
              </Text>{" "}
              or{" "}
              <Text component={Link} to="/payslips/new" c="var(--fs-forest)">
                add manually
              </Text>
              .
            </Text>
          ) : null}

          {monthGroups.map((group) => (
            <div key={group.key}>
              {/* Month divider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "var(--color-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {group.key}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    background: "var(--color-surface-alt)",
                    borderRadius: 10,
                    padding: "0 6px",
                  }}
                >
                  {group.items.length}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--color-border)",
                  }}
                />
              </div>

              {group.items.map((ps) => {
                const personInfo = ps.ownerPersonProfileId
                  ? (personMap.get(ps.ownerPersonProfileId) ?? {
                      id: ps.ownerPersonProfileId,
                      name: "Unknown",
                      initials: "?",
                      color: PERSON_COLORS[0]!,
                    })
                  : {
                      id: "household",
                      name: "Household",
                      initials: "HH",
                      color: PERSON_COLORS[0]!,
                    };

                return (
                  <PayslipListCard
                    key={ps.id}
                    payslip={ps}
                    personName={personInfo.name}
                    personInitials={personInfo.initials}
                    personColor={personInfo.color}
                    employerName={null}
                    onClick={() => navigate(`/payslips/${ps.id}`)}
                  />
                );
              })}
            </div>
          ))}

          {/* ── Income analytics (collapsible) ───────────────────────────── */}
          {filteredItems.length > 0 ? (
            <div
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 9,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setChartsOpen((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "11px 16px",
                  width: "100%",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text)",
                  fontSize: 13.5,
                  fontWeight: 600,
                  minHeight: 44,
                }}
              >
                {chartsOpen ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
                Income analytics
              </button>
              <Collapse in={chartsOpen}>
                <div style={{ padding: "0 16px 16px" }}>
                  <PayslipIncomeCharts items={filteredItems} />
                </div>
              </Collapse>
            </div>
          ) : null}
        </>
      ) : null}

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
