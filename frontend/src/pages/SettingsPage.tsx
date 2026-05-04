import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  FileInput,
  Fieldset,
  Group,
  Modal,
  MultiSelect,
  NumberFormatter,
  NumberInput,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title
} from "@mantine/core";
import { IconTrash, IconUpload } from "@tabler/icons-react";

import { apiFetch, apiJson, getToken, setToken, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { RecurringTagModal, type RecurringOverride } from "../components/RecurringTagModal";
import { formatAccountForSelect, formatAccountFreshness } from "../import/accountDisplay";
import { US_INSTITUTION_LABELS } from "../import/institutionCatalog";

const TABS = ["profile", "household", "accounts", "recurring", "data"] as const;
type SettingsTab = (typeof TABS)[number];

function isTab(s: string | null): s is SettingsTab {
  return s !== null && (TABS as readonly string[]).includes(s);
}

type HouseholdSettingsResponse = {
  monthlySavingsTargetUsd: number | null;
  salaryDepositFinancialAccountId: string | null;
  city: string | null;
  state: string | null;
  combinedGrossIncomeUsd: number | null;
  employers: Array<{
    id: string;
    displayName: string;
    parserProfileId?: string;
    parserMapping?: Record<string, unknown>;
    salaryDepositFinancialAccountId?: string | null;
  }>;
};

type AccountRow = {
  id: string;
  institution: string;
  type: string;
  account_mask: string | null;
  last_uploaded_at?: string | null;
  last_statement_end_date?: string | null;
  owner_scope?: "household" | "person";
  owner_person_profile_id?: string | null;
  default_parser_profile_id?: string | null;
};

type GDriveStatus = {
  connected: boolean;
  folderId?: string;
  folderName?: string | null;
  connectedAt?: string;
  connectedByUserId?: string | null;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};

type DriveBackupEntry = {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  createdAt: string;
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

function buildBelongsToGroups(accountOwners: Array<{ id: string; label: string }>): HierarchicalPickerGroup[] {
  return [
    { group: "Household", items: [{ value: "household", label: "Household", searchText: "household" }] },
    {
      group: "Members",
      items: accountOwners.map((p) => ({
        value: `person:${p.id}`,
        label: formatBelongsToLabel(p.label),
        displayLabel: p.label,
        searchText: p.label
      }))
    }
  ];
}

type EmployerDraft = { id?: string; displayName: string; parserProfileId: string; salaryDepositAccountId: string };

type HouseholdProfileResponse = {
  profile: {
    id: string;
    householdId: string;
    linkedUserId: string | null;
    fullName: string;
    email: string | null;
    phoneNumber: string | null;
    avatarKey: string | null;
    role: "head" | "member";
    relationship: "self" | "spouse" | "child" | "dependent" | "other";
    age: number | null;
    sex: "male" | "female" | "nonbinary" | "prefer_not_to_say" | null;
    individualGrossIncomeUsd: number | null;
    riskTolerance: "conservative" | "moderate" | "aggressive" | null;
    financialGoals: string[];
  };
};

type HouseholdMemberResponse = {
  id: string;
  householdId: string;
  linkedUserId: string | null;
  firstName?: string;
  lastName?: string;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  avatarKey: string | null;
  role: "head" | "member";
  relationship: "self" | "spouse" | "child" | "dependent" | "other";
};

type HouseholdMembersPayload = {
  members?: HouseholdMemberResponse[];
};

type ProfileDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarIconKey: string;
  age: string;
  sex: "" | "male" | "female" | "nonbinary" | "prefer_not_to_say";
  individualGrossIncomeUsd: string;
  riskTolerance: "" | "conservative" | "moderate" | "aggressive";
  financialGoals: string[];
  employers: EmployerDraft[];
};

type HouseholdMemberDraft = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  relationship: string;
  linkedUserId?: string | null;
  createLogin?: boolean;
};

type MeResponse = { user: { role: "owner" | "admin" | "member" } };

type BackupPreview = {
  exportVersion: number;
  exportedAt: string;
  encrypted: boolean;
  scope: "household" | "member";
  personProfileId?: string;
  format: string;
  tables: Record<string, { rows: number }>;
  totalRows: number;
};

type InstitutionsResponse = {
  catalog: string[];
  custom: Array<{ id: string; displayName: string }>;
};

const PROFILE_ICON_KEYS = ["person", "home", "wallet", "briefcase", "star"] as const;

const BACKUP_TABLE_LABELS: Record<string, string> = {
  app_user: "Users",
  household: "Household settings",
  financial_account: "Financial accounts",
  category: "Categories",
  category_rule: "Category rules",
  budget_category: "Budget months",
  transaction_canonical: "Transactions",
  account_balance_snapshot: "Balance snapshots",
  payslip_snapshot: "Payslips",
  payslip_line_item: "Payslip line items",
  recurring_merchant_override: "Recurring overrides",
  resolution_item: "Resolution items",
  household_ai_insight: "AI insights",
  household_membership: "Memberships",
  household_custom_institution: "Custom institutions",
  person_profile: "Person profiles"
};

const AVATAR_KEY_EMOJI: Record<(typeof PROFILE_ICON_KEYS)[number], string> = {
  person: "👤",
  home: "🏠",
  wallet: "💳",
  briefcase: "💼",
  star: "⭐"
};

function avatarEmojiPreview(key: string): string {
  return AVATAR_KEY_EMOJI[key as keyof typeof AVATAR_KEY_EMOJI] ?? "👤";
}

