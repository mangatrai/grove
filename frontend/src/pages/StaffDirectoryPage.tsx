import { Stack } from "@mantine/core";

import { StaffDirectory } from "./staff/StaffDirectory";

export function StaffDirectoryPage() {
  return (
    <Stack p="xl" gap="lg">
      <StaffDirectory active />
    </Stack>
  );
}
