import { useEffect, useState } from "react";

import { Alert, Group, Select, Stack, Text, Title } from "@mantine/core";

import { apiJson } from "../api";
import { GroveLoader } from "../components/GroveLoader";
import { MyPayPanel } from "./staff/MyPayPanel";

type StaffMember = { id: string; fullName: string };

export function StaffPayPage() {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<{ members: StaffMember[] }>("/staff");
        if (cancelled) return;
        setMembers(res.members);
        setSelected((prev) => prev ?? res.members[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load staff");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Stack p="xl" gap="lg">
      <Title order={2}>Staff Pay &amp; Reports</Title>
      {error ? <Alert color="red">{error}</Alert> : null}
      {loading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading staff…</Text>
        </Group>
      ) : null}
      {!loading && members.length === 0 ? (
        <Text size="sm" c="dimmed">No staff members added yet.</Text>
      ) : null}
      {!loading && members.length > 0 ? (
        <Select
          label="Staff member"
          data={members.map((m) => ({ value: m.id, label: m.fullName }))}
          value={selected}
          onChange={setSelected}
          maw={320}
        />
      ) : null}
      {selected ? <MyPayPanel staffId={selected} /> : null}
    </Stack>
  );
}