function normalizeProfileDraft(payload: HouseholdProfileResponse): ProfileDraft {
  const p = payload.profile;
  const [firstName, ...lastNameParts] = (p.fullName ?? "").trim().split(/\s+/);
  return {
    firstName: firstName ?? "",
    lastName: lastNameParts.join(" "),
    email: p.email ?? "",
    phone: (p.phoneNumber ?? "").trim(),
    avatarIconKey: (p.avatarKey ?? PROFILE_ICON_KEYS[0]).trim() || PROFILE_ICON_KEYS[0],
    age: p.age == null ? "" : String(p.age),
    sex: p.sex ?? "",
    individualGrossIncomeUsd: p.individualGrossIncomeUsd == null ? "" : String(p.individualGrossIncomeUsd),
    riskTolerance: p.riskTolerance ?? "",
    financialGoals: Array.isArray(p.financialGoals) ? p.financialGoals : [],
    employers: [{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf", salaryDepositAccountId: "" }]
  };
}

function normalizeMembersPayload(payload: HouseholdMembersPayload | HouseholdMemberResponse[]): HouseholdMemberDraft[] {
  const rawMembers = Array.isArray(payload) ? payload : payload.members ?? [];
  if (!Array.isArray(rawMembers)) {
    return [];
  }
  return rawMembers.map((member) => ({
    id: member.id,
    firstName: member.firstName ?? member.fullName.trim().split(/\s+/)[0] ?? "",
    lastName: member.lastName ?? member.fullName.trim().split(/\s+/).slice(1).join(" "),
    email: member.email ?? "",
    linkedUserId: member.linkedUserId,
    role: member.role,
    relationship: member.relationship
  }));
}

export function SettingsPage() {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: SettingsTab = isTab(tabParam) ? tabParam : "profile";

  const setTab = useCallback(
    (next: SettingsTab) => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", next);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const [targetDraft, setTargetDraft] = useState("");
  const [householdCityDraft, setHouseholdCityDraft] = useState("");
  const [householdStateDraft, setHouseholdStateDraft] = useState("");
  const [householdIncomeDraft, setHouseholdIncomeDraft] = useState("");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadingHousehold, setLoadingHousehold] = useState(true);
  const [savingHousehold, setSavingHousehold] = useState(false);
  const [householdError, setHouseholdError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    avatarIconKey: PROFILE_ICON_KEYS[0],
    age: "",
    sex: "",
    individualGrossIncomeUsd: "",
    riskTolerance: "",
    financialGoals: [],
    employers: [{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf", salaryDepositAccountId: "" }]
  });
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [memberDrafts, setMemberDrafts] = useState<HouseholdMemberDraft[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersSuccess, setMembersSuccess] = useState<string | null>(null);
  const [savingMemberIndex, setSavingMemberIndex] = useState<number | null>(null);
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<string | null>(null);
  const [removeMemberDeleteLogin, setRemoveMemberDeleteLogin] = useState(false);
  const [removeMemberDataCount, setRemoveMemberDataCount] = useState<{ transactions: number; payslips: number } | null>(null);
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null);
  const [creatingLoginForId, setCreatingLoginForId] = useState<string | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [resetPasswordForId, setResetPasswordForId] = useState<string | null>(null);
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
  const [resetPasswordResult, setResetPasswordResult] = useState<{ memberId: string; tempPassword: string } | null>(null);
  const [passwordDraft, setPasswordDraft] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);
  const [authRole, setAuthRole] = useState<"owner" | "admin" | "member" | null>(null);
  const [accountOwners, setAccountOwners] = useState<Array<{ id: string; label: string }>>([]);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [exportZipBusy, setExportZipBusy] = useState(false);
  const [exportZipJobId, setExportZipJobId] = useState<string | null>(null);
  const [exportZipMessage, setExportZipMessage] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importStats, setImportStats] = useState<Record<string, number> | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewData, setPreviewData] = useState<BackupPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [institutionCatalogList, setInstitutionCatalogList] = useState<string[]>([...US_INSTITUTION_LABELS]);
  const [institutionCustom, setInstitutionCustom] = useState<Array<{ id: string; displayName: string }>>([]);
  const [recurringOverrides, setRecurringOverrides] = useState<RecurringOverride[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [editingOverride, setEditingOverride] = useState<RecurringOverride | null>(null);
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveLoading, setGdriveLoading] = useState(false);
  const [gdriveConnecting, setGdriveConnecting] = useState(false);
  const [gdriveError, setGdriveError] = useState<string | null>(null);
  const [gdriveSuccess, setGdriveSuccess] = useState<string | null>(null);
  const [gdriveKeyInput, setGdriveKeyInput] = useState("");
  const [gdriveFolderIdInput, setGdriveFolderIdInput] = useState("");
  const [gdriveDisconnectConfirm, setGdriveDisconnectConfirm] = useState(false);
  const [backupJobId, setBackupJobId] = useState<string | null>(null);
  const [backupPolling, setBackupPolling] = useState(false);
  const [backupResult, setBackupResult] = useState<{ ok: boolean; fileName?: string; error?: string } | null>(null);
  const [driveBackups, setDriveBackups] = useState<DriveBackupEntry[] | null>(null);
  const [driveBackupsLoading, setDriveBackupsLoading] = useState(false);
  const [driveBackupsError, setDriveBackupsError] = useState<string | null>(null);
  const [driveRestoreConfirmFileId, setDriveRestoreConfirmFileId] = useState<string | null>(null);
  const [driveRestoreJobId, setDriveRestoreJobId] = useState<string | null>(null);
  const [driveRestorePolling, setDriveRestorePolling] = useState(false);
  const [driveRestoreError, setDriveRestoreError] = useState<string | null>(null);
  const [accountDraft, setAccountDraft] = useState({
    id: "",
    type: "checking",
    institution: "",
    accountMask: "",
    belongsTo: "household" as BelongsToChoice,
    initialBalance: "",
    initialBalanceDate: new Date().toISOString().slice(0, 10)
  });

  const canManageHousehold = authRole === "owner" || authRole === "admin";

  const loadInstitutions = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const r = await apiJson<InstitutionsResponse>("/imports/institutions");
      setInstitutionCatalogList(r.catalog);
      setInstitutionCustom(r.custom);
    } catch {
      setInstitutionCatalogList([...US_INSTITUTION_LABELS]);
      setInstitutionCustom([]);
    }
  }, [token]);

  const institutionPickerGroups = useMemo((): HierarchicalPickerGroup[] => {
    const catalogItems = institutionCatalogList.map((label) => ({
      value: label,
      label,
      searchText: label
    }));
    const customItems = institutionCustom.map((c) => ({
      value: c.displayName,
      label: c.displayName,
      searchText: c.displayName
    }));
    return [
      { group: "Suggested", items: catalogItems },
      ...(customItems.length > 0 ? [{ group: "Your household", items: customItems }] : [])
    ];
  }, [institutionCatalogList, institutionCustom]);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const [response, settings, acct] = await Promise.all([
        apiJson<HouseholdProfileResponse>("/household/profile"),
        apiJson<HouseholdSettingsResponse>("/household/settings"),
        apiJson<{ accounts: AccountRow[] }>("/imports/accounts")
      ]);
      setAccounts(acct.accounts);
      const base = normalizeProfileDraft(response);
      setProfileDraft({
        ...base,
        employers:
          settings.employers.length > 0
            ? settings.employers.map((e) => ({
                id: e.id,
                displayName: e.displayName,
                parserProfileId: e.parserProfileId ?? "ibm_pay_contributions_pdf",
                salaryDepositAccountId: e.salaryDepositFinancialAccountId ?? ""
              }))
            : [{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf", salaryDepositAccountId: "" }]
      });
    } catch (e: unknown) {
      setProfileError(e instanceof Error ? e.message : "Could not load profile");
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMembersError(null);
    setMembersSuccess(null);
    try {
      const response = await apiJson<HouseholdMembersPayload | HouseholdMemberResponse[]>("/household/members");
      const normalized = normalizeMembersPayload(response);
      setMemberDrafts(
        normalized.length > 0
          ? normalized
          : [{ firstName: "", lastName: "", email: "", role: "member", relationship: "other" }]
      );
    } catch (e: unknown) {
      setMembersError(e instanceof Error ? e.message : "Could not load household members");
      setMemberDrafts([{ firstName: "", lastName: "", email: "", role: "member", relationship: "other" }]);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const loadHousehold = useCallback(async () => {
    setLoadingHousehold(true);
    setHouseholdError(null);
    try {
      const [r, acct] = await Promise.all([
        apiJson<HouseholdSettingsResponse>("/household/settings"),
        apiJson<{ accounts: AccountRow[] }>("/imports/accounts")
      ]);
      setAccounts(acct.accounts);
      setTargetDraft(r.monthlySavingsTargetUsd != null ? String(r.monthlySavingsTargetUsd) : "");
      setHouseholdCityDraft(r.city ?? "");
      setHouseholdStateDraft(r.state ?? "");
      setHouseholdIncomeDraft(r.combinedGrossIncomeUsd == null ? "" : String(r.combinedGrossIncomeUsd));
    } catch (e: unknown) {
      setHouseholdError(e instanceof Error ? e.message : "Could not load settings");
      setTargetDraft("");
      setHouseholdCityDraft("");
      setHouseholdStateDraft("");
      setHouseholdIncomeDraft("");
    } finally {
      setLoadingHousehold(false);
    }
  }, []);

  const runHouseholdZipExport = useCallback(async () => {
    if (!token) return;
    setExportZipBusy(true);
    setExportZipMessage(null);
    setExportZipJobId(null);
    try {
      const { jobId } = await apiJson<{ jobId: string }>("/exports/household", { method: "POST" });
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const st = await apiJson<{ status: string; error: string | null }>(`/exports/${jobId}`);
        if (st.status === "failed") throw new Error(st.error ?? "Export failed");
        if (st.status === "complete") {
          setExportZipJobId(jobId);
          setExportZipMessage("Export ready — click the link below to download.");
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      throw new Error("Export timed out; wait a moment and try again.");
    } catch (e: unknown) {
      setExportZipMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setExportZipBusy(false);
    }
  }, [token]);

  const downloadExportZip = useCallback(async (jobId: string) => {
    try {
      const res = await apiFetch(`/exports/${jobId}/download`);
      if (!res.ok) {
        const txt = await res.text();
        let msg = `Download failed (${res.status})`;
        try {
          const body = JSON.parse(txt) as { code?: string; message?: string };
          if (body.code === "EXPORT_EXPIRED") {
            msg = "This export has expired (files are kept for 48 hours). Please start a new export.";
            setExportZipJobId(null);
          } else {
            msg = body.message ?? msg;
          }
        } catch { /* ignore */ }
        setExportZipMessage(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `household-export-${jobId}.hfb`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setExportZipMessage(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const runHouseholdRestore = useCallback(async () => {
    if (!token || !importFile) return;
    setImportBusy(true);
    setImportMessage(null);
    setImportSuccess(false);
    setImportStats(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await apiFetch("/exports/household/import", { method: "POST", body: formData });
      if (!res.ok) {
        const txt = await res.text();
        let msg = `Upload failed (${res.status})`;
        try { msg = (JSON.parse(txt) as { message?: string }).message ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const { jobId } = (await res.json()) as { jobId: string };
      setImportMessage("Restoring… this may take a minute.");
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        const st = await apiJson<{ status: string; error: string | null; stats: Record<string, number> | null }>(`/exports/import/${jobId}`);
        if (st.status === "failed") throw new Error(st.error ?? "Restore failed");
        if (st.status === "complete") {
          setImportStats(st.stats);
          setImportSuccess(true);
          setImportMessage("Restore complete. Signing you out in 3 seconds…");
          setTimeout(() => {
            setToken(null);
            window.location.href = "/";
          }, 3000);
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Restore timed out.");
    } catch (e: unknown) {
      setImportMessage(e instanceof Error ? e.message : String(e));
      setImportSuccess(false);
    } finally {
      setImportBusy(false);
    }
  }, [token, importFile]);

  const handlePreviewAndRestore = useCallback(async () => {
    if (!importFile) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewData(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await apiFetch("/exports/preview", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPreviewError((body as { message?: string }).message ?? "Could not read backup file.");
        return;
      }
      const data = (await res.json()) as BackupPreview;
      setPreviewData(data);
      setPreviewModalOpen(true);
    } catch {
      setPreviewError("Failed to contact server.");
    } finally {
      setPreviewBusy(false);
    }
  }, [importFile]);

  const handleGDriveConnect = useCallback(async () => {
    setGdriveError(null);
    setGdriveSuccess(null);
    setGdriveConnecting(true);
    try {
      const res = await apiFetch("/gdrive/connect", {
        method: "POST",
        body: JSON.stringify({
          serviceAccountKeyJson: gdriveKeyInput.trim(),
          folderId: gdriveFolderIdInput.trim()
        })
      });
      const raw = await res.text();
      let errPayload: { message?: string } = {};
      if (raw.trim()) {
        try {
          errPayload = JSON.parse(raw) as { message?: string };
        } catch {
          setGdriveError(
            res.ok
              ? "Invalid response from server after connect."
              : `Request failed (${res.status}). Server did not return JSON.`
          );
          return;
        }
      }
      if (!res.ok) {
        setGdriveError(errPayload.message ?? "Could not connect to Google Drive.");
        return;
      }
      const refreshed = await apiJson<GDriveStatus>("/gdrive/status");
      setGdriveStatus(refreshed);
      setGdriveKeyInput("");
      setGdriveFolderIdInput("");
      setGdriveSuccess(
        `Connected to folder "${refreshed.folderName ?? refreshed.folderId ?? ""}".`
      );
    } catch (e: unknown) {
      setGdriveError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setGdriveConnecting(false);
    }
  }, [gdriveKeyInput, gdriveFolderIdInput]);

  const handleGDriveDisconnect = useCallback(async () => {
    setGdriveDisconnectConfirm(false);
    setGdriveError(null);
    setGdriveSuccess(null);
    try {
      await apiFetch("/gdrive/disconnect", { method: "DELETE" });
      setGdriveStatus({ connected: false });
      setBackupResult(null);
      setBackupPolling(false);
      setBackupJobId(null);
      setDriveBackups(null);
      setDriveBackupsError(null);
      setDriveRestorePolling(false);
      setDriveRestoreJobId(null);
      setDriveRestoreError(null);
      setGdriveSuccess("Google Drive disconnected.");
    } catch {
      setGdriveError("Could not disconnect. Please try again.");
    }
  }, []);

  const handleBackupNow = useCallback(async () => {
    setBackupResult(null);
    setBackupPolling(true);
    try {
      const res = await apiFetch("/gdrive/backup", { method: "POST" });
      const body = (await res.json()) as { jobId?: string; message?: string };
      if (!res.ok || !body.jobId) {
        setBackupResult({ ok: false, error: (body as { message?: string }).message ?? "Could not start backup." });
        setBackupPolling(false);
        return;
      }
      setBackupJobId(body.jobId);
    } catch {
      setBackupResult({ ok: false, error: "Could not reach server." });
      setBackupPolling(false);
    }
  }, []);

  const loadDriveBackups = useCallback(async () => {
    setDriveBackupsLoading(true);
    setDriveBackupsError(null);
    try {
      const res = await apiJson<{ files: DriveBackupEntry[] }>("/gdrive/backups");
      setDriveBackups(res.files);
    } catch {
      setDriveBackupsError("Could not load Drive backup list.");
    } finally {
      setDriveBackupsLoading(false);
    }
  }, []);

  const handleDriveRestore = useCallback(async (fileId: string) => {
    setDriveRestoreConfirmFileId(null);
    setDriveRestoreError(null);
    setDriveRestorePolling(true);
    try {
      const res = await apiFetch("/gdrive/restore", {
        method: "POST",
        body: JSON.stringify({ fileId })
      });
      const body = (await res.json()) as { jobId?: string; message?: string };
      if (!res.ok || !body.jobId) {
        setDriveRestoreError(body.message ?? "Could not start restore.");
        setDriveRestorePolling(false);
        return;
      }
      setDriveRestoreJobId(body.jobId);
    } catch {
      setDriveRestoreError("Could not reach server.");
      setDriveRestorePolling(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/auth/capabilities");
        if (res.ok) {
          const body = (await res.json()) as { emailEnabled?: boolean };
          setEmailEnabled(Boolean(body.emailEnabled));
        }
      } catch {
        // keep false
      }
    })();
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<MeResponse>("/auth/me")
      .then((r) => {
        setAuthRole(r.user.role);
      })
      .catch(() => {
        setAuthRole(null);
      });
  }, [token]);

  useEffect(() => {
    if (!token || tab !== "household") {
      return;
    }
    if (!canManageHousehold) {
      setTab("profile");
      return;
    }
    void loadHousehold();
  }, [token, tab, canManageHousehold, loadHousehold, setTab]);

  useEffect(() => {
    if (!token || tab !== "profile") {
      return;
    }
    void loadProfile();
  }, [token, tab, loadProfile]);

  useEffect(() => {
    if (!token || tab !== "household") {
      return;
    }
    if (!canManageHousehold) {
      return;
    }
    void loadMembers();
  }, [token, tab, canManageHousehold, loadMembers]);

  useEffect(() => {
    if (!token || tab !== "accounts") {
      return;
    }
    setAccountError(null);
    setAccountSuccess(null);
    void apiJson<{ accounts: AccountRow[] }>("/imports/accounts")
      .then((r) => setAccounts(r.accounts))
      .catch((e: unknown) => setAccountError(e instanceof Error ? e.message : "Could not load accounts"));
    if (canManageHousehold) {
      void apiJson<HouseholdMembersPayload>("/household/members")
        .then((r) => {
          const rows = (r.members ?? []).map((m) => ({
            id: m.id,
            label: `${m.fullName || m.email || m.id}${m.relationship ? ` (${m.relationship})` : ""}`
          }));
          setAccountOwners(rows);
        })
        .catch(() => setAccountOwners([]));
    } else {
      void apiJson<HouseholdProfileResponse>("/household/profile")
        .then((r) =>
          setAccountOwners([{ id: r.profile.id, label: r.profile.fullName || r.profile.email || "My profile" }])
        )
        .catch(() => setAccountOwners([]));
    }
    void loadInstitutions();
  }, [token, tab, canManageHousehold, loadInstitutions]);

  useEffect(() => {
    if (!token || tab !== "recurring") return;
    setRecurringLoading(true);
    setRecurringError(null);
    void apiJson<{ ok: boolean; data: RecurringOverride[] }>("/recurring-overrides")
      .then((res) => {
        if (res.ok) setRecurringOverrides(res.data);
        else setRecurringError("Failed to load recurring overrides.");
      })
      .catch(() => setRecurringError("Failed to load recurring overrides."))
      .finally(() => setRecurringLoading(false));
  }, [token, tab]);

  useEffect(() => {
    if (!token || tab !== "data" || !canManageHousehold) return;
    setGdriveLoading(true);
    void apiJson<GDriveStatus>("/gdrive/status")
      .then((r) => setGdriveStatus(r))
      .catch(() => setGdriveStatus({ connected: false }))
      .finally(() => setGdriveLoading(false));
  }, [token, tab, canManageHousehold]);

  useEffect(() => {
    if (!backupJobId || !backupPolling) return;
    let cancelled = false;
    const deadline = Date.now() + 3 * 60 * 1000;
    void (async () => {
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) break;
        try {
          const st = await apiJson<{
            status: string;
            driveFileName?: string | null;
            errorText?: string | null;
          }>(`/gdrive/backup/${encodeURIComponent(backupJobId)}`);
          if (st.status === "complete") {
            setBackupResult({ ok: true, fileName: st.driveFileName ?? undefined });
            setBackupPolling(false);
            setBackupJobId(null);
            return;
          }
          if (st.status === "failed") {
            setBackupResult({ ok: false, error: st.errorText ?? "Backup failed." });
            setBackupPolling(false);
            setBackupJobId(null);
            return;
          }
        } catch {
          /* keep polling */
        }
      }
      if (!cancelled) {
        setBackupResult({ ok: false, error: "Backup timed out. Check Drive connectivity and try again." });
        setBackupPolling(false);
        setBackupJobId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backupJobId, backupPolling]);

  useEffect(() => {
    if (!driveRestoreJobId || !driveRestorePolling) return;
    let cancelled = false;
    const deadline = Date.now() + 5 * 60 * 1000;
    void (async () => {
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) break;
        try {
          const st = await apiJson<{ status: string; error: string | null }>(
            `/exports/import/${encodeURIComponent(driveRestoreJobId)}`
          );
          if (st.status === "complete") {
            setToken(null);
            setDriveRestorePolling(false);
            setDriveRestoreJobId(null);
            return;
          }
          if (st.status === "failed") {
            setDriveRestoreError(st.error ?? "Restore failed.");
            setDriveRestorePolling(false);
            setDriveRestoreJobId(null);
            return;
          }
        } catch {
          if (!getToken()) {
            setDriveRestorePolling(false);
            setDriveRestoreJobId(null);
            return;
          }
        }
      }
      if (!cancelled) {
        setDriveRestoreError("Restore timed out. Try again or restore from a local file.");
        setDriveRestorePolling(false);
        setDriveRestoreJobId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driveRestoreJobId, driveRestorePolling]);

  async function addCustomInstitutionName() {
    if (!token) {
      return;
    }
    const name = window.prompt("Institution name (saved for everyone in your household):");
    if (!name?.trim()) {
      return;
    }
    setAccountError(null);
    try {
      await apiJson("/imports/institutions/custom", {
        method: "POST",
        body: JSON.stringify({ displayName: name.trim() })
      });
      await loadInstitutions();
      setAccountDraft((d) => ({ ...d, institution: name.trim() }));
    } catch (e: unknown) {
      setAccountError(e instanceof Error ? e.message : "Could not add institution");
    }
  }

  async function saveConnectedAccount() {
    if (!token) {
      return;
    }
    if (!accountDraft.institution.trim()) {
      setAccountError("Institution is required.");
      return;
    }
    const belongsTo = parseBelongsToChoice(accountDraft.belongsTo);
    if (belongsTo.ownerScope === "person" && !belongsTo.ownerPersonProfileId) {
      setAccountError("Choose a household member.");
      return;
    }
    setSavingAccount(true);
    setAccountError(null);
    setAccountSuccess(null);
    try {
      const parsedInitialBalance = accountDraft.initialBalance.trim()
        ? parseFloat(accountDraft.initialBalance)
        : null;
      const body: Record<string, unknown> = {
        type: accountDraft.type,
        institution: accountDraft.institution.trim(),
        accountMask: accountDraft.accountMask.trim() || null,
        ownerScope: belongsTo.ownerScope,
        ownerPersonProfileId: belongsTo.ownerPersonProfileId,
        defaultParserProfileId: null
      };
      // Initial balance only sent on creation (not on edit — use Net Worth page to update)
      if (!accountDraft.id && parsedInitialBalance !== null && Number.isFinite(parsedInitialBalance)) {
        body.initialBalance = parsedInitialBalance;
        body.initialBalanceDate = accountDraft.initialBalanceDate || new Date().toISOString().slice(0, 10);
      }
      if (accountDraft.id) {
        await apiJson(`/imports/accounts/${encodeURIComponent(accountDraft.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        });
      } else {
        await apiJson("/imports/accounts", { method: "POST", body: JSON.stringify(body) });
      }
      const r = await apiJson<{ accounts: AccountRow[] }>("/imports/accounts");
      setAccounts(r.accounts);
      setAccountSuccess(accountDraft.id ? "Account updated." : "Account created.");
      setAccountDraft({
        id: "",
        type: "checking",
        institution: "",
        accountMask: "",
        belongsTo: "household",
        initialBalance: "",
        initialBalanceDate: new Date().toISOString().slice(0, 10)
      });
    } catch (e: unknown) {
      setAccountError(e instanceof Error ? e.message : "Could not save account");
    } finally {
      setSavingAccount(false);
    }
  }

  async function saveHouseholdTarget(value: number | null) {
    if (!token) {
      return;
    }
    setSavingHousehold(true);
    setHouseholdError(null);
    try {
      const incomeTrim = householdIncomeDraft.trim();
      const parsedIncome = incomeTrim === "" ? null : Number(incomeTrim);
      if (parsedIncome !== null && (!Number.isFinite(parsedIncome) || parsedIncome < 0)) {
        setHouseholdError("Combined gross household income must be a non-negative number.");
        return;
      }
      await apiJson<HouseholdSettingsResponse>("/household/settings", {
        method: "PATCH",
        body: JSON.stringify({
          monthlySavingsTargetUsd: value,
          city: householdCityDraft.trim() || null,
          state: householdStateDraft.trim() || null,
          combinedGrossIncomeUsd: parsedIncome
        })
      });
      await loadHousehold();
    } catch (e: unknown) {
      setHouseholdError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingHousehold(false);
    }
  }

  async function saveProfile() {
    if (!token) {
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const iconKey = profileDraft.avatarIconKey.trim() || PROFILE_ICON_KEYS[0];
      const ageTrim = profileDraft.age.trim();
      const incomeTrim = profileDraft.individualGrossIncomeUsd.trim();
      const age = ageTrim === "" ? null : Number(ageTrim);
      const individualIncome = incomeTrim === "" ? null : Number(incomeTrim);
      if (age !== null && (!Number.isInteger(age) || age < 1 || age > 129)) {
        throw new Error("Age must be an integer between 1 and 129.");
      }
      if (individualIncome !== null && (!Number.isFinite(individualIncome) || individualIncome < 0)) {
        throw new Error("Individual gross annual income must be a non-negative number.");
      }
      await apiJson<HouseholdProfileResponse>("/household/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: profileDraft.firstName.trim(),
          lastName: profileDraft.lastName.trim(),
          email: profileDraft.email.trim() || null,
          phoneNumber: profileDraft.phone.trim() || null,
          avatarKey: iconKey,
          age,
          sex: profileDraft.sex || null,
          individualGrossIncomeUsd: individualIncome,
          riskTolerance: profileDraft.riskTolerance || null,
          financialGoals: profileDraft.financialGoals,
          salaryDepositFinancialAccountId:
            profileDraft.employers[0]?.salaryDepositAccountId &&
            profileDraft.employers[0].salaryDepositAccountId !== ""
              ? profileDraft.employers[0].salaryDepositAccountId
              : null,
          employers: profileDraft.employers
            .map((e) => ({
              id: e.id,
              displayName: e.displayName.trim(),
              parserProfileId: e.parserProfileId,
              parserMapping: {} as Record<string, unknown>,
              salaryDepositFinancialAccountId:
                e.salaryDepositAccountId === "" ? null : e.salaryDepositAccountId
            }))
            .filter((e) => e.displayName.length > 0)
        })
      });
      setProfileSuccess("Profile saved.");
      await loadProfile();
      window.dispatchEvent(new CustomEvent("app:household-profile-updated"));
      try {
        const acct = await apiJson<{ accounts: AccountRow[] }>("/imports/accounts");
        setAccounts(acct.accounts);
      } catch {
        /* accounts tab may not be loaded yet */
      }
    } catch (e: unknown) {
      setProfileError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function openRemoveMemberConfirm(memberId: string) {
    setRemoveMemberConfirm(memberId);
    setRemoveMemberDeleteLogin(false);
    setRemoveMemberDataCount(null);
    setRemoveMemberError(null);
    try {
      const counts = await apiJson<{ transactions: number; payslips: number }>(
        `/household/members/${encodeURIComponent(memberId)}/data-count`
      );
      setRemoveMemberDataCount(counts);
    } catch {
      setRemoveMemberDataCount({ transactions: 0, payslips: 0 });
    }
  }

  async function confirmRemoveHouseholdMember() {
    if (!token || !removeMemberConfirm) return;
    setMembersError(null);
    setMembersSuccess(null);
    setRemoveMemberError(null);
    try {
      const res = await apiFetch(`/household/members/${encodeURIComponent(removeMemberConfirm)}`, {
        method: "DELETE",
        body: JSON.stringify({ deleteLogin: removeMemberDeleteLogin })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string; code?: string };
        if (res.status === 409 && body.code === "HAS_LOGIN_ACCOUNT") {
          const message = "This member has a linked login account. Select \"Also delete their login account\" to continue.";
          setRemoveMemberError(message);
          throw new Error(message);
        }
        throw new Error(body.message ?? `Could not remove member (${res.status})`);
      }
      setRemoveMemberConfirm(null);
      setRemoveMemberDataCount(null);
      setRemoveMemberError(null);
      setMembersSuccess("Member removed.");
      await loadMembers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not remove member";
      setRemoveMemberError(message);
      throw e instanceof Error ? e : new Error(message);
    }
  }

  async function createLoginForExistingMember(memberId: string) {
    setCreatingLoginForId(memberId);
    setMembersError(null);
    setMembersSuccess(null);
    try {
      const data = await apiJson<{ inviteSent: boolean }>(
        `/household/members/${encodeURIComponent(memberId)}/create-login`,
        { method: "POST" }
      );
      if (data.inviteSent) {
        setMembersSuccess("Invite sent — they'll receive a link to set their password.");
      } else {
        setMembersSuccess("Login created. Default password: ChangeMe123! — member must change it on first login.");
      }
      await loadMembers();
    } catch (e: unknown) {
      setMembersError(e instanceof Error ? e.message : "Could not create login");
    } finally {
      setCreatingLoginForId(null);
    }
  }

  async function confirmResetPassword(memberId: string) {
    setResetPasswordBusy(true);
    setMembersError(null);
    try {
      const data = await apiJson<{ emailSent: boolean; tempPassword?: string }>(
        `/household/members/${encodeURIComponent(memberId)}/reset-password`,
        { method: "POST" }
      );
      setResetPasswordForId(null);
      if (data.emailSent) {
        setMembersSuccess("Password reset link sent to member's email.");
      } else {
        setResetPasswordResult({ memberId, tempPassword: data.tempPassword! });
      }
    } catch (e: unknown) {
      setMembersError(e instanceof Error ? e.message : "Could not reset password");
      setResetPasswordForId(null);
    } finally {
      setResetPasswordBusy(false);
    }
  }

  async function saveHouseholdMembers() {
    if (!token) {
      return;
    }
    const rows = memberDrafts.filter(
      (r) => r.firstName.trim().length > 0 || r.lastName.trim().length > 0 || r.email.trim().length > 0
    );
    if (rows.length === 0) {
      setMembersError("Add at least one household member row.");
      return;
    }
    setSavingMemberIndex(-1);
    setMembersError(null);
    setMembersSuccess(null);
    try {
      for (const row of rows) {
        if (!row.firstName.trim()) {
          throw new Error("Each member must include first name.");
        }
        const body = {
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          email: row.email.trim() || null,
          role: row.role as "head" | "member",
          relationship: row.relationship as "self" | "spouse" | "child" | "dependent" | "other",
          ...(row.id ? {} : { createLogin: Boolean(row.createLogin) })
        };
        const path = row.id ? `/household/members/${encodeURIComponent(row.id)}` : "/household/members";
        await apiJson<HouseholdMemberResponse>(path, {
          method: row.id ? "PATCH" : "POST",
          body: JSON.stringify(body)
        });
      }
      setMembersSuccess("Household updated.");
      await loadMembers();
    } catch (e: unknown) {
      setMembersError(e instanceof Error ? e.message : "Could not save household");
    } finally {
      setSavingMemberIndex(null);
    }
  }

  async function changePassword() {
    if (!token) {
      return;
    }
    setSecurityError(null);
    setSecuritySuccess(null);
    if (!passwordDraft.currentPassword || !passwordDraft.newPassword || !passwordDraft.confirmPassword) {
      setSecurityError("All password fields are required.");
      return;
    }
    if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
      setSecurityError("New password and confirmation must match.");
      return;
    }
    setChangingPassword(true);
    try {
      await apiJson<{ ok?: boolean; message?: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordDraft.currentPassword,
          newPassword: passwordDraft.newPassword
        })
      });
      setSecuritySuccess("Password changed successfully.");
      setPasswordDraft({ currentPassword: "", newPassword: "", confirmPassword: "" });
      window.dispatchEvent(new CustomEvent("app:password-changed"));
    } catch (e: unknown) {
      setSecurityError(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleRemoveDismissed(override: RecurringOverride) {
    const res = await apiFetch(`/recurring-overrides/${override.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to remove override (HTTP ${res.status})`);
    setRecurringOverrides((prev) => prev.filter((row) => row.id !== override.id));
  }

  const confirmedOverrides = useMemo(
    () => recurringOverrides.filter((o) => o.verdict === "confirmed"),
    [recurringOverrides]
  );
  const dismissedOverrides = useMemo(
    () => recurringOverrides.filter((o) => o.verdict === "dismissed"),
    [recurringOverrides]
  );

  const visibleTabs = useMemo(
    () => TABS.filter((id) => id !== "household" || canManageHousehold),
    [canManageHousehold]
  );

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <Stack>
      <Paper withBorder p="lg" radius="md">
        <Title order={2}>Settings</Title>
        <Tabs
          value={tab}
          onChange={(value) => value && setTab(value as SettingsTab)}
          mt="md"
          variant="pills"
          radius="xl"
          color="gray"
          styles={{
            list: { gap: 8, marginBottom: 8 },
            tab: { padding: "6px 14px", fontWeight: 500 }
          }}
        >
          <Tabs.List>
            {visibleTabs.map((id) => (
              <Tabs.Tab key={id} value={id}>
                {id === "profile"
                  ? "Profile"
                  : id === "household"
                    ? "Household"
                    : id === "accounts"
                      ? "Accounts"
                      : id === "recurring"
                        ? "Recurring"
                        : "Data & Backup"}
              </Tabs.Tab>
            ))}
          </Tabs.List>

        {tab === "profile" ? (
          <Stack mt="md">
            <Title order={3}>Profile</Title>
            <Paper
              withBorder
              radius="xl"
              w={48}
              h={48}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem" }}
              title={`avatarKey: ${profileDraft.avatarIconKey}`}
              aria-label={`Avatar preview: ${profileDraft.avatarIconKey}`}
            >
              {avatarEmojiPreview(profileDraft.avatarIconKey)}
            </Paper>
            {profileError ? <Alert color="red">{profileError}</Alert> : null}
            {profileSuccess ? <Alert color="green">{profileSuccess}</Alert> : null}
            {loadingProfile ? <Text c="dimmed">Loading…</Text> : null}
            {!loadingProfile ? (
              <Stack>
                <Group align="end" grow>
                  <TextInput
                    label="First name"
                    value={profileDraft.firstName}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, firstName: e.currentTarget.value }))}
                    disabled={savingProfile}
                    placeholder="First name"
                  />
                  <TextInput
                    label="Last name"
                    value={profileDraft.lastName}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, lastName: e.currentTarget.value }))}
                    disabled={savingProfile}
                    placeholder="Last name"
                  />
                </Group>
                <TextInput
                  label="Email"
                  type="email"
                  value={profileDraft.email}
                  onChange={(e) => setProfileDraft((prev) => ({ ...prev, email: e.currentTarget.value }))}
                  disabled={savingProfile}
                  placeholder="you@example.com"
                />
                <TextInput
                  label="Phone"
                  type="tel"
                  value={profileDraft.phone}
                  onChange={(e) => setProfileDraft((prev) => ({ ...prev, phone: e.currentTarget.value }))}
                  disabled={savingProfile}
                  placeholder="+1 555 000 0000"
                />
                <Select
                  label="Avatar icon"
                  value={profileDraft.avatarIconKey}
                  onChange={(value) =>
                    setProfileDraft((prev) => ({ ...prev, avatarIconKey: value ?? PROFILE_ICON_KEYS[0] }))
                  }
                  disabled={savingProfile}
                  data={PROFILE_ICON_KEYS.map((iconKey) => ({ value: iconKey, label: iconKey }))}
                  allowDeselect={false}
                />
                <Fieldset legend="Financial Profile" mt="sm">
                  <Stack gap="sm">
                    <Group align="end" grow>
                      <NumberInput
                        label="Age"
                        min={1}
                        max={129}
                        value={profileDraft.age === "" ? undefined : Number(profileDraft.age)}
                        onChange={(value) =>
                          setProfileDraft((prev) => ({
                            ...prev,
                            age: typeof value === "number" && Number.isFinite(value) ? String(value) : ""
                          }))
                        }
                        disabled={savingProfile}
                        style={{ flex: "0 0 10rem" }}
                      />
                      <Select
                        label="Sex"
                        clearable
                        value={profileDraft.sex || null}
                        data={[
                          { value: "male", label: "Male" },
                          { value: "female", label: "Female" },
                          { value: "nonbinary", label: "Non-binary" },
                          { value: "prefer_not_to_say", label: "Prefer not to say" }
                        ]}
                        onChange={(value) =>
                          setProfileDraft((prev) => ({ ...prev, sex: (value ?? "") as ProfileDraft["sex"] }))
                        }
                        disabled={savingProfile}
                        style={{ flex: "0 0 14rem" }}
                      />
                      <NumberInput
                        label="Individual gross annual income"
                        description="Include base salary + regular bonuses + regular 1099 income. Exclude one-time items."
                        prefix="$"
                        thousandSeparator=","
                        min={0}
                        value={
                          profileDraft.individualGrossIncomeUsd === ""
                            ? undefined
                            : Number(profileDraft.individualGrossIncomeUsd)
                        }
                        onChange={(value) =>
                          setProfileDraft((prev) => ({
                            ...prev,
                            individualGrossIncomeUsd:
                              typeof value === "number" && Number.isFinite(value) ? String(value) : ""
                          }))
                        }
                        disabled={savingProfile}
                        style={{ flex: "0 0 20rem" }}
                      />
                    </Group>
                    <Stack gap={6}>
                      <Text size="sm" mb={6}>Risk tolerance</Text>
                      <SegmentedControl
                        fullWidth
                        value={profileDraft.riskTolerance || "moderate"}
                        data={[
                          { value: "conservative", label: "Conservative" },
                          { value: "moderate", label: "Moderate" },
                          { value: "aggressive", label: "Aggressive" }
                        ]}
                        onChange={(value) =>
                          setProfileDraft((prev) => ({ ...prev, riskTolerance: value as ProfileDraft["riskTolerance"] }))
                        }
                        disabled={savingProfile}
                      />
                    </Stack>
                    <MultiSelect
                      label="Financial goals"
                      data={[
                        "Build emergency fund",
                        "Pay off debt",
                        "Save for home",
                        "Invest for retirement",
                        "Grow wealth",
                        "Other"
                      ]}
                      value={profileDraft.financialGoals}
                      onChange={(value) =>
                        setProfileDraft((prev) => ({ ...prev, financialGoals: value.slice(0, 20) }))
                      }
                      maxValues={20}
                      disabled={savingProfile}
                    />
                  </Stack>
                </Fieldset>
                <Title order={4} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  Employer Setup
                  <Text
                    span
                    aria-label="Employer setup info"
                    title="Use this section to set your employer name, salary deposit account, and payslip format mapping for import/upload."
                    c="dimmed"
                    ff="monospace"
                  >
                    i
                  </Text>
                </Title>
                {profileDraft.employers.map((row, idx) => (
                  <Group key={idx} align="end" grow>
                    <TextInput
                      label="Employers"
                      value={row.displayName}
                      placeholder="e.g. Acme Corp"
                      onChange={(e) => {
                        const next = [...profileDraft.employers];
                        next[idx] = { ...next[idx], displayName: e.currentTarget.value };
                        setProfileDraft((prev) => ({ ...prev, employers: next }));
                      }}
                      disabled={savingProfile}
                    />
                    <Select
                      label="Salary deposit account (optional)"
                      value={row.salaryDepositAccountId || ""}
                      onChange={(value) => {
                        const next = [...profileDraft.employers];
                        next[idx] = { ...next[idx], salaryDepositAccountId: value ?? "" };
                        setProfileDraft((prev) => ({ ...prev, employers: next }));
                      }}
                      disabled={savingProfile}
                      data={[
                        { value: "", label: "- Not set -" },
                        ...accounts
                          .filter((a) => a.type !== "payslip")
                          .map((a) => ({ value: a.id, label: formatAccountForSelect(a) }))
                      ]}
                    />
                    <Select
                      label="Payslip format"
                      value={row.parserProfileId}
                      onChange={(value) => {
                        const next = [...profileDraft.employers];
                        next[idx] = { ...next[idx], parserProfileId: value ?? "ibm_pay_contributions_pdf" };
                        setProfileDraft((prev) => ({ ...prev, employers: next }));
                      }}
                      disabled={savingProfile}
                      allowDeselect={false}
                      data={[
                        { value: "ibm_pay_contributions_pdf", label: "IBM Pay & Contributions (PDF)" },
                        { value: "deloitte_payslip_pdf", label: "Deloitte Pay Statement (PDF)" },
                        { value: "adp_payslip_pdf", label: "ADP (PDF - not implemented)" }
                      ]}
                    />
                    <Button
                      type="button"
                      variant="default"
                      disabled={savingProfile || profileDraft.employers.length <= 1}
                      onClick={() =>
                        setProfileDraft((prev) => ({
                          ...prev,
                          employers: prev.employers.filter((_, i) => i !== idx)
                        }))
                      }
                    >
                      Remove
                    </Button>
                  </Group>
                ))}
                <Group mt={4}>
                  <Button
                    type="button"
                    variant="default"
                    disabled={savingProfile}
                    onClick={() =>
                      setProfileDraft((prev) => ({
                        ...prev,
                        employers: [
                          ...prev.employers,
                          { displayName: "", parserProfileId: "ibm_pay_contributions_pdf", salaryDepositAccountId: "" }
                        ]
                      }))
                    }
                  >
                    Add employer
                  </Button>
                  <Button type="button" loading={savingProfile} onClick={() => void saveProfile()}>
                    {savingProfile ? "Saving…" : "Save profile"}
                  </Button>
                </Group>
                <Divider mt="xl" mb="md" label="Security" labelPosition="left" />
                {securityError ? <Alert color="red">{securityError}</Alert> : null}
                {securitySuccess ? <Alert color="green">{securitySuccess}</Alert> : null}
                <Box
                  component="form"
                  maw={480}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void changePassword();
                  }}
                >
                  <Stack>
                    <PasswordInput
                      label="Current password"
                      value={passwordDraft.currentPassword}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setPasswordDraft((prev) => ({ ...prev, currentPassword: value }));
                      }}
                      disabled={changingPassword}
                      autoComplete="current-password"
                    />
                    <PasswordInput
                      label="New password"
                      value={passwordDraft.newPassword}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setPasswordDraft((prev) => ({ ...prev, newPassword: value }));
                      }}
                      disabled={changingPassword}
                      autoComplete="new-password"
                    />
                    <PasswordInput
                      label="Confirm new password"
                      value={passwordDraft.confirmPassword}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setPasswordDraft((prev) => ({ ...prev, confirmPassword: value }));
                      }}
                      disabled={changingPassword}
                      autoComplete="new-password"
                    />
                    <Group>
                      <Button type="submit" loading={changingPassword}>
                        {changingPassword ? "Updating…" : "Change password"}
                      </Button>
                    </Group>
                  </Stack>
                </Box>

                <Divider mt="xl" mb="md" label="Notifications" labelPosition="left" />
                <Text c="dimmed">No notification service is configured. This section is reserved for future email and push notifications.</Text>
              </Stack>
            ) : null}
          </Stack>
        ) : null}

        {tab === "household" ? (
          <Stack mt="md">
            <Title order={3}>Household</Title>
            <Text c="dimmed">Manage household members, roles, and relationships.</Text>
            <Title order={4}>Household members</Title>
            <Text c="dimmed">Track household members for role and relationship context.</Text>
            {membersError ? <Alert color="red">{membersError}</Alert> : null}
            {membersSuccess ? <Alert color="green">{membersSuccess}</Alert> : null}
            {loadingMembers ? <Text c="dimmed">Loading members…</Text> : null}
            {!loadingMembers ? (
              <>
                {memberDrafts.map((member, idx) => (
                  <Paper
                    key={member.id ?? `draft-${idx}`}
                    withBorder
                    p="sm"
                  >
                    <Stack>
                      <Group align="end" grow>
                        <TextInput
                          label="First name"
                          value={member.firstName}
                          placeholder="Alex"
                          onChange={(e) => {
                            const next = [...memberDrafts];
                            next[idx] = { ...next[idx], firstName: e.currentTarget.value };
                            setMemberDrafts(next);
                          }}
                          disabled={savingMemberIndex !== null}
                        />
                        <TextInput
                          label="Last name"
                          value={member.lastName}
                          placeholder="Doe"
                          onChange={(e) => {
                            const next = [...memberDrafts];
                            next[idx] = { ...next[idx], lastName: e.currentTarget.value };
                            setMemberDrafts(next);
                          }}
                          disabled={savingMemberIndex !== null}
                        />
                        <TextInput
                          label="Email"
                          type="email"
                          value={member.email}
                          placeholder="alex@example.com"
                          onChange={(e) => {
                            const next = [...memberDrafts];
                            next[idx] = { ...next[idx], email: e.currentTarget.value };
                            setMemberDrafts(next);
                          }}
                          disabled={savingMemberIndex !== null}
                        />
                        <Select
                          label="Role"
                          value={member.role}
                          onChange={(value) => {
                            const next = [...memberDrafts];
                            next[idx] = { ...next[idx], role: value ?? "member" };
                            setMemberDrafts(next);
                          }}
                          disabled={savingMemberIndex !== null}
                          allowDeselect={false}
                          data={[
                            { value: "head", label: "Head" },
                            { value: "member", label: "Member" }
                          ]}
                        />
                        <Select
                          label="Relationship"
                          value={member.relationship}
                          onChange={(value) => {
                            const next = [...memberDrafts];
                            next[idx] = { ...next[idx], relationship: value ?? "other" };
                            setMemberDrafts(next);
                          }}
                          disabled={savingMemberIndex !== null}
                          allowDeselect={false}
                          data={[
                            { value: "self", label: "Self" },
                            { value: "spouse", label: "Spouse" },
                            { value: "child", label: "Child" },
                            { value: "dependent", label: "Dependent" },
                            { value: "other", label: "Other" }
                          ]}
                        />
                        <Button
                          type="button"
                          title={member.id ? "Remove this household member" : "Discard unsaved row"}
                          disabled={savingMemberIndex !== null}
                          variant="default"
                          color="red"
                          onClick={() => {
                            if (member.id) {
                              void openRemoveMemberConfirm(member.id);
                            } else {
                              setMemberDrafts((prev) => prev.filter((_, i) => i !== idx));
                            }
                          }}
                        >
                          <IconTrash size={14} />
                        </Button>
                      </Group>
                    {/* Login status row */}
                      <Group>
                        {member.id ? (
                          member.linkedUserId ? (
                            <Group>
                              <Text size="sm" c="green" fw={600}>
                              ✓ Has login account
                              </Text>
                              <Button
                                type="button"
                                variant="default"
                                size="xs"
                                disabled={resetPasswordBusy}
                                onClick={() => setResetPasswordForId(member.id!)}
                              >
                                Reset password
                              </Button>
                            </Group>
                          ) : (
                            <>
                              <Text size="sm" c="dimmed">
                              No login account
                              </Text>
                              <Button
                                type="button"
                                variant="default"
                                size="xs"
                                disabled={creatingLoginForId === member.id}
                                onClick={() => void createLoginForExistingMember(member.id!)}
                              >
                                {creatingLoginForId === member.id ? "Creating…" : "Create login"}
                              </Button>
                            </>
                          )
                        ) : (
                          <Checkbox
                            checked={Boolean(member.createLogin)}
                            onChange={(e) => {
                              const next = [...memberDrafts];
                              next[idx] = { ...next[idx], createLogin: e.currentTarget.checked };
                              setMemberDrafts(next);
                            }}
                            disabled={savingMemberIndex !== null}
                            label={
                              emailEnabled
                                ? "Create login account (invite email will be sent)"
                                : (
                                  <>
                                    Create login account (default password: <Text span ff="monospace">ChangeMe123!</Text>{" "}
                                    - must change on first login)
                                  </>
                                )
                            }
                          />
                        )}
                      </Group>
                    </Stack>
                  </Paper>
                ))}
                <Group mb="md">
                  <Button
                    type="button"
                    variant="default"
                    disabled={savingMemberIndex !== null}
                    onClick={() =>
                      setMemberDrafts((prev) => [
                        ...prev,
                        { firstName: "", lastName: "", email: "", role: "member", relationship: "other" }
                      ])
                    }
                  >
                    Add another row
                  </Button>
                  <Button type="button" loading={savingMemberIndex !== null} onClick={() => void saveHouseholdMembers()}>
                    {savingMemberIndex !== null ? "Saving…" : "Save household"}
                  </Button>
                </Group>
              </>
            ) : null}
            {householdError ? <Alert color="red">{householdError}</Alert> : null}
            {loadingHousehold ? <Text c="dimmed">Loading…</Text> : null}
            {!loadingHousehold ? (
              <Stack mb="xl">
                <NumberInput
                  label="Monthly savings target (USD)"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 500"
                  value={targetDraft === "" ? "" : Number(targetDraft)}
                  onChange={(value) => setTargetDraft(value === "" || value == null ? "" : String(value))}
                  disabled={savingHousehold}
                  maw={320}
                />
                <Fieldset legend="Household Demographics" mt="sm">
                  <Stack gap="sm">
                    <TextInput
                      label="City"
                      value={householdCityDraft}
                      onChange={(e) => setHouseholdCityDraft(e.currentTarget.value)}
                      disabled={savingHousehold}
                    />
                    <TextInput
                      label="State"
                      maxLength={100}
                      value={householdStateDraft}
                      onChange={(e) => setHouseholdStateDraft(e.currentTarget.value)}
                      disabled={savingHousehold}
                    />
                    <NumberInput
                      label="Combined gross household income"
                      description="Combined gross income for all earners: base salary + regular bonuses. Exclude one-time items."
                      prefix="$"
                      thousandSeparator=","
                      min={0}
                      value={householdIncomeDraft === "" ? undefined : Number(householdIncomeDraft)}
                      onChange={(value) =>
                        setHouseholdIncomeDraft(
                          typeof value === "number" && Number.isFinite(value) ? String(value) : ""
                        )
                      }
                      disabled={savingHousehold}
                      maw={360}
                    />
                  </Stack>
                </Fieldset>
                <Group>
                  <Button
                    type="button"
                    loading={savingHousehold}
                    onClick={() => {
                      const t = targetDraft.trim();
                      if (t === "") {
                        void saveHouseholdTarget(null);
                        return;
                      }
                      const n = Number(t);
                      if (!Number.isFinite(n) || n < 0) {
                        setHouseholdError("Enter a non-negative number or leave blank to clear.");
                        return;
                      }
                      void saveHouseholdTarget(Math.round(n * 100) / 100);
                    }}
                  >
                    {savingHousehold ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    disabled={savingHousehold}
                    onClick={() => void saveHouseholdTarget(null)}
                  >
                    Clear target
                  </Button>
                </Group>
              </Stack>
            ) : null}
          </Stack>
        ) : null}

        {tab === "accounts" ? (
          <Stack mt="md">
            <Title order={3}>Connected accounts</Title>
            <Text c="dimmed">Link accounts for import. Parser is chosen from institution, account type, and file when you import.</Text>
            {accountError ? <Alert color="red">{accountError}</Alert> : null}
            {accountSuccess ? <Alert color="green">{accountSuccess}</Alert> : null}
            <Stack>
              <Fieldset legend="Institution">
                <HierarchicalSearchPicker
                  value={accountDraft.institution || null}
                  onChange={(v) => setAccountDraft((d) => ({ ...d, institution: v ?? "" }))}
                  groups={institutionPickerGroups}
                  placeholder="Select institution"
                  ariaLabel="Financial institution"
                  disabled={savingAccount}
                  clearable
                  footer={
                    <Group justify="flex-start">
                      <Button
                        type="button"
                        variant="default"
                        disabled={savingAccount}
                        onClick={() => void addCustomInstitutionName()}
                      >
                        Add institution name…
                      </Button>
                    </Group>
                  }
                />
              </Fieldset>
              <Group align="end" grow>
                <Select
                  label="Account type"
                  value={accountDraft.type}
                  onChange={(value) => value && setAccountDraft((d) => ({ ...d, type: value }))}
                  disabled={savingAccount}
                  data={[
                    { value: "checking", label: "Checking" },
                    { value: "savings", label: "Savings" },
                    { value: "credit_card", label: "Credit card" },
                    { value: "loan", label: "Loan" },
                    { value: "mortgage", label: "Mortgage" },
                    { value: "investment", label: "Investment" },
                    { value: "retirement", label: "Retirement (401K / IRA / Pension)" },
                    { value: "payslip", label: "Payslip" }
                  ]}
                />
                <TextInput
                  label="Account mask (optional)"
                  value={accountDraft.accountMask}
                  onChange={(e) => setAccountDraft((d) => ({ ...d, accountMask: e.currentTarget.value }))}
                  disabled={savingAccount}
                  placeholder="1234"
                />
              </Group>
              <Fieldset legend="Belongs-to">
                <HierarchicalSearchPicker
                  value={accountDraft.belongsTo}
                  onChange={(v) => setAccountDraft((d) => ({ ...d, belongsTo: (v ?? "household") as BelongsToChoice }))}
                  groups={buildBelongsToGroups(accountOwners)}
                  placeholder="Select who this account belongs to"
                  ariaLabel="Connected account belongs-to"
                  disabled={savingAccount}
                />
              </Fieldset>
              {!accountDraft.id ? (
                <Group align="end" grow>
                  <NumberInput
                    label="Starting balance (optional)"
                    value={accountDraft.initialBalance === "" ? "" : Number(accountDraft.initialBalance)}
                    onChange={(value) =>
                      setAccountDraft((d) => ({
                        ...d,
                        initialBalance: value === "" || value == null ? "" : String(value)
                      }))
                    }
                    decimalScale={2}
                    fixedDecimalScale={false}
                    thousandSeparator=","
                    disabled={savingAccount}
                    placeholder="0.00"
                    maw={280}
                  />
                  <TextInput
                    label="Balance as of"
                    type="date"
                    value={accountDraft.initialBalanceDate}
                    onChange={(e) => setAccountDraft((d) => ({ ...d, initialBalanceDate: e.currentTarget.value }))}
                    disabled={savingAccount}
                  />
                </Group>
              ) : null}
              {!accountDraft.id ? (
                <Text c="dimmed" size="sm">
                  Optional starting point for net worth. Overwritten when statements are imported.
                </Text>
              ) : null}
              <Group>
                <Button type="button" loading={savingAccount} onClick={() => void saveConnectedAccount()}>
                  {savingAccount ? "Saving…" : accountDraft.id ? "Update account" : "Add account"}
                </Button>
                {accountDraft.id ? (
                  <Button
                    type="button"
                    variant="default"
                    disabled={savingAccount}
                    onClick={() =>
                      setAccountDraft({
                        id: "",
                        type: "checking",
                        institution: "",
                        accountMask: "",
                        belongsTo: "household",
                        initialBalance: "",
                        initialBalanceDate: new Date().toISOString().slice(0, 10)
                      })
                    }
                  >
                    Cancel edit
                  </Button>
                ) : null}
              </Group>
            </Stack>
            <Table striped withTableBorder withColumnBorders mt="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Institution</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Mask</Table.Th>
                  <Table.Th>Import freshness</Table.Th>
                  <Table.Th>Belongs-to</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                  {accounts.map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td>{a.institution}</Table.Td>
                      <Table.Td>{a.type}</Table.Td>
                      <Table.Td>{a.account_mask ?? "—"}</Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed">Last upload</Text>
                          <Text size="sm">{formatAccountFreshness(a).lastUpload}</Text>
                          <Text size="xs" c="dimmed">Statement ending</Text>
                          <Text size="sm">{formatAccountFreshness(a).statementEnding}</Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        {a.owner_scope === "person"
                          ? formatBelongsToLabel(
                              accountOwners.find((p) => p.id === a.owner_person_profile_id)?.label ?? "Member"
                            )
                          : "Household"}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          type="button"
                          variant="default"
                          size="xs"
                          onClick={() =>
                            setAccountDraft({
                              id: a.id,
                              type: a.type,
                              institution: a.institution,
                              accountMask: a.account_mask ?? "",
                              belongsTo:
                                a.owner_scope === "person" && a.owner_person_profile_id
                                  ? (`person:${a.owner_person_profile_id}` as BelongsToChoice)
                                  : "household",
                              initialBalance: "",
                              initialBalanceDate: new Date().toISOString().slice(0, 10)
                            })
                          }
                        >
                          Edit
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
          </Stack>
        ) : null}

        {tab === "recurring" ? (
          <Stack mt="md">
            <Title order={3}>Recurring Payments</Title>
            <Text c="dimmed">
              Confirmed overrides always appear on the dashboard. Dismissed overrides suppress a merchant from the
              heuristic suggestions permanently. Remove a dismissed override to let it resurface.
            </Text>

            {recurringLoading ? <Text c="dimmed">Loading…</Text> : null}
            {recurringError ? <Alert color="red">{recurringError}</Alert> : null}

            {!recurringLoading && !recurringError ? (
              <>
                <Title order={4} mt="lg" mb="xs">
                  Confirmed ({confirmedOverrides.length})
                </Title>
                {confirmedOverrides.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No confirmed recurring payments yet. Mark a transaction as recurring from the{" "}
                    <Anchor component={Link} to="/transactions">Transactions</Anchor> page.
                  </Text>
                ) : (
                  <Table striped withTableBorder withColumnBorders>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Merchant key</Table.Th>
                        <Table.Th>Display name</Table.Th>
                        <Table.Th>Amount anchor</Table.Th>
                        <Table.Th>Tolerance</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {confirmedOverrides.map((o) => (
                          <Table.Tr key={o.id}>
                            <Table.Td><Text ff="monospace">{o.merchantKey}</Text></Table.Td>
                            <Table.Td>{o.displayName ?? <Text c="dimmed" span>—</Text>}</Table.Td>
                            <Table.Td>{o.amountAnchor != null ? `$${o.amountAnchor.toFixed(2)}` : <Text c="dimmed" span>any</Text>}</Table.Td>
                            <Table.Td>{o.amountTolerancePct}%</Table.Td>
                            <Table.Td>
                              <Button
                                type="button"
                                variant="default"
                                size="xs"
                                onClick={() => setEditingOverride(o)}
                              >
                                Edit
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                    </Table.Tbody>
                  </Table>
                )}

                <Title order={4} mt="xl" mb="xs">
                  Dismissed ({dismissedOverrides.length})
                </Title>
                {dismissedOverrides.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No dismissed suggestions. Dismiss a heuristic candidate from the dashboard to suppress it
                    permanently.
                  </Text>
                ) : (
                  <Table striped withTableBorder withColumnBorders>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Merchant key</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {dismissedOverrides.map((o) => (
                          <Table.Tr key={o.id}>
                            <Table.Td><Text ff="monospace">{o.merchantKey}</Text></Table.Td>
                            <Table.Td>
                              <Button
                                type="button"
                                variant="default"
                                size="xs"
                                onClick={() => void handleRemoveDismissed(o)}
                              >
                                Remove
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                    </Table.Tbody>
                  </Table>
                )}
              </>
            ) : null}

            {editingOverride ? (
              <RecurringTagModal
                opened={editingOverride !== null}
                onClose={() => setEditingOverride(null)}
                txnMerchant={editingOverride.merchantKey}
                txnAmount={editingOverride.amountAnchor ?? 0}
                allTxns={[]}
                existingOverride={editingOverride}
                onConfirm={async ({ merchantKey, amountAnchor, amountTolerancePct }) => {
                  const res = await apiFetch("/recurring-overrides", {
                    method: "POST",
                    body: JSON.stringify({ merchantKey, verdict: "confirmed", amountAnchor, amountTolerancePct })
                  });
                  if (!res.ok) throw new Error(`Failed to save (HTTP ${res.status})`);
                  const updated = await apiJson<{ ok: boolean; data: RecurringOverride[] }>("/recurring-overrides");
                  if (updated.ok) setRecurringOverrides(updated.data);
                  setEditingOverride(null);
                }}
                onRemove={async () => {
                  const delRes = await apiFetch(`/recurring-overrides/${editingOverride.id}`, { method: "DELETE" });
                  if (!delRes.ok) throw new Error(`Failed to remove override (HTTP ${delRes.status})`);
                  setRecurringOverrides((prev) => prev.filter((o) => o.id !== editingOverride.id));
                  setEditingOverride(null);
                }}
              />
            ) : null}
          </Stack>
        ) : null}

        {tab === "data" ? (
          <Stack mt="md">
            <Title order={3}>Data &amp; Backup</Title>

            <Title order={4}>Export data</Title>
            <Text c="dimmed">
              Download a full .hfb backup — accounts, transactions, net worth history, category rules, payslips, and more.
              Use this to migrate to a new host or keep an offline archive.
            </Text>
            <Text c="dimmed" size="sm">
              Export files are available for 48 hours after generation. Please download a local copy before then.
            </Text>
            {exportZipMessage ? (
              <Alert color={exportZipJobId ? "green" : "red"}>{exportZipMessage}</Alert>
            ) : null}
            {exportZipJobId ? (
              <Button
                variant="subtle"
                px={0}
                justify="flex-start"
                type="button"
                onClick={() => void downloadExportZip(exportZipJobId)}
              >
                Download household-export.hfb
              </Button>
            ) : null}
            <Button type="button" variant="default" disabled={exportZipBusy} onClick={() => void runHouseholdZipExport()}>
              {exportZipBusy ? "Preparing export…" : "Start data export"}
            </Button>

            {canManageHousehold ? (
              <>
                <Title order={4} mt="xl">
                  Restore from backup
                </Title>
                <Text c="dimmed">
                  Upload an .hfb backup to preview its contents before restoring.
                </Text>
                <Alert color="red" variant="light">
                  Warning: restoring will permanently replace all current accounts, transactions, rules, and net worth history.
                  You will be signed out when restore completes.
                </Alert>
                {previewError ? <Alert color="red">{previewError}</Alert> : null}
                {importMessage ? (
                  <Alert color={importSuccess ? "green" : "red"}>{importMessage}</Alert>
                ) : null}
                {importStats ? (
                  <Text c="dimmed" size="sm">
                    Restored: {Object.entries(importStats).map(([k, v]) => `${String(v)} ${k}`).join(", ")}
                  </Text>
                ) : null}
                <Group align="end" grow wrap="nowrap">
                  <FileInput
                    label="Backup .hfb file"
                    accept=".hfb"
                    disabled={previewBusy || importBusy}
                    value={importFile}
                    onChange={(file) => {
                      setImportFile(file);
                      setPreviewData(null);
                      setPreviewError(null);
                    }}
                    placeholder="Choose backup .hfb…"
                    leftSection={<IconUpload size={16} />}
                    clearable
                    w="100%"
                  />
                  <Button
                    type="button"
                    disabled={!importFile || previewBusy || importBusy}
                    loading={previewBusy}
                    onClick={() => void handlePreviewAndRestore()}
                    miw={180}
                  >
                    {previewBusy ? "Reading backup..." : "Preview & Restore"}
                  </Button>
                </Group>
              </>
            ) : null}

            {canManageHousehold ? (
              <>
                <Divider mt="xl" mb="md" label="Google Drive Backup" labelPosition="left" />
                {authRole === "admin" ? (
                  <Text c="dimmed" size="sm">
                    View-only: connection status for your household. Only a household owner can connect, disconnect, or
                    change the service account key.
                  </Text>
                ) : (
                  <Text c="dimmed" size="sm">
                    Connect a Google Drive folder using a Service Account to enable automated cloud backups.
                    The service account email must have <strong>Editor</strong> access to the folder.
                  </Text>
                )}

                {gdriveLoading ? (
                  <Text c="dimmed" size="sm">
                    Loading…
                  </Text>
                ) : null}
                {authRole === "owner" && gdriveError ? (
                  <Alert color="red" variant="light" mt="xs">
                    {gdriveError}
                  </Alert>
                ) : null}
                {authRole === "owner" && gdriveSuccess ? (
                  <Alert color="green" variant="light" mt="xs">
                    {gdriveSuccess}
                  </Alert>
                ) : null}

                {!gdriveLoading && gdriveStatus?.connected ? (
                  <Paper withBorder p="sm" radius="md" mt="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <Stack gap={2}>
                        <Group gap="xs">
                          <Badge color="green" variant="light">
                            Connected
                          </Badge>
                          <Text size="sm" fw={500}>
                            {gdriveStatus.folderName ?? gdriveStatus.folderId}
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          Connected{" "}
                          {gdriveStatus.connectedAt
                            ? new Date(gdriveStatus.connectedAt).toLocaleDateString()
                            : ""}
                        </Text>
                        {gdriveStatus.lastError ? (
                          <Text size="xs" c="red">
                            Last error: {gdriveStatus.lastError}
                          </Text>
                        ) : null}
                        {authRole === "owner" ? (
                          <Group mt="xs">
                            <Button
                              type="button"
                              size="xs"
                              variant="light"
                              loading={backupPolling}
                              disabled={backupPolling}
                              onClick={() => void handleBackupNow()}
                            >
                              {backupPolling ? "Backing up…" : "Back up now"}
                            </Button>
                          </Group>
                        ) : null}
                        {backupResult ? (
                          <Alert
                            color={backupResult.ok ? "green" : "red"}
                            variant="light"
                            mt="xs"
                            withCloseButton
                            onClose={() => setBackupResult(null)}
                          >
                            {backupResult.ok
                              ? `Backed up: ${backupResult.fileName ?? "file uploaded to Drive"}`
                              : backupResult.error}
                          </Alert>
                        ) : null}
                        {authRole === "owner" ? (
                          <>
                            <Divider my="sm" />
                            <Group justify="space-between" align="center">
                              <Text size="sm" fw={500}>
                                Restore from Drive
                              </Text>
                              <Button
                                type="button"
                                size="xs"
                                variant="subtle"
                                loading={driveBackupsLoading}
                                disabled={driveBackupsLoading || driveRestorePolling}
                                onClick={() => void loadDriveBackups()}
                              >
                                {driveBackups === null ? "Load backups" : "Refresh"}
                              </Button>
                            </Group>

                            {driveBackupsError ? (
                              <Alert color="red" variant="light" mt="xs">
                                {driveBackupsError}
                              </Alert>
                            ) : null}

                            {driveRestoreError ? (
                              <Alert
                                color="red"
                                variant="light"
                                mt="xs"
                                withCloseButton
                                onClose={() => setDriveRestoreError(null)}
                              >
                                {driveRestoreError}
                              </Alert>
                            ) : null}

                            {driveRestorePolling ? (
                              <Text size="sm" c="dimmed" mt="xs">
                                Restoring… please wait. You will be signed out when complete.
                              </Text>
                            ) : null}

                            {driveBackups !== null && !driveBackupsLoading ? (
                              driveBackups.length === 0 ? (
                                <Text size="sm" c="dimmed" mt="xs">
                                  No backups found in this Drive folder.
                                </Text>
                              ) : (
                                <Stack gap={4} mt="xs">
                                  {driveBackups.map((f) => (
                                    <Group key={f.fileId} justify="space-between" wrap="nowrap">
                                      <Stack gap={0}>
                                        <Text size="sm" style={{ wordBreak: "break-all" }}>
                                          {f.fileName}
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                          {f.createdAt ? new Date(f.createdAt).toLocaleString() : ""}
                                          {f.sizeBytes != null ? ` · ${(f.sizeBytes / 1024).toFixed(0)} KB` : ""}
                                        </Text>
                                      </Stack>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="default"
                                        disabled={driveRestorePolling}
                                        onClick={() => setDriveRestoreConfirmFileId(f.fileId)}
                                      >
                                        Restore
                                      </Button>
                                    </Group>
                                  ))}
                                </Stack>
                              )
                            ) : null}

                            <ConfirmDialog
                              opened={driveRestoreConfirmFileId !== null}
                              title="Restore from Drive backup?"
                              message="This will replace all household data with the selected backup. Your current data will be permanently deleted and you will be signed out. This cannot be undone."
                              confirmLabel="Restore"
                              cancelLabel="Cancel"
                              danger
                              onClose={() => setDriveRestoreConfirmFileId(null)}
                              onConfirm={() => {
                                if (driveRestoreConfirmFileId) void handleDriveRestore(driveRestoreConfirmFileId);
                              }}
                            />
                          </>
                        ) : null}
                      </Stack>
                      {authRole === "owner" ? (
                        <Button
                          type="button"
                          variant="default"
                          size="xs"
                          color="red"
                          onClick={() => setGdriveDisconnectConfirm(true)}
                        >
                          Disconnect
                        </Button>
                      ) : null}
                    </Group>
                  </Paper>
                ) : null}

                {!gdriveLoading && !gdriveStatus?.connected ? (
                  authRole === "owner" ? (
                    <Stack gap="sm" mt="xs" maw={560}>
                      <Textarea
                        label="Service Account Key JSON"
                        description="Paste the full contents of your downloaded service account JSON key file."
                        placeholder='{"type": "service_account", "project_id": "...", ...}'
                        value={gdriveKeyInput}
                        onChange={(e) => setGdriveKeyInput(e.currentTarget.value)}
                        disabled={gdriveConnecting}
                        minRows={5}
                        maxRows={10}
                        autosize
                        styles={{ input: { fontFamily: "monospace", fontSize: "0.8rem" } }}
                      />
                      <TextInput
                        label="Drive Folder ID"
                        description="The folder ID from the Drive URL: drive.google.com/drive/folders/THIS_PART"
                        placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                        value={gdriveFolderIdInput}
                        onChange={(e) => setGdriveFolderIdInput(e.currentTarget.value)}
                        disabled={gdriveConnecting}
                      />
                      <Group>
                        <Button
                          type="button"
                          loading={gdriveConnecting}
                          disabled={!gdriveKeyInput.trim() || !gdriveFolderIdInput.trim()}
                          onClick={() => void handleGDriveConnect()}
                        >
                          {gdriveConnecting ? "Connecting…" : "Connect Google Drive"}
                        </Button>
                      </Group>
                    </Stack>
                  ) : (
                    <Text c="dimmed" size="sm" mt="xs">
                      No Google Drive backup is configured. Ask a household owner to connect a folder here.
                    </Text>
                  )
                ) : null}

                {authRole === "owner" ? (
                  <ConfirmDialog
                    opened={gdriveDisconnectConfirm}
                    title="Disconnect Google Drive?"
                    message="This will remove the stored service account key and disable automated backups. You can reconnect at any time."
                    confirmLabel="Disconnect"
                    cancelLabel="Cancel"
                    danger
                    onClose={() => setGdriveDisconnectConfirm(false)}
                    onConfirm={() => void handleGDriveDisconnect()}
                  />
                ) : null}
              </>
            ) : null}
          </Stack>
        ) : null}
        <Modal
          opened={previewModalOpen}
          onClose={() => {
            setPreviewModalOpen(false);
            setPreviewData(null);
            setImportFile(null);
          }}
          title="Backup Preview"
          closeOnClickOutside={false}
          centered
          size="lg"
        >
          {previewData ? (
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Text fw={600}>Exported</Text>
                  <Text c="dimmed" size="sm">{new Date(previewData.exportedAt).toLocaleString()}</Text>
                </Stack>
                <Badge color={previewData.encrypted ? "green" : "gray"} variant="light">
                  {previewData.encrypted ? "Encrypted" : "Not encrypted"}
                </Badge>
              </Group>
              <Group gap="xl">
                <Text size="sm">
                  Format version: <Text span fw={600}>{previewData.exportVersion}</Text>
                </Text>
                <Text size="sm">
                  Scope: <Text span fw={600}>{previewData.scope === "member" ? "Personal (member)" : "Full household"}</Text>
                </Text>
                {previewData.personProfileId ? (
                  <Text size="sm">
                    Profile: <Text span fw={600}>{previewData.personProfileId}</Text>
                  </Text>
                ) : null}
              </Group>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Table</Table.Th>
                    <Table.Th ta="right">Rows</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.entries(previewData.tables)
                    .filter(([, entry]) => entry.rows > 0)
                    .map(([tableKey, entry]) => (
                      <Table.Tr key={tableKey}>
                        <Table.Td>{BACKUP_TABLE_LABELS[tableKey] ?? tableKey}</Table.Td>
                        <Table.Td ta="right">
                          <NumberFormatter value={entry.rows} thousandSeparator />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
              <Group justify="flex-end">
                <Text size="sm" fw={600}>
                  Total: <NumberFormatter value={previewData.totalRows} thousandSeparator /> rows
                </Text>
              </Group>
              <Divider />
              <Alert color="red" variant="light">
                This will permanently replace ALL current household data. You will be signed out when the restore completes.
              </Alert>
              <Group justify="flex-end">
                <Button
                  variant="default"
                  onClick={() => {
                    setPreviewModalOpen(false);
                    setPreviewData(null);
                    setImportFile(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    void runHouseholdRestore();
                    setPreviewModalOpen(false);
                    setPreviewData(null);
                    setImportFile(null);
                  }}
                >
                  Restore from this backup
                </Button>
              </Group>
            </Stack>
          ) : null}
        </Modal>
        </Tabs>
      </Paper>
      <ConfirmDialog
        opened={removeMemberConfirm !== null}
        title="Remove household member"
        message={
          <div style={{ fontSize: "0.9rem" }}>
            {removeMemberError ? (
              <div style={{ padding: "0.6rem 0.75rem", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, marginBottom: "0.75rem" }}>
                {removeMemberError}
              </div>
            ) : null}
            {removeMemberDataCount && (removeMemberDataCount.transactions > 0 || removeMemberDataCount.payslips > 0) ? (
              <div style={{ padding: "0.6rem 0.75rem", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, marginBottom: "0.75rem" }}>
                <strong>Warning:</strong> This member has{" "}
                {removeMemberDataCount.transactions > 0 ? <><strong>{removeMemberDataCount.transactions}</strong> transaction(s)</> : null}
                {removeMemberDataCount.transactions > 0 && removeMemberDataCount.payslips > 0 ? " and " : null}
                {removeMemberDataCount.payslips > 0 ? <><strong>{removeMemberDataCount.payslips}</strong> payslip(s)</> : null}
                {" "}assigned to them. Those records will remain but show no owner. Use <strong>Transactions → Belongs-to</strong> filter to reassign before deleting.
              </div>
            ) : null}
            <p style={{ margin: "0 0 0.75rem" }}>This member will be permanently removed from the household. This cannot be undone.</p>
            {memberDrafts.find((m) => m.id === removeMemberConfirm)?.linkedUserId ? (
              <Checkbox
                checked={removeMemberDeleteLogin}
                onChange={(e) => setRemoveMemberDeleteLogin(e.currentTarget.checked)}
                label="Also delete their login account"
              />
            ) : null}
          </div>
        }
        confirmLabel="Remove member"
        danger
        onClose={() => { setRemoveMemberConfirm(null); setRemoveMemberDataCount(null); setRemoveMemberError(null); }}
        onConfirm={() => confirmRemoveHouseholdMember()}
      />
      <ConfirmDialog
        opened={resetPasswordForId !== null}
        title="Reset member password"
        message={
          <p style={{ fontSize: "0.9rem", margin: 0 }}>
            {emailEnabled
              ? "A password reset link will be sent to their email address. Their current session will be invalidated immediately."
              : "This will generate a new temporary password and immediately invalidate their current session. They will be required to change it on next login."}
          </p>
        }
        confirmLabel={resetPasswordBusy ? "Resetting…" : "Reset password"}
        onClose={() => setResetPasswordForId(null)}
        onConfirm={() => { if (resetPasswordForId) void confirmResetPassword(resetPasswordForId); }}
      />
      <Modal
        opened={resetPasswordResult !== null}
        onClose={() => setResetPasswordResult(null)}
        title="Temporary password"
        centered
      >
        <Text c="dimmed" size="sm" mb="md">
          Share this with the member. They must change it on first login.
        </Text>
        <Paper withBorder p="sm" mb="md">
          <Text ff="monospace" size="lg">
            {resetPasswordResult?.tempPassword}
          </Text>
        </Paper>
        <Button fullWidth onClick={() => setResetPasswordResult(null)}>Done</Button>
      </Modal>
    </Stack>
  );
}
