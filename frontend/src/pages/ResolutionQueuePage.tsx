import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Alert, Anchor, Box, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";

import { apiJson, useAuthToken } from "../api";

type ResolutionItem = {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  context: {
    sessionId: string | null;
    fileId: string | null;
    fileName: string | null;
    raw: {
      txnDate: string | null;
      amount: number | null;
      description: string | null;
    } | null;
  };
};

type ListResponse = {
  items: ResolutionItem[];
  status: string;
  type: string;
};

const TYPE_LABELS: Record<string, string> = {
  duplicate_ambiguity: "Near-duplicate (raw)",
  unknown_category: "Unknown category",
  transfer_ambiguity: "Transfer ambiguity",
  reconciliation_mismatch: "Reconciliation"
};

export function ResolutionQueuePage() {
  const token = useAuthToken();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await apiJson<ListResponse>("/resolution?status=open&type=all");
    setData(res);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <Stack>
      <Paper withBorder p="lg">
        <Title order={2} mb="xs">Open resolution items</Title>
        <Text c="dimmed" size="sm" mb="md">
          Full queue of open review items (including near-duplicates that never received a ledger row — they do not
          appear on <Anchor component={Link} to="/transactions?needsReview=true">Transactions → Needs review</Anchor>).
          Use status actions from your workflow; this list is the API-backed <code>GET /resolution</code> surface.
        </Text>

        {error ? <Alert color="red" mb="sm">{error}</Alert> : null}
        {loading ? <Skeleton height={120} radius="sm" /> : null}

        {!loading && data && data.items.length === 0 ? (
          <Text c="dimmed">No open items.</Text>
        ) : null}

        {!loading && data && data.items.length > 0 ? (
          <Box style={{ overflowX: "auto" }}>
            <Table withRowBorders striped="odd" verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Type</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Status</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>File</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Raw preview</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Session</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.items.map((it) => (
                  <Table.Tr key={it.id}>
                    <Table.Td>{TYPE_LABELS[it.type] ?? it.type}</Table.Td>
                    <Table.Td>{it.status}</Table.Td>
                    <Table.Td style={{ maxWidth: "14rem", wordBreak: "break-word" }}>
                      {it.context.fileName ?? "—"}
                    </Table.Td>
                    <Table.Td fz="sm">
                      {it.context.raw
                        ? `${it.context.raw.txnDate ?? "—"} · ${it.context.raw.description ?? "—"} · ${it.context.raw.amount != null ? `$${it.context.raw.amount.toFixed(2)}` : "—"}`
                        : "—"}
                    </Table.Td>
                    <Table.Td>
                      {it.context.sessionId ? (
                        <Anchor component={Link} to={`/imports/${it.context.sessionId}`}>Import session</Anchor>
                      ) : (
                        "—"
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        ) : null}

        <Text size="sm" mt="md">
          <Anchor component={Link} to="/transactions?needsReview=true">← Back to Transactions → Needs review</Anchor>
        </Text>
      </Paper>
    </Stack>
  );
}
