import { Paper, Stack, Text, Title } from "@mantine/core";
import { IconBell } from "@tabler/icons-react";

export function FamilyDeadlinesPage() {
  return (
    <Stack>
      <Title order={2}>Deadlines</Title>
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md" py="xl">
          <IconBell size={48} stroke={1} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed" size="sm">
            Coming soon — enrollment deadlines, medical appointments, and financial cutoffs
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
