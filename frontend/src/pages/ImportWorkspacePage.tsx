import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { apiFetch, apiJson, getToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { formatAccountForSelect } from "../import/accountDisplay";
import {
  inferParserProfile,
  profilesEquivalent,
  type FinancialAccountLike,
  type IncomeInferenceContext
} from "../import/inferParserProfile";
import { friendlyParserLabel } from "../import/profileLabels";

const PAYSLIP_PARSER_IDS = new Set(["ibm_pay_contributions_pdf", "deloitte_payslip_pdf", "adp_payslip_pdf"]);
const OFX_PARSER_ID = "ofx_transactions";

type OfxSuggestion = {
  matchedAccountId: string | null;
  matchedAccountLabel: string | null;
  acctIdLast4: string | null;
  normalizedAcctType: string | null;
  institution: string | null;
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
          searchText: `${a.institution} ${a.type} ${a.account_mask ?? ""}`
        }))
    }));
}

function formatProfileLabel(id: string): string {
  return id.replace(/_/g, " ");
}

function accountById(accounts: FinancialAccount[], id: string): FinancialAccount | undefined {
  return accounts.find((a) => a.id === id);
}

/** Parses JSON error bodies from `apiJson` failures (e.g. 409 INVALID_TRANSITION). */
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function messageFromApiError(err: unknown): string {
  if (!(err instanceof Error)) {
    return "Request failed";
  }
  const text = err.message;
  const jsonStart = text.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const j = JSON.parse(text.slice(jsonStart)) as {
        code?: string;
        message?: string;
        from?: string;
        to?: string;
      };
      if (j.code === "INVALID_TRANSITION") {
        const detail =
          j.from != null && j.to != null ? ` Current status “${j.from}” cannot move to “${j.to}”.` : "";
        return `${j.message ?? "Invalid session status change"}${detail}`.trim();
      }
      if (typeof j.message === "string" && j.message.length > 0) {
        return j.message;
      }
    } catch {
      /* use raw message */
    }
  }
  return text;
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

type ImportConfirmAction = { kind: "undo" } | { kind: "finalize" } | { kind: "removeFile"; fileId: string };

function categoryLabelForPreview(cat: CategoryLabelRow, all: CategoryLabelRow[]): string {
  if (!cat.parentId) {
    return cat.name;
  }
  const p = all.find((x) => x.id === cat.parentId);
  return p ? `${p.name} › ${cat.name}` : cat.name;
}

