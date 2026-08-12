import { useEffect, useState } from "react";

import { Alert, Group, Paper, Stack, Tabs, Text, Title } from "@mantine/core";

import { apiJson } from "../api";
import { GroveLoader } from "../components/GroveLoader";
import { formatUsd } from "../utils/format";
import { MyExpensesPanel } from "./staff/MyExpensesPanel";
import { MyPayPanel } from "./staff/MyPayPanel";
import { MyTimesheetPanel } from "./staff/MyTimesheetPanel";

type StaffProfile = {
  id: string;
  fullName: string;
  employmentStartDate: string;
  hourlyRateCents: number;
  isActive: boolean;
};

export function StaffPortalPage() {
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiJson<{ member: StaffProfile }>("/staff/me")
      .then((res) => {
        if (!cancelled) setProfile(res.member);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your staff profile");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Stack>
      <Paper withBorder p="lg" radius="md">
        <Title order={2}>My Portal</Title>
        {loading ? (
          <Group gap="sm" mt="md">
            <GroveLoader size="sm" color="muted" />
            <Text size="sm" c="dimmed">Loading…</Text>
          </Group>
        ) : null}
        {error ? <Alert color="red" mt="md">{error}</Alert> : null}
        {!loading && profile ? (
          <>
            <Group mt="md" gap="xl">
              <div>
                <Text size="xs" c="dimmed">Employment start</Text>
                <Text fw={600}>{profile.employmentStartDate}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Hourly rate</Text>
                <Text fw={600}>{formatUsd(profile.hourlyRateCents / 100)}/hr</Text>
              </div>
            </Group>

            <Tabs defaultValue="timesheet" mt="lg" variant="pills" radius="xl" color="gray">
              <Tabs.List>
                <Tabs.Tab value="timesheet">My Timesheet</Tabs.Tab>
                <Tabs.Tab value="expenses">My Expenses</Tabs.Tab>
                <Tabs.Tab value="pay">My Pay</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="timesheet" pt="md">
                <MyTimesheetPanel />
              </Tabs.Panel>
              <Tabs.Panel value="expenses" pt="md">
                <MyExpensesPanel />
              </Tabs.Panel>
              <Tabs.Panel value="pay" pt="md">
                <MyPayPanel staffId={profile.id} />
              </Tabs.Panel>
            </Tabs>
          </>
        ) : null}
      </Paper>
    </Stack>
  );
}
