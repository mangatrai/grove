import { Paper, Stack, Text, Title } from "@mantine/core";
import { IconRobot } from "@tabler/icons-react";

export function FamilyAgentPage() {
  return (
    <Stack>
      <Title order={2}>Household Agent</Title>
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md" py="xl">
          <IconRobot size={48} stroke={1} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed" size="sm">
            Coming soon — conflict detection, coverage suggestions, and deadline lookups
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