export function ImportWorkspacePage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showAdvanced = searchParams.get("advanced") === "1";
  const token = getToken();
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
  const [finalizeBusy, setFinalizeBusy] = useState(false);
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

  // OFX/QFX/QBO confirm flow
  const [ofxSuggestions, setOfxSuggestions] = useState<Record<string, OfxSuggestion | null>>({});
  const [ofxDrafts, setOfxDrafts] = useState<Record<string, { accountId: string; ownerScope: "household" | "person"; ownerPersonProfileId: string }>>({});
  const [ofxConfirming, setOfxConfirming] = useState<Set<string>>(new Set());
  // Create-account inline form for OFX files with no account match
  const [ofxCreateAccountFileId, setOfxCreateAccountFileId] = useState<string | null>(null);
  const [newAcctType, setNewAcctType] = useState("");
  const [newAcctInstitution, setNewAcctInstitution] = useState("");
  const [newAcctMask, setNewAcctMask] = useState("");
  const [newAcctScope, setNewAcctScope] = useState<"household" | "person">("household");
  const [newAcctPersonId, setNewAcctPersonId] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);

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
      nextDrafts[f.id] = {
        accountId: f.financial_account_id ?? "",
        profileId: f.parser_profile_id ?? "",
        employerId: f.employer_id ?? "",
        ownerScope: f.owner_scope ?? "household",
        ownerPersonProfileId: f.owner_person_profile_id ?? ""
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

    // Fetch OFX account suggestions for any OFX/QFX/QBO files.
    const ofxFiles = detail.files.filter((f) => f.parser_profile_id === OFX_PARSER_ID);
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
      // Pre-populate OFX drafts with matched account id if not already set.
      setOfxDrafts((prev) => {
        const next = { ...prev };
        for (const f of ofxFiles) {
          if (!next[f.id]) {
            const sug = suggestMap[f.id];
            next[f.id] = {
              accountId: f.financial_account_id ?? sug?.matchedAccountId ?? "",
              ownerScope: f.owner_scope ?? "household",
              ownerPersonProfileId: f.owner_person_profile_id ?? ""
            };
          }
        }
        return next;
      });
    }
  }, [sessionId]);

  const openUndoConfirm = useCallback(() => {
    if (!sessionId || (sessionSummary?.totals.canonicalRows ?? 0) === 0) {
      return;
    }
    setImportConfirmAction({ kind: "undo" });
  }, [sessionId, sessionSummary?.totals.canonicalRows]);

  const openFinalizeConfirm = useCallback(() => {
    if (!sessionId) {
      return;
    }
    setImportConfirmAction({ kind: "finalize" });
  }, [sessionId]);

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

    if (a.kind === "finalize") {
      setError(null);
      setMessage(null);
      setFinalizeBusy(true);
      try {
        await apiJson<{ sessionId: string; status: string }>(
          `/imports/sessions/${sessionId}/status`,
          { method: "PATCH", body: JSON.stringify({ status: "finalized" }) }
        );
        setMessage("Session finalized. This import session is now locked.");
        await load();
      } catch (err) {
        setError(messageFromApiError(err));
        throw err;
      } finally {
        setFinalizeBusy(false);
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
          setMessage("Payslip extraction still running; next automatic check in 2 minutes (or use Check now).");
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
        const nextOwnerScope = drafts[fileId]?.ownerScope ?? "household";
        const nextOwnerPersonProfileId = drafts[fileId]?.ownerPersonProfileId ?? "";
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
        const nextOwnerScope = drafts[fileId]?.ownerScope ?? "household";
        const nextOwnerPersonProfileId = drafts[fileId]?.ownerPersonProfileId ?? "";
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
          ownerScope: drafts[fileId]?.ownerScope ?? "household",
          ownerPersonProfileId: drafts[fileId]?.ownerPersonProfileId ?? ""
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
    if (!canUploadMore) {
      setError(
        "This session no longer accepts new files. Use “Start another import session” below to import more statements."
      );
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

  const canUploadMore = sessionStatus === "created" || sessionStatus === "processing";

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
          `Queued ${up} Deloitte PDF(s) for payslip extraction (OpenAI). Session stays in processing until extraction finishes — automatic check every 2 minutes, or use “Check now”.`
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
          "Deloitte PDF(s) queued for payslip extraction. Wait until files show “parsed”, then run import again (or use Check now)."
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

  async function confirmOfxFile(fileId: string) {
    if (!sessionId) {
      return;
    }
    const draft = ofxDrafts[fileId];
    if (!draft?.accountId) {
      setError("Choose an account before confirming.");
      return;
    }
    setOfxConfirming((prev) => new Set([...prev, fileId]));
    setError(null);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        fileId,
        financialAccountId: draft.accountId,
        ownerScope: draft.ownerScope,
        ownerPersonProfileId: draft.ownerScope === "person" ? draft.ownerPersonProfileId || null : null
      };
      const out = await apiJson<{ parsedFiles: number; parsedRows: number; inserted: number; duplicates: number; nearDuplicates: number; skipped: number }>(
        `/imports/sessions/${sessionId}/ofx-confirm`,
        { method: "POST", body: JSON.stringify(body) }
      );
      const nd = out.nearDuplicates ?? 0;
      setMessage(
        `OFX import done: parsed ${out.parsedRows} row(s), posted ${out.inserted}, duplicates ${out.duplicates}${nd > 0 ? `, near-duplicates flagged ${nd}` : ""}.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setOfxConfirming((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }

  async function createAccountForOfxFile(fileId: string) {
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
      // Refresh accounts and pre-select the new one.
      const accRes = await apiJson<{ accounts: FinancialAccount[] }>("/imports/accounts");
      setAccounts(accRes.accounts);
      setOfxDrafts((prev) => ({
        ...prev,
        [fileId]: {
          ...prev[fileId]!,
          accountId: result.id
        }
      }));
      setOfxCreateAccountFileId(null);
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
      <div>
        <div className="card">
          <h1>Import</h1>
          <p className="muted">
            Start a new session or continue one you already have. Parsed data stays in the database until you finalize the
            flow or reset the app database — use <strong>Recent sessions</strong> so you don&apos;t lose your place.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <button type="button" disabled={startingSession} onClick={() => void startNewImportSession()}>
              {startingSession ? "Starting…" : "New import session"}
            </button>
            <Link to="/" className="muted">
              Back to home
            </Link>
            <Link to="/categories/rules" className="muted">
              Classification rules
            </Link>
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Recent sessions</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Open a session to upload files, parse, run import, or run the classification matcher preview. Sessions in{" "}
            <strong>review</strong> still hold parsed rows and ledger posts you can undo before finalizing.
          </p>
          {hubLoading ? <p className="muted">Loading…</p> : null}
          {!hubLoading && recentSessions.length === 0 ? (
            <p className="muted">No sessions yet. Start a new import above.</p>
          ) : null}
          {!hubLoading && recentSessions.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Started</th>
                    <th scope="col">Status</th>
                    <th scope="col">Files</th>
                    <th scope="col">Session id</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.startedAt?.replace("T", " ").slice(0, 19) ?? "—"}</td>
                      <td>
                        <strong>{s.status}</strong>
                      </td>
                      <td>{s.fileCount}</td>
                      <td>
                        <code style={{ fontSize: "0.78rem" }}>{s.id.slice(0, 8)}…</code>
                      </td>
                      <td>
                        <Link to={`/imports/${s.id}`}>Continue</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="muted" style={{ marginTop: "0.75rem", marginBottom: 0, fontSize: "0.88rem" }}>
            Deep link: <code>/imports?sessionId=&lt;uuid&gt;</code> opens that session directly (bookmark or paste from{" "}
            <strong>Copy id</strong> on the session page).
          </p>
        </div>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <p className="muted">Loading session…</p>;
  }

  return (
    <div className="import-workspace-page">
      <div className="card import-workspace__control-band">
        <h1>Import session</h1>
        <p className="muted">
          Session <code>{sessionId}</code>{" "}
          <button type="button" className="secondary" style={{ fontSize: "0.82rem", verticalAlign: "middle" }} onClick={() => void copySessionId()}>
            Copy id
          </button>
          {copySessionMsg ? (
            <span className="muted" style={{ marginLeft: "0.45rem" }}>
              {copySessionMsg}
            </span>
          ) : null}{" "}
          — status: <strong>{sessionStatus ?? "—"}</strong>
        </p>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="success">{message}</p> : null}
      </div>

      {lastImportSummary ? (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Last import — data reached your ledger</h2>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            {lastImportSummary.parsedRows === 0 &&
            lastImportSummary.inserted === 0 &&
            lastImportSummary.parsedFiles > 0 ? (
              <li className="muted">
                No transaction lines were extracted (often correct for an <strong>employer payslip</strong> import).
                Check <Link to="/payslips">Payslips</Link> for the snapshot; the ledger stays unchanged for payslip-only
                files.
              </li>
            ) : (
              <li>
                <strong>{lastImportSummary.parsedRows}</strong> transaction line(s) extracted from your file(s)
              </li>
            )}
            <li>
              <strong>{lastImportSummary.inserted}</strong> line(s) safely posted to your ledger
            </li>
            <li>
              <strong>{lastImportSummary.duplicates}</strong> line(s) flagged as exact duplicates (not posted)
            </li>
            {lastImportSummary.nearDuplicates > 0 ? (
              <li>
                <strong>{lastImportSummary.nearDuplicates}</strong> line(s) looked like an existing transaction (same
                account, date, and amount; similar description) — not posted; recorded for review.
              </li>
            ) : null}
            {lastImportSummary.skipped > 0 ? (
              <li>
                <strong>{lastImportSummary.skipped}</strong> line(s) skipped during load (e.g. invalid or
                incomplete)
              </li>
            ) : null}
          </ul>
          <p className="muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            Posted rows are in your ledger now. Flagged rows (duplicates, near-duplicates, skipped) were not posted.
            Use the review queue when you have near-duplicates to investigate.
          </p>
          {lastImportSummary.nearDuplicates > 0 ? (
            <p style={{ marginTop: "0.65rem", marginBottom: 0 }}>
              <Link
                to={
                  sessionId
                    ? `/transactions?needsReview=true&sessionId=${encodeURIComponent(sessionId)}`
                    : "/transactions?needsReview=true"
                }
              >
                Go to Transactions → Needs review
              </Link>{" "}
              to triage near-duplicate lines before moving on.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Upload files</h2>
        {canUploadMore ? (
          <>
            <p className="muted">
              CSV, XLSX, PDF, and OFX/QFX/QBO are supported. Files upload as soon as you pick them. OFX/QFX/QBO files
              are detected automatically and use a streamlined confirm flow. If a file was already added to this session,
              it&apos;s skipped and everything else still uploads.
            </p>
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
            {uploading ? <span className="muted"> Uploading…</span> : null}
          </>
        ) : sessionStatus == null ? (
          <p className="muted">Could not determine session status. Refresh the page or return home.</p>
        ) : (
          <>
            <p>
              {sessionStatus === "review"
                ? "This session is in review: parsed data is ready. You can’t add more files to this session yet (a dedicated transaction review screen is planned)."
                : sessionStatus === "finalized"
                  ? "This session is finalized. New files can’t be added here."
                  : sessionStatus === "failed"
                    ? "This session is in a failed state. Start fresh with a new session if you need to."
                    : "This session no longer accepts new uploads."}
            </p>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              To import more statements, start a <strong>new import session</strong>.
            </p>
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <button type="button" disabled={startingSession} onClick={() => void startNewImportSession()}>
                {startingSession ? "Starting…" : "Start another import session"}
              </button>
              <Link to="/" className="muted" style={{ alignSelf: "center" }}>
                Back to home
              </Link>
            </div>
          </>
        )}
      </div>

      {/* OFX / QFX / QBO streamlined confirm — shown when the session has OFX files awaiting binding */}
      {files.filter((f) => f.parser_profile_id === OFX_PARSER_ID && !f.financial_account_id).length > 0 ? (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>OFX / QFX / QBO — confirm account & import</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Each statement file needs an account. We matched account numbers from the file where possible. Select
            the account, confirm who it belongs to, then hit <strong>Confirm &amp; import</strong>.
          </p>
          {files
            .filter((f) => f.parser_profile_id === OFX_PARSER_ID && !f.financial_account_id)
            .map((f) => {
              const sug = ofxSuggestions[f.id];
              const draft = ofxDrafts[f.id] ?? { accountId: "", ownerScope: "household" as const, ownerPersonProfileId: "" };
              const isConfirming = ofxConfirming.has(f.id);
              const isCreating = ofxCreateAccountFileId === f.id;
              const belongsToValue: BelongsToChoice =
                draft.ownerScope === "person" && draft.ownerPersonProfileId
                  ? (`person:${draft.ownerPersonProfileId}` as BelongsToChoice)
                  : "household";

              return (
                <div key={f.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "0.75rem" }}>
                  <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>{f.file_name}</p>
                  {sug ? (
                    <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
                      Detected:{" "}
                      {sug.institution ? <strong>{sug.institution}</strong> : null}
                      {sug.normalizedAcctType ? ` · ${sug.normalizedAcctType}` : null}
                      {sug.acctIdLast4 ? ` · ...${sug.acctIdLast4}` : null}
                      {sug.matchedAccountId ? (
                        <span className="success"> — matched to {sug.matchedAccountLabel}</span>
                      ) : (
                        <span className="muted"> — no matching account found</span>
                      )}
                    </p>
                  ) : null}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
                    <div>
                      <label className="muted" style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                        Account
                      </label>
                      <HierarchicalSearchPicker
                        value={draft.accountId || null}
                        onChange={(v) =>
                          setOfxDrafts((prev) => ({ ...prev, [f.id]: { ...draft, accountId: v ?? "" } }))
                        }
                        groups={buildAccountGroups(accounts.filter((a) => a.type !== "payslip"))}
                        placeholder="Choose account"
                        ariaLabel={`Account for ${f.file_name}`}
                        clearable
                      />
                      {!draft.accountId ? (
                        <button
                          type="button"
                          className="secondary"
                          style={{ marginTop: "0.4rem", fontSize: "0.84rem" }}
                          onClick={() => {
                            setNewAcctType(sug?.normalizedAcctType ?? "checking");
                            setNewAcctInstitution(sug?.institution ?? "");
                            setNewAcctMask(sug?.acctIdLast4 ?? "");
                            setNewAcctScope("household");
                            setNewAcctPersonId("");
                            setOfxCreateAccountFileId(f.id);
                          }}
                        >
                          Create new account
                        </button>
                      ) : null}
                    </div>
                    <div>
                      <label className="muted" style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                        Belongs-to
                      </label>
                      <HierarchicalSearchPicker
                        value={belongsToValue}
                        onChange={(v) => {
                          const p = parseBelongsToChoice(v ?? "household");
                          setOfxDrafts((prev) => ({
                            ...prev,
                            [f.id]: { ...draft, ownerScope: p.ownerScope, ownerPersonProfileId: p.ownerPersonProfileId ?? "" }
                          }));
                        }}
                        groups={buildBelongsToGroups(ownerProfiles)}
                        placeholder="Belongs-to"
                        ariaLabel={`Belongs-to for ${f.file_name}`}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!draft.accountId || isConfirming}
                      onClick={() => void confirmOfxFile(f.id)}
                      title={!draft.accountId ? "Choose an account first" : undefined}
                    >
                      {isConfirming ? "Importing…" : "Confirm & import"}
                    </button>
                  </div>

                  {/* Inline create-account form */}
                  {isCreating ? (
                    <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "var(--surface)", borderRadius: 4, border: "1px solid var(--border)" }}>
                      <p style={{ margin: "0 0 0.5rem", fontWeight: 500, fontSize: "0.9rem" }}>Create account</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
                        <div>
                          <label className="muted" style={{ display: "block", fontSize: "0.82rem" }}>Type</label>
                          <select value={newAcctType} onChange={(e) => setNewAcctType(e.target.value)}>
                            <option value="">—</option>
                            <option value="checking">Checking</option>
                            <option value="savings">Savings</option>
                            <option value="credit_card">Credit card</option>
                            <option value="loan">Loan</option>
                            <option value="investment">Investment</option>
                          </select>
                        </div>
                        <div>
                          <label className="muted" style={{ display: "block", fontSize: "0.82rem" }}>Institution</label>
                          <input
                            value={newAcctInstitution}
                            onChange={(e) => setNewAcctInstitution(e.target.value)}
                            placeholder="e.g. Bank of America"
                            style={{ width: "14rem" }}
                          />
                        </div>
                        <div>
                          <label className="muted" style={{ display: "block", fontSize: "0.82rem" }}>Last 4 digits</label>
                          <input
                            value={newAcctMask}
                            onChange={(e) => setNewAcctMask(e.target.value.slice(-4))}
                            placeholder="1234"
                            maxLength={4}
                            style={{ width: "5rem" }}
                          />
                        </div>
                        <div>
                          <label className="muted" style={{ display: "block", fontSize: "0.82rem" }}>Belongs-to</label>
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
                        </div>
                        <button type="button" disabled={creatingAccount} onClick={() => void createAccountForOfxFile(f.id)}>
                          {creatingAccount ? "Saving…" : "Save account"}
                        </button>
                        <button type="button" className="secondary" onClick={() => setOfxCreateAccountFileId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Files & account</h2>
        <p className="muted">
          Assign each file to an account and confirm the format. Format is inferred automatically unless you use{" "}
          <strong>Advanced</strong>. Then use <a href="#import-run-import">Run import</a> below.
        </p>
        <details className="muted" style={{ marginTop: "0.35rem", fontSize: "0.9rem" }}>
          <summary style={{ cursor: "pointer", userSelect: "none" }}>
            Payslip PDFs, IBM pay stubs, and where results appear
          </summary>
          <p style={{ marginTop: "0.5rem", marginBottom: "0.35rem" }}>
            <strong>Payslips:</strong> Set salary deposit + employers under <strong>Settings → Profile</strong>. Generic
            filenames still map if you pick the right account or payslip bucket from <strong>Employer Setup</strong>.
            Payslip data shows under <Link to="/payslips">Payslips</Link>, not the bank ledger.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>IBM Pay &amp; Contributions:</strong> choose <strong>{friendlyParserLabel("ibm_pay_contributions_pdf")}</strong> if
            needed; <strong>0</strong> ledger lines after parse is normal. <strong>Run import</strong> runs parse and
            canonicalize together; split steps live under <em>Separate steps</em> in Run import.
          </p>
        </details>
        {files.length === 0 ? (
          <p className="muted">No files yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Account</th>
                {householdEmployers.length > 1 ? <th>Employer</th> : null}
                <th>Format</th>
                <th>Belongs-to</th>
              </tr>
            </thead>
            <tbody>
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
                const autoLine =
                  inferred && savedProfile && profilesEquivalent(inferred, savedProfile) ? (
                    <span className="success">Ready: {friendlyParserLabel(inferred)}</span>
                  ) : savedProfile ? (
                    <span>{friendlyParserLabel(savedProfile)}</span>
                  ) : (
                    <span className="muted">—</span>
                  );

                return (
                  <tr key={f.id}>
                    <td>
                      <div>{f.file_name}</div>
                      <span className="muted">status: {f.status}</span>
                      {sessionStatus !== "finalized" ? (
                        <div style={{ marginTop: "0.35rem" }}>
                          <button
                            type="button"
                            className="secondary"
                            style={{ fontSize: "0.85rem" }}
                            disabled={removingFileId === f.id}
                            onClick={() => openRemoveFileConfirm(f.id)}
                          >
                            {removingFileId === f.id ? "Removing…" : "Remove from session"}
                          </button>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <HierarchicalSearchPicker
                        value={drafts[f.id]?.accountId ?? null}
                        onChange={(v) => void onAccountChange(f.id, v ?? "")}
                        groups={buildAccountGroups(accounts)}
                        placeholder="Choose account"
                        ariaLabel={`Account for ${f.file_name}`}
                        clearable
                      />
                    </td>
                    {householdEmployers.length > 1 ? (
                      <td>
                        {showEmployerSelect ? (
                          <select
                            value={drafts[f.id]?.employerId ?? ""}
                            onChange={(e) => void onEmployerChange(f.id, e.target.value)}
                          >
                            <option value="">— choose employer —</option>
                            {householdEmployers.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.displayName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ) : null}
                    <td>
                      <div style={{ marginBottom: "0.35rem" }}>{autoLine}</div>
                      {showAdvanced ? (
                        <details>
                          <summary className="muted" style={{ cursor: "pointer", fontSize: "0.9rem" }}>
                            Manual format (advanced)…
                          </summary>
                          <div style={{ marginTop: "0.5rem" }}>
                            <label className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                              Override automatic detection:
                            </label>
                            <select
                              value={drafts[f.id]?.profileId ?? ""}
                              onChange={(e) => void onOverrideProfileChange(f.id, e.target.value)}
                            >
                              <option value="">— choose —</option>
                              {profiles.map((p) => (
                                <option key={p} value={p}>
                                  {formatProfileLabel(p)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </details>
                      ) : null}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {files.length > 0 ? (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Outcomes by file</h2>
          {sessionSummary ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Parsed lines vs what reached your ledger for this session. Near-duplicates are flagged for review (not
                posted). “Not posted (dup / skip)” covers exact duplicates and lines skipped during load.{" "}
                <Link to={`/transactions?sessionId=${sessionId}`}>All lines from this import in the ledger</Link>
                {" · "}
                <Link to="/transactions">Full household ledger</Link>
                {sessionSummary.totals.openItemsNeedingReview > 0 ? (
                  <>
                    {" · "}
                    <Link to={`/transactions?sessionId=${sessionId}&needsReview=true`}>
                      Needs review (this session)
                    </Link>
                  </>
                ) : null}
                .
              </p>
              <dl className="import-file-outcome-stats" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                <dt>Session — parsed</dt>
                <dd>{sessionSummary.totals.rawRows}</dd>
                <dt>Session — posted</dt>
                <dd>{sessionSummary.totals.canonicalRows}</dd>
                <dt>Session — near-dup flagged</dt>
                <dd>{sessionSummary.totals.nearDuplicatesFlagged}</dd>
                <dt>Session — not posted (dup / skip)</dt>
                <dd>{sessionSummary.totals.notPostedExactDuplicateOrSkipped}</dd>
                <dt>Session — recon checks</dt>
                <dd>{sessionSummary.totals.reconciliationAvailableFiles}</dd>
                <dt>Session — recon mismatches</dt>
                <dd>{sessionSummary.totals.reconciliationMismatchedFiles}</dd>
                {sessionSummary.totals.openItemsNeedingReview > 0 ? (
                  <>
                    <dt>Session — open review items</dt>
                    <dd>{sessionSummary.totals.openItemsNeedingReview}</dd>
                  </>
                ) : null}
              </dl>
              <div className="import-file-outcomes">
                {files.map((f) => {
                  const row = summaryByFileId.get(f.id);
                  if (!row) {
                    return (
                      <div key={f.id} className="import-file-outcome-card">
                        <p className="import-file-outcome-card__title">{f.file_name}</p>
                        <p className="muted import-file-outcome-card__meta">No summary row for this file yet.</p>
                      </div>
                    );
                  }
                  const ledgerHref = `/transactions?sessionId=${sessionId}&fileId=${encodeURIComponent(row.fileId)}`;
                  const reviewHref = `/transactions?sessionId=${sessionId}&fileId=${encodeURIComponent(row.fileId)}&needsReview=true`;
                  return (
                    <div key={f.id} className="import-file-outcome-card">
                      <p className="import-file-outcome-card__title">{row.fileName}</p>
                      <p className="muted import-file-outcome-card__meta">
                        File status: <strong>{row.status}</strong>
                      </p>
                      <dl className="import-file-outcome-stats">
                        <dt>Parsed rows</dt>
                        <dd>{row.rawRowCount}</dd>
                        <dt>Posted to ledger</dt>
                        <dd>{row.canonicalRowCount}</dd>
                        <dt>Near-duplicates flagged</dt>
                        <dd>{row.nearDuplicatesFlagged}</dd>
                        <dt>Not posted (dup / skip)</dt>
                        <dd>{row.notPostedExactDuplicateOrSkipped}</dd>
                        <dt>Reconciliation</dt>
                        <dd>
                          {row.reconciliation.available
                            ? row.reconciliation.status === "ok"
                              ? "OK"
                              : "Mismatch"
                            : "N/A"}
                        </dd>
                        {row.openItemsNeedingReview > 0 ? (
                          <>
                            <dt>Open review items</dt>
                            <dd>{row.openItemsNeedingReview}</dd>
                          </>
                        ) : null}
                      </dl>
                      {row.reconciliation.available ? (
                        <p className="muted import-file-outcome-card__meta" style={{ marginTop: 0 }}>
                          Open: ${row.reconciliation.openingBalance?.toFixed(2) ?? "—"} · Net: $
                          {row.reconciliation.netActivity?.toFixed(2) ?? "—"} · Expected close: $
                          {row.reconciliation.expectedClosingBalance?.toFixed(2) ?? "—"} · Actual close: $
                          {row.reconciliation.closingBalance?.toFixed(2) ?? "—"} · Variance: $
                          {row.reconciliation.variance?.toFixed(2) ?? "—"}
                        </p>
                      ) : (
                        <p className="muted import-file-outcome-card__meta" style={{ marginTop: 0 }}>
                          {row.reconciliation.note}
                        </p>
                      )}
                      <div className="import-file-outcome-actions">
                        <Link to={ledgerHref}>View in ledger</Link>
                        {row.openItemsNeedingReview > 0 ? (
                          <Link to={reviewHref}>Needs review</Link>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              Could not load import statistics. Refresh the page or try again later.
            </p>
          )}
        </div>
      ) : null}

      {showGenericMapping ? (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Generic tabular column names</h2>
          <p className="muted">Used for files with profile &quot;generic tabular&quot; (CSV / Excel).</p>
          <div className="row">
            <div>
              <label>Date column</label>
              <input value={mapDate} onChange={(e) => setMapDate(e.target.value)} />
            </div>
            <div>
              <label>Amount column</label>
              <input value={mapAmount} onChange={(e) => setMapAmount(e.target.value)} />
            </div>
            <div>
              <label>Description column</label>
              <input value={mapDesc} onChange={(e) => setMapDesc(e.target.value)} />
            </div>
            <div>
              <label>Excel sheet name (optional)</label>
              <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="card" id="import-run-import">
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Run import</h2>
        <p className="muted">
          One step parses every file and then loads transactions into your ledger (dedupe included). IBM payslip PDFs
          finish in one step. <strong>Deloitte</strong> PDFs are extracted via OpenAI (background) — wait until they show parsed, then
          run import again. Use separate steps only if you need to debug.
        </p>
        <div className="row">
          <button
            type="button"
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
          </button>
        </div>
        {!allFilesBound && files.length > 0 ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Choose an account for every file first. Formats save automatically when we can detect them.
          </p>
        ) : null}
        {filesMissingEmployerSelection.length > 0 ? (
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            Choose employer for payslip file(s) before running import: {filesMissingEmployerSelection.join(", ")}.
          </p>
        ) : null}
        <details style={{ marginTop: "1rem" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            Separate steps (parse only / canonicalize only)
          </summary>
          <div className="row" style={{ marginTop: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className="secondary" disabled={!allFilesReady || pipelineBusy} onClick={() => void runParse()}>
              Parse session
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!sessionId || pipelineBusy}
              title="Poll for completed Deloitte payslip extraction (bypasses 2-minute throttle)"
              onClick={() => void runReconcilePayslipAsync(true)}
            >
              Check now (Deloitte payslip)
            </button>
            <button type="button" className="secondary" disabled={pipelineBusy} onClick={() => void runCanonicalize()}>
              Canonicalize (dedupe)
            </button>
          </div>
        </details>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Classification matcher preview (read-only)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Dry-run of your current <Link to="/categories/rules">classification rules</Link> on parsed raw rows in{" "}
          <strong>this</strong> session. This does <strong>not</strong> assign categories, post to the ledger, or create
          rules — it only shows what would match today. After you change rules, click load again.
        </p>
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="secondary" disabled={matcherPreviewLoading} onClick={() => void loadMatcherPreview()}>
            {matcherPreviewLoading ? "Loading…" : "Load classification preview"}
          </button>
          {(sessionSummary?.totals.rawRows ?? 0) === 0 ? (
            <span className="muted" style={{ fontSize: "0.88rem" }}>
              Parse files first (or open a session that already has raw rows).
            </span>
          ) : (
            <span className="muted" style={{ fontSize: "0.88rem" }}>
              {sessionSummary?.totals.rawRows} raw row(s) in this session.
            </span>
          )}
        </div>
        {matcherPreviewRows.length > 0 ? (
          <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Description</th>
                  <th scope="col">Preview category</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {matcherPreviewRows.map((r) => {
                  const cid = r.classification.categoryId;
                  const cat = cid ? matcherPreviewCategories.find((c) => c.id === cid) : null;
                  return (
                    <tr key={r.rawId}>
                      <td>{r.txnDate}</td>
                      <td>{r.amount}</td>
                      <td>
                        <code style={{ fontSize: "0.78rem" }}>{r.description}</code>
                      </td>
                      <td>{cat ? categoryLabelForPreview(cat, matcherPreviewCategories) : "—"}</td>
                      <td>{r.classification.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {sessionStatus === "review" ? (
        <>
          <div className="card">
            <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Undo ledger posting</h2>
            <p className="muted">
              While the session is in <strong>review</strong> (before <strong>finalized</strong>), you can remove posted
              transactions from this import from the ledger and run <strong>Run import</strong> again. Parsed rows in the
              database stay. After you <strong>Finalize session</strong> below, the session is immutable and this action
              is not available.
            </p>
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={
                  undoBusy ||
                  finalizeBusy ||
                  pipelineBusy ||
                  (sessionSummary?.totals.canonicalRows ?? 0) === 0
                }
                title={
                  (sessionSummary?.totals.canonicalRows ?? 0) === 0
                    ? "Nothing from this import is in the ledger yet"
                    : undefined
                }
                onClick={openUndoConfirm}
              >
                {undoBusy ? "Working…" : "Remove posted transactions from this import"}
              </button>
            </div>
          </div>

          <div className="card import-finalize-session-card">
            <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Finalize session</h2>
            <p className="muted">
              When you&apos;re done reviewing, finalize to lock this session. Finalized sessions cannot be changed: you
              cannot undo ledger posting for this import afterward.
            </p>
            <div className="row">
              <button
                type="button"
                disabled={finalizeBusy || undoBusy || pipelineBusy}
                onClick={openFinalizeConfirm}
              >
                {finalizeBusy ? "Working…" : "Finalize session"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        opened={importConfirmAction !== null}
        title={
          importConfirmAction?.kind === "undo"
            ? "Remove posted transactions?"
            : importConfirmAction?.kind === "finalize"
              ? "Finalize import session?"
              : importConfirmAction?.kind === "removeFile"
                ? "Remove file from session?"
                : ""
        }
        message={
          importConfirmAction?.kind === "undo"
            ? "Remove all transactions this import posted to the ledger? Parsed file rows stay so you can run import again. After the session is finalized, this rollback is no longer available."
            : importConfirmAction?.kind === "finalize"
              ? "After finalizing, the session is locked: you cannot undo ledger posting for this import, and this cannot be reversed from the app."
              : importConfirmAction?.kind === "removeFile"
                ? "Staged data for this file (including parsed rows or payslip snapshot if any) will be deleted."
                : ""
        }
        confirmLabel={
          importConfirmAction?.kind === "undo"
            ? "Remove from ledger"
            : importConfirmAction?.kind === "finalize"
              ? "Finalize session"
              : importConfirmAction?.kind === "removeFile"
                ? "Remove file"
                : "Confirm"
        }
        danger
        closeOnClickOutside={false}
        onClose={() => setImportConfirmAction(null)}
        onConfirm={handleImportConfirm}
      />
    </div>
  );
}
