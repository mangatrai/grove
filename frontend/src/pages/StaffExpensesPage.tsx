import { useState } from "react";

import { Divider, Stack, Title } from "@mantine/core";

import { MyExpensesPanel } from "./staff/MyExpensesPanel";
import { StaffPicker } from "./staff/StaffPicker";
import { ExpenseApprovalQueue } from "./staff/StaffDirectory";

export function StaffExpensesPage() {
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  return (
    <Stack p="xl" gap="lg">
      <Title order={2}>Staff Expenses</Title>
      <StaffPicker value={selectedStaffId} onChange={setSelectedStaffId} />
      {selectedStaffId ? <MyExpensesPanel staffId={selectedStaffId} /> : null}
      <Divider />
      <ExpenseApprovalQueue />
    </Stack>
  );
}
