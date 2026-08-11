import { useEffect, useState } from "react";

import { Select } from "@mantine/core";

import { apiJson } from "../../api";

type StaffOption = {
  id: string;
  fullName: string;
  isActive: boolean;
};

type StaffPickerProps = {
  value: string | null;
  onChange: (staffId: string | null) => void;
};

/** Owner/admin staff selector — lets them pick which household staff member's timesheet/expenses to view or submit. */
export function StaffPicker({ value, onChange }: StaffPickerProps) {
  const [options, setOptions] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ members: StaffOption[] }>("/staff")
      .then((res) => {
        if (!cancelled) setOptions(res.members.filter((m) => m.isActive));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Select
      label="Staff member"
      placeholder="Select a staff member"
      data={options.map((m) => ({ value: m.id, label: m.fullName }))}
      value={value}
      onChange={onChange}
      disabled={loading}
      w={280}
    />
  );
}
