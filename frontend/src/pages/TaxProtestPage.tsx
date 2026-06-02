import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Drawer,
  Grid,
  Group,
  List,
  Loader,
  NumberInput,
  Paper,
  Popover,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
  Modal,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconCalendarEvent,
  IconExternalLink,
  IconFileText,
  IconMessage,
  IconNote,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { apiJson, getToken, useAuthToken } from "../api";
import { GrovePageLoader } from "../components/GroveLoader";

type ProtestStatus = "not_filed" | "filed" | "informal" | "arb" | "resolved";
type ProtestOutcome = "settled_informal" | "won_arb" | "lost_arb" | "withdrawn";
type AttachmentType = "pdf" | "url" | "text";

type PropertyRecord = {
  id: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  propertyUse: "primary" | "rental" | "vacation" | null;
  latestValueUsd: number | null;
  latestValueAsOf: string | null;
  valuationDetail: unknown | null;
  valuationFetchedAt: string | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  monthlyRent: number | null;
  propertyNotes: string | null;
};

type ConversationTurn = {
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
  attachmentType?: AttachmentType;
};

type StrategyJson = {
  caseStrength: number;
  targetValueUsd: number;
  primaryStrategy: string;
  draftArguments: string[];
  redFlags: string[];
};

type Worksheet = {
  id: string;
  propertyId: string;
  taxYear: number;
  status: ProtestStatus;
  outcome: ProtestOutcome | null;
  informalOfferUsd: number | null;
  hearingDate: string | null;
  filingDeadline: string | null;
  cadPortalUrl: string | null;
  conversationJson: ConversationTurn[];
  strategyJson: StrategyJson | null;
  cadEvidenceJson: CadEvidenceData | null;
  cadEvidenceFilename: string | null;
  soldCompsNotesJson: Record<string, string>;
};

type CADComp = {
  cadPropertyId: string;
  addressLine1: string | null;
  city: string | null;
  assessedValueUsd: number | null;
  marketValueUsd: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  perSqftUsd: number | null;
  notes: string | null;
};

type CadSalesComp = {
  compNum: number;
  propId: string;
  address: string;
  distanceMi: number | null;
  saleDate: string | null;
  salePriceUsd: number | null;
  cadMarketValueUsd: number | null;
  cadIndValueUsd: number | null;
};

type CadEquityComp = {
  compNum: number;
  propId: string;
  address: string;
  distanceMi: number | null;
  cadMarketValueUsd: number | null;
  cadIndValueUsd: number | null;
};

type CadEvidenceData = {
  uploadedAt: string;
  subjectCadPropertyId: string | null;
  subjectAddress: string | null;
  assessedValueUsd: number | null;
  improvementsUsd: number | null;
  landValueUsd: number | null;
  percentGood: number | null;
  livingAreaSqft: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  salesAnalysis: { comps: CadSalesComp[]; medianIndValueUsd: number | null; medianValuePerSqft: number | null };
  equityAnalysis: { comps: CadEquityComp[]; medianIndValueUsd: number | null; medianValuePerSqft: number | null };
};

type SoldComp = {
  address: string | null;
  city: string | null;
  state: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  soldPrice: number | null;
  soldDate: string | null;
  pricePerSqft: number | null;
  listPrice: number | null;
  cadAssessedValueUsd: number | null;
};

type CadSearchResult = {
  cadPropertyId: string;
  address: string | null;
  city: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  assessedValue: number | null;
  marketValue: number | null;
};

type Toast = { id: number; color: "green" | "red" | "yellow"; message: string };
type ChatTurnUI = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  attachmentType?: AttachmentType;
  optimistic?: boolean;
};

type PendingAttachment = {
  type: AttachmentType;
  text: string;
  label: string;
};

