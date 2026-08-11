import { useCallback, useEffect, useState } from "react";

import { Alert, Badge, Button, Group, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";

import { apiJson } from "../../api";
import { CurrencyInput } from "../../components/CurrencyInput";
import { GroveLoader } from "../../components/GroveLoader";
import { formatUsd } from "../../utils/format";

type ExpenseStatus = "pending" | "approved" | "rejected";

type StaffExpense = {
  id: string;
  expenseDate: string;
  category: string;
  amountCents: number;
  description: string | null;
  status: ExpenseStatus;
  reviewNote: string | null;
};

const EXPENSE_CATEGORIES = [
  "Transportation/Mileage",
  "Groceries & Kids' Supplies",
  "Activities & Outings",
  "Parking & Tolls",
  "Medical/First Aid",
  "Other",
];

const STATUS_META: Record<ExpenseStatus, { label: string; color: string }> = {
  pending: { label: "Pending review", color: "blue" },
  approved: { label: "Approved", color: "green" },
  rejected: { label: "Rejected", color: "red" },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MyExpensesPanel() {
  const [expenses, setExpenses] = useState<StaffExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [expenseDate, setExpenseDate] = useState(todayIso);
  const [category, setCategory] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] = useState<number | undefined>(undefined);
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ expenses: StaffExpense[] }>("/staff/expenses/me");
      setExpenses(res.expenses);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load expenses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitExpense() {
    setSubmitError(null);
    if (!expenseDate || !category || !amountUsd || amountUsd <= 0) {
      setSubmitError("Date, category, and a positive amount are required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiJson("/staff/expenses/me", {
        method: "POST",
        body: JSON.stringify({
          expenseDate,
          category,
          amountCents: Math.round(amountUsd * 100),
          description: description.trim() || null,
        }),
      });
      setCategory(null);
      setAmountUsd(undefined);
      setDescription("");
      await load();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not submit expense");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack mt="sm">
      <Stack gap="xs">
        <Title order={5}>New expense claim</Title>
        <Group align="end" grow>
          <TextInput
            label="Date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.currentTarget.value)}
            disabled={submitting}
          />
          <Select
            label="Category"
            placeholder="Select a category"
            data={EXPENSE_CATEGORIES}
            value={category}
            onChange={setCategory}
            disabled={submitting}
          />
          <CurrencyInput label="Amount (USD)" placeholder="0.00" value={amountUsd} onChange={setAmountUsd} disabled={submitting} />
        </Group>
        <TextInput
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          disabled={submitting}
        />
        {submitError ? <Alert color="red" p="xs">{submitError}</Alert> : null}
        <Group>
          <Button size="sm" loading={submitting} onClick={() => void submitExpense()}>
            Submit expense
          </Button>
        </Group>
      </Stack>

      <Title order={5} mt="md">Your expenses</Title>
      {loading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading…</Text>
        </Group>
      ) : null}
      {error ? <Alert color="red">{error}</Alert> : null}
      {!loading && expenses.length === 0 ? (
        <Text size="sm" c="dimmed">No expenses submitted yet.</Text>
      ) : null}
      {!loading && expenses.length > 0 ? (
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {expenses.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{e.expenseDate}</Table.Td>
                <Table.Td>{e.category}</Table.Td>
                <Table.Td>{formatUsd(e.amountCents / 100)}</Table.Td>
                <Table.Td>{e.description ?? "—"}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_META[e.status].color} variant="light" size="sm">
                    {STATUS_META[e.status].label}
                  </Badge>
                  {e.status === "rejected" && e.reviewNote ? (
                    <Text size="xs" c="red" mt={2}>{e.reviewNote}</Text>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}
    </Stack>
  );
}
