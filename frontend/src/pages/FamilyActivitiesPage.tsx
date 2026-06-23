import { Paper, Stack, Text, Title } from "@mantine/core";
import { IconRun } from "@tabler/icons-react";

export function FamilyActivitiesPage() {
  return (
    <Stack>
      <Title order={2}>Kid Activities</Title>
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md" py="xl">
          <IconRun size={48} stroke={1} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed" size="sm">
            Coming soon — activity schedule, recurring commitments, and pickup reminders
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
