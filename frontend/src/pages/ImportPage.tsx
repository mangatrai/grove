import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput
} from "@mantine/core";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { useCurrentUser } from "../UserContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatAccountForSelect } from "../import/accountDisplay";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { inferParserProfile, IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID, type IncomeInferenceContext } from "../import/inferParserProfile";
import { friendlyParserLabel } from "../import/profileLabels";

type ImportType = "bank" | "payslip";
type BelongsToChoice = "household" | `person:${string}`;

type FinancialAccount = {
  id: string;
  type: string;
  institution: string;
  account_mask: string | null;
  currency: string;
};

type Employer = { id: string; displayName: string; parserProfileId?: string; salaryDepositFinancialAccountId?: string | null };
type OwnerProfile = { id: string; label: string };

type ImportHistoryItem = {
  id: string;
  type: "bank" | "payslip";
  accountType: string | null;
  createdAt: string;
  label: string;
  status: string;
  addedCount: number | null;
  duplicateCount: number | null;
  canUndo: boolean;
};

type OfxSuggestion = {
  matchedAccountId: string | null;
  matchedAccountLabel: string | null;
  acctIdLast4: string | null;
  normalizedAcctType: string | null;
  institution: string | null;
  ledgerBalance: number | null;
  ledgerBalanceDate: string | null;
};

type OfxPreflightState = {
  loading: boolean;
  failed: boolean;
};

type PreparedImportFile = {
  id: string;
  fileName: string;
};

type PreparedImportSession = {
  fileKey: string;
  sessionId: string;
  files: PreparedImportFile[];
  ofxSuggestionByFileId: Record<string, OfxSuggestion>;
};

type ImportSessionSummaryFile = {
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
  files: ImportSessionSummaryFile[];
};

function parseBelongsToChoice(choice: string): { ownerScope: "household" | "person"; ownerPersonProfileId: string | null } {
  if (choice.startsWith("person:")) {
    const id = choice.slice("person:".length);
    if (id) {
      return { ownerScope: "person", ownerPersonProfileId: id };
    }
  }
  return { ownerScope: "household", ownerPersonProfileId: null };
}

