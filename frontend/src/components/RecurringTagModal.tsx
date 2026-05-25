import { Button, Group, Modal, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";

export interface RecurringOverride {
  id: string;
  householdId: string;
  merchantKey: string;
  displayName: string | null;
  verdict: "confirmed" | "dismissed";
  amountAnchor: number | null;
  amountTolerancePct: number;
  taggedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RecurringTagModalProps {
  opened: boolean;
  onClose: () => void;
  txnMerchant: string;
  txnAmount: number;
  allTxns: Array<{ merchant: string | null; amount: number; direction: string }>;
  existingOverride: RecurringOverride | null;
  onConfirm: (payload: {
    merchantKey: string;
    displayName?: string;
    amountAnchor: number | null;
    amountTolerancePct: number;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
}

export function RecurringTagModal({
  opened,
  onClose,
  txnMerchant,
  txnAmount,
  allTxns,
  existingOverride,
  onConfirm,
  onRemove
}: RecurringTagModalProps) {
  const [merchantKeyDraft, setMerchantKeyDraft] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [amountAnchorDraft, setAmountAnchorDraft] = useState("");
  const [toleranceDraft, setToleranceDraft] = useState("15");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) {
      return;
    }
    setMerchantKeyDraft(existingOverride?.merchantKey ?? txnMerchant.toLowerCase().trim());
    setDisplayNameDraft(existingOverride?.displayName ?? "");
    setAmountAnchorDraft(
      existingOverride?.amountAnchor != null ? existingOverride.amountAnchor.toFixed(2) : txnAmount.toFixed(2)
    );
    setToleranceDraft(existingOverride ? existingOverride.amountTolerancePct.toFixed(0) : "15");
    setError(null);
    setSaving(false);
  }, [opened, existingOverride, txnMerchant, txnAmount]);

  const matchCount = useMemo(() => {
    const key = merchantKeyDraft.toLowerCase().trim();
    if (!key) return 0;
    const anchor = amountAnchorDraft !== "" ? Number(amountAnchorDraft) : null;
    const tol = Number(toleranceDraft ?? "15") / 100;
    return allTxns.filter((t) => {
      if (t.direction !== "debit") return false;
      const merchant = (t.merchant ?? "").toLowerCase();
      if (!merchant.includes(key)) return false;
      if (anchor != null && Number.isFinite(anchor) && anchor > 0) {
        const absAmount = Math.abs(t.amount);
        if (Math.abs(absAmount - anchor) / anchor > tol) return false;
      }
      return true;
    }).length;
  }, [merchantKeyDraft, amountAnchorDraft, toleranceDraft, allTxns]);

  async function handleConfirm() {
    const merchantKey = merchantKeyDraft.trim().toLowerCase();
    if (!merchantKey) {
      setError("Match string is required.");
      return;
    }
    const parsedAnchor = amountAnchorDraft !== "" ? Number(amountAnchorDraft) : null;
    const amountAnchor = parsedAnchor != null && Number.isFinite(parsedAnchor) ? parsedAnchor : null;
    const parsedTolerance = Number(toleranceDraft);
    const amountTolerancePct = Number.isFinite(parsedTolerance) ? parsedTolerance : 15;
    setSaving(true);
    setError(null);
    try {
      await onConfirm({
        merchantKey,
        displayName: displayNameDraft.trim() || undefined,
        amountAnchor,
        amountTolerancePct
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save recurring override.");
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError(null);
    try {
      await onRemove();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove recurring override.");
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      title={existingOverride ? "Edit recurring override" : "Mark as recurring"}
      centered
    >
      <Stack gap="sm">
        <TextInput
          label="Match string"
          value={merchantKeyDraft}
          onChange={(e) => setMerchantKeyDraft(e.currentTarget.value)}
          description="Match is a substring of merchant, case-insensitive"
        />
        <TextInput
          label="Display name"
          description="Name shown on dashboard and settings. Defaults to merchant key if blank."
          placeholder={merchantKeyDraft || "e.g. Frisco Utilities"}
          value={displayNameDraft}
          onChange={(e) => setDisplayNameDraft(e.currentTarget.value)}
        />
        <Text size="sm" mt="xs">
          {matchCount} transaction{matchCount === 1 ? "" : "s"} in current view match this pattern
        </Text>
        <NumberInput
          label="Amount anchor (USD)"
          description="Leave empty to match regardless of amount"
          value={amountAnchorDraft}
          onChange={(v) => setAmountAnchorDraft(v === "" ? "" : String(v))}
          decimalScale={2}
          min={0}
          placeholder="e.g. 18.99"
        />
        <NumberInput
          label="Amount tolerance %"
          description="How much the amount can vary from the anchor"
          value={toleranceDraft}
          onChange={(v) => setToleranceDraft(v === "" ? "" : String(v))}
          min={0}
          max={100}
          suffix="%"
        />
        {error ? <Text c="red" size="sm">{error}</Text> : null}
        <Group justify="space-between" mt="sm">
          {existingOverride ? (
            <Button variant="subtle" color="red" disabled={saving} onClick={() => void handleRemove()}>
              Remove override
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void handleConfirm()}>
              {existingOverride ? "Save changes" : "Mark as recurring"}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
