import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { inferParserProfile, type IncomeInferenceContext } from "../import/inferParserProfile";
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
  createdAt: string;
  label: string;
  status: string;
  addedCount: number | null;
  duplicateCount: number | null;
  canUndo: boolean;
};

type ImportUploadBankResult = {
  type: "bank";
  sessionId: string;
  addedCount: number;
  duplicateCount: number;
  parserProfileId: string;
};

type ImportUploadPayslipResult = {
  type: "payslip";
  snapshotId: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  netPayCurrent: number | null;
  employerDisplayName: string | null;
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
  sessionId: string | null;
  fileId: string | null;
  suggestion: OfxSuggestion | null;
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

function mapOfxTypeToAccountType(t: string | null): string {
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
  const [file, setFile] = useState<File | null>(null);
  const [financialAccountId, setFinancialAccountId] = useState<string | null>(null);
  const [employerId, setEmployerId] = useState("");
  const [belongsToChoice, setBelongsToChoice] = useState<BelongsToChoice>("household");

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<OwnerProfile[]>([]);
  const [incomeInference, setIncomeInference] = useState<IncomeInferenceContext>({});
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);

  const [detectedProfileId, setDetectedProfileId] = useState<string | null>(null);
  const [ofxState, setOfxState] = useState<OfxPreflightState>({
    loading: false,
    failed: false,
    sessionId: null,
    fileId: null,
    suggestion: null
  });

  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [createAccountType, setCreateAccountType] = useState("checking");
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
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const sniffRunRef = useRef(0);

  const bankAccounts = useMemo(() => accounts.filter((a) => a.type !== "payslip"), [accounts]);
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
    !!file &&
    (importType === "payslip" || !!financialAccountId) &&
    !(importType === "bank" && isOfxFileName(file?.name) && ofxState.loading);

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

  const runOfxPreflight = useCallback(
    async (nextFile: File) => {
      const thisRun = ++sniffRunRef.current;
      setOfxState({ loading: true, failed: false, sessionId: null, fileId: null, suggestion: null });
      try {
        const sessionRes = await apiJson<{ session: { id: string } }>("/imports/sessions", {
          method: "POST",
          body: JSON.stringify({ sourceType: "upload" })
        });
        const sessionId = sessionRes.session.id;
        const uploadForm = new FormData();
        uploadForm.append("files", nextFile);
        const uploadRes = await apiFetch(`/imports/sessions/${sessionId}/files`, {
          method: "POST",
          body: uploadForm
        });
        if (!uploadRes.ok) {
          throw new Error("OFX preflight upload failed");
        }
        const uploadJson = (await uploadRes.json()) as { files?: Array<{ id: string }> };
        const fileId = uploadJson.files?.[0]?.id;
        if (!fileId) {
          throw new Error("OFX preflight missing import file id");
        }
        const suggestion = await apiJson<OfxSuggestion>(
          `/imports/sessions/${sessionId}/files/${fileId}/ofx-suggestion`
        );
        if (sniffRunRef.current !== thisRun) {
          return;
        }

        if (suggestion.matchedAccountId) {
          setFinancialAccountId(suggestion.matchedAccountId);
          if (sessionId && fileId) {
            await apiJson(`/imports/sessions/${sessionId}/files/${fileId}`, {
              method: "PATCH",
              body: JSON.stringify({
                financialAccountId: suggestion.matchedAccountId,
                parserProfileId: "ofx_transactions",
                ownerScope: "household",
                ownerPersonProfileId: null
              })
            }).catch(() => {
              // Non-fatal; explicit confirm payload still includes selected account and owner.
            });
          }
        }
        setOfxState({ loading: false, failed: false, sessionId, fileId, suggestion });
      } catch {
        if (sniffRunRef.current === thisRun) {
          setOfxState({ loading: false, failed: true, sessionId: null, fileId: null, suggestion: null });
        }
      }
    },
    []
  );

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
    if (importType !== "bank" || !selectedAccount || !file) {
      setDetectedProfileId(null);
      return;
    }
    const inferred = inferParserProfile(selectedAccount, file.name, incomeInference);
    setDetectedProfileId(inferred);
  }, [file, importType, incomeInference, selectedAccount]);

  useEffect(() => {
    if (importType !== "payslip") {
      return;
    }
    const selectedEmployer = employers.find((e) => e.id === employerId);
    if (selectedEmployer?.parserProfileId) {
      setDetectedProfileId(selectedEmployer.parserProfileId);
      return;
    }
    if (!selectedEmployer && employers.length === 1) {
      setDetectedProfileId(employers[0]?.parserProfileId ?? "ibm_pay_contributions_pdf");
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
    if (importType !== "bank" || !file || !isOfxFileName(file.name)) {
      setOfxState({ loading: false, failed: false, sessionId: null, fileId: null, suggestion: null });
      setShowCreateAccount(false);
      return;
    }
    void runOfxPreflight(file);
  }, [file, importType, runOfxPreflight]);

  function parseErrorMessageFromResponse(status: number, statusText: string, text: string): { code?: string; message: string } {
    if (!text) {
      return { message: `${status} ${statusText}` };
    }
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      return { code: parsed.code, message: parsed.message ?? `${status} ${statusText}` };
    } catch {
      return { message: text };
    }
  }

  if (!token) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError("Please choose a file.");
      return;
    }
    if (importType === "bank" && !financialAccountId) {
      setError("Please choose an account for bank import.");
      return;
    }

    setLoading(true);
    try {
      const ownership = parseBelongsToChoice(belongsToChoice);
      const isOfxBankImport = importType === "bank" && isOfxFileName(file.name) && !ofxState.failed && !!ofxState.sessionId && !!ofxState.fileId;

      if (isOfxBankImport) {
        const res = await apiFetch(`/imports/sessions/${ofxState.sessionId}/ofx-confirm`, {
          method: "POST",
          body: JSON.stringify({
            fileId: ofxState.fileId,
            financialAccountId,
            ownerScope: ownership.ownerScope,
            ownerPersonProfileId: ownership.ownerPersonProfileId
          })
        });
        const text = await res.text();
        const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        if (!res.ok) {
          const err = parseErrorMessageFromResponse(res.status, res.statusText, text);
          setError(err.message);
          return;
        }
        const added = Number(body.inserted ?? 0);
        const dupes = Number(body.duplicates ?? 0);
        setSuccess(`Import complete. ${added} added · ${dupes} duplicates.`);
      } else {
        const form = new FormData();
        form.append("file", file);
        form.append("importType", importType);
        if (importType === "bank" && financialAccountId) {
          form.append("financialAccountId", financialAccountId);
        } else if (employerId) {
          form.append("employerId", employerId);
        }
        const res = await apiFetch("/imports/upload", { method: "POST", body: form });
        const text = await res.text();
        const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        if (!res.ok) {
          const code = String((body.code ?? "") as string);
          if (code === "PROFILE_INFERENCE_FAILED") {
            setError("Format not recognised for this file/account combination. Try Advanced Import.");
          } else if (code === "DUPLICATE_PAYSLIP") {
            setError("This payslip file has already been uploaded.");
          } else {
            setError(String((body.message ?? `${res.status} ${res.statusText}`) as string));
          }
          return;
        }

        if ((body.type as string) === "bank") {
          const payload = body as unknown as ImportUploadBankResult;
          setSuccess(`Import complete. ${payload.addedCount} added · ${payload.duplicateCount} duplicates.`);
        } else {
          const payload = body as unknown as ImportUploadPayslipResult;
          setSuccess(
            `Payslip saved${payload.employerDisplayName ? ` for ${payload.employerDisplayName}` : ""}. Net pay: ${fmtMoney(payload.netPayCurrent)}.`
          );
        }
      }
      setFile(null);
      setOfxState({ loading: false, failed: false, sessionId: null, fileId: null, suggestion: null });
      setShowCreateAccount(false);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
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
      setShowCreateAccount(false);
      if (ofxState.suggestion) {
        setOfxState({
          ...ofxState,
          suggestion: {
            ...ofxState.suggestion,
            matchedAccountId: created.id
          }
        });
      }
      setSuccess("Account created and selected.");
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
      try {
        const parsed = JSON.parse(text) as { message?: string };
        throw new Error(parsed.message || "Undo failed");
      } catch {
        throw new Error(text || "Undo failed");
      }
    }
    setSuccess(undoTarget.type === "bank" ? "Import undone successfully." : "Payslip deleted successfully.");
    await loadHistory();
  }

  const ofxMessage = useMemo(() => {
    const suggestion = ofxState.suggestion;
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
        text: `OFX: ${last4}${acctType} - matched.`,
        balance
      };
    }
    return {
      color: "yellow",
      text: `No account found for ${last4}${acctType}. Pick an account above or create new account.`,
      balance
    };
  }, [ofxState.suggestion]);

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
              />
              {detectedProfileId ? (
                <Text size="xs" c="dimmed">Detected format: {friendlyParserLabel(detectedProfileId)}</Text>
              ) : null}
            </Stack>
          ) : (
            <Stack gap={6}>
              <Select
                label="Employer"
                placeholder="Auto-select"
                data={[
                  { value: "", label: "Auto-select" },
                  ...employers.map((e) => ({ value: e.id, label: e.displayName }))
                ]}
                value={employerId}
                onChange={(value) => setEmployerId(value ?? "")}
                clearable={false}
              />
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
            label="File"
            placeholder="Choose file"
            value={file}
            onChange={setFile}
            accept=".csv,.pdf,.ofx,.qfx,.qbo"
          />

          {ofxState.failed && importType === "bank" && file && isOfxFileName(file.name) ? (
            <Text size="xs" c="dimmed">
              OFX detection unavailable right now. Continue by selecting account manually.
            </Text>
          ) : null}
          {ofxMessage && importType === "bank" && file && isOfxFileName(file.name) ? (
            <Stack gap={2}>
              <Text size="xs" c={ofxMessage.color === "green" ? "green" : "orange"}>
                {ofxMessage.text}
              </Text>
              {ofxMessage.balance ? <Text size="xs" c="dimmed">{ofxMessage.balance}</Text> : null}
              {!ofxState.suggestion?.matchedAccountId ? (
                <Text size="xs">
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() => {
                      setShowCreateAccount(true);
                      setCreateAccountType(mapOfxTypeToAccountType(ofxState.suggestion?.normalizedAcctType ?? null));
                      setCreateInstitution(ofxState.suggestion?.institution ?? null);
                      setCreateLast4(ofxState.suggestion?.acctIdLast4 ?? "");
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
            <Text fw={600}>Create account for OFX file</Text>
            {loadingInstitutions ? (
              <Group>
                <Loader size="xs" />
                <Text size="xs" c="dimmed">Loading institutions...</Text>
              </Group>
            ) : null}
            <Select
              label="Type"
              data={[
                { value: "checking", label: "checking" },
                { value: "savings", label: "savings" },
                { value: "credit_card", label: "credit_card" },
                { value: "investment", label: "investment" },
                { value: "loan", label: "loan" },
                { value: "mortgage", label: "mortgage" },
                { value: "retirement", label: "retirement" }
              ]}
              value={createAccountType}
              onChange={(value) => setCreateAccountType(value ?? "checking")}
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
              <Button variant="default" onClick={() => setShowCreateAccount(false)} disabled={savingAccount}>
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
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((item) => (
                    <Table.Tr key={`${item.type}-${item.id}`}>
                      <Table.Td>{fmtDate(item.createdAt)}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={item.type === "bank" ? "blue" : "grape"}>
                          {item.type === "bank" ? "Bank" : "Payslip"}
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
                  ))}
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