function formatAccountTypeLabel(type: string | null): string {
  if (!type) {
    return "Bank";
  }
  return type.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildAccountGroups(accounts: FinancialAccount[]): HierarchicalPickerGroup[] {
  const byInstitution = new Map<string, FinancialAccount[]>();
  for (const account of accounts) {
    const key = account.institution;
    byInstitution.set(key, [...(byInstitution.get(key) ?? []), account]);
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

const ADDABLE_ACCOUNT_TYPES = ["checking", "savings", "credit_card", "loan", "investment"] as const;

function mapOfxTypeToAccountType(t: string | null): (typeof ADDABLE_ACCOUNT_TYPES)[number] {
  if (!t) {
    return "checking";
  }
  if (t === "credit_card") {
    return "credit_card";
  }
  if (t === "savings") {
    return "savings";
  }
  return "checking";
}

function fileListKey(files: File[]): string {
  return files
    .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
    .sort()
    .join("|");
}

function isOfxFileName(fileName: string | null | undefined): boolean {
  if (!fileName) {
    return false;
  }
  const lower = fileName.toLowerCase();
  return lower.endsWith(".ofx") || lower.endsWith(".qfx") || lower.endsWith(".qbo");
}

function fmtDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

function fmtMoney(v: number | null): string {
  if (v == null || !Number.isFinite(v)) {
    return "—";
  }
  return `$${v.toFixed(2)}`;
}

export function ImportPage() {
  const token = useAuthToken();
  const { role: currentRole, personProfileId: currentPersonProfileId } = useCurrentUser();
  const [importType, setImportType] = useState<ImportType>("bank");
  const [files, setFiles] = useState<File[]>([]);
  const [financialAccountId, setFinancialAccountId] = useState<string | null>(null);
  const [employerId, setEmployerId] = useState("");
  const [belongsToChoice, setBelongsToChoice] = useState<BelongsToChoice>("household");

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<OwnerProfile[]>([]);
  const [incomeInference, setIncomeInference] = useState<IncomeInferenceContext>({});
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);

  const [detectedProfileId, setDetectedProfileId] = useState<string | null>(null);
  const [ofxState, setOfxState] = useState<OfxPreflightState>({ loading: false, failed: false });
  const [preparedSession, setPreparedSession] = useState<PreparedImportSession | null>(null);

  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [createAccountType, setCreateAccountType] = useState<(typeof ADDABLE_ACCOUNT_TYPES)[number]>("checking");
  const [createInstitution, setCreateInstitution] = useState<string | null>(null);
  const [createLast4, setCreateLast4] = useState("");
  const [createBelongsToChoice, setCreateBelongsToChoice] = useState<BelongsToChoice>("household");
  const [savingAccount, setSavingAccount] = useState(false);
  const [institutionCatalog, setInstitutionCatalog] = useState<string[]>([]);
  const [institutionCustom, setInstitutionCustom] = useState<Array<{ id: string; displayName: string }>>([]);
  const [loadingInstitutions, setLoadingInstitutions] = useState(false);

  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<ImportHistoryItem | null>(null);
  const [expandedHistoryRows, setExpandedHistoryRows] = useState<Record<string, boolean>>({});
  const [summaryBySessionId, setSummaryBySessionId] = useState<Record<string, ImportSessionSummary | undefined>>({});
  const [summaryLoadingBySessionId, setSummaryLoadingBySessionId] = useState<Record<string, boolean>>({});
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const sniffRunRef = useRef(0);

  const currentFileKey = useMemo(() => fileListKey(files), [files]);
  const hasOfxFiles = useMemo(() => files.some((f) => isOfxFileName(f.name)), [files]);
  const bankAccounts = useMemo(() => accounts.filter((a) => a.type !== "payslip"), [accounts]);
  const payslipAccount = useMemo(() => accounts.find((a) => a.type === "payslip") ?? null, [accounts]);
  const accountGroups = useMemo(() => buildAccountGroups(bankAccounts), [bankAccounts]);
  const selectedAccount = useMemo(
    () => (financialAccountId ? bankAccounts.find((a) => a.id === financialAccountId) : undefined),
    [bankAccounts, financialAccountId]
  );
  const belongsToOptions = useMemo(
    () => [
      { value: "household", label: "Household" },
      ...ownerProfiles.map((p) => ({ value: `person:${p.id}`, label: p.label }))
    ],
    [ownerProfiles]
  );
  const institutionGroups = useMemo<HierarchicalPickerGroup[]>(
    () => [
      {
        group: "Suggested",
        items: institutionCatalog.map((label) => ({ value: label, label, searchText: label }))
      },
      ...(institutionCustom.length > 0
        ? [
            {
              group: "Your household",
              items: institutionCustom.map((c) => ({ value: c.displayName, label: c.displayName, searchText: c.displayName }))
            }
          ]
        : [])
    ],
    [institutionCatalog, institutionCustom]
  );
  const canSubmit =
    !loading &&
    files.length > 0 &&
    (importType === "payslip" || !!financialAccountId) &&
    !(importType === "bank" && hasOfxFiles && ofxState.loading);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiJson<{ items: ImportHistoryItem[] }>("/imports/history");
      setHistory(res.items ?? []);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadInstitutions = useCallback(async () => {
    if (loadingInstitutions || institutionCatalog.length > 0) {
      return;
    }
    setLoadingInstitutions(true);
    try {
      const result = await apiJson<{ catalog: string[]; custom: Array<{ id: string; displayName: string }> }>("/imports/institutions");
      setInstitutionCatalog(result.catalog ?? []);
      setInstitutionCustom(result.custom ?? []);
    } catch {
      // Non-fatal: form can still submit with typed/default values later.
    } finally {
      setLoadingInstitutions(false);
    }
  }, [institutionCatalog.length, loadingInstitutions]);

  function resetCreateAccountForm() {
    setCreateAccountType("checking");
    setCreateInstitution(null);
    setCreateLast4("");
    if (currentRole === "member" && currentPersonProfileId) {
      setCreateBelongsToChoice(`person:${currentPersonProfileId}`);
    } else {
      setCreateBelongsToChoice("household");
    }
    setShowCreateAccount(false);
  }

  function parseApiError(text: string, fallback: string): { code?: string; message: string } {
    if (!text) {
      return { message: fallback };
    }
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      return { code: parsed.code, message: parsed.message ?? fallback };
    } catch {
      return { message: text };
    }
  }

  const prepareSessionForFiles = useCallback(
    async (nextFiles: File[], includeOfxSuggestions: boolean): Promise<PreparedImportSession> => {
      const key = fileListKey(nextFiles);
      if (
        preparedSession &&
        preparedSession.fileKey === key &&
        (!includeOfxSuggestions ||
          !nextFiles.some((f) => isOfxFileName(f.name)) ||
          Object.keys(preparedSession.ofxSuggestionByFileId).length > 0)
      ) {
        return preparedSession;
      }

      const sessionRes = await apiJson<{ session: { id: string } }>("/imports/sessions", {
        method: "POST",
        body: JSON.stringify({ sourceType: "upload" })
      });
      const sessionId = sessionRes.session.id;
      const uploadForm = new FormData();
      for (const file of nextFiles) {
        uploadForm.append("files", file);
      }
      const uploadRes = await apiFetch(`/imports/sessions/${sessionId}/files`, { method: "POST", body: uploadForm });
      const uploadText = await uploadRes.text();
      if (!uploadRes.ok) {
        const err = parseApiError(uploadText, "File upload failed");
        throw new Error(err.message);
      }
      const uploadBody = uploadText
        ? (JSON.parse(uploadText) as {
            files?: Array<{ id: string; fileName?: string; file_name?: string }>;
          })
        : {};
      const uploadedFiles: PreparedImportFile[] = (uploadBody.files ?? []).map((f, idx) => ({
        id: f.id,
        fileName: f.fileName ?? f.file_name ?? nextFiles[idx]?.name ?? ""
      }));

      const ofxSuggestionByFileId: Record<string, OfxSuggestion> = {};
      if (includeOfxSuggestions) {
        for (const uploaded of uploadedFiles) {
          if (!isOfxFileName(uploaded.fileName)) {
            continue;
          }
          try {
            const suggestion = await apiJson<OfxSuggestion>(
              `/imports/sessions/${sessionId}/files/${uploaded.id}/ofx-suggestion`
            );
            ofxSuggestionByFileId[uploaded.id] = suggestion;
          } catch {
            // non-fatal; caller handles fallback UI
          }
        }
      }

      const prepared: PreparedImportSession = {
        fileKey: key,
        sessionId,
        files: uploadedFiles,
        ofxSuggestionByFileId
      };
      setPreparedSession(prepared);
      return prepared;
    },
    [preparedSession]
  );

  const runOfxPreflight = useCallback(
    async (nextFiles: File[]) => {
      if (!nextFiles.some((f) => isOfxFileName(f.name))) {
        setOfxState({ loading: false, failed: false });
        return;
      }
      const thisRun = ++sniffRunRef.current;
      setOfxState({ loading: true, failed: false });
      try {
        const prepared = await prepareSessionForFiles(nextFiles, true);
        if (sniffRunRef.current !== thisRun) {
          return;
        }
        const matched = Object.values(prepared.ofxSuggestionByFileId).find((s) => s.matchedAccountId);
        if (matched?.matchedAccountId) {
          setFinancialAccountId(matched.matchedAccountId);
        }
        setOfxState({ loading: false, failed: false });
      } catch {
        if (sniffRunRef.current === thisRun) {
          setOfxState({ loading: false, failed: true });
        }
      }
    },
    [prepareSessionForFiles]
  );

  const loadSummaryForSession = useCallback(async (sessionId: string) => {
    if (summaryBySessionId[sessionId] || summaryLoadingBySessionId[sessionId]) {
      return;
    }
    setSummaryLoadingBySessionId((prev) => ({ ...prev, [sessionId]: true }));
    try {
      const summary = await apiJson<ImportSessionSummary>(`/imports/sessions/${sessionId}/summary`);
      setSummaryBySessionId((prev) => ({ ...prev, [sessionId]: summary }));
    } catch {
      setSummaryBySessionId((prev) => ({ ...prev, [sessionId]: undefined }));
    } finally {
      setSummaryLoadingBySessionId((prev) => ({ ...prev, [sessionId]: false }));
    }
  }, [summaryBySessionId, summaryLoadingBySessionId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setIsBootstrapping(true);
    setError(null);
    void Promise.all([
      apiJson<{ accounts: FinancialAccount[] }>("/imports/accounts"),
      apiJson<{ salaryDepositFinancialAccountId: string | null; employers: Employer[] }>("/household/settings"),
      apiJson<{ members: Array<{ id: string; fullName: string; relationship: string }> }>("/household/members").catch(
        async () => {
          const profile = await apiJson<{ profile: { id: string; fullName: string } }>("/household/profile");
          return {
            members: [{ id: profile.profile.id, fullName: profile.profile.fullName || "My profile", relationship: "" }]
          };
        }
      ),
      apiJson<{ items: ImportHistoryItem[] }>("/imports/history")
    ])
      .then(([accRes, settingsRes, membersRes, historyRes]) => {
        setAccounts(accRes.accounts ?? []);
        setEmployers(settingsRes.employers ?? []);
        setIncomeInference({
          salaryDepositAccountId: settingsRes.salaryDepositFinancialAccountId ?? null,
          employers: settingsRes.employers ?? []
        });
        setOwnerProfiles(
          (membersRes.members ?? []).map((m) => ({
            id: m.id,
            label: `${m.fullName}${m.relationship ? ` (${m.relationship})` : ""}`
          }))
        );
        setHistory(historyRes.items ?? []);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load import options");
      })
      .finally(() => setIsBootstrapping(false));
  }, [token]);

  useEffect(() => {
    if (currentRole === "member" && currentPersonProfileId) {
      const ownChoice = `person:${currentPersonProfileId}` as BelongsToChoice;
      setBelongsToChoice(ownChoice);
      setCreateBelongsToChoice(ownChoice);
    }
  }, [currentRole, currentPersonProfileId]);

  useEffect(() => {
    if (importType !== "bank" || !selectedAccount || files.length === 0) {
      setDetectedProfileId(null);
      return;
    }
    const inferred = inferParserProfile(selectedAccount, files[0]?.name ?? "", incomeInference);
    setDetectedProfileId(inferred);
  }, [files, importType, incomeInference, selectedAccount]);

  useEffect(() => {
    if (importType !== "payslip") {
      return;
    }
    if (employers.length === 0) {
      setDetectedProfileId(IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
      return;
    }
    const selectedEmployer = employers.find((e) => e.id === employerId);
    if (selectedEmployer?.parserProfileId) {
      setDetectedProfileId(selectedEmployer.parserProfileId);
      return;
    }
    if (employers.length === 1) {
      setDetectedProfileId(employers[0]?.parserProfileId ?? IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID);
      return;
    }
    setDetectedProfileId(null);
  }, [employerId, employers, importType]);

  useEffect(() => {
    if (!showCreateAccount) {
      return;
    }
    void loadInstitutions();
  }, [loadInstitutions, showCreateAccount]);

  useEffect(() => {
    if (importType !== "bank" || files.length === 0) {
      setPreparedSession(null);
      setOfxState({ loading: false, failed: false });
      resetCreateAccountForm();
      return;
    }
    if (files.some((f) => isOfxFileName(f.name))) {
      void runOfxPreflight(files);
    } else {
      setOfxState({ loading: false, failed: false });
      setPreparedSession(null);
      resetCreateAccountForm();
    }
  }, [currentFileKey, files, importType, runOfxPreflight]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (files.length === 0) {
      setError("Please choose at least one file.");
      return;
    }
    if (importType === "bank" && !financialAccountId) {
      setError("Please choose an account for bank import.");
      return;
    }

    setLoading(true);
    try {
      let session: PreparedImportSession;
      if (preparedSession && preparedSession.fileKey === currentFileKey) {
        session = preparedSession;
      } else {
        session = await prepareSessionForFiles(files, importType === "bank");
      }

      const ownership = parseBelongsToChoice(belongsToChoice);
      if (importType === "bank") {
        for (const uploaded of session.files) {
          const isOfx = isOfxFileName(uploaded.fileName);
          const parserProfileId = isOfx
            ? "ofx_transactions"
            : inferParserProfile(selectedAccount, uploaded.fileName, incomeInference);
          if (!parserProfileId) {
            setError("Format not recognised for this file/account combination. Try Advanced Import.");
            return;
          }
          await apiJson(`/imports/sessions/${session.sessionId}/files/${uploaded.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              financialAccountId,
              parserProfileId,
              ownerScope: ownership.ownerScope,
              ownerPersonProfileId: ownership.ownerPersonProfileId
            })
          });
        }
      } else {
        if (!payslipAccount) {
          setError("Payslip import account is not available. Please refresh and try again.");
          return;
        }
        let resolvedEmployerId: string | null = null;
        let resolvedParserProfileId = IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
        if (employers.length === 1) {
          resolvedEmployerId = employers[0]!.id;
          resolvedParserProfileId = employers[0]!.parserProfileId ?? IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
        } else if (employers.length > 1) {
          if (!employerId) {
            setError("Please choose an employer for payslip import.");
            return;
          }
          const selectedEmployer = employers.find((emp) => emp.id === employerId);
          if (!selectedEmployer) {
            setError("Selected employer is invalid.");
            return;
          }
          resolvedEmployerId = selectedEmployer.id;
          resolvedParserProfileId = selectedEmployer.parserProfileId ?? IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
        }
        for (const uploaded of session.files) {
          await apiJson(`/imports/sessions/${session.sessionId}/files/${uploaded.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              financialAccountId: payslipAccount.id,
              parserProfileId: resolvedParserProfileId,
              employerId: resolvedEmployerId,
              ownerScope: ownership.ownerScope,
              ownerPersonProfileId: ownership.ownerPersonProfileId
            })
          });
        }
      }

      const parseRes = await apiFetch(`/imports/sessions/${session.sessionId}/parse`, {
        method: "POST",
        body: JSON.stringify({})
      });
      const parseText = await parseRes.text();
      if (!parseRes.ok) {
        const err = parseApiError(parseText, `${parseRes.status} ${parseRes.statusText}`);
        setError(err.message);
        return;
      }
      const parseBody = parseText
        ? (JSON.parse(parseText) as {
            parsedFiles?: number;
            parsedRows?: number;
            skippedFiles?: Array<{ fileId: string; reason: string }>;
          })
        : {};

      const canonicalizeRes = await apiFetch(`/imports/sessions/${session.sessionId}/canonicalize`, {
        method: "POST",
        body: JSON.stringify({})
      });
      const canonicalizeText = await canonicalizeRes.text();
      if (!canonicalizeRes.ok) {
        const err = parseApiError(canonicalizeText, `${canonicalizeRes.status} ${canonicalizeRes.statusText}`);
        setError(err.message);
        return;
      }
      const canonicalizeBody = canonicalizeText
        ? (JSON.parse(canonicalizeText) as { inserted?: number; duplicates?: number; skipped?: number })
        : {};

      if (importType === "bank") {
        setSuccess(
          `Import complete. ${Number(canonicalizeBody.inserted ?? 0)} added · ${Number(
            canonicalizeBody.duplicates ?? 0
          )} duplicates · ${Number(parseBody.parsedRows ?? 0)} parsed rows.`
        );
      } else {
        setSuccess(
          `Payslip import complete. ${Number(parseBody.parsedFiles ?? 0)} file(s) parsed; ${
            parseBody.skippedFiles?.length ?? 0
          } skipped.`
        );
      }

      setSummaryBySessionId((prev) => {
        const next = { ...prev };
        delete next[session.sessionId];
        return next;
      });
      if (expandedHistoryRows[session.sessionId]) {
        void loadSummaryForSession(session.sessionId);
      }

      setFiles([]);
      setPreparedSession(null);
      setOfxState({ loading: false, failed: false });
      resetCreateAccountForm();
      await loadHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      if (msg.includes("DUPLICATE_PAYSLIP")) {
        setError("This payslip file has already been uploaded.");
      } else if (msg.includes("PROFILE_INFERENCE_FAILED")) {
        setError("Format not recognised for this file/account combination. Try Advanced Import.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function createAccountFromOfx(): Promise<void> {
    if (!createInstitution?.trim()) {
      setError("Institution is required.");
      return;
    }
    const owner = parseBelongsToChoice(createBelongsToChoice);
    setSavingAccount(true);
    try {
      const payload = {
        type: createAccountType,
        institution: createInstitution.trim(),
        accountMask: createLast4.trim() || null,
        ownerScope: owner.ownerScope,
        ownerPersonProfileId: owner.ownerPersonProfileId
      };
      const created = await apiJson<{ id: string }>("/imports/accounts", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const accRes = await apiJson<{ accounts: FinancialAccount[] }>("/imports/accounts");
      setAccounts(accRes.accounts ?? []);
      setFinancialAccountId(created.id);
      setSuccess("Account created and selected.");
      resetCreateAccountForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSavingAccount(false);
    }
  }

  async function confirmUndo(): Promise<void> {
    if (!undoTarget) {
      return;
    }
    const endpoint =
      undoTarget.type === "bank"
        ? `/imports/sessions/${undoTarget.id}/undo-import`
        : `/payslips/${undoTarget.id}`;
    const method = undoTarget.type === "bank" ? "POST" : "DELETE";

    const res = await apiFetch(endpoint, { method });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseApiError(text, "Undo failed").message);
    }
    setSuccess(undoTarget.type === "bank" ? "Import undone successfully." : "Payslip deleted successfully.");
    await loadHistory();
  }

  const ofxSuggestions = useMemo(() => preparedSession?.ofxSuggestionByFileId ?? {}, [preparedSession]);
  const firstOfxSuggestion = useMemo(
    () => Object.values(ofxSuggestions)[0] ?? null,
    [ofxSuggestions]
  );
  const ofxMessage = useMemo(() => {
    const suggestion = firstOfxSuggestion;
    if (!suggestion) {
      return null;
    }
    const last4 = suggestion.acctIdLast4 ? `...${suggestion.acctIdLast4}` : "account";
    const acctType = suggestion.normalizedAcctType ? ` (${suggestion.normalizedAcctType})` : "";
    const balance =
      suggestion.ledgerBalance != null
        ? `Balance as of ${suggestion.ledgerBalanceDate ?? "statement"}: ${fmtMoney(suggestion.ledgerBalance)} - auto-saved to net worth on import.`
        : null;
    if (suggestion.matchedAccountId) {
      return {
        color: "green",
        text: `OFX: ${last4}${acctType} \u2713 matched`,
        balance
      };
    }
    return {
      color: "yellow",
      text: `No account found for ${last4}${acctType}. Pick an account above or create new account.`,
      balance
    };
  }, [firstOfxSuggestion]);

  function toggleRowDetails(item: ImportHistoryItem) {
    if (item.type !== "bank") {
      return;
    }
    setExpandedHistoryRows((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
    if (!expandedHistoryRows[item.id]) {
      void loadSummaryForSession(item.id);
    }
  }

  return (
    <Stack gap="md" mt="md">
      <Paper withBorder shadow="xs" p="md">
        <Stack component="form" gap="sm" onSubmit={(e) => void onSubmit(e)}>
          <Text fw={700} size="lg">Import</Text>
          <Text c="dimmed" size="sm">
            One-shot upload for bank statements and payslips.
          </Text>

          {error ? (
            <Alert color="red">
              {error.includes("Try Advanced Import") ? (
                <>
                  {error.replace(" Try Advanced Import.", "")}{" "}
                  <Link to="/imports/workspace">Try Advanced Import -&gt;</Link>
                </>
              ) : (
                error
              )}
            </Alert>
          ) : null}
          {success ? <Alert color="green">{success}</Alert> : null}

          {isBootstrapping ? (
            <Group>
              <Loader size="sm" />
              <Text size="sm" c="dimmed">Loading import options...</Text>
            </Group>
          ) : null}

          <SegmentedControl
            data={[
              { label: "Bank / Card Statement", value: "bank" },
              { label: "Payslip", value: "payslip" }
            ]}
            value={importType}
            onChange={(value) => setImportType(value as ImportType)}
          />

          {importType === "bank" ? (
            <Stack gap={6}>
              <Group justify="space-between">
                <Text size="sm" fw={500}>Account</Text>
                {ofxState.loading ? <Loader size="xs" /> : null}
              </Group>
              <HierarchicalSearchPicker
                value={financialAccountId}
                onChange={(value) => setFinancialAccountId(value)}
                groups={accountGroups}
                placeholder="Choose account"
                ariaLabel="Bank account picker"
                footer={
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() => {
                      setCreateBelongsToChoice(belongsToChoice);
                      setShowCreateAccount(true);
                    }}
                  >
                    Add account
                  </Button>
                }
              />
              {detectedProfileId ? (
                <Text size="xs" c="dimmed">Detected format: {friendlyParserLabel(detectedProfileId)}</Text>
              ) : null}
            </Stack>
          ) : (
            <Stack gap={6}>
              {employers.length === 0 ? (
                <Text size="sm" c="dimmed">Employer: Auto-detect (IBM default)</Text>
              ) : employers.length === 1 ? (
                <Text size="sm" c="dimmed">Employer: {employers[0]?.displayName}</Text>
              ) : (
                <Select
                  label="Employer"
                  placeholder="Select employer"
                  data={employers.map((e) => ({ value: e.id, label: e.displayName }))}
                  value={employerId || null}
                  onChange={(value) => setEmployerId(value ?? "")}
                  allowDeselect={false}
                  withAsterisk
                />
              )}
              {detectedProfileId ? (
                <Text size="xs" c="dimmed">Detected format: {friendlyParserLabel(detectedProfileId)}</Text>
              ) : null}
            </Stack>
          )}

          <Select
            label="Belongs-to"
            data={belongsToOptions}
            value={belongsToChoice}
            onChange={(value) => setBelongsToChoice((value as BelongsToChoice) ?? "household")}
            allowDeselect={false}
          />

          <FileInput
            label="Files"
            placeholder="Choose one or more files"
            value={files}
            onChange={(value) => {
              if (!value) {
                setFiles([]);
                return;
              }
              setFiles(Array.isArray(value) ? value : [value]);
            }}
            accept=".csv,.pdf,.ofx,.qfx,.qbo"
            multiple
            clearable
          />

          {ofxState.failed && importType === "bank" && hasOfxFiles ? (
            <Text size="xs" c="dimmed">
              OFX detection unavailable right now. Continue by selecting account manually.
            </Text>
          ) : null}
          {ofxMessage && importType === "bank" && hasOfxFiles ? (
            <Stack gap={2}>
              <Text size="xs" c={ofxMessage.color === "green" ? "green" : "orange"}>
                {ofxMessage.text}
              </Text>
              {ofxMessage.balance ? <Text size="xs" c="dimmed">{ofxMessage.balance}</Text> : null}
              {!firstOfxSuggestion?.matchedAccountId ? (
                <Text size="xs">
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() => {
                      setShowCreateAccount(true);
                      setCreateAccountType(mapOfxTypeToAccountType(firstOfxSuggestion?.normalizedAcctType ?? null));
                      setCreateInstitution(firstOfxSuggestion?.institution ?? null);
                      setCreateLast4(firstOfxSuggestion?.acctIdLast4 ?? "");
                      setCreateBelongsToChoice(belongsToChoice);
                    }}
                  >
                    create new account
                  </Button>
                </Text>
              ) : null}
            </Stack>
          ) : null}

          <Group>
            <Button type="submit" disabled={!canSubmit}>
              {loading ? "Importing..." : "Import"}
            </Button>
          </Group>
        </Stack>
      </Paper>

      {showCreateAccount ? (
        <Paper withBorder shadow="sm" p="md">
          <Stack gap="sm">
            <Text fw={600}>Add account</Text>
            {loadingInstitutions ? (
              <Group>
                <Loader size="xs" />
                <Text size="xs" c="dimmed">Loading institutions...</Text>
              </Group>
            ) : null}
            <Select
              label="Type"
              data={ADDABLE_ACCOUNT_TYPES.map((value) => ({ value, label: formatAccountTypeLabel(value) }))}
              value={createAccountType}
              onChange={(value) => setCreateAccountType((value as (typeof ADDABLE_ACCOUNT_TYPES)[number]) ?? "checking")}
              allowDeselect={false}
            />
            <Stack gap={6}>
              <Text size="sm" fw={500}>Institution</Text>
              <HierarchicalSearchPicker
                value={createInstitution}
                onChange={setCreateInstitution}
                groups={institutionGroups}
                placeholder="Choose institution"
                ariaLabel="Institution picker"
                clearable
                footer={<Text size="xs" c="dimmed">Use Suggested or Your household institutions.</Text>}
              />
            </Stack>
            <TextInput
              label="Last 4"
              value={createLast4}
              maxLength={4}
              onChange={(e) => setCreateLast4(e.currentTarget.value.replace(/\D/g, "").slice(0, 4))}
            />
            <Select
              label="Belongs-to"
              data={belongsToOptions}
              value={createBelongsToChoice}
              onChange={(value) => setCreateBelongsToChoice((value as BelongsToChoice) ?? "household")}
              allowDeselect={false}
            />
            <Group>
              <Button onClick={() => void createAccountFromOfx()} loading={savingAccount}>
                Save
              </Button>
              <Button variant="default" onClick={() => resetCreateAccountForm()} disabled={savingAccount}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : null}

      <Paper withBorder shadow="xs" p="md">
        <Stack gap="sm">
          <Text fw={700}>Recent imports</Text>
          {historyLoading ? (
            <Group>
              <Loader size="sm" />
              <Text size="sm" c="dimmed">Loading history...</Text>
            </Group>
          ) : null}
          {!historyLoading && history.length === 0 ? <Text c="dimmed" size="sm">No imports yet.</Text> : null}
          {!historyLoading && history.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <Table striped withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>File</Table.Th>
                    <Table.Th>Result</Table.Th>
                    <Table.Th>Details</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((item) => {
                    const expanded = Boolean(expandedHistoryRows[item.id]);
                    const summary = summaryBySessionId[item.id];
                    const isSummaryLoading = Boolean(summaryLoadingBySessionId[item.id]);
                    return (
                      <Fragment key={`${item.type}-${item.id}`}>
                        <Table.Tr key={`${item.type}-${item.id}`}>
                          <Table.Td>{fmtDate(item.createdAt)}</Table.Td>
                          <Table.Td>
                            <Badge variant="light" color={item.type === "bank" ? "blue" : "grape"}>
                              {item.type === "bank" ? formatAccountTypeLabel(item.accountType) : "Payslip"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{item.label}</Table.Td>
                          <Table.Td>
                            {item.type === "bank"
                              ? item.addedCount == null && item.duplicateCount == null
                                ? "—"
                                : `${item.addedCount ?? 0} added · ${item.duplicateCount ?? 0} duplicates`
                              : "—"}
                          </Table.Td>
                          <Table.Td>
                            <Button
                              variant="subtle"
                              size="compact-sm"
                              disabled={item.type !== "bank"}
                              onClick={() => toggleRowDetails(item)}
                            >
                              {expanded ? "Hide" : "Show"}
                            </Button>
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            <Button
                              variant="subtle"
                              color="red"
                              disabled={!item.canUndo}
                              onClick={() => setUndoTarget(item)}
                            >
                              Undo
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                        {item.type === "bank" && expanded ? (
                          <Table.Tr key={`${item.id}-details`}>
                            <Table.Td colSpan={6}>
                              {isSummaryLoading ? (
                                <Group>
                                  <Loader size="xs" />
                                  <Text size="xs" c="dimmed">Loading details...</Text>
                                </Group>
                              ) : summary ? (
                                <Stack gap={6}>
                                  <Text size="xs" c="dimmed">
                                    Not posted includes exact duplicates or skipped lines. Near duplicates are sent to{" "}
                                    <Link to="/transactions?needsReview=true">Transactions → Needs Review</Link>.
                                  </Text>
                                  <Table withTableBorder withColumnBorders>
                                    <Table.Thead>
                                      <Table.Tr>
                                        <Table.Th>File status</Table.Th>
                                        <Table.Th>Parsed rows</Table.Th>
                                        <Table.Th>Posted to ledger</Table.Th>
                                        <Table.Th>Near-duplicates flagged</Table.Th>
                                        <Table.Th>Not posted (dup / skip)</Table.Th>
                                        <Table.Th>Reconciliation</Table.Th>
                                      </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                      {summary.files.map((f) => (
                                        <Table.Tr key={f.fileId}>
                                          <Table.Td>{f.fileName} ({f.status})</Table.Td>
                                          <Table.Td>{f.rawRowCount}</Table.Td>
                                          <Table.Td>{f.canonicalRowCount}</Table.Td>
                                          <Table.Td>{f.nearDuplicatesFlagged}</Table.Td>
                                          <Table.Td>{f.notPostedExactDuplicateOrSkipped}</Table.Td>
                                          <Table.Td>{f.reconciliation.available ? f.reconciliation.status : "N/A"}</Table.Td>
                                        </Table.Tr>
                                      ))}
                                    </Table.Tbody>
                                  </Table>
                                </Stack>
                              ) : (
                                <Text size="xs" c="dimmed">Details unavailable for this import.</Text>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </div>
          ) : null}

          <Text c="dimmed" size="xs">
            Need manual control or an unsupported format? <Link to="/imports/workspace">Advanced Import -&gt;</Link>
          </Text>
        </Stack>
      </Paper>

      <ConfirmDialog
        opened={Boolean(undoTarget)}
        title="Confirm undo"
        message={
          undoTarget?.type === "bank"
            ? "This will remove all transactions from this import. Are you sure?"
            : "This will delete this payslip snapshot. Are you sure?"
        }
        confirmLabel="Undo"
        danger
        onClose={() => setUndoTarget(null)}
        onConfirm={confirmUndo}
      />
    </Stack>
  );
}
