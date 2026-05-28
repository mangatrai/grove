import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";

import { apiJson } from "../api";
import { CurrencyInput } from "./CurrencyInput";

const MORTGAGE_SUBTYPES = new Set(["mortgage_primary", "mortgage_investment", "mortgage_vacation"]);

export type AddPropertyModalProps = {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When set, property will be linked to this account and the mortgage picker is hidden */
  accountId?: string | null;
  /** When set, existing property details are loaded for editing */
  existingPropertyId?: string | null;
};

type ModalState = {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  propertyUse: "" | "primary" | "rental" | "vacation";
  purchasePrice: string;
  purchaseDate: string;
  marketValueUsd: string;
  asOfDate: string;
  saving: boolean;
  error: string | null;
  apiPropertyId: string | null;
  apiListingId: string | null;
  valuationDetail: unknown | null;
  retrieving: boolean;
  retrieveError: string | null;
  linkedAccountId: string | null;
  mortgageOptions: Array<{ value: string; label: string }>;
};

function blank(): ModalState {
  return {
    addressLine1: "", city: "", state: "", zip: "",
    propertyUse: "",
    purchasePrice: "", purchaseDate: "",
    marketValueUsd: "",
    asOfDate: new Date().toISOString().slice(0, 10),
    saving: false, error: null,
    apiPropertyId: null, apiListingId: null, valuationDetail: null,
    retrieving: false, retrieveError: null,
    linkedAccountId: null, mortgageOptions: []
  };
}

