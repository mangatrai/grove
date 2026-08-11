import { useState } from "react";

import { Divider, Stack, Title } from "@mantine/core";

import { MyTimesheetPanel } from "./staff/MyTimesheetPanel";
import { StaffPicker } from "./staff/StaffPicker";
import { TimesheetApprovalQueue } from "./staff/StaffDirectory";

export function StaffTimesheetsPage() {
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  return (
    <Stack p="xl" gap="lg">
      <Title order={2}>Staff Timesheets</Title>
      <StaffPicker value={selectedStaffId} onChange={setSelectedStaffId} />
      {selectedStaffId ? <MyTimesheetPanel staffId={selectedStaffId} /> : null}
      <Divider />
      <TimesheetApprovalQueue />
    </Stack>
  );
}
