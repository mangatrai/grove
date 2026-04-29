import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

export type ConfirmDialogProps = {
  opened: boolean;
  title: string;
  /** Primary message; use string or short React fragment for emphasis. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use stronger styling for destructive / irreversible actions. */
  danger?: boolean;
  /** When false, backdrop / outside clicks do not dismiss (safer for finalize/delete). */
  closeOnClickOutside?: boolean;
  onClose: () => void;
  /**
   * Run when user confirms. On success, resolve normally and the dialog closes.
   * Reject or throw to keep the dialog open (e.g. after surfacing an error).
   */
  onConfirm: () => void | Promise<void>;
};

/**
 * In-app confirmation instead of window.confirm — Mantine modal with app button classes.
 */
export function ConfirmDialog({
  opened,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  closeOnClickOutside = false,
  onClose,
  onConfirm
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.resolve(onConfirm());
      onClose();
    } catch {
      /* Parent showed error; keep dialog open */
    } finally {
      setLoading(false);
    }
  }, [onClose, onConfirm]);

  return (
    <Modal
      opened={opened}
      onClose={loading ? () => undefined : onClose}
      title={title}
      centered
      closeOnClickOutside={closeOnClickOutside && !loading}
      closeOnEscape={!loading}
    >
      <Stack gap="md">
        {typeof message === "string" ? <Text size="sm">{message}</Text> : <div>{message}</div>}
        <Group justify="flex-end" gap="sm" mt={4}>
          <Button type="button" variant="default" disabled={loading} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            color={danger ? "red" : undefined}
            disabled={loading}
            onClick={() => void handleConfirm()}
          >
            {loading ? "Working…" : confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