type PropertiesResponse = { properties: PropertyRecord[] };
type PropertyResponse = { property: PropertyRecord };
type WorksheetResponse = { worksheet: Worksheet };
type CompsResponse = { comps: CADComp[] };
type SoldCompsResponse = { comps: SoldComp[]; excluded: string[] };
type ChatResponse = { assistantMessage: string; strategyUpdated: boolean; compsAdded: number; soldCompsRefreshed: boolean; valuationAgeHours: number | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ppsf(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(0)}/sf`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(iso: string): number | null {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / 86_400_000);
}

function statusIndex(status: ProtestStatus, outcome: ProtestOutcome | null): number {
  if (status === "filed") return 1;
  if (status === "informal") return 2;
  if (status === "arb") return 3;
  if (status === "resolved") {
    return outcome === "settled_informal" ? 3 : 4;
  }
  return 0;
}

function outcomeColor(outcome: ProtestOutcome | null): string {
  if (outcome === "settled_informal" || outcome === "won_arb") return "green";
  if (outcome === "lost_arb") return "red";
  if (outcome === "withdrawn") return "gray";
  return "yellow";
}

function outcomeLabel(outcome: ProtestOutcome | null): string {
  if (outcome === "settled_informal") return "Settled at Informal";
  if (outcome === "won_arb") return "Won at ARB";
  if (outcome === "lost_arb") return "Lost at ARB";
  if (outcome === "withdrawn") return "Withdrew Protest";
  return "Resolved";
}

function markdownLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));
}

function vsSubjectColor(compPpsf: number | null, subjectPpsf: number | null): string | undefined {
  if (compPpsf == null || subjectPpsf == null || subjectPpsf === 0) return undefined;
  return compPpsf < subjectPpsf ? "green" : "red";
}

function vsSubjectLabel(compPpsf: number | null, subjectPpsf: number | null): string {
  if (compPpsf == null || subjectPpsf == null || subjectPpsf === 0) return "—";
  const diff = ((compPpsf / subjectPpsf) - 1) * 100;
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
}

function CompNotePopover({ note, onSave }: { note: string | null; onSave: (v: string) => void }) {
  const [opened, setOpened] = useState(false);
  const [value, setValue] = useState(note ?? "");

  useEffect(() => { setValue(note ?? ""); }, [note]);

  return (
    <Popover opened={opened} onClose={() => { setOpened(false); onSave(value); }} withArrow>
      <Popover.Target>
        <Tooltip label={note ? "Edit note" : "Add note"} withArrow>
          <ActionIcon
            variant={note ? "light" : "subtle"}
            color={note ? "yellow" : "gray"}
            size="sm"
            onClick={() => setOpened((o) => !o)}
            aria-label="Note"
          >
            <IconNote size={13} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          placeholder="Add note about this comp..."
          size="xs"
          autosize
          minRows={2}
          maxRows={5}
          w={260}
          onBlur={() => { setOpened(false); onSave(value); }}
          autoFocus
        />
      </Popover.Dropdown>
    </Popover>
  );
}

export function TaxProtestPage() {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toastSeq, setToastSeq] = useState(1);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [comps, setComps] = useState<CADComp[]>([]);
  const [soldComps, setSoldComps] = useState<SoldComp[]>([]);
  const [year, setYear] = useState<string>("2026");
  const [chat, setChat] = useState<ChatTurnUI[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [hearingDraft, setHearingDraft] = useState("");
  const [informalOfferDraft, setInformalOfferDraft] = useState<number | "">("");
  const [filingDeadlineDraft, setFilingDeadlineDraft] = useState("");
  const [cadPortalUrlDraft, setCadPortalUrlDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [docFormat, setDocFormat] = useState<"pdf" | "docx">("pdf");
  const [staleAlertDismissed, setStaleAlertDismissed] = useState(false);
  const [excludedSoldComps, setExcludedSoldComps] = useState<string[]>([]);
  const [addCompOpen, setAddCompOpen] = useState(false);
  const [addCompStep, setAddCompStep] = useState<"search" | "results" | "manual">("search");
  const [addCompAddress, setAddCompAddress] = useState("");
  const [addCompCity, setAddCompCity] = useState("");
  const [addCompSqft, setAddCompSqft] = useState<number | "">("");
  const [addCompBeds, setAddCompBeds] = useState<number | "">("");
  const [addCompBaths, setAddCompBaths] = useState<number | "">("");
  const [addCompYearBuilt, setAddCompYearBuilt] = useState<number | "">("");
  const [addCompAssessed, setAddCompAssessed] = useState<number | "">("");
  const [addingComp, setAddingComp] = useState(false);
  const [cadSearchLoading, setCadSearchLoading] = useState(false);
  const [cadSearchResults, setCadSearchResults] = useState<CadSearchResult[]>([]);
  const [selectedCadResult, setSelectedCadResult] = useState<CadSearchResult | null>(null);
  const [cadHasAdapter, setCadHasAdapter] = useState(true);
  const [removingCompId, setRemovingCompId] = useState<string | null>(null);
  const [refreshingComps, setRefreshingComps] = useState(false);
  const [cadEvidence, setCadEvidence] = useState<CadEvidenceData | null>(null);
  const [soldCompsNotes, setSoldCompsNotes] = useState<Record<string, string>>({});
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cadEvidenceFileRef = useRef<HTMLInputElement | null>(null);

  const colorScheme = useComputedColorScheme("light");

  const addToast = useCallback(
    (color: Toast["color"], messageText: string) => {
      const next: Toast = { id: toastSeq, color, message: messageText };
      setToastSeq((n) => n + 1);
      setToasts((prev) => [...prev, next]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== next.id));
      }, 3000);
    },
    [toastSeq]
  );

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propsRes = await apiJson<PropertiesResponse>("/household/properties");
      const props = propsRes.properties ?? [];
      setProperties(props);
      if (props.length === 0) {
        setPropertyId(null);
        setProperty(null);
        setWorksheet(null);
        setComps([]);
        setSoldComps([]);
        setChat([]);
        setLoading(false);
        return;
      }
      const qpProperty = searchParams.get("property");
      const chosen =
        qpProperty && props.some((p) => p.id === qpProperty) ? qpProperty : props[0].id;
      setPropertyId(chosen);
      if (!qpProperty || qpProperty !== chosen) {
        setSearchParams({ property: chosen });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties");
    } finally {
      setLoading(false);
    }
  }, [searchParams, setSearchParams]);

  const loadPropertyAndWorksheet = useCallback(async (pid: string, selectedYear: number) => {
    setError(null);
    try {
      const [propRes, wsRes, compsRes, soldCompsRes] = await Promise.all([
        apiJson<PropertyResponse>(`/household/properties/${encodeURIComponent(pid)}`),
        apiJson<WorksheetResponse>(
          `/api/protest/${encodeURIComponent(pid)}/worksheet?year=${selectedYear}`
        ),
        apiJson<CompsResponse>(
          `/api/protest/${encodeURIComponent(pid)}/comps?year=${selectedYear}`
        ).catch(() => ({ comps: [] as CADComp[] })),
        apiJson<SoldCompsResponse>(
          `/api/protest/${encodeURIComponent(pid)}/sold-comps?year=${selectedYear}`
        ).catch(() => ({ comps: [] as SoldComp[], excluded: [] as string[] }))
      ]);
      setProperty(propRes.property);
      setStaleAlertDismissed(false);
      setWorksheet(wsRes.worksheet);
      setComps(compsRes.comps);
      setSoldComps(soldCompsRes.comps);
      setExcludedSoldComps(soldCompsRes.excluded ?? []);
      setCadEvidence(wsRes.worksheet.cadEvidenceJson ?? null);
      setSoldCompsNotes(wsRes.worksheet.soldCompsNotesJson ?? {});
      setHearingDraft(wsRes.worksheet.hearingDate ?? "");
      setInformalOfferDraft("");
      setFilingDeadlineDraft(wsRes.worksheet.filingDeadline ?? "");
      setCadPortalUrlDraft(wsRes.worksheet.cadPortalUrl ?? "");
      const turns: ChatTurnUI[] = (wsRes.worksheet.conversationJson ?? [])
        .filter((t) => t.role === "user" || t.role === "assistant")
        .map((t, idx) => ({
          id: `${wsRes.worksheet.id}-${idx}-${t.ts}`,
          role: t.role as "user" | "assistant",
          content: t.content,
          ts: t.ts,
          attachmentType: t.attachmentType
        }));
      setChat(turns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worksheet");
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadBase();
  }, [token, loadBase]);

  useEffect(() => {
    if (!token || !propertyId) return;
    void loadPropertyAndWorksheet(propertyId, Number(year));
  }, [token, propertyId, year, loadPropertyAndWorksheet]);

  useEffect(() => {
    if (chatOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chat, thinking, chatOpen]);

  const subject = useMemo(
    () => asRecord(asRecord(property?.valuationDetail)?.subject),
    [property?.valuationDetail]
  );
  const estimate = useMemo(
    () => asRecord(asRecord(property?.valuationDetail)?.estimate),
    [property?.valuationDetail]
  );
  const assessment = useMemo(
    () => asRecord(asRecord(property?.valuationDetail)?.taxCurrent),
    [property?.valuationDetail]
  );

  const cadAssessed = asNumber(assessment?.assessedValue);
  const avm = asNumber(estimate?.value) ?? property?.latestValueUsd ?? null;
  const subjectSqft = asNumber(subject?.sqFt);
  const overPct =
    cadAssessed != null && avm != null && avm > 0
      ? ((cadAssessed / avm) - 1) * 100
      : null;
  const overAmt = cadAssessed != null && avm != null ? cadAssessed - avm : null;
  const annualSavings =
    overAmt != null &&
    overAmt > 0 &&
    (property?.state ?? "").toUpperCase() === "TX"
      ? overAmt * 0.02
      : null;

  const subjectAssessedPpsf =
    cadAssessed != null && subjectSqft != null && subjectSqft > 0
      ? cadAssessed / subjectSqft
      : null;
  const subjectMarketPpsf =
    avm != null && subjectSqft != null && subjectSqft > 0 ? avm / subjectSqft : null;

  const hearingDays =
    worksheet?.hearingDate != null ? daysUntil(worksheet.hearingDate) : null;
  const filingDeadlineDays =
    worksheet?.filingDeadline != null ? daysUntil(worksheet.filingDeadline) : null;

  const visibleSoldComps = useMemo(
    () => soldComps.filter((c) => !excludedSoldComps.includes(c.address ?? "")),
    [soldComps, excludedSoldComps]
  );

  const removeCADComp = useCallback(async (cadPropertyId: string) => {
    if (!propertyId) return;
    setRemovingCompId(cadPropertyId);
    try {
      await apiJson(
        `/api/protest/${encodeURIComponent(propertyId)}/comps/${encodeURIComponent(cadPropertyId)}?year=${year}`,
        { method: "DELETE" }
      );
      setComps((prev) => prev.filter((c) => c.cadPropertyId !== cadPropertyId));
      addToast("green", "Comp removed");
    } catch {
      addToast("red", "Failed to remove comp");
    } finally {
      setRemovingCompId(null);
    }
  }, [propertyId, year, addToast]);

  const removeSoldComp = useCallback(async (address: string) => {
    if (!propertyId || !worksheet || !address) return;
    const updated = [...excludedSoldComps, address];
    setExcludedSoldComps(updated);
    try {
      await apiJson(
        `/api/protest/${encodeURIComponent(propertyId)}/sold-comps/exclusions`,
        { method: "PATCH", body: JSON.stringify({ year: Number(year), excluded: updated }) }
      );
      addToast("green", "Comp removed from evidence");
    } catch {
      setExcludedSoldComps((prev) => prev.filter((a) => a !== address));
      addToast("red", "Failed to remove comp");
    }
  }, [propertyId, worksheet, year, excludedSoldComps, addToast]);

  const uploadCadEvidence = useCallback(async (file: File) => {
    if (!propertyId) return;
    const form = new FormData();
    form.append("file", file);
    setUploadingEvidence(true);
    try {
      await fetch(`/api/protest/${encodeURIComponent(propertyId)}/cad-evidence?taxYear=${year}`, {
        method: "POST",
        body: form,
        headers: { Authorization: `Bearer ${getToken() ?? ""}` }
      });
      await loadPropertyAndWorksheet(propertyId, Number(year));
      addToast("green", "CAD evidence uploaded");
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingEvidence(false);
    }
  }, [propertyId, year, loadPropertyAndWorksheet, addToast]);

  const deleteCadEvidence = useCallback(async () => {
    if (!propertyId) return;
    setUploadingEvidence(true);
    try {
      await fetch(`/api/protest/${encodeURIComponent(propertyId)}/cad-evidence?taxYear=${year}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` }
      });
      await loadPropertyAndWorksheet(propertyId, Number(year));
      addToast("green", "CAD evidence removed");
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Delete failed");
    } finally {
      setUploadingEvidence(false);
    }
  }, [propertyId, year, loadPropertyAndWorksheet, addToast]);

  const saveSoldCompNote = useCallback(async (address: string, notes: string) => {
    if (!propertyId) return;
    try {
      await fetch(`/api/protest/${encodeURIComponent(propertyId)}/sold-comps/notes?taxYear=${year}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`
        },
        body: JSON.stringify({ address, notes })
      });
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Failed to save note");
    }
  }, [propertyId, year, addToast]);

  const saveEquityCompNote = useCallback(async (cadPropertyId: string, notes: string) => {
    if (!propertyId) return;
    try {
      await fetch(`/api/protest/${encodeURIComponent(propertyId)}/comps/${encodeURIComponent(cadPropertyId)}/notes?taxYear=${year}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`
        },
        body: JSON.stringify({ notes })
      });
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Failed to save note");
    }
  }, [propertyId, year, addToast]);

  const resetAddCompModal = useCallback(() => {
    setAddCompStep("search");
    setAddCompAddress("");
    setAddCompCity("");
    setAddCompSqft("");
    setAddCompBeds("");
    setAddCompBaths("");
    setAddCompYearBuilt("");
    setAddCompAssessed("");
    setCadSearchResults([]);
    setSelectedCadResult(null);
    setCadHasAdapter(true);
    setCadSearchLoading(false);
  }, []);

  const refreshComps = useCallback(async () => {
    if (!propertyId) return;
    setRefreshingComps(true);
    try {
      const res = await apiJson<{
        cad: { ok: boolean; count: number; message?: string };
        redfin: { ok: boolean; code?: string; message?: string; estimate?: number };
        comps: CADComp[];
        soldComps: SoldComp[];
        soldCompsCadFetched?: number;
      }>(`/api/protest/${encodeURIComponent(propertyId)}/refresh-comps`, {
        method: "POST",
        body: JSON.stringify({ year: Number(year) })
      });
      if (Array.isArray(res.comps)) setComps(res.comps);
      if (Array.isArray(res.soldComps)) setSoldComps(res.soldComps);
      const msgs: string[] = [];
      if (res.cad.ok) msgs.push(`${res.cad.count} CAD comp${res.cad.count !== 1 ? "s" : ""}`);
      else if (res.cad.message) msgs.push(`CAD: ${res.cad.message}`);
      if (res.redfin.ok) msgs.push("Redfin updated");
      else if (res.redfin.code === "RATE_LIMITED") msgs.push("Redfin refreshed < 24h ago");
      else if (res.redfin.message) msgs.push(`Redfin: ${res.redfin.message}`);
      if (res.soldCompsCadFetched) msgs.push(`${res.soldCompsCadFetched} §41.43 values`);
      addToast(res.cad.ok || res.redfin.ok ? "green" : "yellow", msgs.join(" · ") || "Refreshed");
    } catch {
      addToast("red", "Comps refresh failed");
    } finally {
      setRefreshingComps(false);
    }
  }, [propertyId, year, addToast]);

  const searchCad = useCallback(async () => {
    if (!propertyId || !addCompAddress.trim()) return;
    setCadSearchLoading(true);
    setCadSearchResults([]);
    setSelectedCadResult(null);
    try {
      const res = await apiJson<{ results: CadSearchResult[]; hasAdapter: boolean }>(
        `/api/protest/${encodeURIComponent(propertyId)}/cad-search?address=${encodeURIComponent(addCompAddress.trim())}&year=${year}`
      );
      setCadHasAdapter(res.hasAdapter);
      if (!res.hasAdapter) {
        setAddCompStep("manual");
      } else {
        setCadSearchResults(res.results);
        setAddCompStep("results");
      }
    } catch {
      addToast("red", "CAD search failed");
    } finally {
      setCadSearchLoading(false);
    }
  }, [propertyId, addCompAddress, year, addToast]);

  const submitAddComp = useCallback(async () => {
    if (!propertyId) return;
    if (!selectedCadResult && !addCompAddress.trim()) return;
    setAddingComp(true);
    try {
      let body: Record<string, unknown>;
      if (selectedCadResult) {
        body = {
          year: Number(year),
          cadPropertyId: selectedCadResult.cadPropertyId,
          addressLine1: selectedCadResult.address ?? addCompAddress.trim(),
          city: selectedCadResult.city,
          sqft: selectedCadResult.sqft,
          beds: selectedCadResult.beds,
          baths: selectedCadResult.baths,
          yearBuilt: selectedCadResult.yearBuilt,
          assessedValueUsd: selectedCadResult.assessedValue,
          marketValueUsd: selectedCadResult.marketValue,
        };
      } else {
        body = {
          year: Number(year),
          addressLine1: addCompAddress.trim(),
          city: addCompCity.trim() || null,
          sqft: addCompSqft !== "" ? Number(addCompSqft) : null,
          beds: addCompBeds !== "" ? Number(addCompBeds) : null,
          baths: addCompBaths !== "" ? Number(addCompBaths) : null,
          yearBuilt: addCompYearBuilt !== "" ? Number(addCompYearBuilt) : null,
          assessedValueUsd: addCompAssessed !== "" ? Number(addCompAssessed) : null,
        };
      }
      const res = await apiJson<{ ok: boolean; comps: CADComp[] }>(
        `/api/protest/${encodeURIComponent(propertyId)}/comps`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (Array.isArray(res.comps)) setComps(res.comps);
      addToast("green", "Comp added");
      resetAddCompModal();
      setAddCompOpen(false);
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Failed to add comp");
    } finally {
      setAddingComp(false);
    }
  }, [propertyId, year, selectedCadResult, addCompAddress, addCompCity, addCompSqft, addCompBeds, addCompBaths, addCompYearBuilt, addCompAssessed, addToast, resetAddCompModal]);

  const send = useCallback(async () => {
    if (!propertyId || !worksheet) return;
    const bodyText = message.trim();
    if (!bodyText) return;
    const optimistic: ChatTurnUI = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: bodyText,
      ts: new Date().toISOString(),
      attachmentType: pendingAttachment?.type,
      optimistic: true
    };
    setChat((prev) => [...prev, optimistic]);
    setMessage("");
    const attachment = pendingAttachment;
    setPendingAttachment(null);
    setSending(true);
    setThinking(true);
    try {
      const res = await apiJson<ChatResponse>(
        `/api/protest/${encodeURIComponent(propertyId)}/chat`,
        {
          method: "POST",
          body: JSON.stringify({
            message: bodyText,
            attachmentText: attachment?.text,
            attachmentType: attachment?.type,
            year: Number(year)
          })
        }
      );
      setChat((prev) => [
        ...prev.map((t) => (t.id === optimistic.id ? { ...t, optimistic: false } : t)),
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: res.assistantMessage,
          ts: new Date().toISOString()
        }
      ]);
      if (res.strategyUpdated) {
        const wsRes = await apiJson<WorksheetResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/worksheet?year=${Number(year)}`
        );
        setWorksheet(wsRes.worksheet);
      }
      if (res.compsAdded > 0) {
        addToast("green", `Fetched ${res.compsAdded} comparable properties from DCAD.`);
        const compsRes = await apiJson<CompsResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/comps?year=${Number(year)}`
        ).catch(() => ({ comps: [] as CADComp[] }));
        setComps(compsRes.comps);
      }
      if (res.soldCompsRefreshed) {
        addToast("green", "Redfin data refreshed — comparable sold prices updated.");
        setStaleAlertDismissed(true);
        const soldCompsRes = await apiJson<SoldCompsResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/sold-comps?year=${Number(year)}`
        ).catch(() => ({ comps: [] as SoldComp[], excluded: [] as string[] }));
        setSoldComps(soldCompsRes.comps);
        setExcludedSoldComps(soldCompsRes.excluded ?? []);
      }
    } catch (err) {
      setChat((prev) => prev.filter((t) => t.id !== optimistic.id));
      addToast("red", err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
      setThinking(false);
    }
  }, [propertyId, worksheet, message, pendingAttachment, year, addToast]);

  const updateWorksheet = useCallback(
    async (patch: {
      status?: ProtestStatus;
      outcome?: ProtestOutcome | null;
      informalOfferUsd?: number | null;
      hearingDate?: string | null;
      filingDeadline?: string | null;
      cadPortalUrl?: string | null;
    }) => {
      if (!propertyId || !worksheet) return;
      try {
        const res = await apiJson<WorksheetResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/worksheet`,
          {
            method: "PATCH",
            body: JSON.stringify({ year: Number(year), ...patch })
          }
        );
        setWorksheet(res.worksheet);
        setHearingDraft(res.worksheet.hearingDate ?? "");
        setFilingDeadlineDraft(res.worksheet.filingDeadline ?? "");
        setCadPortalUrlDraft(res.worksheet.cadPortalUrl ?? "");
        if (patch.status && patch.status !== "informal") {
          setInformalOfferDraft("");
        }
      } catch (err) {
        addToast("red", err instanceof Error ? err.message : "Failed to update worksheet");
      }
    },
    [propertyId, worksheet, year, addToast]
  );

  const onPickTextFile = useCallback(
    (file: File) => {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        addToast(
          "yellow",
          "PDF extraction coming soon — paste the text content from your PDF for now"
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setPendingAttachment({ type: "text", text, label: file.name });
      };
      reader.onerror = () => addToast("red", "Could not read attachment");
      reader.readAsText(file);
    },
    [addToast]
  );

  const handleDownload = useCallback(async () => {
    if (!propertyId) return;
    setDownloading(true);
    try {
      const tok = getToken();
      const res = await fetch(`/api/protest/${propertyId}/evidence-packet?year=${year}&format=${docFormat}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {}
      });
      if (!res.ok) throw new Error(`Document generation failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ARB_Evidence_${year}.${docFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Failed to generate document");
    } finally {
      setDownloading(false);
    }
  }, [propertyId, year, docFormat, addToast]);

  if (!token) return <Navigate to="/" replace />;
  if (loading) return <GrovePageLoader label="Loading protest assistant…" />;

  const propertyLabel =
    property != null
      ? [property.addressLine1, property.city, property.state].filter(Boolean).join(", ")
      : "No property";

  return (
    <Stack gap="md">
      {/* Toast stack */}
      {toasts.length > 0 ? (
        <Stack
          gap={6}
          style={{ position: "fixed", right: 18, top: 72, zIndex: 2000, width: 340 }}
        >
          {toasts.map((toast) => (
            <Alert
              key={toast.id}
              color={toast.color}
              withCloseButton
              onClose={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            >
              {toast.message}
            </Alert>
          ))}
        </Stack>
      ) : null}

      {error ? <Alert color="red">{error}</Alert> : null}

      {/* Property switcher + year + export */}
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end" gap="sm">
          <Select
            label="Property"
            value={propertyId}
            data={properties.map((p) => ({
              value: p.id,
              label: `${p.addressLine1 ?? "Unnamed"}${p.city ? `, ${p.city}` : ""}`
            }))}
            onChange={(next) => {
              if (!next) return;
              setPropertyId(next);
              setSearchParams({ property: next });
            }}
            w={280}
          />
          <Select
            label="Tax Year"
            value={year}
            onChange={(v) => setYear(v ?? "2026")}
            data={[
              { value: "2024", label: "2024" },
              { value: "2025", label: "2025" },
              { value: "2026", label: "2026" }
            ]}
            w={100}
          />
        </Group>
        <Group gap="xs" align="flex-end">
          <SegmentedControl
            value={docFormat}
            onChange={(v) => setDocFormat(v as "pdf" | "docx")}
            data={[{ label: "PDF", value: "pdf" }, { label: "Word", value: "docx" }]}
            size="sm"
          />
          <Button
            leftSection={<IconFileText size={16} />}
            variant="default"
            loading={downloading}
            disabled={!propertyId}
            onClick={handleDownload}
          >
            Generate Document
          </Button>
        </Group>
      </Group>

      {/* Deadline banner */}
      {worksheet?.hearingDate != null && hearingDays != null && hearingDays <= 30 ? (
        <Alert
          color={hearingDays <= 7 ? "red" : "yellow"}
          icon={<IconCalendarEvent size={16} />}
          title="Upcoming ARB Hearing"
        >
          {propertyLabel} · {formatDate(worksheet.hearingDate)} ·{" "}
          <strong>{hearingDays} days away</strong>
        </Alert>
      ) : null}

      {/* Stale comps banner */}
      {!staleAlertDismissed && property?.valuationFetchedAt != null &&
        (Date.now() - new Date(property.valuationFetchedAt).getTime()) > 7 * 24 * 60 * 60 * 1000 ? (
        <Alert
          color="yellow"
          withCloseButton
          onClose={() => setStaleAlertDismissed(true)}
          title="Redfin data may be outdated"
        >
          {`Sold comps were last fetched ${Math.floor((Date.now() - new Date(property.valuationFetchedAt!).getTime()) / (1000 * 60 * 60 * 24))} day(s) ago. Use the Refresh button in the comps section to fetch the latest data.`}
        </Alert>
      ) : null}

      {/* Signal card */}
      <Card withBorder radius="md" p="md">
        <Stack gap={8}>
          <Group justify="space-between">
            <div>
              <Title order={3} style={{ fontSize: 17 }}>
                {property?.addressLine1 ?? "Select a property"}
              </Title>
              <Text c="dimmed" size="sm">
                {[property?.city, property?.state, property?.zip].filter(Boolean).join(", ")}
              </Text>
            </div>
            {overPct != null ? (
              <Badge
                color={overPct > 3 ? "yellow" : "green"}
                variant="light"
                size="lg"
              >
                {overPct > 0 ? "+" : ""}
                {overPct.toFixed(1)}% vs AVM
              </Badge>
            ) : null}
          </Group>

          <Grid>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">CAD Assessed</Text>
              <Text fw={700} size="sm">{money(cadAssessed)}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">AVM (Redfin)</Text>
              <Text fw={700} size="sm">{money(avm)}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Est. Annual Savings</Text>
              <Text fw={700} size="sm" c={annualSavings != null && annualSavings > 0 ? "green" : undefined}>
                {annualSavings != null ? money(annualSavings) + "/yr" : "—"}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Sqft</Text>
              <Text fw={700} size="sm">
                {subjectSqft != null ? subjectSqft.toLocaleString() : "—"}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Beds / Baths</Text>
              <Text fw={700} size="sm">
                {asNumber(subject?.beds) ?? "—"} / {asNumber(subject?.baths) ?? "—"}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Year Built</Text>
              <Text fw={700} size="sm">{asNumber(subject?.yearBuilt) ?? "—"}</Text>
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      {/* Market Value Evidence table — Redfin comparable sold prices */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>Market Value Evidence</Title>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {soldComps.length > 0
                  ? `${visibleSoldComps.length} Redfin comparable sales${soldComps.length > visibleSoldComps.length ? ` (${soldComps.length - visibleSoldComps.length} hidden)` : ""}`
                  : "No Redfin comps loaded"}
              </Text>
              <Button
                size="xs"
                variant="subtle"
                loading={refreshingComps}
                leftSection={<IconRefresh size={13} />}
                onClick={() => void refreshComps()}
              >
                Refresh
              </Button>
            </Group>
          </Group>
          {soldComps.length > 0 ? (
            <>
              <Box style={{ overflowX: "auto" }}>
                <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Address</Table.Th>
                      <Table.Th>City</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Sqft</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Beds</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Baths</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Sold Price</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>$/sqft</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Sold Date</Table.Th>
                      {(property?.state ?? "").toUpperCase() === "TX" && (
                        <>
                          <Table.Th style={{ textAlign: "right" }}>
                            <Tooltip label="CAD-assessed value for this comp (§41.43)" withArrow>
                              <span>CAD Assessed</span>
                            </Tooltip>
                          </Table.Th>
                          <Table.Th style={{ textAlign: "right" }}>
                            <Tooltip label="CAD Assessed ÷ Sold Price. Green = comp assessed lower than subject (supports §41.43 unequal appraisal)" withArrow>
                              <span>§41.43 Ratio</span>
                            </Tooltip>
                          </Table.Th>
                        </>
                      )}
                      <Table.Th style={{ textAlign: "right" }}>vs Subject</Table.Th>
                      <Table.Th style={{ width: 36 }} />
                      <Table.Th style={{ width: 36 }} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleSoldComps.map((comp, idx) => {
                      const color = vsSubjectColor(comp.pricePerSqft, subjectMarketPpsf);
                      const subjectRatio = cadAssessed != null && avm != null && avm > 0 ? cadAssessed / avm : null;
                      const compRatio = comp.cadAssessedValueUsd != null && comp.soldPrice != null && comp.soldPrice > 0
                        ? comp.cadAssessedValueUsd / comp.soldPrice
                        : null;
                      const ratioColor = compRatio != null && subjectRatio != null
                        ? (compRatio < subjectRatio ? "green" : "red")
                        : undefined;
                      return (
                        <Table.Tr key={`${comp.address ?? ""}-${idx}`}>
                          <Table.Td>{comp.address ?? "—"}</Table.Td>
                          <Table.Td>{comp.city ?? "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {comp.sqft != null ? comp.sqft.toLocaleString() : "—"}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{comp.beds ?? "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{comp.baths ?? "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {comp.soldPrice != null ? (
                              money(comp.soldPrice)
                            ) : comp.listPrice != null ? (
                              <Text size="xs" c="dimmed">Listed: {money(comp.listPrice)}</Text>
                            ) : (
                              "—"
                            )}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {ppsf(comp.pricePerSqft)}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {comp.soldDate ?? "—"}
                          </Table.Td>
                          {(property?.state ?? "").toUpperCase() === "TX" && (
                            <>
                              <Table.Td style={{ textAlign: "right" }}>
                                {comp.cadAssessedValueUsd != null ? money(comp.cadAssessedValueUsd) : "—"}
                              </Table.Td>
                              <Table.Td style={{ textAlign: "right" }}>
                                {compRatio != null ? (
                                  <Text size="xs" c={ratioColor} fw={ratioColor ? 600 : undefined}>
                                    {(compRatio * 100).toFixed(1)}%
                                  </Text>
                                ) : "—"}
                              </Table.Td>
                            </>
                          )}
                          <Table.Td style={{ textAlign: "right" }}>
                            <Text size="xs" c={color} fw={color ? 600 : undefined}>
                              {vsSubjectLabel(comp.pricePerSqft, subjectMarketPpsf)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {comp.address && (
                              <CompNotePopover
                                note={soldCompsNotes[comp.address] ?? null}
                                onSave={(v) => {
                                  setSoldCompsNotes((prev) => ({ ...prev, [comp.address!]: v }));
                                  void saveSoldCompNote(comp.address!, v);
                                }}
                              />
                            )}
                          </Table.Td>
                          <Table.Td>
                            {comp.address ? (
                              <Tooltip label="Remove from evidence" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  size="sm"
                                  onClick={() => void removeSoldComp(comp.address!)}
                                  aria-label="Remove comp"
                                >
                                  <IconTrash size={13} />
                                </ActionIcon>
                              </Tooltip>
                            ) : null}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                    {/* Subject row */}
                    <Table.Tr bg={colorScheme === "dark" ? "blue.9" : "blue.0"}>
                      <Table.Td fw={700}>{property?.addressLine1 ?? "Subject"}</Table.Td>
                      <Table.Td fw={700}>{property?.city ?? "—"}</Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {subjectSqft != null ? subjectSqft.toLocaleString() : "—"}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {asNumber(subject?.beds) ?? "—"}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {asNumber(subject?.baths) ?? "—"}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {money(avm)} <Text size="xs" c="dimmed" span>(AVM)</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {ppsf(subjectMarketPpsf)}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>—</Table.Td>
                      {(property?.state ?? "").toUpperCase() === "TX" && (
                        <>
                          <Table.Td style={{ textAlign: "right" }} fw={700}>
                            {cadAssessed != null ? money(cadAssessed) : "—"}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }} fw={700}>
                            {cadAssessed != null && avm != null && avm > 0
                              ? `${((cadAssessed / avm) * 100).toFixed(1)}%`
                              : "—"}
                          </Table.Td>
                        </>
                      )}
                      <Table.Td style={{ textAlign: "right" }}>
                        <Badge size="xs" variant="light">Subject</Badge>
                      </Table.Td>
                      <Table.Td />
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Box>
              <Text size="xs" c="dimmed">
                Comparable sold prices from Redfin. Texas is a non-disclosure state — sold prices may not be available for all properties. Ask the protest assistant to refresh Redfin data or search for additional evidence.
              </Text>
            </>
          ) : (
            <Paper withBorder p="md" radius="md">
              <Stack align="center" gap="xs">
                <Text size="sm" c="dimmed">No Redfin comparable sales loaded.</Text>
                <Text size="xs" c="dimmed" ta="center">
                  Redfin comps load from your property valuation data.
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  loading={refreshingComps}
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => void refreshComps()}
                >
                  Refresh Comps
                </Button>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Card>

      {/* Unequal Appraisal Evidence table */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>Unequal Appraisal Evidence</Title>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {comps.length > 0 ? `${comps.length} DCAD comparable properties` : "No comps loaded"}
              </Text>
              <Button
                size="xs"
                variant="subtle"
                loading={refreshingComps}
                leftSection={<IconRefresh size={13} />}
                onClick={() => void refreshComps()}
              >
                Refresh
              </Button>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={13} />}
                onClick={() => setAddCompOpen(true)}
              >
                Add Comp
              </Button>
            </Group>
          </Group>
          {comps.length > 0 ? (
            <Box style={{ overflowX: "auto" }}>
              <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Address</Table.Th>
                    <Table.Th>City</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Sqft</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Beds</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Baths</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>CAD Assessed</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>$/sqft</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>vs Subject</Table.Th>
                    <Table.Th style={{ width: 36 }} />
                    <Table.Th style={{ width: 36 }} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {comps.map((comp) => {
                    const color = vsSubjectColor(comp.perSqftUsd, subjectAssessedPpsf);
                    return (
                      <Table.Tr key={comp.cadPropertyId}>
                        <Table.Td>{comp.addressLine1 ?? "—"}</Table.Td>
                        <Table.Td>{comp.city ?? "—"}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          {comp.sqft != null ? comp.sqft.toLocaleString() : "—"}
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>{comp.beds ?? "—"}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>{comp.baths ?? "—"}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          {money(comp.assessedValueUsd)}
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>{ppsf(comp.perSqftUsd)}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          <Text size="xs" c={color} fw={color ? 600 : undefined}>
                            {vsSubjectLabel(comp.perSqftUsd, subjectAssessedPpsf)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <CompNotePopover
                            note={comp.notes}
                            onSave={(v) => {
                              setComps((prev) => prev.map((c) => c.cadPropertyId === comp.cadPropertyId ? { ...c, notes: v } : c));
                              void saveEquityCompNote(comp.cadPropertyId, v);
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label="Remove comp" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              loading={removingCompId === comp.cadPropertyId}
                              onClick={() => void removeCADComp(comp.cadPropertyId)}
                              aria-label="Remove comp"
                            >
                              <IconTrash size={13} />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {/* Subject row */}
                  <Table.Tr bg={colorScheme === "dark" ? "blue.9" : "blue.0"}>
                    <Table.Td fw={700}>
                      {property?.addressLine1 ?? "Subject"}
                    </Table.Td>
                    <Table.Td fw={700}>{property?.city ?? "—"}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {subjectSqft != null ? subjectSqft.toLocaleString() : "—"}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {asNumber(subject?.beds) ?? "—"}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {asNumber(subject?.baths) ?? "—"}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {money(cadAssessed)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {ppsf(subjectAssessedPpsf)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      <Badge size="xs" variant="light">Subject</Badge>
                    </Table.Td>
                    <Table.Td />
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Box>
          ) : (
            <Paper withBorder p="md" radius="md">
              <Stack align="center" gap="xs">
                <Text size="sm" c="dimmed">No DCAD comparable properties loaded.</Text>
                <Text size="xs" c="dimmed">
                  DCAD comps are fetched automatically for TX properties or can be requested via the protest assistant.
                </Text>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Card>

      {/* CAD Evidence Card */}
      <Card withBorder shadow="xs" radius="md" p="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600} size="sm">CAD Evidence Packet</Text>
          <Group gap="xs">
            {cadEvidence && worksheet?.cadEvidenceFilename && (
              <Text size="xs" c="dimmed">{worksheet.cadEvidenceFilename}</Text>
            )}
            <input
              type="file"
              accept=".pdf"
              ref={cadEvidenceFileRef}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) void uploadCadEvidence(file);
                e.currentTarget.value = "";
              }}
            />
            <Button
              size="xs"
              variant="light"
              loading={uploadingEvidence}
              onClick={() => cadEvidenceFileRef.current?.click()}
            >
              {cadEvidence ? "Re-upload PDF" : "Upload Evidence PDF"}
            </Button>
            {cadEvidence && (
              <Tooltip label="Remove evidence" withArrow>
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => void deleteCadEvidence()}>
                  <IconTrash size={13} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>

        {!cadEvidence && (
          <Text size="xs" c="dimmed">
            Upload the official DCAD evidence packet PDF (the one DCAD emails before your ARB hearing).
            The app will extract DCAD's own comps and feed them to the AI assistant.
          </Text>
        )}

        {cadEvidence && (
          <Stack gap="sm">
            {/* §41.43 insight badge */}
            {cadEvidence.equityAnalysis.medianIndValueUsd != null && cadAssessed != null && (
              <Alert
                color={cadEvidence.equityAnalysis.medianIndValueUsd < cadAssessed ? "green" : "orange"}
                variant="light"
                radius="sm"
              >
                <Text size="xs" fw={600}>
                  §41.43 Signal: CAD equity median {money(cadEvidence.equityAnalysis.medianIndValueUsd)} vs. your assessed {money(cadAssessed)}
                  {" → "}
                  {cadEvidence.equityAnalysis.medianIndValueUsd < cadAssessed
                    ? `${money(cadAssessed - cadEvidence.equityAnalysis.medianIndValueUsd)} over-assessed — §41.43 argument supported`
                    : `${money(cadEvidence.equityAnalysis.medianIndValueUsd - cadAssessed)} under equity median`}
                </Text>
              </Alert>
            )}

            {/* CAD Sales Analysis comps */}
            {cadEvidence.salesAnalysis.comps.length > 0 && (
              <>
                <Group gap="xs">
                  <Text size="xs" fw={600}>DCAD Sales Analysis (§41.41)</Text>
                  {cadEvidence.salesAnalysis.medianIndValueUsd != null && (
                    <Badge size="xs" variant="light" color="blue">
                      Median ind. {money(cadEvidence.salesAnalysis.medianIndValueUsd)}
                    </Badge>
                  )}
                </Group>
                <Box style={{ overflowX: "auto" }}>
                  <Table withTableBorder withColumnBorders fz="xs" striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>#</Table.Th>
                        <Table.Th>Address</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>Distance</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>Sale Date</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>Sale Price</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>DCAD Market</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>Ind. Value</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {cadEvidence.salesAnalysis.comps.map((c) => (
                        <Table.Tr key={c.compNum}>
                          <Table.Td>{c.compNum}</Table.Td>
                          <Table.Td>{c.address}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{c.distanceMi != null ? `${c.distanceMi} mi` : "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{c.saleDate ?? "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{money(c.salePriceUsd)}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{money(c.cadMarketValueUsd)}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{money(c.cadIndValueUsd)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Box>
              </>
            )}

            {/* CAD Equity Analysis comps */}
            {cadEvidence.equityAnalysis.comps.length > 0 && (
              <>
                <Group gap="xs">
                  <Text size="xs" fw={600}>DCAD Equity Analysis (§41.43)</Text>
                  {cadEvidence.equityAnalysis.medianIndValueUsd != null && (
                    <Badge size="xs" variant="light" color="teal">
                      Median ind. {money(cadEvidence.equityAnalysis.medianIndValueUsd)}
                    </Badge>
                  )}
                </Group>
                <Box style={{ overflowX: "auto" }}>
                  <Table withTableBorder withColumnBorders fz="xs" striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>#</Table.Th>
                        <Table.Th>Address</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>Distance</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>DCAD Market</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>Ind. Value</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {cadEvidence.equityAnalysis.comps.map((c) => {
                        const isOverAssessed = cadEvidence.equityAnalysis.medianIndValueUsd != null && cadAssessed != null && cadAssessed > cadEvidence.equityAnalysis.medianIndValueUsd;
                        return (
                          <Table.Tr key={c.compNum}>
                            <Table.Td>{c.compNum}</Table.Td>
                            <Table.Td>{c.address}</Table.Td>
                            <Table.Td style={{ textAlign: "right" }}>{c.distanceMi != null ? `${c.distanceMi} mi` : "—"}</Table.Td>
                            <Table.Td style={{ textAlign: "right" }}>{money(c.cadMarketValueUsd)}</Table.Td>
                            <Table.Td style={{ textAlign: "right" }}>
                              <Text size="xs" c={isOverAssessed && c.cadIndValueUsd != null && cadAssessed != null && c.cadIndValueUsd < cadAssessed ? "green" : undefined} fw={isOverAssessed ? 600 : undefined}>
                                {money(c.cadIndValueUsd)}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Box>
              </>
            )}
          </Stack>
        )}
      </Card>

      {/* Strategy panel — only when AI has generated a strategy */}
      {worksheet?.strategyJson ? (
        <Card withBorder radius="md" p="md">
          <Stack gap="sm">
            <Title order={4}>AI Strategy Analysis</Title>
            <Group gap="xl">
              <div style={{ flex: 1 }}>
                <Text size="xs" c="dimmed" mb={4}>
                  Case strength ({worksheet.strategyJson.caseStrength.toFixed(1)}/10)
                </Text>
                <Progress
                  value={Math.max(
                    0,
                    Math.min(100, (worksheet.strategyJson.caseStrength / 10) * 100)
                  )}
                  color={
                    worksheet.strategyJson.caseStrength >= 7
                      ? "green"
                      : worksheet.strategyJson.caseStrength >= 4
                      ? "yellow"
                      : "red"
                  }
                  size="md"
                />
              </div>
              <div>
                <Text size="xs" c="dimmed">Target Value</Text>
                <Text fw={700}>{money(worksheet.strategyJson.targetValueUsd)}</Text>
              </div>
            </Group>
            <div>
              <Text size="sm" c="dimmed" mb={2}>Primary approach</Text>
              <Text size="sm">{worksheet.strategyJson.primaryStrategy}</Text>
            </div>
            <div>
              <Text size="sm" fw={600} mb={6}>Draft arguments</Text>
              <List size="sm" spacing={4}>
                {worksheet.strategyJson.draftArguments.map((arg, idx) => (
                  <List.Item key={`${idx}-${arg.slice(0, 16)}`}>{arg}</List.Item>
                ))}
              </List>
            </div>
            {worksheet.strategyJson.redFlags.length > 0 ? (
              <Alert color="orange" title="Red flags">
                <List size="sm">
                  {worksheet.strategyJson.redFlags.map((flag, idx) => (
                    <List.Item key={`${idx}-${flag.slice(0, 20)}`}>{flag}</List.Item>
                  ))}
                </List>
              </Alert>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {/* Protest tracker */}
      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Title order={4}>Protest Status</Title>
          <Stepper
            active={worksheet ? statusIndex(worksheet.status, worksheet.outcome) : 0}
            size="xs"
            iconSize={20}
          >
            <Stepper.Step label="Not Filed" />
            <Stepper.Step label="Filed" />
            <Stepper.Step label="Informal Offer" />
            <Stepper.Step label="ARB Hearing" />
            <Stepper.Step label="Resolved" />
          </Stepper>

          {worksheet?.filingDeadline != null &&
            filingDeadlineDays != null &&
            filingDeadlineDays >= 0 &&
            filingDeadlineDays <= 7 &&
            worksheet.status !== "resolved" ? (
            <Alert color="red" icon={<IconCalendarEvent size={16} />} title="Filing Deadline Approaching">
              Protest filing deadline for {propertyLabel} is{" "}
              <strong>{filingDeadlineDays === 0 ? "today" : filingDeadlineDays === 1 ? "tomorrow" : `in ${filingDeadlineDays} days`}</strong>{" "}
              ({formatDate(worksheet.filingDeadline)}).
            </Alert>
          ) : null}

          {/* Contextual status actions */}
          {worksheet ? (
            <Stack gap="xs">
              {worksheet.status === "not_filed" ? (
                <Group>
                  <Button
                    size="sm"
                    variant="filled"
                    onClick={() => void updateWorksheet({ status: "filed" })}
                  >
                    Mark as Filed
                  </Button>
                </Group>
              ) : worksheet.status === "filed" ? (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>Informal offer received?</Text>
                  <Group align="flex-end">
                    <NumberInput
                      label="Appraiser's offer amount (optional)"
                      placeholder="e.g. 485000"
                      prefix="$"
                      value={informalOfferDraft}
                      onChange={(v) => setInformalOfferDraft(typeof v === "number" ? v : "")}
                      min={0}
                      thousandSeparator=","
                      w={240}
                      size="sm"
                    />
                    <Button
                      size="sm"
                      variant="filled"
                      onClick={() =>
                        void updateWorksheet({
                          status: "informal",
                          informalOfferUsd: typeof informalOfferDraft === "number" ? informalOfferDraft : null
                        })
                      }
                    >
                      Informal Offer Received
                    </Button>
                  </Group>
                </Stack>
              ) : worksheet.status === "informal" ? (
                <Stack gap="xs">
                  {worksheet.informalOfferUsd != null ? (
                    <Text size="sm">
                      Appraiser&apos;s offer: <strong>{money(worksheet.informalOfferUsd)}</strong>
                    </Text>
                  ) : null}
                  <Group>
                    <Button
                      size="sm"
                      color="green"
                      variant="filled"
                      onClick={() =>
                        void updateWorksheet({ status: "resolved", outcome: "settled_informal" })
                      }
                    >
                      Accept Offer — Settle
                    </Button>
                    <Button
                      size="sm"
                      color="orange"
                      variant="outline"
                      onClick={() => void updateWorksheet({ status: "arb" })}
                    >
                      Reject — Escalate to ARB
                    </Button>
                  </Group>
                </Stack>
              ) : worksheet.status === "arb" ? (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>ARB hearing outcome</Text>
                  <Group>
                    <Button
                      size="sm"
                      color="green"
                      variant="filled"
                      onClick={() =>
                        void updateWorksheet({ status: "resolved", outcome: "won_arb" })
                      }
                    >
                      Won at ARB
                    </Button>
                    <Button
                      size="sm"
                      color="red"
                      variant="filled"
                      onClick={() =>
                        void updateWorksheet({ status: "resolved", outcome: "lost_arb" })
                      }
                    >
                      Lost at ARB
                    </Button>
                    <Button
                      size="sm"
                      color="gray"
                      variant="outline"
                      onClick={() =>
                        void updateWorksheet({ status: "resolved", outcome: "withdrawn" })
                      }
                    >
                      Withdrew Protest
                    </Button>
                  </Group>
                </Stack>
              ) : worksheet.status === "resolved" ? (
                <Stack gap="xs">
                  <Group align="center">
                    <Badge size="lg" color={outcomeColor(worksheet.outcome)}>
                      {outcomeLabel(worksheet.outcome)}
                    </Badge>
                    {worksheet.outcome === "settled_informal" && worksheet.informalOfferUsd != null ? (
                      <Text size="sm" c="dimmed">
                        Settlement value: {money(worksheet.informalOfferUsd)}
                      </Text>
                    ) : null}
                  </Group>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={() =>
                      void updateWorksheet({ status: "not_filed", outcome: null })
                    }
                  >
                    Reset protest status
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          ) : null}

          <Divider />

          <Grid>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="Hearing Date"
                type="date"
                value={hearingDraft}
                onChange={(e) => setHearingDraft(e.currentTarget.value)}
                onBlur={() => {
                  if (!worksheet) return;
                  const next = hearingDraft.trim() || null;
                  if ((worksheet.hearingDate ?? null) !== next) {
                    void updateWorksheet({ hearingDate: next });
                  }
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="Filing Deadline"
                type="date"
                value={filingDeadlineDraft}
                onChange={(e) => setFilingDeadlineDraft(e.currentTarget.value)}
                onBlur={() => {
                  if (!worksheet) return;
                  const next = filingDeadlineDraft.trim() || null;
                  if ((worksheet.filingDeadline ?? null) !== next) {
                    void updateWorksheet({ filingDeadline: next });
                  }
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="CAD Portal URL"
                placeholder="https://www.dallascad.org/..."
                value={cadPortalUrlDraft}
                onChange={(e) => setCadPortalUrlDraft(e.currentTarget.value)}
                onBlur={() => {
                  if (!worksheet) return;
                  const next = cadPortalUrlDraft.trim() || null;
                  if ((worksheet.cadPortalUrl ?? null) !== next) {
                    void updateWorksheet({ cadPortalUrl: next });
                  }
                }}
                rightSection={
                  cadPortalUrlDraft ? (
                    <ActionIcon
                      variant="subtle"
                      component="a"
                      href={cadPortalUrlDraft}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconExternalLink size={16} />
                    </ActionIcon>
                  ) : null
                }
              />
            </Grid.Col>
          </Grid>
          {worksheet?.hearingDate ? (
            <Text size="sm" c="dimmed">
              Hearing: {formatDate(worksheet.hearingDate)}
              {hearingDays != null ? ` · ${hearingDays} days away` : ""}
            </Text>
          ) : null}
        </Stack>
      </Card>

      {/* Floating chat FAB — hidden when drawer is open */}
      {!chatOpen && (
        <Tooltip label="Protest Assistant" withArrow position="left">
          <ActionIcon
            radius="xl"
            size={56}
            style={{ position: "fixed", bottom: 28, right: 28, zIndex: 300 }}
            onClick={() => setChatOpen(true)}
          >
            <IconMessage size={26} />
          </ActionIcon>
        </Tooltip>
      )}

      {/* Add Comp modal */}
      <Modal
        opened={addCompOpen}
        onClose={() => { resetAddCompModal(); setAddCompOpen(false); }}
        title="Add Comparable Property"
        size="md"
      >
        {addCompStep === "search" && (
          <Stack gap="sm">
            <TextInput
              label="Address"
              required
              value={addCompAddress}
              onChange={(e) => setAddCompAddress(e.currentTarget.value)}
              placeholder="123 Oak Lane"
              onKeyDown={(e) => { if (e.key === "Enter" && addCompAddress.trim() && !cadSearchLoading) void searchCad(); }}
            />
            <Group justify="space-between" mt="xs">
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setAddCompStep("manual")}
              >
                Add manually instead
              </Button>
              <Button
                leftSection={cadSearchLoading ? <Loader size={14} color="white" /> : <IconSearch size={16} />}
                disabled={!addCompAddress.trim() || cadSearchLoading}
                onClick={() => void searchCad()}
              >
                Search CAD
              </Button>
            </Group>
          </Stack>
        )}

        {addCompStep === "results" && (
          <Stack gap="sm">
            {cadSearchResults.length === 0 ? (
              <Text size="sm" c="dimmed">No CAD records found for that address.</Text>
            ) : (
              cadSearchResults.map((r) => (
                <Card
                  key={r.cadPropertyId}
                  withBorder
                  style={{
                    cursor: "pointer",
                    borderColor: selectedCadResult?.cadPropertyId === r.cadPropertyId ? "var(--mantine-color-blue-5)" : undefined,
                    borderWidth: selectedCadResult?.cadPropertyId === r.cadPropertyId ? 2 : 1,
                  }}
                  onClick={() => setSelectedCadResult(r)}
                  p="sm"
                >
                  <Text fw={500} size="sm">
                    {r.address ?? "(no address)"}{r.city ? `, ${r.city}` : ""}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {[
                      r.sqft ? `${r.sqft.toLocaleString()} sqft` : null,
                      r.beds != null ? `${r.beds} bd` : null,
                      r.baths != null ? `${r.baths} ba` : null,
                      r.yearBuilt ? `Built ${r.yearBuilt}` : null,
                    ].filter(Boolean).join(" · ")}
                  </Text>
                  {(r.assessedValue != null || r.marketValue != null) && (
                    <Text size="xs" c="dimmed">
                      {r.assessedValue != null ? `Assessed: $${r.assessedValue.toLocaleString()}` : ""}
                      {r.marketValue != null ? `${r.assessedValue != null ? " · " : ""}Market: $${r.marketValue.toLocaleString()}` : ""}
                    </Text>
                  )}
                </Card>
              ))
            )}
            <Group justify="space-between" mt="xs">
              <Group gap="xs">
                <Button variant="subtle" size="sm" onClick={() => setAddCompStep("search")}>Back</Button>
                <Button variant="subtle" size="sm" onClick={() => setAddCompStep("manual")}>Enter manually</Button>
              </Group>
              <Button
                loading={addingComp}
                disabled={!selectedCadResult}
                onClick={() => void submitAddComp()}
              >
                Add Selected
              </Button>
            </Group>
          </Stack>
        )}

        {addCompStep === "manual" && (
          <Stack gap="sm">
            {!cadHasAdapter && (
              <Alert color="yellow" title="County not connected">
                This county isn&apos;t linked to a CAD database yet. Enter property details manually.
              </Alert>
            )}
            <TextInput
              label="Address"
              required
              value={addCompAddress}
              onChange={(e) => setAddCompAddress(e.currentTarget.value)}
              placeholder="123 Oak Lane"
            />
            <TextInput
              label="City"
              value={addCompCity}
              onChange={(e) => setAddCompCity(e.currentTarget.value)}
              placeholder="Dallas"
            />
            <Group grow>
              <NumberInput
                label="Sqft"
                value={addCompSqft}
                onChange={(v) => setAddCompSqft(v as number | "")}
                min={1}
                max={100000}
                thousandSeparator=","
              />
              <NumberInput
                label="Beds"
                value={addCompBeds}
                onChange={(v) => setAddCompBeds(v as number | "")}
                min={0}
                max={50}
                decimalScale={0}
              />
              <NumberInput
                label="Baths"
                value={addCompBaths}
                onChange={(v) => setAddCompBaths(v as number | "")}
                min={0}
                max={50}
                step={0.5}
              />
            </Group>
            <Group grow>
              <NumberInput
                label="Year Built"
                value={addCompYearBuilt}
                onChange={(v) => setAddCompYearBuilt(v as number | "")}
                min={1800}
                max={2100}
              />
              <NumberInput
                label="CAD Assessed Value ($)"
                value={addCompAssessed}
                onChange={(v) => setAddCompAssessed(v as number | "")}
                min={0}
                prefix="$"
                thousandSeparator=","
              />
            </Group>
            <Group justify="space-between" mt="xs">
              <Button variant="subtle" size="sm" onClick={() => setAddCompStep("search")}>Back</Button>
              <Button
                loading={addingComp}
                disabled={!addCompAddress.trim()}
                onClick={() => void submitAddComp()}
              >
                Add Comp
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Chat drawer */}
      <Drawer
        opened={chatOpen}
        onClose={() => setChatOpen(false)}
        position="right"
        size={400}
        title="Protest Assistant"
        styles={{ body: { display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", padding: "12px 16px" } }}
      >
        <ScrollArea style={{ flex: 1, minHeight: 0 }} pr={4} type="auto">
          <Stack gap="sm">
            {chat.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" mt="xl">
                Ask me to analyze your case, draft arguments, or fetch comparable properties.
              </Text>
            ) : null}
            {chat.map((turn) => (
              <Group key={turn.id} justify={turn.role === "user" ? "flex-end" : "flex-start"}>
                <Paper
                  radius="md"
                  p="sm"
                  bg={turn.role === "user" ? "forest.6" : colorScheme === "dark" ? "dark.5" : "gray.1"}
                  c={turn.role === "user" ? "white" : undefined}
                  maw="88%"
                >
                  <Stack gap={4}>
                    {turn.role === "assistant"
                      ? markdownLines(turn.content).map((line, idx) => (
                          <Text key={idx} size="sm">
                            {line || " "}
                          </Text>
                        ))
                      : <Text size="sm">{turn.content}</Text>}
                    {turn.attachmentType ? (
                      <Chip checked readOnly size="xs" variant="light">
                        <Group gap={4} align="center">
                          <IconPaperclip size={12} />
                          Attachment
                        </Group>
                      </Chip>
                    ) : null}
                  </Stack>
                </Paper>
              </Group>
            ))}
            {thinking ? (
              <Group justify="flex-start">
                <Paper radius="md" p="sm" bg={colorScheme === "dark" ? "dark.5" : "gray.1"}>
                  <Text size="sm" c="dimmed">Thinking…</Text>
                </Paper>
              </Group>
            ) : null}
            <div ref={bottomRef} />
          </Stack>
        </ScrollArea>

        <Stack gap={8} mt="sm" style={{ flexShrink: 0 }}>
          {pendingAttachment ? (
            <Group>
              <Chip checked readOnly size="xs">{pendingAttachment.label}</Chip>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setPendingAttachment(null)}
                aria-label="Remove attachment"
                size="sm"
              >
                <IconX size={14} />
              </ActionIcon>
            </Group>
          ) : null}
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
            placeholder="Ask about comps, arguments, strategy…"
            disabled={sending}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!sending) void send();
              }
            }}
          />
          <Group justify="space-between">
            <Group gap={4}>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept=".txt,.json,.csv"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (!file) return;
                  onPickTextFile(file);
                }}
              />
              <Tooltip label="Attach text file" withArrow>
                <ActionIcon
                  variant="default"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach text file"
                  disabled={sending}
                >
                  <IconPaperclip size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group gap="xs">
              <Text size="xs" c="dimmed">{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+↵</Text>
              <Button
                leftSection={<IconSend size={16} />}
                onClick={() => void send()}
                loading={sending}
                disabled={sending || message.trim().length === 0}
              >
                Send
              </Button>
            </Group>
          </Group>
        </Stack>
      </Drawer>
    </Stack>
  );
}
