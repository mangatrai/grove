import { useCallback, useEffect, useState } from "react";

import { Alert, Group, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";

import { apiJson } from "../../api";
import { GroveLoader } from "../../components/GroveLoader";
import { formatUsd } from "../../utils/format";

type StaffPayAdjustment = {
  id: string;
  adjustmentDate: string;
  amountCents: number;
  reason: string;
};

type PaySummary = {
  from: string;
  to: string;
  earned: { timesheetCents: number; expenseCents: number; adjustmentCents: number; totalCents: number };
  paid: { salaryCents: number; bonusCents: number; reimbursementCents: number; totalCents: number };
  balanceDueCents: number;
  adjustments: StaffPayAdjustment[];
};

function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MyPayPanel({ staffId }: { staffId: string }) {
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(todayIso);
  const [summary, setSummary] = useState<PaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ summary: PaySummary }>(
        `/staff/${staffId}/pay-summary?from=${from}&to=${to}`
      );
      setSummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load pay summary");
    } finally {
      setLoading(false);
    }
  }, [staffId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack mt="sm">
      <Group align="end">
        <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
      </Group>

      {loading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading…</Text>
        </Group>
      ) : null}
      {error ? <Alert color="red">{error}</Alert> : null}

      {!loading && summary ? (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" c="dimmed">Earned</Text>
              <Text fw={700} size="xl">{formatUsd(summary.earned.totalCents / 100)}</Text>
              <Text size="xs" c="dimmed" mt={4}>
                Timesheet {formatUsd(summary.earned.timesheetCents / 100)} · Expenses{" "}
                {formatUsd(summary.earned.expenseCents / 100)} · Bonuses{" "}
                {formatUsd(summary.earned.adjustmentCents / 100)}
              </Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" c="dimmed">Paid</Text>
              <Text fw={700} size="xl">{formatUsd(summary.paid.totalCents / 100)}</Text>
              <Text size="xs" c="dimmed" mt={4}>
                Salary {formatUsd(summary.paid.salaryCents / 100)} · Bonus{" "}
                {formatUsd(summary.paid.bonusCents / 100)} · Reimbursement{" "}
                {formatUsd(summary.paid.reimbursementCents / 100)}
              </Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" c="dimmed">Balance due</Text>
              <Text fw={700} size="xl" c={summary.balanceDueCents > 0 ? "orange" : undefined}>
                {formatUsd(summary.balanceDueCents / 100)}
              </Text>
            </Paper>
          </SimpleGrid>

          <Title order={5} mt="md">Bonuses / extra pay in range</Title>
          {summary.adjustments.length === 0 ? (
            <Text size="sm" c="dimmed">None recorded in this range.</Text>
          ) : (
            <Table withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Amount</Table.Th>
                  <Table.Th>Reason</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.adjustments.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>{a.adjustmentDate}</Table.Td>
                    <Table.Td>{formatUsd(a.amountCents / 100)}</Table.Td>
                    <Table.Td>{a.reason}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      ) : null}
    </Stack>
  );
}
