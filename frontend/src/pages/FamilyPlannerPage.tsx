import { Paper, Stack, Text, Title } from "@mantine/core";
import { IconCalendar } from "@tabler/icons-react";

export function FamilyPlannerPage() {
  return (
    <Stack>
      <Title order={2}>Family Planner</Title>
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md" py="xl">
          <IconCalendar size={48} stroke={1} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed" size="sm">
            Coming soon — weekly coverage view, conflict alerts, and calendar sync
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
