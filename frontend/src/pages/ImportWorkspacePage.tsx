import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Collapse,
  Group,
  List,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconArrowBackUp, IconChevronDown, IconChevronRight, IconPlayerPlay, IconTrash, IconUpload } from "@tabler/icons-react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { apiFetch, apiJson, getToken } from "../api";
import { useCurrentUser } from "../UserContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { formatAccountForSelect, formatAccountFreshness } from "../import/accountDisplay";
import {
  inferParserProfile,
  profilesEquivalent,
  type FinancialAccountLike,
  type IncomeInferenceContext
} from "../import/inferParserProfile";
import { friendlyParserLabel, DISABLED_PROFILES } from "../import/profileLabels";

const PAYSLIP_PARSER_IDS = new Set(["ibm_pay_contributions_pdf", "deloitte_payslip_pdf", "adp_payslip_pdf"]);
const OFX_PARSER_ID = "ofx_transactions";

type OfxSuggestion = {
  matchedAccountId: string | null;
  matchedAccountLabel: string | null;
  acctIdLast4: string | null;
  normalizedAcctType: string | null;
  institution: string | null;
  ledgerBalance: number | null;
  ledgerBalanceDate: string | null;
};

type ImportFileRow = {
  id: string;
  file_name: string;
  status: string;
  financial_account_id: string | null;
  parser_profile_id: string | null;
  employer_id: string | null;
  owner_scope: "household" | "person";
  owner_person_profile_id: string | null;
};

type HouseholdEmployer = {
  id: string;
  displayName: string;
  parserProfileId?: string;
  salaryDepositFinancialAccountId?: string | null;
};

type FinancialAccount = {
  id: string;
  type: string;
  institution: string;
  account_mask: string | null;
  currency: string;
  owner_scope: "household" | "person";
  owner_person_profile_id: string | null;
  last_uploaded_at?: string | null;
  last_statement_end_date?: string | null;
};

type BelongsToChoice = "household" | `person:${string}`;

function parseBelongsToChoice(choice: string): { ownerScope: "household" | "person"; ownerPersonProfileId: string | null } {
  if (choice.startsWith("person:")) {
    const id = choice.slice("person:".length);
    if (id) {
      return { ownerScope: "person", ownerPersonProfileId: id };
    }
  }
  return { ownerScope: "household", ownerPersonProfileId: null };
}

function formatBelongsToLabel(label: string): string {
  return `Household > ${label}`;
}

function buildBelongsToGroups(ownerProfiles: Array<{ id: string; label: string }>): HierarchicalPickerGroup[] {
  return [
    { group: "Household", items: [{ value: "household", label: "Household", searchText: "household" }] },
    {
      group: "Members",
      items: ownerProfiles.map((p) => ({
        value: `person:${p.id}`,
        label: formatBelongsToLabel(p.label),
        displayLabel: p.label,
        searchText: p.label
      }))
    }
  ];
}

function buildAccountGroups(accounts: FinancialAccount[]): HierarchicalPickerGroup[] {
  const byInstitution = new Map<string, FinancialAccount[]>();
  for (const a of accounts) {
    const key = a.institution;
    byInstitution.set(key, [...(byInstitution.get(key) ?? []), a]);
  }
  return [...byInstitution.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([institution, rows]) => ({
      group: institution,
      items: rows
        .sort((a, b) => formatAccountForSelect(a).localeCompare(formatAccountForSelect(b)))
        .map((a) => ({
          value: a.id,
          label: formatAccountForSelect(a),
          displayLabel: formatAccountForSelect(a),
          searchText: `${a.institution} ${a.type} ${a.account_mask ?? ""} ${formatAccountFreshness(a).lastUpload} ${formatAccountFreshness(a).statementEnding}`
        }))
    }));
}

function formatProfileLabel(id: string): string {
  return friendlyParserLabel(id);
}

function accountById(accounts: FinancialAccount[], id: string): FinancialAccount | undefined {
  return accounts.find((a) => a.id === id);
}

/** Parses JSON error bodies from `apiJson` failures (e.g. 409 INVALID_TRANSITION). */
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function friendlyImportSkipReason(reason: string): string {
  if (reason === "payslip_pdf_extract_unreadable") {
    return "payslip_pdf_extract_unreadable (PDF has no usable text for parsing — re-export from payroll or use a text-based PDF)";
  }
  if (reason === "payslip_openai_api_not_configured") {
    return "payslip_openai_api_not_configured (set OPENAI_API_KEY for Deloitte payslip extraction)";
  }
  return reason;
}

/** Append per-file parse skip reasons when API returns `skippedFiles` (e.g. duplicate payslip vs parse failure). */
function enrichImportErrorWithSkippedFiles(message: string): string {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) {
    return message;
  }
  try {
    const j = JSON.parse(message.slice(jsonStart)) as {
      skippedFiles?: Array<{ fileId: string; reason: string }>;
    };
    if (!j.skippedFiles?.length) {
      return message;
    }
    const detail = j.skippedFiles.map((s) => friendlyImportSkipReason(s.reason)).join("; ");
    return `${message.trim()} — Per file: ${detail}`;
  } catch {
    return message;
  }
}

type LastImportSummary = {
  parsedFiles: number;
  parsedRows: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  /** Same account/date/amount as an existing row but similar non-identical description — queued for review (Epic 4.2). */
  nearDuplicates: number;
};

type CanonicalizeResult = {
  inserted: number;
  duplicates: number;
  skipped: number;
  nearDuplicates: number;
};

type ImportSessionFileSummaryRow = {
  fileId: string;
  fileName: string;
  status: string;
  rawRowCount: number;
  canonicalRowCount: number;
  nearDuplicatesFlagged: number;
  openItemsNeedingReview: number;
  notPostedExactDuplicateOrSkipped: number;
  reconciliation: {
    available: boolean;
    status: "ok" | "mismatch" | "insufficient_data";
    openingBalance: number | null;
    closingBalance: number | null;
    expectedClosingBalance: number | null;
    netActivity: number | null;
    variance: number | null;
    note: string;
  };
};

type ImportSessionSummary = {
  sessionId: string;
  totals: {
    rawRows: number;
    canonicalRows: number;
    nearDuplicatesFlagged: number;
    openItemsNeedingReview: number;
    notPostedExactDuplicateOrSkipped: number;
    reconciliationAvailableFiles: number;
    reconciliationMismatchedFiles: number;
  };
  files: ImportSessionFileSummaryRow[];
};

type ImportSessionListRow = {
  id: string;
  status: string;
  sourceType: string;
  startedAt: string;
  finalizedAt: string | null;
  fileCount: number;
};

type MatcherPreviewRow = {
  rawId: string;
  txnDate: string;
  amount: number;
  description: string;
  normalizedDescription: string;
  classification: {
    categoryId: string | null;
    ruleId: string | null;
    source: string;
    reason: string;
  };
};

type CategoryLabelRow = { id: string; name: string; parentId: string | null };

type ImportConfirmAction = { kind: "undo" } | { kind: "removeFile"; fileId: string };

function categoryLabelForPreview(cat: CategoryLabelRow, all: CategoryLabelRow[]): string {
  if (!cat.parentId) {
    return cat.name;
  }
  const p = all.find((x) => x.id === cat.parentId);
  return p ? `${p.name} › ${cat.name}` : cat.name;
}

function SessionStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    created: "gray",
    processing: "blue",
    review: "yellow",
    finalized: "green",
    failed: "red",
  };
  const labelMap: Record<string, string> = {
    created: "Created",
    processing: "Processing",
    review: "Review",
    finalized: "Finalized",
    failed: "Failed",
  };
  return (
    <Badge color={colorMap[status] ?? "gray"} variant="light" size="sm">
      {labelMap[status] ?? status}
    </Badge>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" gap="xs">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" fw={600}>{value}</Text>
    </Group>
  );
}