export function AddPropertyModal({
  opened, onClose, onSaved, accountId, existingPropertyId
}: AddPropertyModalProps) {
  const [s, setS] = useState<ModalState>(blank);

  useEffect(() => {
    if (!opened) return;
    const fresh = blank();
    setS(fresh);

    if (existingPropertyId) {
      void (async () => {
        try {
          const r = await apiJson<{
            property: {
              addressLine1: string | null; city: string | null;
              state: string | null; zip: string | null;
              propertyUse: string | null; latestValueUsd: number | null;
              latestValueAsOf: string | null;
              purchasePrice: number | null; purchaseDate: string | null;
            }
          }>(`/household/properties/${encodeURIComponent(existingPropertyId)}`);
          const p = r.property;
          setS((prev) => ({
            ...prev,
            addressLine1: p.addressLine1 ?? "",
            city: p.city ?? "",
            state: p.state ?? "",
            zip: p.zip ?? "",
            propertyUse: (p.propertyUse ?? "") as ModalState["propertyUse"],
            purchasePrice: p.purchasePrice != null ? String(p.purchasePrice) : "",
            purchaseDate: p.purchaseDate ?? "",
            marketValueUsd: p.latestValueUsd != null ? String(p.latestValueUsd) : "",
            asOfDate: p.latestValueAsOf ?? fresh.asOfDate
          }));
        } catch { /* leave blank */ }
      })();
    }

    if (!accountId) {
      void (async () => {
        try {
          const r = await apiJson<{
            accounts: Array<{ id: string; institution: string; account_mask: string | null; type: string; sub_type: string | null }>
          }>("/imports/accounts");
          const mortgages = r.accounts.filter(
            (a) => a.type === "loan" && MORTGAGE_SUBTYPES.has(a.sub_type ?? "")
          );
          setS((prev) => ({
            ...prev,
            mortgageOptions: mortgages.map((a) => ({
              value: a.id,
              label: a.account_mask
                ? `${a.institution} ····${a.account_mask}`
                : a.institution
            }))
          }));
        } catch { /* skip */ }
      })();
    }
  }, [opened, accountId, existingPropertyId]);

  async function retrieveValuation() {
    const addr = [s.addressLine1.trim(), s.city.trim(), s.state.trim(), s.zip.trim()]
      .filter(Boolean).join(", ");
    if (!addr) return;
    setS((m) => ({ ...m, retrieving: true, retrieveError: null }));
    try {
      const r = await apiJson<{
        estimate: number; apiPropertyId: string; apiListingId: string | null; detail: unknown
      }>("/household/properties/preview-valuation", {
        method: "POST",
        body: JSON.stringify({ address: addr })
      });
      setS((m) => ({
        ...m,
        retrieving: false,
        marketValueUsd: String(Math.round(r.estimate)),
        asOfDate: new Date().toISOString().slice(0, 10),
        apiPropertyId: r.apiPropertyId,
        apiListingId: r.apiListingId,
        valuationDetail: r.detail
      }));
    } catch (e: unknown) {
      setS((m) => ({
        ...m,
        retrieving: false,
        retrieveError: e instanceof Error ? e.message : "Could not retrieve valuation"
      }));
    }
  }

  async function save() {
    setS((m) => ({ ...m, saving: true, error: null }));
    const effectiveAccountId = accountId ?? s.linkedAccountId;
    try {
      const body: Record<string, unknown> = {
        addressLine1: s.addressLine1.trim() || null,
        city: s.city.trim() || null,
        state: s.state.trim() || null,
        zip: s.zip.trim() || null,
        propertyUse: s.propertyUse || null,
        ...(effectiveAccountId ? { accountId: effectiveAccountId } : {})
      };
      if (s.apiPropertyId) {
        body.apiPropertyId = s.apiPropertyId;
        body.apiListingId = s.apiListingId;
        body.valuationDetailJson = s.valuationDetail;
      }
      const valueUsd = parseFloat(s.marketValueUsd);
      if (!isNaN(valueUsd) && valueUsd >= 0) {
        body.initialValueUsd = valueUsd;
        body.initialValueAsOf = s.asOfDate;
      }
      const purchaseVal = parseFloat(s.purchasePrice);
      if (!isNaN(purchaseVal) && purchaseVal > 0) body.purchasePrice = purchaseVal;
      if (s.purchaseDate) body.purchaseDate = s.purchaseDate;

      if (existingPropertyId) {
        await apiJson(`/household/properties/${encodeURIComponent(existingPropertyId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            addressLine1: body.addressLine1,
            city: body.city,
            state: body.state,
            zip: body.zip,
            propertyUse: body.propertyUse,
            purchasePrice: !isNaN(purchaseVal) && purchaseVal > 0 ? purchaseVal : null,
            purchaseDate: s.purchaseDate || null,
          })
        });
        if (!isNaN(valueUsd) && valueUsd >= 0) {
          await apiJson(`/household/properties/${encodeURIComponent(existingPropertyId)}/values`, {
            method: "POST",
            body: JSON.stringify({ marketValueUsd: valueUsd, asOfDate: s.asOfDate })
          });
        }
      } else {
        await apiJson("/household/properties", { method: "POST", body: JSON.stringify(body) });
      }

      onSaved();
      onClose();
    } catch (e: unknown) {
      setS((m) => ({
        ...m,
        saving: false,
        error: e instanceof Error ? e.message : "Could not save property details"
      }));
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={existingPropertyId ? "Edit property" : "Add property"}
      size="md"
    >
      <Stack>
        {s.error ? <Alert color="red">{s.error}</Alert> : null}

        {!accountId ? (
          <Select
            label="Link to mortgage account (optional)"
            value={s.linkedAccountId}
            onChange={(v) => setS((m) => ({ ...m, linkedAccountId: v }))}
            disabled={s.saving}
            clearable
            placeholder="No linked account"
            data={s.mortgageOptions}
          />
        ) : null}

        <TextInput
          label="Street address"
          value={s.addressLine1}
          onChange={(e) => setS((m) => ({ ...m, addressLine1: e.currentTarget.value }))}
          placeholder="123 Main St"
          disabled={s.saving}
        />
        <Group grow>
          <TextInput
            label="City"
            value={s.city}
            onChange={(e) => setS((m) => ({ ...m, city: e.currentTarget.value }))}
            disabled={s.saving}
          />
          <TextInput
            label="State"
            value={s.state}
            onChange={(e) => setS((m) => ({ ...m, state: e.currentTarget.value }))}
            placeholder="CA"
            maw={80}
            disabled={s.saving}
          />
          <TextInput
            label="ZIP"
            value={s.zip}
            onChange={(e) => setS((m) => ({ ...m, zip: e.currentTarget.value }))}
            placeholder="94105"
            maw={100}
            disabled={s.saving}
          />
        </Group>
        <Select
          label="Property use"
          value={s.propertyUse || null}
          onChange={(v) => setS((m) => ({ ...m, propertyUse: (v ?? "") as ModalState["propertyUse"] }))}
          disabled={s.saving}
          clearable
          placeholder="Select use"
          data={[
            { value: "primary", label: "Primary residence" },
            { value: "rental", label: "Rental / investment property" },
            { value: "vacation", label: "Vacation home" }
          ]}
        />
        <Group grow align="end">
          <CurrencyInput
            label="Purchase price (USD)"
            value={s.purchasePrice === "" ? undefined : Number(s.purchasePrice)}
            onChange={(v) => setS((m) => ({ ...m, purchasePrice: v == null ? "" : String(v) }))}
            placeholder="0.00"
            disabled={s.saving}
          />
          <TextInput
            label="Purchase date"
            type="date"
            value={s.purchaseDate}
            onChange={(e) => setS((m) => ({ ...m, purchaseDate: e.currentTarget.value }))}
            disabled={s.saving}
          />
        </Group>
        <Group grow align="end">
          <CurrencyInput
            label="Market value (USD)"
            value={s.marketValueUsd === "" ? undefined : Number(s.marketValueUsd)}
            onChange={(v) => setS((m) => ({ ...m, marketValueUsd: v == null ? "" : String(v) }))}
            placeholder="0.00"
            disabled={s.saving}
          />
          <TextInput
            label="As of date"
            type="date"
            value={s.asOfDate}
            onChange={(e) => setS((m) => ({ ...m, asOfDate: e.currentTarget.value }))}
            disabled={s.saving}
          />
        </Group>
        {s.retrieveError ? (
          <Alert color="orange" py={6}>{s.retrieveError}</Alert>
        ) : null}
        <Button
          variant="light"
          size="xs"
          loading={s.retrieving}
          disabled={
            s.saving ||
            !s.addressLine1.trim() ||
            !s.city.trim() ||
            !s.state.trim() ||
            !s.zip.trim()
          }
          onClick={() => void retrieveValuation()}
        >
          {s.marketValueUsd !== "" ? "Update Redfin estimate" : "Retrieve Redfin estimate"}
        </Button>
        <Text size="xs" c="dimmed">
          Market value creates a snapshot in property history. Add new snapshots any time to track appreciation.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={s.saving}>
            Cancel
          </Button>
          <Button loading={s.saving} onClick={() => void save()}>
            Save property
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
