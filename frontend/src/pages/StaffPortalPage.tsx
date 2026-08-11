import { useEffect, useState } from "react";

import { Alert, Group, Paper, Stack, Tabs, Text, Title } from "@mantine/core";

import { apiJson } from "../api";
import { GroveLoader } from "../components/GroveLoader";
import { formatUsd } from "../utils/format";
import { MyTimesheetPanel } from "./staff/MyTimesheetPanel";

type StaffProfile = {
  id: string;
  fullName: string;
  employmentStartDate: string;
  regularScheduleJson: Record<string, number>;
  hourlyRateCents: number;
  isActive: boolean;
};

const DAY_LABELS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

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
              <div>
                <Text size="xs" c="dimmed">Regular schedule</Text>
                <Text fw={600}>
                  {DAY_LABELS
                    .filter((d) => (profile.regularScheduleJson[d.key] ?? 0) > 0)
                    .map((d) => `${d.label} ${profile.regularScheduleJson[d.key]}h`)
                    .join(", ") || "Not set"}
                </Text>
              </div>
            </Group>

            <Tabs defaultValue="timesheet" mt="lg" variant="pills" radius="xl" color="gray">
              <Tabs.List>
                <Tabs.Tab value="timesheet">My Timesheet</Tabs.Tab>
                <Tabs.Tab value="expenses">My Expenses</Tabs.Tab>
                <Tabs.Tab value="pay">My Pay</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="timesheet" pt="md">
                <MyTimesheetPanel regularSchedule={profile.regularScheduleJson} />
              </Tabs.Panel>
              <Tabs.Panel value="expenses" pt="md">
                <Text c="dimmed" size="sm">Expense claims are coming soon.</Text>
              </Tabs.Panel>
              <Tabs.Panel value="pay" pt="md">
                <Text c="dimmed" size="sm">Pay summary and reports are coming soon.</Text>
              </Tabs.Panel>
            </Tabs>
          </>
        ) : null}
      </Paper>
    </Stack>
  );
}