export function ImportWorkspacePage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showAdvanced = searchParams.get("advanced") === "1";
  const token = getToken();
  const { role: currentRole, personProfileId: currentPersonProfileId } = useCurrentUser();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [files, setFiles] = useState<ImportFileRow[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);

  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        accountId: string;
        profileId: string;
        employerId: string;
        ownerScope: "household" | "person";
        ownerPersonProfileId: string;
      }
    >
  >({});
  const [ownerProfiles, setOwnerProfiles] = useState<Array<{ id: string; label: string }>>([]);
  const [householdEmployers, setHouseholdEmployers] = useState<HouseholdEmployer[]>([]);
  const [mapDate, setMapDate] = useState("Date");
  const [mapAmount, setMapAmount] = useState("Amount");
  const [mapDesc, setMapDesc] = useState("Description");
  const [sheetName, setSheetName] = useState("Sheet1");

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [lastImportSummary, setLastImportSummary] = useState<LastImportSummary | null>(null);
  const [sessionSummary, setSessionSummary] = useState<ImportSessionSummary | null>(null);
  const [incomeInference, setIncomeInference] = useState<IncomeInferenceContext>({});
  const [recentSessions, setRecentSessions] = useState<ImportSessionListRow[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [matcherPreviewRows, setMatcherPreviewRows] = useState<MatcherPreviewRow[]>([]);
  const [matcherPreviewCategories, setMatcherPreviewCategories] = useState<CategoryLabelRow[]>([]);
  const [matcherPreviewLoading, setMatcherPreviewLoading] = useState(false);
  const [copySessionMsg, setCopySessionMsg] = useState<string | null>(null);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);
  const [importConfirmAction, setImportConfirmAction] = useState<ImportConfirmAction | null>(null);
  const [showPayslipHelp, setShowPayslipHelp] = useState(false);
  const [showSeparateSteps, setShowSeparateSteps] = useState(false);

  // OFX/QFX/QBO: account suggestions fetched after upload (fileId → suggestion)
  const [ofxSuggestions, setOfxSuggestions] = useState<Record<string, OfxSuggestion | null>>({});
  // Inline create-account form for OFX files with no account match (fileId or null)
  const [createAccountFileId, setCreateAccountFileId] = useState<string | null>(null);
  const [newAcctType, setNewAcctType] = useState("");
  const [newAcctInstitution, setNewAcctInstitution] = useState("");
  const [newAcctMask, setNewAcctMask] = useState("");
  const [newAcctScope, setNewAcctScope] = useState<"household" | "person">("household");
  const [newAcctPersonId, setNewAcctPersonId] = useState("");
  // Default new-account Belongs-To to the member's own profile when identity loads.
  useEffect(() => {
    if (currentRole === "member" && currentPersonProfileId) {
      setNewAcctScope("person");
      setNewAcctPersonId(currentPersonProfileId);
    }
  }, [currentRole, currentPersonProfileId]);
  const [creatingAccount, setCreatingAccount] = useState(false);
  // Institution catalog for the inline create-account form (lazy-loaded when form opens)
  const [institutionCatalogList, setInstitutionCatalogList] = useState<string[]>([]);
  const [institutionCustom, setInstitutionCustom] = useState<Array<{ id: string; displayName: string }>>([]);
  // Inline "Add institution" input row (shown below the picker when user wants a custom name)
  const [addingInstitution, setAddingInstitution] = useState(false);
  const [newInstitutionName, setNewInstitutionName] = useState("");
  const [savingInstitution, setSavingInstitution] = useState(false);

  const institutionPickerGroups = useMemo((): HierarchicalPickerGroup[] => {
    const catalogItems = institutionCatalogList.map((label) => ({ value: label, label, searchText: label }));
    const customItems = institutionCustom.map((c) => ({ value: c.displayName, label: c.displayName, searchText: c.displayName }));
    return [
      { group: "Suggested", items: catalogItems },
      ...(customItems.length > 0 ? [{ group: "Your household", items: customItems }] : [])
    ];
  }, [institutionCatalogList, institutionCustom]);

  const loadInstitutions = useCallback(async () => {
    try {
      const r = await apiJson<{ catalog: string[]; custom: Array<{ id: string; displayName: string }> }>("/imports/institutions");
      setInstitutionCatalogList(r.catalog);
      setInstitutionCustom(r.custom);
    } catch {
      /* non-fatal — picker stays empty */
    }
  }, []);

  const load = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setError(null);
    const detail = await apiJson<{
      session: { status: string };
      files: ImportFileRow[];
    }>(`/imports/sessions/${sessionId}`);
    setSessionStatus(detail.session.status);
    setFiles(detail.files);
    const nextDrafts: Record<
      string,
      { accountId: string; profileId: string; employerId: string; ownerScope: "household" | "person"; ownerPersonProfileId: string }
    > = {};
    for (const f of detail.files) {
      // For unbound files, default Belongs-To to the member's own profile.
      const isMemberWithProfile = currentRole === "member" && !!currentPersonProfileId;
      const defaultOwnerScope: "household" | "person" =
        f.owner_person_profile_id ? (f.owner_scope ?? "household") : (isMemberWithProfile ? "person" : "household");
      const defaultOwnerPersonProfileId =
        f.owner_person_profile_id ?? (isMemberWithProfile ? currentPersonProfileId : "");
      nextDrafts[f.id] = {
        accountId: f.financial_account_id ?? "",
        profileId: f.parser_profile_id ?? "",
        employerId: f.employer_id ?? "",
        ownerScope: defaultOwnerScope,
        ownerPersonProfileId: defaultOwnerPersonProfileId
      };
    }
    setDrafts(nextDrafts);

    const accRes = await apiJson<{ accounts: FinancialAccount[] }>("/imports/accounts");
    setAccounts(accRes.accounts);

    try {
      const hs = await apiJson<{
        salaryDepositFinancialAccountId: string | null;
        employers: HouseholdEmployer[];
      }>("/household/settings");
      setHouseholdEmployers(hs.employers ?? []);
      setIncomeInference({
        salaryDepositAccountId: hs.salaryDepositFinancialAccountId,
        employers: hs.employers ?? []
      });
    } catch {
      setHouseholdEmployers([]);
      setIncomeInference({});
    }
    try {
      // Lists all household person profiles for Belongs-to (owner/admin). Members without this role fall through to profile-only fallback below.
      const members = await apiJson<{ members: Array<{ id: string; fullName: string; relationship: string }> }>(
        "/household/members"
      );
      setOwnerProfiles(
        (members.members ?? []).map((m) => ({
          id: m.id,
          label: `${m.fullName}${m.relationship ? ` (${m.relationship})` : ""}`
        }))
      );
    } catch {
      try {
        const me = await apiJson<{ profile: { id: string; fullName: string } }>("/household/profile");
        setOwnerProfiles([{ id: me.profile.id, label: me.profile.fullName || "My profile" }]);
      } catch {
        setOwnerProfiles([]);
      }
    }

    try {
      const sum = await apiJson<ImportSessionSummary>(`/imports/sessions/${sessionId}/summary`);
      setSessionSummary(sum);
    } catch {
      setSessionSummary(null);
    }

    // Fetch OFX account suggestions for any unbound OFX/QFX/QBO files, then
    // auto-populate the account picker and save the binding when a match is found.
    const ofxFiles = detail.files.filter(
      (f) => f.parser_profile_id === OFX_PARSER_ID && !f.financial_account_id
    );
    if (ofxFiles.length > 0) {
      const suggestMap: Record<string, OfxSuggestion | null> = {};
      await Promise.all(
        ofxFiles.map(async (f) => {
          try {
            const s = await apiJson<OfxSuggestion>(
              `/imports/sessions/${sessionId}/files/${f.id}/ofx-suggestion`
            );
            suggestMap[f.id] = s;
          } catch {
            suggestMap[f.id] = null;
          }
        })
      );
      setOfxSuggestions((prev) => ({ ...prev, ...suggestMap }));

      // For each OFX file with a matched account, auto-save the binding so
      // "Run import" becomes available without a manual account selection step.
      for (const f of ofxFiles) {
        const sug = suggestMap[f.id];
        if (sug?.matchedAccountId) {
          try {
            const matchedAccount = accRes.accounts.find((a) => a.id === sug.matchedAccountId);
            const ofxOwnerScope: "household" | "person" =
              matchedAccount?.owner_scope ?? (currentRole === "member" && currentPersonProfileId ? "person" : "household");
            const ofxOwnerPersonProfileId =
              matchedAccount?.owner_person_profile_id ?? (currentRole === "member" && currentPersonProfileId ? currentPersonProfileId : null);
            await apiJson(`/imports/sessions/${sessionId}/files/${f.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                financialAccountId: sug.matchedAccountId,
                parserProfileId: OFX_PARSER_ID,
                ownerScope: ofxOwnerScope,
                ownerPersonProfileId: ofxOwnerPersonProfileId
              })
            });
            // Refresh so the file row shows the bound account.
            const refreshed = await apiJson<{ session: { status: string }; files: ImportFileRow[] }>(
              `/imports/sessions/${sessionId}`
            );
            setFiles(refreshed.files);
            setSessionStatus(refreshed.session.status);
            setDrafts((prev) => ({
              ...prev,
              [f.id]: {
                accountId: sug.matchedAccountId!,
                profileId: OFX_PARSER_ID,
                employerId: "",
                ownerScope: ofxOwnerScope,
                ownerPersonProfileId: ofxOwnerPersonProfileId ?? ""
              }
            }));
          } catch {
            // Non-fatal — the user can still select the account manually.
          }
        }
      }
    }
  }, [sessionId, currentRole, currentPersonProfileId]);

  const openUndoConfirm = useCallback(() => {
    if (!sessionId || (sessionSummary?.totals.canonicalRows ?? 0) === 0) {
      return;
    }
    setImportConfirmAction({ kind: "undo" });
  }, [sessionId, sessionSummary?.totals.canonicalRows]);

  const handleImportConfirm = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    const a = importConfirmAction;
    if (!a) {
      return;
    }

    if (a.kind === "undo") {
      setError(null);
      setMessage(null);
      setUndoBusy(true);
      try {
        const out = await apiJson<{ deletedCanonicalRows: number; deletedResolutionItems: number }>(
          `/imports/sessions/${sessionId}/undo-import`,
          { method: "POST", body: "{}" }
        );
        setLastImportSummary(null);
        setMessage(
          `Removed ${out.deletedCanonicalRows} ledger row(s) and ${out.deletedResolutionItems} review item(s) tied to this import. You can run import again.`
        );
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Undo failed");
        throw err;
      } finally {
        setUndoBusy(false);
      }
      return;
    }

    const fileId = a.fileId;
    setRemovingFileId(fileId);
    setError(null);
    try {
      const res = await apiFetch(`/imports/sessions/${sessionId}/files/${fileId}`, { method: "DELETE" });
      const text = await res.text();
      if (!res.ok) {
        let msg = text || res.statusText;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (typeof j.message === "string" && j.message.length > 0) {
            msg = j.message;
          }
        } catch {
          /* use raw */
        }
        throw new Error(msg);
      }
      setMessage("File removed from session.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove file");
      throw err;
    } finally {
      setRemovingFileId(null);
    }
  }, [sessionId, importConfirmAction, load]);

  const runReconcilePayslipAsync = useCallback(
    async (force: boolean) => {
      if (!sessionId) {
        return;
      }
      setError(null);
      try {
        const q = force ? "?force=true" : "";
        const r = await apiJson<{
          stillPending: boolean;
          completedFiles: number;
          polledFiles: number;
        }>(`/imports/sessions/${sessionId}/reconcile-payslip-async${q}`, { method: "POST", body: "{}" });
        await load();
        if (r.completedFiles > 0) {
          setMessage(
            `Payslip LLM: parsed ${r.completedFiles} Deloitte file(s).${r.stillPending ? " More still in progress." : ""}`
          );
        } else if (r.polledFiles > 0 && r.stillPending) {
          setMessage("Payslip extraction still running; automatic check every 2 minutes.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reconcile failed");
      }
    },
    [sessionId, load]
  );

  useEffect(() => {
    const pending = files.some(
      (f) => f.parser_profile_id === "deloitte_payslip_pdf" && f.status === "processing"
    );
    if (!sessionId || !pending) {
      return;
    }
    const kickoff = window.setTimeout(() => {
      void runReconcilePayslipAsync(false);
    }, 2500);
    const id = window.setInterval(() => {
      void runReconcilePayslipAsync(false);
    }, 120_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [sessionId, files, runReconcilePayslipAsync]);

  useEffect(() => {
    if (sessionId) {
      return;
    }
    const raw = searchParams.get("sessionId")?.trim();
    if (raw && isUuid(raw)) {
      navigate(`/imports/${raw}`, { replace: true });
    }
  }, [sessionId, searchParams, navigate]);

  useEffect(() => {
    if (!token || sessionId) {
      return;
    }
    setHubLoading(true);
    setError(null);
    void apiJson<{ sessions: ImportSessionListRow[] }>("/imports/sessions")
      .then((r) => setRecentSessions(r.sessions ?? []))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load sessions");
      })
      .finally(() => setHubLoading(false));
  }, [token, sessionId]);

  useEffect(() => {
    setMatcherPreviewRows([]);
    setMatcherPreviewCategories([]);
    setCopySessionMsg(null);
  }, [sessionId]);

  useEffect(() => {
    if (!showAdvanced || !token) {
      return;
    }
    let cancelled = false;
    void apiJson<{ profiles: string[] }>("/imports/parser-profiles").then((r) => {
      if (!cancelled) {
        setProfiles(r.profiles);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showAdvanced, token]);

  // Lazy-load institution catalog when the inline create-account form opens.
  useEffect(() => {
    if (createAccountFileId && institutionCatalogList.length === 0) {
      void loadInstitutions();
    }
  }, [createAccountFileId, institutionCatalogList.length, loadInstitutions]);

  useEffect(() => {
    if (!token || !sessionId) {
      return;
    }
    setLoading(true);
    void load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load session");
      })
      .finally(() => setLoading(false));
  }, [token, sessionId, load]);

  useEffect(() => {
    setLastImportSummary(null);
  }, [sessionId]);

  const persistBinding = useCallback(
    async (
      fileId: string,
      accountId: string,
      profileId: string,
      employerId: string | null,
      ownerScope: "household" | "person",
      ownerPersonProfileId: string | null
    ) => {
      if (!sessionId || !accountId || !profileId) {
        return;
      }
      setError(null);
      try {
        const body: Record<string, unknown> = {
          financialAccountId: accountId,
          parserProfileId: profileId,
          employerId: PAYSLIP_PARSER_IDS.has(profileId) ? (employerId ?? null) : null,
          ownerScope,
          ownerPersonProfileId: ownerScope === "person" ? ownerPersonProfileId : null
        };
        await apiJson(`/imports/sessions/${sessionId}/files/${fileId}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        });
        setError(null);
        setMessage("Binding saved.");
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [sessionId, load]
  );

  const onAccountChange = useCallback(
    async (fileId: string, accountId: string) => {
      setError(null);
      const file = files.find((f) => f.id === fileId);
      const account = accountById(accounts, accountId);

      if (!accountId) {
        setDrafts((d) => ({
          ...d,
          [fileId]: {
            accountId: "",
            profileId: "",
            employerId: "",
            ownerScope: "household",
            ownerPersonProfileId: ""
          }
        }));
        return;
      }

      const inferred = inferParserProfile(account as FinancialAccountLike, file?.file_name, incomeInference);
      if (inferred) {
        const nextOwnerScope = account?.owner_scope ?? drafts[fileId]?.ownerScope ?? "household";
        const nextOwnerPersonProfileId = account?.owner_person_profile_id ?? drafts[fileId]?.ownerPersonProfileId ?? "";
        let employerId = "";
        if (PAYSLIP_PARSER_IDS.has(inferred) && householdEmployers.length === 1) {
          employerId = householdEmployers[0]!.id;
        }
        setDrafts((d) => ({
          ...d,
          [fileId]: {
            accountId,
            profileId: inferred,
            employerId,
            ownerScope: nextOwnerScope,
            ownerPersonProfileId: nextOwnerPersonProfileId
          }
        }));
        await persistBinding(
          fileId,
          accountId,
          inferred,
          employerId || null,
          nextOwnerScope,
          nextOwnerScope === "person" ? nextOwnerPersonProfileId : null
        );
        return;
      }

      /** Payslip + multiple employers: inference is intentionally null — default first employer so binding persists and the employer control stays usable. */
      const accountType = (account?.type ?? "").toLowerCase();
      if (accountType === "payslip" && householdEmployers.length > 1) {
        const emp0 = householdEmployers[0]!;
        const defaultProfile = emp0.parserProfileId ?? "ibm_pay_contributions_pdf";
        const nextOwnerScope = account?.owner_scope ?? drafts[fileId]?.ownerScope ?? "household";
        const nextOwnerPersonProfileId = account?.owner_person_profile_id ?? drafts[fileId]?.ownerPersonProfileId ?? "";
        setDrafts((d) => ({
          ...d,
          [fileId]: {
            accountId,
            profileId: defaultProfile,
            employerId: emp0.id,
            ownerScope: nextOwnerScope,
            ownerPersonProfileId: nextOwnerPersonProfileId
          }
        }));
        await persistBinding(
          fileId,
          accountId,
          defaultProfile,
          emp0.id,
          nextOwnerScope,
          nextOwnerScope === "person" ? nextOwnerPersonProfileId : null
        );
        return;
      }

      setDrafts((d) => ({
        ...d,
        [fileId]: {
          accountId,
          profileId: "",
          employerId: "",
          ownerScope: account?.owner_scope ?? drafts[fileId]?.ownerScope ?? "household",
          ownerPersonProfileId: account?.owner_person_profile_id ?? drafts[fileId]?.ownerPersonProfileId ?? ""
        }
      }));
      const hint = showAdvanced
        ? ""
        : " If you’re debugging, add ?advanced=1 to this page’s URL to pick a format manually.";
      setError(
        `We couldn’t match this file to a supported import for that account.${hint}`
      );
    },
    [accounts, files, persistBinding, showAdvanced, incomeInference, householdEmployers, drafts]
  );

  const onOverrideProfileChange = useCallback(
    async (fileId: string, profileId: string) => {
      const accountId = drafts[fileId]?.accountId ?? "";
      let employerId = drafts[fileId]?.employerId ?? "";
      if (PAYSLIP_PARSER_IDS.has(profileId) && householdEmployers.length === 1) {
        employerId = householdEmployers[0]!.id;
      }
      setDrafts((d) => ({
        ...d,
        [fileId]: {
          accountId,
          profileId,
          employerId,
          ownerScope: d[fileId]?.ownerScope ?? "household",
          ownerPersonProfileId: d[fileId]?.ownerPersonProfileId ?? ""
        }
      }));
      if (accountId && profileId) {
        await persistBinding(
          fileId,
          accountId,
          profileId,
          employerId || null,
          drafts[fileId]?.ownerScope ?? "household",
          drafts[fileId]?.ownerPersonProfileId || null
        );
      }
    },
    [drafts, persistBinding, householdEmployers]
  );

  const onEmployerChange = useCallback(
    async (fileId: string, employerId: string) => {
      const accountId = drafts[fileId]?.accountId ?? "";
      const file = files.find((ff) => ff.id === fileId);
      const acc = accountById(accounts, accountId);
      const prev = drafts[fileId];
      const ownerScope = prev?.ownerScope ?? "household";
      const ownerPersonProfileId =
        ownerScope === "person" && prev?.ownerPersonProfileId?.trim()
          ? prev.ownerPersonProfileId
          : null;

      if (!employerId) {
        const inferred = inferParserProfile(acc as FinancialAccountLike | undefined, file?.file_name, incomeInference);
        setDrafts((d) => ({
          ...d,
          [fileId]: {
            ...d[fileId]!,
            employerId: "",
            profileId: inferred ?? ""
          }
        }));
        if (accountId && inferred) {
          await persistBinding(fileId, accountId, inferred, null, ownerScope, ownerPersonProfileId);
        }
        return;
      }

      const emp = householdEmployers.find((e) => e.id === employerId);
      const nextProfileId = emp?.parserProfileId ?? prev?.profileId ?? "";
      setDrafts((d) => ({
        ...d,
        [fileId]: {
          ...d[fileId]!,
          employerId,
          profileId: nextProfileId || d[fileId]!.profileId
        }
      }));
      if (accountId && nextProfileId) {
        await persistBinding(fileId, accountId, nextProfileId, employerId, ownerScope, ownerPersonProfileId);
      }
    },
    [drafts, persistBinding, files, accounts, householdEmployers, incomeInference]
  );

  const openRemoveFileConfirm = useCallback(
    (fileId: string) => {
      if (!sessionId) {
        return;
      }
      setImportConfirmAction({ kind: "removeFile", fileId });
    },
    [sessionId]
  );

  const onBelongsToChange = useCallback(
    async (fileId: string, belongsTo: BelongsToChoice) => {
      const accountId = drafts[fileId]?.accountId ?? "";
      const profileId = drafts[fileId]?.profileId ?? "";
      const employerId = drafts[fileId]?.employerId ?? "";
      const parsed = parseBelongsToChoice(belongsTo);
      setDrafts((d) => ({
        ...d,
        [fileId]: {
          ...d[fileId]!,
          ownerScope: parsed.ownerScope,
          ownerPersonProfileId: parsed.ownerPersonProfileId ?? ""
        }
      }));
      if (accountId && profileId) {
        await persistBinding(
          fileId,
          accountId,
          profileId,
          employerId || null,
          parsed.ownerScope,
          parsed.ownerPersonProfileId
        );
      }
    },
    [drafts, persistBinding]
  );

  async function uploadFiles(list: FileList | null) {
    if (!sessionId || !list?.length) {
      return;
    }
    setError(null);
    setMessage(null);
    setUploading(true);
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append("files", f));
    try {
      const res = await apiFetch(`/imports/sessions/${sessionId}/files`, {
        method: "POST",
        body: fd
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text || res.statusText;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (typeof j.message === "string" && j.message.length > 0) {
            msg = j.message;
          }
        } catch {
          /* use raw */
        }
        throw new Error(msg);
      }
      const data = JSON.parse(text) as {
        files: unknown[];
        skipped?: Array<{ fileName: string; message?: string }>;
      };
      const added = data.files?.length ?? 0;
      const skipped = data.skipped ?? [];
      const parts: string[] = [];
      if (added > 0) {
        parts.push(`Added ${added} file(s).`);
      }
      if (skipped.length > 0) {
        parts.push(
          `Skipped ${skipped.length} (already in this session): ${skipped.map((s) => s.fileName).join(", ")}`
        );
      }
      if (parts.length === 0) {
        parts.push("Nothing new to add.");
      }
      setError(null);
      setMessage(parts.join(" "));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  const canUploadMore = true;

  async function startNewImportSession() {
    setStartingSession(true);
    setError(null);
    setMessage(null);
    try {
      const data = await apiJson<{ session: { id: string } }>("/imports/sessions", {
        method: "POST",
        body: JSON.stringify({ sourceType: "upload" })
      });
      navigate(`/imports/${data.session.id}`, { replace: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a new import session.");
    } finally {
      setStartingSession(false);
    }
  }

  const showGenericMapping = files.some(
    (f) =>
      f.parser_profile_id === "generic_tabular" || drafts[f.id]?.profileId === "generic_tabular"
  );
  const serverUsesGeneric = files.some((f) => f.parser_profile_id === "generic_tabular");

  const summaryByFileId = useMemo(() => {
    const m = new Map<string, ImportSessionFileSummaryRow>();
    if (sessionSummary) {
      for (const r of sessionSummary.files) {
        m.set(r.fileId, r);
      }
    }
    return m;
  }, [sessionSummary]);

  const allFilesBound = files.length > 0 && files.every((f) => f.financial_account_id && f.parser_profile_id);
  const filesMissingEmployerSelection =
    householdEmployers.length > 1
      ? files
          .filter((f) => {
            const profileForRow = drafts[f.id]?.profileId || f.parser_profile_id || "";
            if (!PAYSLIP_PARSER_IDS.has(profileForRow)) {
              return false;
            }
            const selectedEmployerId = drafts[f.id]?.employerId || f.employer_id || "";
            return selectedEmployerId.trim().length === 0;
          })
          .map((f) => f.file_name)
      : [];
  const allFilesReady = allFilesBound && filesMissingEmployerSelection.length === 0;

  async function runParse() {
    if (!sessionId) {
      return;
    }
    setError(null);
    setMessage(null);
    const body: Record<string, unknown> = {};
    if (serverUsesGeneric) {
      body.mapping = {
        date: mapDate,
        amount: mapAmount,
        description: mapDesc
      };
      body.sheetName = sheetName;
    }
    try {
      const out = await apiJson<{
        parsedFiles: number;
        parsedRows: number;
        skippedFiles?: unknown[];
        asyncPayslipPending?: number;
      }>(`/imports/sessions/${sessionId}/parse`, { method: "POST", body: JSON.stringify(body) });
      const up = out.asyncPayslipPending ?? 0;
      if (up > 0) {
        setMessage(
          `Queued ${up} Deloitte PDF(s) for payslip extraction (OpenAI). Session stays in processing until extraction finishes — automatic check every 2 minutes.`
        );
      } else {
        setMessage(`Parse OK: ${out.parsedFiles} file(s), ${out.parsedRows} row(s).`);
      }
      await load();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Parse failed";
      setError(enrichImportErrorWithSkippedFiles(raw));
    }
  }

  async function runCanonicalize() {
    if (!sessionId) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const out = await apiJson<CanonicalizeResult>(`/imports/sessions/${sessionId}/canonicalize`, {
        method: "POST",
        body: "{}"
      });
      const nd = out.nearDuplicates ?? 0;
      const flagged = out.duplicates + out.skipped + nd;
      const near = nd > 0 ? ` Near-duplicate review items: ${nd}.` : "";
      setMessage(
        `Canonicalize complete: posted ${out.inserted}, flagged ${flagged} (exact duplicates ${out.duplicates}, near-duplicates ${nd}, skipped ${out.skipped}).${near} Staged source files were removed from disk.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Canonicalize failed");
    }
  }

  async function runImport() {
    if (!sessionId) {
      return;
    }
    setError(null);
    setMessage(null);
    setPipelineBusy(true);
    const body: Record<string, unknown> = {};
    if (serverUsesGeneric) {
      body.mapping = {
        date: mapDate,
        amount: mapAmount,
        description: mapDesc
      };
      body.sheetName = sheetName;
    }
    try {
      const parseOut = await apiJson<{
        parsedFiles: number;
        parsedRows: number;
        asyncPayslipPending?: number;
      }>(`/imports/sessions/${sessionId}/parse`, { method: "POST", body: JSON.stringify(body) });
      if ((parseOut.asyncPayslipPending ?? 0) > 0) {
        setMessage(
          'Deloitte PDF(s) queued for payslip extraction. Wait until files show "parsed" (automatic check every 2 minutes), then run import again.'
        );
        setPipelineBusy(false);
        await load();
        return;
      }
      await load();
      const canonOut = await apiJson<CanonicalizeResult>(`/imports/sessions/${sessionId}/canonicalize`, {
        method: "POST",
        body: "{}"
      });
      const nd = canonOut.nearDuplicates ?? 0;
      setLastImportSummary({
        parsedFiles: parseOut.parsedFiles,
        parsedRows: parseOut.parsedRows,
        inserted: canonOut.inserted,
        duplicates: canonOut.duplicates,
        skipped: canonOut.skipped,
        nearDuplicates: nd
      });
      const near =
        nd > 0
          ? ` ${nd} line(s) flagged as near-duplicates (not posted; review queue).`
          : "";
      setMessage(
        `Import finished: parsed ${parseOut.parsedFiles} file(s) (${parseOut.parsedRows} row(s)); posted ${canonOut.inserted} transaction(s), exact duplicates ${canonOut.duplicates}, skipped ${canonOut.skipped}.${near} Staged source files were removed from disk.`
      );
      await load();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Import failed";
      setError(enrichImportErrorWithSkippedFiles(raw));
    } finally {
      setPipelineBusy(false);
    }
  }

  async function createAccountForFile(fileId: string) {
    if (!newAcctType || !newAcctInstitution) {
      setError("Account type and institution are required.");
      return;
    }
    if (newAcctScope === "person" && !newAcctPersonId) {
      setError("Select a person for this account.");
      return;
    }
    setCreatingAccount(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        type: newAcctType,
        institution: newAcctInstitution,
        accountMask: newAcctMask || null,
        ownerScope: newAcctScope,
        ownerPersonProfileId: newAcctScope === "person" ? newAcctPersonId || null : null
      };
      const result = await apiJson<{ id: string }>("/imports/accounts", {
        method: "POST",
        body: JSON.stringify(body)
      });
      // Refresh accounts list and auto-select the new account in the file binding.
      const accRes = await apiJson<{ accounts: FinancialAccount[] }>("/imports/accounts");
      setAccounts(accRes.accounts);
      setCreateAccountFileId(null);
      // Use the fresh accounts list directly — onAccountChange captures a stale `accounts`
      // closure and cannot find the just-created account, leaving the binding unset.
      const freshAccount = accRes.accounts.find((a) => a.id === result.id);
      const fileForBinding = files.find((f) => f.id === fileId);
      const inferred = inferParserProfile(freshAccount as FinancialAccountLike | undefined, fileForBinding?.file_name, incomeInference);
      const ownerScope = freshAccount?.owner_scope ?? drafts[fileId]?.ownerScope ?? "household";
      const ownerPersonProfileId = freshAccount?.owner_person_profile_id ?? drafts[fileId]?.ownerPersonProfileId ?? "";
      if (inferred) {
        setDrafts((d) => ({
          ...d,
          [fileId]: {
            accountId: result.id,
            profileId: inferred,
            employerId: "",
            ownerScope,
            ownerPersonProfileId
          }
        }));
        await persistBinding(fileId, result.id, inferred, null, ownerScope, ownerScope === "person" ? ownerPersonProfileId : null);
      } else {
        // Profile could not be inferred — let the user pick it manually.
        setDrafts((d) => ({ ...d, [fileId]: { ...d[fileId], accountId: result.id, profileId: "" } }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setCreatingAccount(false);
    }
  }

  async function loadMatcherPreview() {
    if (!sessionId) {
      return;
    }
    setMatcherPreviewLoading(true);
    setError(null);
    try {
      const [catRes, prevRes] = await Promise.all([
        apiJson<{ categories: CategoryLabelRow[] }>("/categories"),
        apiJson<{ rows: MatcherPreviewRow[] }>("/categories/rules/rule-learning-preview", {
          method: "POST",
          body: JSON.stringify({ sessionId })
        })
      ]);
      setMatcherPreviewCategories(catRes.categories ?? []);
      setMatcherPreviewRows(prevRes.rows ?? []);
    } catch (err: unknown) {
      setMatcherPreviewRows([]);
      setMatcherPreviewCategories([]);
      setError(err instanceof Error ? err.message : "Could not load classification preview");
    } finally {
      setMatcherPreviewLoading(false);
    }
  }

  async function copySessionId() {
    if (!sessionId || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopySessionMsg("Copied");
      window.setTimeout(() => setCopySessionMsg(null), 2000);
    } catch {
      setCopySessionMsg("Copy failed");
      window.setTimeout(() => setCopySessionMsg(null), 2000);
    }
  }

  if (!sessionId) {
    if (!token) {
      return <Navigate to="/" replace />;
    }
    return (
      <Stack>
        <Paper withBorder p="lg">
          <Group align="center" gap={8} mb="md" wrap="wrap">
            <Title order={2}>Import</Title>
            <HelpIcon label="Start a new session to upload bank statements, parse them, and post transactions to your ledger. Parsed data stays in the database until you undo or reset. Use Recent sessions to resume where you left off." />
            <Group ml="auto" gap="md">
              <Anchor component={Link} to="/" c="dimmed" size="sm">Home</Anchor>
              <Anchor component={Link} to="/categories/rules" c="dimmed" size="sm">Classification rules</Anchor>
            </Group>
          </Group>
          {error ? <Alert color="red" mb="sm">{error}</Alert> : null}
          <Button
            leftSection={<IconUpload size={15} />}
            loading={startingSession}
            onClick={() => void startNewImportSession()}
          >
            New import session
          </Button>
        </Paper>

        <Paper withBorder p="lg">
          <Group align="center" gap={8} mb="sm">
            <Title order={3} fz="1.1rem">Recent sessions</Title>
            <HelpIcon label="Open a session to upload files, parse, run import, or run the classification matcher preview. Sessions hold parsed rows and ledger posts you can undo at any time." />
          </Group>
          {hubLoading ? <Skeleton height={80} radius="sm" /> : null}
          {!hubLoading && recentSessions.length === 0 ? (
            <Text c="dimmed" size="sm">No sessions yet. Start a new import above.</Text>
          ) : null}
          {!hubLoading && recentSessions.length > 0 ? (
            <Stack gap={6} mt="xs">
              {recentSessions.map((s) => (
                <Paper key={s.id} withBorder p="xs" radius="sm">
                  <Group gap="md" wrap="nowrap" align="center">
                    <Text size="xs" c="dimmed" style={{ minWidth: 140 }}>{s.startedAt?.replace("T", " ").slice(0, 19) ?? "—"}</Text>
                    <SessionStatusBadge status={s.status} />
                    <Text size="xs" c="dimmed">{s.fileCount} file{s.fileCount !== 1 ? "s" : ""}</Text>
                    <Code fz="xs" style={{ flex: 1 }}>{s.id.slice(0, 8)}…</Code>
                    <Anchor component={Link} to={`/imports/${s.id}`} size="sm" fw={500}>Open</Anchor>
                  </Group>
                </Paper>
              ))}
            </Stack>
          ) : null}
          <Text size="xs" c="dimmed" mt="sm">
            Deep link: <Code fz="xs">/imports?sessionId=&lt;uuid&gt;</Code> opens that session directly.
          </Text>
        </Paper>
      </Stack>
    );
  }

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <Skeleton height={200} radius="md" />;
  }

  return (
    <Stack>
      <Paper withBorder p="lg">
        <Group align="center" gap={8} mb="xs" wrap="wrap">
          <Title order={2}>Import session</Title>
          <HelpIcon label="Upload bank statement files, assign each to an account, then Run import to parse and post transactions to your ledger." />
          <Group ml="auto" align="center" gap={8}>
            <SessionStatusBadge status={sessionStatus ?? "—"} />
            <Code fz="xs">{sessionId?.slice(0, 8)}…</Code>
            <Button size="compact-xs" variant="default" onClick={() => void copySessionId()}>Copy id</Button>
            {copySessionMsg ? <Text size="xs" c="dimmed">{copySessionMsg}</Text> : null}
          </Group>
        </Group>
        {error ? <Alert color="red" mt="xs">{error}</Alert> : null}
        {message ? <Alert color="green" variant="light" mt="xs">{message}</Alert> : null}
      </Paper>

      {lastImportSummary ? (
        <Paper withBorder p="lg">
          <Title order={3} fz="1.1rem" mb="sm">Last import — data reached your ledger</Title>
          <List size="sm" spacing={4} mb="sm">
            {lastImportSummary.parsedRows === 0 &&
            lastImportSummary.inserted === 0 &&
            lastImportSummary.parsedFiles > 0 ? (
              <List.Item>
                <Text size="sm" c="dimmed" span>
                  No transaction lines were extracted (often correct for an <strong>employer payslip</strong> import).
                  Check <Anchor component={Link} to="/payslips" size="sm">Payslips</Anchor> for the snapshot; the ledger stays unchanged for payslip-only files.
                </Text>
              </List.Item>
            ) : (
              <List.Item><Text size="sm" span><strong>{lastImportSummary.parsedRows}</strong> transaction line(s) extracted from your file(s)</Text></List.Item>
            )}
            <List.Item><Text size="sm" span><strong>{lastImportSummary.inserted}</strong> line(s) safely posted to your ledger</Text></List.Item>
            <List.Item><Text size="sm" span><strong>{lastImportSummary.duplicates}</strong> line(s) flagged as exact duplicates (not posted)</Text></List.Item>
            {lastImportSummary.nearDuplicates > 0 ? (
              <List.Item>
                <Text size="sm" span>
                  <strong>{lastImportSummary.nearDuplicates}</strong> line(s) looked like an existing transaction (same account, date, and amount; similar description) — not posted; recorded for review.
                </Text>
              </List.Item>
            ) : null}
            {lastImportSummary.skipped > 0 ? (
              <List.Item>
                <Text size="sm" span><strong>{lastImportSummary.skipped}</strong> line(s) skipped during load (e.g. invalid or incomplete)</Text>
              </List.Item>
            ) : null}
          </List>
          <Text size="sm" c="dimmed">
            Posted rows are in your ledger now. Flagged rows (duplicates, near-duplicates, skipped) were not posted. Use the review queue when you have near-duplicates to investigate.
          </Text>
          {lastImportSummary.nearDuplicates > 0 ? (
            <Text size="sm" mt="xs">
              <Anchor
                component={Link}
                to={sessionId ? `/transactions?needsReview=true&sessionId=${encodeURIComponent(sessionId)}` : "/transactions?needsReview=true"}
                size="sm"
              >
                Go to Transactions → Needs review
              </Anchor>{" "}
              to triage near-duplicate lines before moving on.
            </Text>
          ) : null}
        </Paper>
      ) : null}

      <Paper withBorder p="lg">
        <Group align="center" gap={8} mb="sm">
          <Title order={3} fz="1.1rem">Upload files</Title>
          <HelpIcon label="CSV, XLSX, PDF, and OFX/QFX/QBO are supported. Files upload as soon as you pick them. OFX/QFX/QBO files are detected automatically. Already-added files are skipped." />
        </Group>
        {canUploadMore ? (
          <Group align="center" gap="sm">
            <input
              ref={fileInputRef}
              name="files"
              type="file"
              multiple
              accept=".csv,.xlsx,.xls,.pdf,.ofx,.qfx,.qbo"
              disabled={uploading}
              onClick={() => {
                setError(null);
                setMessage(null);
              }}
              onChange={(e) => void uploadFiles(e.target.files)}
            />
            {uploading ? <Text size="sm" c="dimmed">Uploading…</Text> : null}
          </Group>
        ) : null}
      </Paper>

      <Paper withBorder p="lg">
        <Group align="center" gap={8} mb="xs">
          <Title order={3} fz="1.1rem">Files &amp; account</Title>
          <HelpIcon label="Assign each file to an account and confirm the format. Format is inferred automatically. Then use Run import below." />
        </Group>

        {/* Payslip help — collapsible */}
        <Group gap={6} mb="xs" align="center">
          <Anchor
            size="sm"
            c="dimmed"
            onClick={() => setShowPayslipHelp((v) => !v)}
            style={{ cursor: "pointer" }}
          >
            {showPayslipHelp ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            {" "}Payslip PDFs, IBM pay stubs, and where results appear
          </Anchor>
        </Group>
        <Collapse in={showPayslipHelp} mb="sm">
          <Paper withBorder p="sm" radius="sm">
            <Text size="sm" mb={6}>
              <strong>Payslips:</strong> Set salary deposit + employers under <strong>Settings → Profile</strong>. Generic filenames still map if you pick the right account or payslip bucket from <strong>Employer Setup</strong>.
              Payslip data shows under <Anchor component={Link} to="/payslips" size="sm">Payslips</Anchor>, not the bank ledger.
            </Text>
            <Text size="sm">
              <strong>IBM Pay &amp; Contributions:</strong> choose <strong>{friendlyParserLabel("ibm_pay_contributions_pdf")}</strong> if needed; <strong>0</strong> ledger lines after parse is normal. <strong>Run import</strong> runs parse and canonicalize together; split steps live under <em>Separate steps</em> in Run import.
            </Text>
          </Paper>
        </Collapse>

        {files.length === 0 ? (
          <Text c="dimmed" size="sm">No files yet.</Text>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <Table withRowBorders verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>File</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Account</Table.Th>
                  {householdEmployers.length > 1 ? <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Employer</Table.Th> : null}
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Format</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Belongs-to</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {files.map((f) => {
                  const acc = accountById(accounts, drafts[f.id]?.accountId ?? "");
                  const inferred = inferParserProfile(
                    acc as FinancialAccountLike | undefined,
                    f.file_name,
                    incomeInference
                  );
                  const savedProfile = f.parser_profile_id ?? drafts[f.id]?.profileId ?? "";
                  const profileForRow = drafts[f.id]?.profileId || f.parser_profile_id || "";
                  const isPayslipAccount = (acc?.type ?? "").toLowerCase() === "payslip";
                  const showEmployerSelect =
                    householdEmployers.length > 1 &&
                    (PAYSLIP_PARSER_IDS.has(profileForRow) || isPayslipAccount);
                  const disabledProfileReason = profileForRow ? DISABLED_PROFILES[profileForRow] : undefined;
                  const autoLine = disabledProfileReason ? (
                    <Text size="sm" c="red" span>
                      {friendlyParserLabel(profileForRow)} — not supported yet, file will not be imported
                    </Text>
                  ) : inferred && savedProfile && profilesEquivalent(inferred, savedProfile) ? (
                    <Text size="sm" c="green" span>Ready: {friendlyParserLabel(inferred)}</Text>
                  ) : savedProfile ? (
                    <Text size="sm" span>{friendlyParserLabel(savedProfile)}</Text>
                  ) : (
                    <Text size="sm" c="dimmed" span>—</Text>
                  );

                  return (
                    <Table.Tr key={f.id}>
                      <Table.Td style={{ minWidth: 160 }}>
                        <Text size="sm" fw={500}>{f.file_name}</Text>
                        <Text size="xs" c="dimmed">status: {f.status}</Text>
                        <Box mt={4}>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            title="Remove file from session"
                            disabled={removingFileId === f.id}
                            onClick={() => openRemoveFileConfirm(f.id)}
                          >
                            <IconTrash size={12} />
                          </ActionIcon>
                        </Box>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 220 }}>
                        <HierarchicalSearchPicker
                          value={drafts[f.id]?.accountId ?? null}
                          onChange={(v) => void onAccountChange(f.id, v ?? "")}
                          groups={buildAccountGroups(accounts)}
                          placeholder="Choose account"
                          ariaLabel={`Account for ${f.file_name}`}
                          clearable
                        />
                        {acc ? (
                          <Text size="xs" c="dimmed" mt={2}>
                            Last upload {formatAccountFreshness(acc).lastUpload} · Statement ending {formatAccountFreshness(acc).statementEnding}
                          </Text>
                        ) : null}
                        {/* OFX/QFX/QBO account hint — shown only for OFX files */}
                        {f.parser_profile_id === OFX_PARSER_ID ? (() => {
                          const sug = ofxSuggestions[f.id];
                          const bound = Boolean(drafts[f.id]?.accountId);
                          if (!sug) return null;
                          if (bound) {
                            return (
                              <Stack gap={2} mt={4}>
                                <Text size="xs" c="dimmed">
                                  {sug.acctIdLast4 ? `OFX account: ...${sug.acctIdLast4}` : "OFX"}
                                  {sug.normalizedAcctType ? ` · ${sug.normalizedAcctType}` : ""}
                                  {sug.matchedAccountId ? <Text span size="xs" c="green"> ✓ matched</Text> : null}
                                </Text>
                                {sug.ledgerBalance !== null && sug.ledgerBalanceDate ? (
                                  <Text size="xs" c="dimmed">
                                    Balance as of {sug.ledgerBalanceDate}: <strong>${sug.ledgerBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (from OFX ledger balance — auto-saved to net worth)
                                  </Text>
                                ) : null}
                              </Stack>
                            );
                          }
                          return (
                            <Stack gap={2} mt={4}>
                              {sug.ledgerBalance !== null && sug.ledgerBalanceDate ? (
                                <Text size="xs" c="dimmed">
                                  Balance as of {sug.ledgerBalanceDate}: <strong>${sug.ledgerBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (from OFX — will auto-save to net worth once account is bound)
                                </Text>
                              ) : null}
                              <Text size="xs" c="dimmed">
                                {sug.acctIdLast4
                                  ? `No account found for ...${sug.acctIdLast4}${sug.normalizedAcctType ? ` (${sug.normalizedAcctType})` : ""}.`
                                  : "No matching account found."}
                                {" "}Pick one above or{" "}
                                <Anchor
                                  size="xs"
                                  component="button"
                                  type="button"
                                  onClick={() => {
                                    setNewAcctType(sug.normalizedAcctType ?? "checking");
                                    setNewAcctInstitution(sug.institution ?? "");
                                    setNewAcctMask(sug.acctIdLast4 ?? "");
                                    setNewAcctScope("household");
                                    setNewAcctPersonId("");
                                    setCreateAccountFileId(f.id);
                                  }}
                                >
                                  create new account
                                </Anchor>
                              </Text>
                            </Stack>
                          );
                        })() : null}
                        {profileForRow !== OFX_PARSER_ID && !PAYSLIP_PARSER_IDS.has(profileForRow) ? (
                          <Text size="xs" c="dimmed" mt={2}>
                            Pick one above or{" "}
                            <Anchor
                              size="xs"
                              component="button"
                              type="button"
                              onClick={() => {
                                setNewAcctType("checking");
                                setNewAcctInstitution("");
                                setNewAcctMask("");
                                setNewAcctScope("household");
                                setNewAcctPersonId("");
                                setCreateAccountFileId(f.id);
                              }}
                            >
                              create new account
                            </Anchor>
                          </Text>
                        ) : null}
                        {createAccountFileId === f.id ? (
                          <Paper withBorder p="sm" mt="xs" radius="sm">
                            <Text size="sm" fw={500} mb="xs">New account</Text>
                            <Stack gap="xs">
                              <Group gap="xs" align="flex-end" wrap="wrap">
                                <Select
                                  label="Type"
                                  size="xs"
                                  value={newAcctType}
                                  onChange={(v) => setNewAcctType(v ?? "")}
                                  data={[
                                    { value: "checking", label: "Checking" },
                                    { value: "savings", label: "Savings" },
                                    { value: "credit_card", label: "Credit card" },
                                    { value: "loan", label: "Loan" },
                                    { value: "investment", label: "Investment" },
                                  ]}
                                  placeholder="—"
                                  style={{ minWidth: 110 }}
                                />
                                <Box style={{ minWidth: 160 }}>
                                  <Text size="xs" c="dimmed" mb={2}>Institution</Text>
                                  <HierarchicalSearchPicker
                                    value={newAcctInstitution || null}
                                    onChange={(v) => setNewAcctInstitution(v ?? "")}
                                    groups={institutionPickerGroups}
                                    placeholder="Choose institution"
                                    ariaLabel="Institution for new account"
                                    clearable
                                  />
                                </Box>
                                <TextInput
                                  label="Last 4"
                                  size="xs"
                                  value={newAcctMask}
                                  onChange={(e) => setNewAcctMask(e.target.value.replace(/\D/g, "").slice(-4))}
                                  placeholder="4883"
                                  maxLength={4}
                                  style={{ width: "5rem" }}
                                />
                                <Box style={{ minWidth: 140 }}>
                                  <Text size="xs" c="dimmed" mb={2}>Belongs-to</Text>
                                  <HierarchicalSearchPicker
                                    value={newAcctScope === "person" && newAcctPersonId ? (`person:${newAcctPersonId}` as BelongsToChoice) : "household"}
                                    onChange={(v) => {
                                      const p = parseBelongsToChoice(v ?? "household");
                                      setNewAcctScope(p.ownerScope);
                                      setNewAcctPersonId(p.ownerPersonProfileId ?? "");
                                    }}
                                    groups={buildBelongsToGroups(ownerProfiles)}
                                    placeholder="Belongs-to"
                                    ariaLabel="New account belongs-to"
                                  />
                                </Box>
                                <Button size="xs" loading={creatingAccount} onClick={() => void createAccountForFile(f.id)}>Save</Button>
                                <Button size="xs" variant="default" onClick={() => { setCreateAccountFileId(null); setAddingInstitution(false); setNewInstitutionName(""); }}>Cancel</Button>
                              </Group>
                              {/* Inline add-institution row */}
                              {addingInstitution ? (
                                <Group gap="xs" align="center">
                                  <TextInput
                                    size="xs"
                                    autoFocus
                                    value={newInstitutionName}
                                    onChange={(e) => setNewInstitutionName(e.target.value)}
                                    placeholder="Institution name"
                                    style={{ flex: "1 1 12rem" }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void (async () => {
                                          if (!newInstitutionName.trim()) return;
                                          setSavingInstitution(true);
                                          try {
                                            await apiJson("/imports/institutions/custom", { method: "POST", body: JSON.stringify({ displayName: newInstitutionName.trim() }) });
                                            await loadInstitutions();
                                            setNewAcctInstitution(newInstitutionName.trim());
                                            setAddingInstitution(false);
                                            setNewInstitutionName("");
                                          } finally {
                                            setSavingInstitution(false);
                                          }
                                        })();
                                      }
                                      if (e.key === "Escape") { setAddingInstitution(false); setNewInstitutionName(""); }
                                    }}
                                  />
                                  <Button
                                    size="xs"
                                    loading={savingInstitution}
                                    disabled={!newInstitutionName.trim()}
                                    onClick={() => void (async () => {
                                      if (!newInstitutionName.trim()) return;
                                      setSavingInstitution(true);
                                      try {
                                        await apiJson("/imports/institutions/custom", { method: "POST", body: JSON.stringify({ displayName: newInstitutionName.trim() }) });
                                        await loadInstitutions();
                                        setNewAcctInstitution(newInstitutionName.trim());
                                        setAddingInstitution(false);
                                        setNewInstitutionName("");
                                      } finally {
                                        setSavingInstitution(false);
                                      }
                                    })()}
                                  >
                                    Add
                                  </Button>
                                  <Button size="xs" variant="default" onClick={() => { setAddingInstitution(false); setNewInstitutionName(""); }}>Cancel</Button>
                                </Group>
                              ) : (
                                <Box>
                                  <Button size="compact-xs" variant="subtle" c="dimmed" onClick={() => { setAddingInstitution(true); setNewInstitutionName(""); }}>
                                    Add institution…
                                  </Button>
                                </Box>
                              )}
                            </Stack>
                          </Paper>
                        ) : null}
                      </Table.Td>
                      {householdEmployers.length > 1 ? (
                        <Table.Td style={{ minWidth: 160 }}>
                          {showEmployerSelect ? (
                            <Select
                              size="xs"
                              value={drafts[f.id]?.employerId ?? ""}
                              onChange={(v) => void onEmployerChange(f.id, v ?? "")}
                              data={[
                                { value: "", label: "— choose employer —" },
                                ...householdEmployers.map((e) => ({ value: e.id, label: e.displayName }))
                              ]}
                              placeholder="— choose employer —"
                            />
                          ) : (
                            <Text size="sm" c="dimmed">—</Text>
                          )}
                        </Table.Td>
                      ) : null}
                      <Table.Td style={{ minWidth: 180 }}>
                        <Box mb={4}>{autoLine}</Box>
                        {showAdvanced ? (
                          <Select
                            size="xs"
                            label={<Text size="xs" c="dimmed">Override automatic detection:</Text>}
                            value={drafts[f.id]?.profileId ?? ""}
                            onChange={(v) => void onOverrideProfileChange(f.id, v ?? "")}
                            data={[
                              { value: "", label: "— choose —" },
                              ...profiles.map((p) => {
                                const disabledReason = DISABLED_PROFILES[p];
                                return {
                                  value: p,
                                  label: `${formatProfileLabel(p)}${disabledReason ? " (not supported)" : ""}`,
                                  disabled: !!disabledReason,
                                };
                              })
                            ]}
                            placeholder="— choose —"
                          />
                        ) : null}
                      </Table.Td>
                      <Table.Td style={{ minWidth: 160 }}>
                        <HierarchicalSearchPicker
                          value={
                            drafts[f.id]?.ownerScope === "person" && drafts[f.id]?.ownerPersonProfileId
                              ? (`person:${drafts[f.id]!.ownerPersonProfileId}` as BelongsToChoice)
                              : "household"
                          }
                          onChange={(v) => void onBelongsToChange(f.id, (v ?? "household") as BelongsToChoice)}
                          groups={buildBelongsToGroups(ownerProfiles)}
                          placeholder="Belongs-to"
                          ariaLabel={`Belongs-to for ${f.file_name}`}
                        />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Paper>

      {files.length > 0 ? (
        <Paper withBorder p="lg">
          <Title order={3} fz="1.1rem" mb="sm">Outcomes by file</Title>
          {sessionSummary ? (
            <>
              <Text size="sm" c="dimmed" mb="sm">
                Parsed lines vs what reached your ledger for this session. Near-duplicates are flagged for review (not
                posted). "Not posted (dup / skip)" covers exact duplicates and lines skipped during load.{" "}
                <Anchor component={Link} to={`/transactions?sessionId=${sessionId}`} size="sm">All lines from this import in the ledger</Anchor>
                {" · "}
                <Anchor component={Link} to="/transactions" size="sm">Full household ledger</Anchor>
                {sessionSummary.totals.openItemsNeedingReview > 0 ? (
                  <>
                    {" · "}
                    <Anchor component={Link} to={`/transactions?sessionId=${sessionId}&needsReview=true`} size="sm">
                      Needs review (this session)
                    </Anchor>
                  </>
                ) : null}
                .
              </Text>
              <Stack gap={4} mb="sm">
                <StatRow label="Session — parsed" value={sessionSummary.totals.rawRows} />
                <StatRow label="Session — posted" value={sessionSummary.totals.canonicalRows} />
                <StatRow label="Session — near-dup flagged" value={sessionSummary.totals.nearDuplicatesFlagged} />
                <StatRow label="Session — not posted (dup / skip)" value={sessionSummary.totals.notPostedExactDuplicateOrSkipped} />
                <StatRow label="Session — recon checks" value={sessionSummary.totals.reconciliationAvailableFiles} />
                <StatRow label="Session — recon mismatches" value={sessionSummary.totals.reconciliationMismatchedFiles} />
                {sessionSummary.totals.openItemsNeedingReview > 0 ? (
                  <StatRow label="Session — open review items" value={sessionSummary.totals.openItemsNeedingReview} />
                ) : null}
              </Stack>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                {files.map((f) => {
                  const row = summaryByFileId.get(f.id);
                  if (!row) {
                    return (
                      <Paper key={f.id} withBorder p="sm" radius="sm">
                        <Text size="sm" fw={600} mb={4}>{f.file_name}</Text>
                        <Text size="xs" c="dimmed">No summary row for this file yet.</Text>
                      </Paper>
                    );
                  }
                  const ledgerHref = `/transactions?sessionId=${sessionId}&fileId=${encodeURIComponent(row.fileId)}`;
                  const reviewHref = `/transactions?sessionId=${sessionId}&fileId=${encodeURIComponent(row.fileId)}&needsReview=true`;
                  return (
                    <Paper key={f.id} withBorder p="sm" radius="sm">
                      <Text size="sm" fw={600} mb={4}>{row.fileName}</Text>
                      <Text size="xs" c="dimmed" mb={6}>File status: <strong>{row.status}</strong></Text>
                      <Stack gap={2} mb="xs">
                        <StatRow label="Parsed rows" value={row.rawRowCount} />
                        <StatRow label="Posted to ledger" value={row.canonicalRowCount} />
                        <StatRow label="Near-duplicates flagged" value={row.nearDuplicatesFlagged} />
                        <StatRow label="Not posted (dup / skip)" value={row.notPostedExactDuplicateOrSkipped} />
                        <StatRow
                          label="Reconciliation"
                          value={
                            row.reconciliation.available
                              ? row.reconciliation.status === "ok"
                                ? "OK"
                                : "Mismatch"
                              : "N/A"
                          }
                        />
                        {row.openItemsNeedingReview > 0 ? (
                          <StatRow label="Open review items" value={row.openItemsNeedingReview} />
                        ) : null}
                      </Stack>
                      {row.reconciliation.available ? (
                        <Text size="xs" c="dimmed" mb="xs">
                          Open: ${row.reconciliation.openingBalance?.toFixed(2) ?? "—"} · Net: $
                          {row.reconciliation.netActivity?.toFixed(2) ?? "—"} · Expected close: $
                          {row.reconciliation.expectedClosingBalance?.toFixed(2) ?? "—"} · Actual close: $
                          {row.reconciliation.closingBalance?.toFixed(2) ?? "—"} · Variance: $
                          {row.reconciliation.variance?.toFixed(2) ?? "—"}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed" mb="xs">{row.reconciliation.note}</Text>
                      )}
                      <Group gap="sm">
                        <Anchor component={Link} to={ledgerHref} size="sm">View in ledger</Anchor>
                        {row.openItemsNeedingReview > 0 ? (
                          <Anchor component={Link} to={reviewHref} size="sm">Needs review</Anchor>
                        ) : null}
                      </Group>
                    </Paper>
                  );
                })}
              </SimpleGrid>
            </>
          ) : (
            <Text size="sm" c="dimmed">
              Could not load import statistics. Refresh the page or try again later.
            </Text>
          )}
        </Paper>
      ) : null}

      {showGenericMapping ? (
        <Paper withBorder p="lg">
          <Title order={3} fz="1.1rem" mb="xs">Generic tabular column names</Title>
          <Text size="sm" c="dimmed" mb="sm">Used for files with profile "generic tabular" (CSV / Excel).</Text>
          <Group gap="md" align="flex-end" wrap="wrap">
            <TextInput
              label="Date column"
              size="xs"
              value={mapDate}
              onChange={(e) => setMapDate(e.target.value)}
            />
            <TextInput
              label="Amount column"
              size="xs"
              value={mapAmount}
              onChange={(e) => setMapAmount(e.target.value)}
            />
            <TextInput
              label="Description column"
              size="xs"
              value={mapDesc}
              onChange={(e) => setMapDesc(e.target.value)}
            />
            <TextInput
              label="Excel sheet name (optional)"
              size="xs"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
            />
          </Group>
        </Paper>
      ) : null}

      <Paper withBorder p="lg" id="import-run-import">
        <Group align="center" gap={6} mb="sm">
          <Title order={3} fz="1.1rem">Run import</Title>
          <HelpIcon label="One step parses every file and then loads transactions into your ledger (dedupe included). IBM payslip PDFs finish in one step. Deloitte PDFs are extracted via OpenAI (background) — wait until they show 'parsed', then run import again." />
        </Group>
        <Group gap="sm">
          <Button
            leftSection={<IconPlayerPlay size={15} />}
            loading={pipelineBusy}
            disabled={!allFilesReady || pipelineBusy}
            onClick={() => void runImport()}
            title={
              !allFilesBound
                ? "Each file needs an account and format saved"
                : filesMissingEmployerSelection.length > 0
                  ? "Choose employer for each payslip file"
                  : undefined
            }
          >
            {pipelineBusy ? "Working…" : "Run import"}
          </Button>
        </Group>
        {!allFilesBound && files.length > 0 ? (
          <Text size="sm" c="dimmed" mt="xs">
            Choose an account for every file first. Formats save automatically when we can detect them.
          </Text>
        ) : null}
        {filesMissingEmployerSelection.length > 0 ? (
          <Text size="sm" c="dimmed" mt="xs">
            Choose employer for payslip file(s) before running import: {filesMissingEmployerSelection.join(", ")}.
          </Text>
        ) : null}
        <Box mt="md">
          <Anchor
            size="sm"
            c="dimmed"
            onClick={() => setShowSeparateSteps((v) => !v)}
            style={{ cursor: "pointer" }}
          >
            {showSeparateSteps ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            {" "}Separate steps (parse only / canonicalize only)
          </Anchor>
          <Collapse in={showSeparateSteps}>
            <Group gap="sm" mt="sm" wrap="wrap">
              <Button variant="default" disabled={!allFilesReady || pipelineBusy} onClick={() => void runParse()}>
                Parse session
              </Button>
              <Button variant="default" disabled={pipelineBusy} onClick={() => void runCanonicalize()}>
                Canonicalize (dedupe)
              </Button>
            </Group>
          </Collapse>
        </Box>
      </Paper>

      <Paper withBorder p="lg">
        <Group align="center" gap={6} mb="sm">
          <Title order={3} fz="1.1rem">Classification matcher preview</Title>
          <HelpIcon label="Dry-run of your current classification rules on parsed raw rows in this session. Does not assign categories or post to the ledger — only shows what would match today. After changing rules, click Load again." />
        </Group>
        <Group gap="sm" wrap="wrap" align="center" mb="sm">
          <Button
            variant="default"
            loading={matcherPreviewLoading}
            onClick={() => {
              if (matcherPreviewRows.length > 0) {
                setMatcherPreviewRows([]);
              } else {
                void loadMatcherPreview();
              }
            }}
          >
            {matcherPreviewLoading ? "Loading…" : matcherPreviewRows.length > 0 ? "Hide preview" : "Load classification preview"}
          </Button>
          {(sessionSummary?.totals.rawRows ?? 0) === 0 ? (
            <Text size="sm" c="dimmed">Parse files first (or open a session that already has raw rows).</Text>
          ) : (
            <Text size="sm" c="dimmed">{sessionSummary?.totals.rawRows} raw row(s) in this session.</Text>
          )}
        </Group>
        {matcherPreviewRows.length > 0 ? (
          <Box style={{ overflowX: "auto" }}>
            <Table withRowBorders verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Date</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Amount</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Description</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Preview category</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Source</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {matcherPreviewRows.map((r) => {
                  const cid = r.classification.categoryId;
                  const cat = cid ? matcherPreviewCategories.find((c) => c.id === cid) : null;
                  return (
                    <Table.Tr key={r.rawId}>
                      <Table.Td><Text size="sm">{r.txnDate}</Text></Table.Td>
                      <Table.Td><Text size="sm">{r.amount}</Text></Table.Td>
                      <Table.Td><Code fz="xs">{r.description}</Code></Table.Td>
                      <Table.Td><Text size="sm">{cat ? categoryLabelForPreview(cat, matcherPreviewCategories) : "—"}</Text></Table.Td>
                      <Table.Td><Text size="sm">{r.classification.source}</Text></Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Box>
        ) : null}
      </Paper>

      <Paper withBorder p="lg">
        <Group align="center" gap={6} mb="sm">
          <Title order={3} fz="1.1rem">Undo ledger posting</Title>
          <HelpIcon label="You can remove posted transactions from this import and run import again. Parsed rows stay. Undo is available any time while the session exists." />
        </Group>
        <Group gap="sm">
          <Button
            variant="default"
            leftSection={<IconArrowBackUp size={15} />}
            loading={undoBusy}
            disabled={undoBusy || pipelineBusy || (sessionSummary?.totals.canonicalRows ?? 0) === 0}
            title={
              (sessionSummary?.totals.canonicalRows ?? 0) === 0
                ? "Nothing from this import is in the ledger yet"
                : undefined
            }
            onClick={openUndoConfirm}
          >
            {undoBusy ? "Working…" : "Undo posting"}
          </Button>
        </Group>
      </Paper>

      <ConfirmDialog
        opened={importConfirmAction !== null}
        title={
          importConfirmAction?.kind === "undo"
            ? "Remove posted transactions?"
            : importConfirmAction?.kind === "removeFile"
                ? "Remove file from session?"
                : ""
        }
        message={
          importConfirmAction?.kind === "undo"
            ? "Remove all transactions this import posted to the ledger? Parsed file rows stay so you can run import again."
            : importConfirmAction?.kind === "removeFile"
                ? "Staged data for this file (including parsed rows or payslip snapshot if any) will be deleted."
                : ""
        }
        confirmLabel={
          importConfirmAction?.kind === "undo"
            ? "Remove from ledger"
            : importConfirmAction?.kind === "removeFile"
                ? "Remove file"
                : "Confirm"
        }
        danger
        closeOnClickOutside={false}
        onClose={() => setImportConfirmAction(null)}
        onConfirm={handleImportConfirm}
      />
    </Stack>
  );
}
