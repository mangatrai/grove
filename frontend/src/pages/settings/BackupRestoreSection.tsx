import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  FileInput,
  Group,
  Modal,
  NumberFormatter,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { IconCloudUpload, IconDownload, IconUpload } from "@tabler/icons-react";

import { apiFetch, apiJson, getToken, setToken, useAuthToken } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";

// ─── Types ───────────────────────────────────────────────────────────────────

type GDriveStatus = {
  connected: boolean;
  folderId?: string;
  folderName?: string | null;
  connectedAt?: string;
  lastError?: string | null;
  backupFrequencyHours?: number;
  backupRetentionCount?: number;
  lastScheduledBackupAt?: string | null;
  needsReauth?: boolean;
};

type DriveBackupEntry = {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  createdAt: string;
};

type GDriveBackupJobRow = {
  id: string;
  status: string;
  driveFileName: string | null;
  sizeBytes: number | null;
  errorText: string | null;
  createdAt: string;
  completedAt: string | null;
};

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

// ─── Constants ───────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBackupDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Unknown";
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${time}`;
}

function fmtKb(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  return ` · ${(bytes / 1024).toFixed(0)} KB`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BackupRestoreSectionProps {
  authRole: "owner" | "admin" | "member" | null;
  /** Whether the data tab is currently active — gates API calls. */
  active: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BackupRestoreSection({ authRole, active }: BackupRestoreSectionProps) {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = authRole === "owner" || authRole === "admin";

  // ── Device export ──────────────────────────────────────────────────────────
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);

  // ── Restore source toggle ──────────────────────────────────────────────────
  const [restoreSource, setRestoreSource] = useState<"device" | "drive">("device");

  // ── Device restore ─────────────────────────────────────────────────────────
  const [deviceFile, setDeviceFile] = useState<File | null>(null);
  const [devicePreviewBusy, setDevicePreviewBusy] = useState(false);
  const [devicePreviewError, setDevicePreviewError] = useState<string | null>(null);
  const [prepareToken, setPrepareToken] = useState<string | null>(null);

  // ── Drive backup job ───────────────────────────────────────────────────────
  const [driveBackupJobId, setDriveBackupJobId] = useState<string | null>(null);
  const [driveBackupPolling, setDriveBackupPolling] = useState(false);
  const [driveBackupResult, setDriveBackupResult] = useState<{ ok: boolean; fileName?: string; error?: string } | null>(null);

  // ── Drive backups list ─────────────────────────────────────────────────────
  const [driveBackups, setDriveBackups] = useState<DriveBackupEntry[] | null>(null);
  const [driveBackupsLoading, setDriveBackupsLoading] = useState(false);
  const [driveBackupsError, setDriveBackupsError] = useState<string | null>(null);
  const [backupHistory, setBackupHistory] = useState<GDriveBackupJobRow[] | null>(null);

  // ── Drive restore job ──────────────────────────────────────────────────────
  const [driveRestoreJobId, setDriveRestoreJobId] = useState<string | null>(null);
  const [driveRestorePolling, setDriveRestorePolling] = useState(false);
  const [driveRestoreError, setDriveRestoreError] = useState<string | null>(null);

  // ── Shared preview modal ───────────────────────────────────────────────────
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<BackupPreview | null>(null);
  const [previewSource, setPreviewSource] = useState<"device" | "drive">("device");
  // For drive previews: which fileId to restore when user confirms inside modal
  const [previewDriveFileId, setPreviewDriveFileId] = useState<string | null>(null);
  const [previewDriveFileName, setPreviewDriveFileName] = useState<string>("");
  const [drivePreviewBusy, setDrivePreviewBusy] = useState<string | null>(null); // fileId being previewed

  // ── Restore progress (shared: device + drive post-confirm) ─────────────────
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  // ── GDrive connection ──────────────────────────────────────────────────────
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveLoading, setGdriveLoading] = useState(false);
  const [gdriveConnecting, setGdriveConnecting] = useState(false);
  const [gdriveError, setGdriveError] = useState<string | null>(null);
  const [gdriveSuccess, setGdriveSuccess] = useState<string | null>(null);
  const [gdriveFolderIdInput, setGdriveFolderIdInput] = useState("");
  const [gdriveDisconnectConfirm, setGdriveDisconnectConfirm] = useState(false);
  const [gdriveSchedulerFreq, setGdriveSchedulerFreq] = useState("24");
  const [gdriveSchedulerRetention, setGdriveSchedulerRetention] = useState<number | string>(7);
  const [gdriveSchedulerSaving, setGdriveSchedulerSaving] = useState(false);
  const [gdriveSchedulerSavedFlash, setGdriveSchedulerSavedFlash] = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────
  const gdriveLastCompletedJob = useMemo(
    () => backupHistory?.find((j) => j.status === "complete") ?? null,
    [backupHistory]
  );

  // ─── Effects ─────────────────────────────────────────────────────────────

  // Load gdrive status when data tab opens
  useEffect(() => {
    if (!token || !active || !canManage) return;
    setGdriveLoading(true);
    void apiJson<GDriveStatus>("/gdrive/status")
      .then((r) => setGdriveStatus(r))
      .catch(() => setGdriveStatus({ connected: false }))
      .finally(() => setGdriveLoading(false));
  }, [token, active, canManage]);

  // Sync scheduler inputs when status loads
  useEffect(() => {
    if (!gdriveStatus?.connected) return;
    setGdriveSchedulerFreq(String(gdriveStatus.backupFrequencyHours ?? 24));
    setGdriveSchedulerRetention(gdriveStatus.backupRetentionCount ?? 7);
  }, [gdriveStatus?.connected, gdriveStatus?.backupFrequencyHours, gdriveStatus?.backupRetentionCount]);

  // Load backup list + history when connected and data tab is active
  useEffect(() => {
    if (!token || !active || !canManage || !gdriveStatus?.connected) return;
    void loadDriveBackups();
    void loadBackupHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, active, canManage, gdriveStatus?.connected]);

  // OAuth callback: ?gdrive=connected or ?gdrive=error lands here
  useEffect(() => {
    const gdriveParam = searchParams.get("gdrive");
    if (!gdriveParam || !token) return;
    const message = searchParams.get("message");
    if (gdriveParam === "connected") {
      setGdriveSuccess("Google Drive connected successfully.");
      setGdriveError(null);
      void apiJson<GDriveStatus>("/gdrive/status")
        .then((r) => setGdriveStatus(r))
        .catch(() => {});
    } else if (gdriveParam === "error") {
      setGdriveError(message ?? "Google Drive connection failed.");
      setGdriveSuccess(null);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("gdrive");
    next.delete("message");
    if (!next.get("tab")) next.set("tab", "data");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, token]);

  // Poll drive backup job
  useEffect(() => {
    if (!driveBackupJobId || !driveBackupPolling) return;
    let cancelled = false;
    const deadline = Date.now() + 3 * 60 * 1000;
    void (async () => {
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) break;
        try {
          const st = await apiJson<{ status: string; driveFileName?: string | null; errorText?: string | null }>(
            `/gdrive/backup/${encodeURIComponent(driveBackupJobId)}`
          );
          if (st.status === "complete") {
            setDriveBackupResult({ ok: true, fileName: st.driveFileName ?? undefined });
            setDriveBackupPolling(false);
            setDriveBackupJobId(null);
            void loadBackupHistory();
            void loadDriveBackups();
            void apiJson<GDriveStatus>("/gdrive/status").then((r) => setGdriveStatus(r)).catch(() => {});
            return;
          }
          if (st.status === "failed") {
            setDriveBackupResult({ ok: false, error: st.errorText ?? "Backup failed." });
            setDriveBackupPolling(false);
            setDriveBackupJobId(null);
            void loadBackupHistory();
            return;
          }
        } catch { /* keep polling */ }
      }
      if (!cancelled) {
        setDriveBackupResult({ ok: false, error: "Backup timed out." });
        setDriveBackupPolling(false);
        setDriveBackupJobId(null);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveBackupJobId, driveBackupPolling]);

  // Poll drive restore job
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
          if (!getToken()) { setDriveRestorePolling(false); setDriveRestoreJobId(null); return; }
        }
      }
      if (!cancelled) {
        setDriveRestoreError("Restore timed out. Try again or restore from a local file.");
        setDriveRestorePolling(false);
        setDriveRestoreJobId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [driveRestoreJobId, driveRestorePolling]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const loadDriveBackups = useCallback(async () => {
    setDriveBackupsLoading(true);
    setDriveBackupsError(null);
    try {
      const res = await apiJson<{ files: DriveBackupEntry[] }>("/gdrive/backups");
      setDriveBackups(res.files);
    } catch (e: unknown) {
      setDriveBackupsError(e instanceof Error ? e.message : "Could not load Drive backup list.");
    } finally {
      setDriveBackupsLoading(false);
    }
  }, []);

  const loadBackupHistory = useCallback(async () => {
    try {
      const res = await apiJson<{ jobs: GDriveBackupJobRow[] }>("/gdrive/backups/history");
      setBackupHistory(res.jobs);
    } catch {
      setBackupHistory([]);
    }
  }, []);

  /** Export to device: start job, poll, auto-download. */
  const handleDownloadToDevice = useCallback(async () => {
    setExportBusy(true);
    setExportError(null);
    setExportJobId(null);
    try {
      const { jobId } = await apiJson<{ jobId: string }>("/exports/household", { method: "POST" });
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const st = await apiJson<{ status: string; error: string | null }>(`/exports/${jobId}`);
        if (st.status === "failed") throw new Error(st.error ?? "Export failed");
        if (st.status === "complete") {
          setExportJobId(jobId);
          // Auto-download
          const res = await apiFetch(`/exports/${jobId}/download`);
          if (!res.ok) {
            setExportError("Export ready but download failed. Try the link below.");
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
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      throw new Error("Export timed out; wait a moment and try again.");
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }, []);

  /** Preview device file — opens shared modal. */
  const handleDevicePreview = useCallback(async () => {
    if (!deviceFile) return;
    setDevicePreviewBusy(true);
    setDevicePreviewError(null);
    try {
      const formData = new FormData();
      formData.append("file", deviceFile);
      const res = await apiFetch("/exports/household/import/prepare", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDevicePreviewError((body as { message?: string }).message ?? "Could not read backup file.");
        return;
      }
      const data = (await res.json()) as BackupPreview & { token: string };
      setPreviewData(data);
      setPrepareToken(data.token);
      setPreviewSource("device");
      setPreviewDriveFileId(null);
      setPreviewModalOpen(true);
    } catch {
      setDevicePreviewError("Failed to contact server.");
    } finally {
      setDevicePreviewBusy(false);
    }
  }, [deviceFile]);

  /** Preview Drive file — downloads manifest, opens shared modal. */
  const handleDrivePreview = useCallback(async (fileId: string, fileName: string) => {
    setDrivePreviewBusy(fileId);
    setDriveBackupsError(null);
    try {
      const res = await apiFetch(`/gdrive/backups/${encodeURIComponent(fileId)}/preview`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDriveBackupsError((body as { message?: string }).message ?? "Could not read backup.");
        return;
      }
      const data = (await res.json()) as BackupPreview;
      setPreviewData(data);
      setPreviewSource("drive");
      setPreviewDriveFileId(fileId);
      setPreviewDriveFileName(fileName);
      setPreviewModalOpen(true);
    } catch {
      setDriveBackupsError("Failed to load backup preview.");
    } finally {
      setDrivePreviewBusy(null);
    }
  }, []);

  /** Restore from device file (called from shared modal confirm). */
  const handleDeviceRestore = useCallback(async () => {
    if (!token || !prepareToken) return;
    setRestoreMessage("Restoring… this may take a minute.");
    setRestoreSuccess(false);
    try {
      const res = await apiFetch("/exports/household/import/execute", {
        method: "POST",
        body: JSON.stringify({ token: prepareToken })
      });
      if (!res.ok) {
        const txt = await res.text();
        let msg = `Restore failed (${res.status})`;
        try { msg = (JSON.parse(txt) as { message?: string }).message ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const { jobId } = (await res.json()) as { jobId: string };
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        const st = await apiJson<{ status: string; error: string | null }>(
          `/exports/import/${jobId}`
        );
        if (st.status === "failed") throw new Error(st.error ?? "Restore failed");
        if (st.status === "complete") {
          setRestoreSuccess(true);
          setRestoreMessage("Restore complete. Signing you out in 3 seconds…");
          setTimeout(() => { setToken(null); window.location.href = "/"; }, 3000);
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Restore timed out.");
    } catch (e: unknown) {
      setRestoreMessage(e instanceof Error ? e.message : String(e));
      setRestoreSuccess(false);
    } finally {
      setPrepareToken(null);
    }
  }, [token, prepareToken]);

  /** Restore from Drive file (called from shared modal confirm). */
  const handleDriveRestore = useCallback(async (fileId: string) => {
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

  /** Back up now to Drive. */
  const handleBackupNow = useCallback(async () => {
    setDriveBackupResult(null);
    setDriveBackupPolling(true);
    try {
      const res = await apiFetch("/gdrive/backup", { method: "POST" });
      const body = (await res.json()) as { jobId?: string; message?: string };
      if (!res.ok || !body.jobId) {
        setDriveBackupResult({ ok: false, error: (body as { message?: string }).message ?? "Could not start backup." });
        setDriveBackupPolling(false);
        return;
      }
      setDriveBackupJobId(body.jobId);
    } catch {
      setDriveBackupResult({ ok: false, error: "Could not reach server." });
      setDriveBackupPolling(false);
    }
  }, []);

  const handleGDriveConnect = useCallback(async (overrideFolderId?: string) => {
    setGdriveError(null);
    setGdriveSuccess(null);
    const folderId = (overrideFolderId ?? gdriveFolderIdInput).trim();
    if (!folderId) { setGdriveError("Enter the Drive folder ID first."); return; }
    setGdriveConnecting(true);
    try {
      const q = new URLSearchParams({ folderId });
      const res = await apiFetch(`/gdrive/oauth/url?${q.toString()}`);
      const raw = await res.text();
      let body: { url?: string; code?: string; message?: string } = {};
      if (raw.trim()) { try { body = JSON.parse(raw) as typeof body; } catch { /* ignore */ } }
      if (!res.ok) {
        setGdriveError(body.message ?? "Could not start Google sign-in.");
        return;
      }
      if (!body.url) { setGdriveError("Server did not return a sign-in URL."); return; }
      window.location.href = body.url;
    } catch (e: unknown) {
      setGdriveError(e instanceof Error ? e.message : "Could not start Google sign-in.");
    } finally {
      setGdriveConnecting(false);
    }
  }, [gdriveFolderIdInput]);

  const handleGDriveDisconnect = useCallback(async () => {
    setGdriveDisconnectConfirm(false);
    setGdriveError(null);
    setGdriveSuccess(null);
    try {
      await apiFetch("/gdrive/disconnect", { method: "DELETE" });
      setGdriveStatus({ connected: false });
      setDriveBackupResult(null);
      setDriveBackupPolling(false);
      setDriveBackupJobId(null);
      setDriveBackups(null);
      setDriveBackupsError(null);
      setDriveRestorePolling(false);
      setDriveRestoreJobId(null);
      setDriveRestoreError(null);
      setBackupHistory(null);
      setGdriveSchedulerSavedFlash(false);
      setGdriveSuccess("Google Drive disconnected.");
    } catch {
      setGdriveError("Could not disconnect. Please try again.");
    }
  }, []);

  const handleSaveScheduler = useCallback(async () => {
    const freq = Number(gdriveSchedulerFreq);
    const retention = typeof gdriveSchedulerRetention === "number"
      ? gdriveSchedulerRetention
      : Number(gdriveSchedulerRetention);
    if (![0, 12, 24, 48, 72, 168].includes(freq) || !Number.isFinite(retention) || retention < 1 || retention > 30) return;
    setGdriveSchedulerSaving(true);
    setGdriveSchedulerSavedFlash(false);
    try {
      const res = await apiFetch("/gdrive/settings", {
        method: "PATCH",
        body: JSON.stringify({ backupFrequencyHours: freq, backupRetentionCount: Math.round(retention) })
      });
      if (!res.ok) return;
      const st = await apiJson<GDriveStatus>("/gdrive/status");
      setGdriveStatus(st);
      setGdriveSchedulerSavedFlash(true);
      window.setTimeout(() => setGdriveSchedulerSavedFlash(false), 3000);
    } catch { /* ignore */ } finally {
      setGdriveSchedulerSaving(false);
    }
  }, [gdriveSchedulerFreq, gdriveSchedulerRetention]);

  const closePreviewModal = useCallback(() => {
    setPreviewModalOpen(false);
    setPreviewData(null);
    setPreviewDriveFileId(null);
    setDeviceFile(null);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  const driveConnected = gdriveStatus?.connected === true;

  /** Staleness alert: last backup was more than 2x the scheduled frequency ago. */
  const showStaleness =
    authRole === "owner" &&
    (gdriveStatus?.backupFrequencyHours ?? 0) > 0 &&
    gdriveLastCompletedJob?.completedAt != null &&
    Date.now() - new Date(gdriveLastCompletedJob.completedAt).getTime() >
      2 * (gdriveStatus?.backupFrequencyHours ?? 0) * 3600 * 1000;

  if (!active) return null;

  return (
    <Stack gap="xl">

      {/* ── Create Backup ─────────────────────────────────────────────── */}
      <Box>
        <Title order={4} mb="xs">Create backup</Title>
        <Text c="dimmed" size="sm" mb="md">
          A backup captures all accounts, transactions, rules, net worth history, payslips, and settings in a single
          portable <strong>.hfb</strong> file.
        </Text>

        {exportError ? (
          <Alert color="red" variant="light" mb="sm" withCloseButton onClose={() => setExportError(null)}>
            {exportError}
          </Alert>
        ) : null}
        {exportJobId && !exportBusy ? (
          <Alert color="green" variant="light" mb="sm">
            Export downloaded. File kept for 48 hours — re-download from{" "}
            <Text
              span
              c="blue"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => void apiFetch(`/exports/${exportJobId}/download`).then(async (res) => {
                if (!res.ok) return;
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `household-export-${exportJobId}.hfb`; a.rel = "noopener";
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
              })}
            >
              here
            </Text>{" "}if needed.
          </Alert>
        ) : null}

        <Group gap="sm" wrap="wrap">
          <Button
            type="button"
            variant="default"
            leftSection={<IconDownload size={16} />}
            loading={exportBusy}
            disabled={exportBusy}
            onClick={() => void handleDownloadToDevice()}
          >
            {exportBusy ? "Preparing…" : "Download to device"}
          </Button>

          {canManage ? (
            <Box>
              <Button
                type="button"
                variant="default"
                leftSection={<IconCloudUpload size={16} />}
                loading={driveBackupPolling}
                disabled={driveBackupPolling || !driveConnected || !gdriveStatus}
                onClick={() => void handleBackupNow()}
                title={!driveConnected ? "Connect Google Drive first" : undefined}
              >
                {driveBackupPolling ? "Backing up…" : "Back up to Drive"}
              </Button>
              {!driveConnected && !gdriveLoading ? (
                <Text size="xs" c="dimmed" mt={4}>Connect Drive below to enable</Text>
              ) : null}
            </Box>
          ) : null}
        </Group>

        {/* Drive backup result inline */}
        {driveBackupResult ? (
          <Alert
            color={driveBackupResult.ok ? "green" : "red"}
            variant="light"
            mt="sm"
            withCloseButton
            onClose={() => setDriveBackupResult(null)}
          >
            {driveBackupResult.ok
              ? `Backup uploaded to Drive${driveBackupResult.fileName ? ` — ${driveBackupResult.fileName}` : ""}.`
              : driveBackupResult.error}
          </Alert>
        ) : null}

        {/* Last backup summary line */}
        {canManage && gdriveLastCompletedJob ? (
          <Text size="sm" c="dimmed" mt="xs">
            Last backup: {formatBackupDate(gdriveLastCompletedJob.completedAt)}
            {fmtKb(gdriveLastCompletedJob.sizeBytes)} — Drive
          </Text>
        ) : null}

        {showStaleness ? (
          <Alert color="fsGold" variant="light" mt="sm">
            Last successful backup was over{" "}
            {Math.floor((Date.now() - new Date(gdriveLastCompletedJob!.completedAt!).getTime()) / 3600000)}{" "}
            hours ago. The server may have been sleeping and missed scheduled backups.
          </Alert>
        ) : null}
      </Box>

      {/* ── Restore ───────────────────────────────────────────────────── */}
      {canManage ? (
        <Box>
          <Title order={4} mb="xs">Restore</Title>
          <Text c="dimmed" size="sm" mb="sm">
            Preview the contents of a backup before committing. Restore permanently replaces all current household
            data — you will be signed out when it completes.
          </Text>

          <SegmentedControl
            mb="md"
            value={restoreSource}
            onChange={(v) => setRestoreSource(v as "device" | "drive")}
            data={[
              { value: "device", label: "This device" },
              { value: "drive", label: "Google Drive" }
            ]}
          />

          {/* ── Device restore tab ── */}
          {restoreSource === "device" ? (
            <Stack gap="sm">
              {devicePreviewError ? (
                <Alert color="red" variant="light">{devicePreviewError}</Alert>
              ) : null}
              {restoreMessage && previewSource === "device" ? (
                <Alert color={restoreSuccess ? "green" : "red"}>{restoreMessage}</Alert>
              ) : null}
              {restoreSuccess ? (
                <Alert color="yellow" variant="light">
                  Google Drive connection has been reset. Go to Settings → Data → Backup to reconnect.
                </Alert>
              ) : null}
              <Group align="flex-end" wrap="nowrap">
                <FileInput
                  label="Backup .hfb file"
                  accept=".hfb"
                  disabled={devicePreviewBusy}
                  value={deviceFile}
                  onChange={(file) => {
                    setDeviceFile(file);
                    setDevicePreviewError(null);
                    setPrepareToken(null);
                  }}
                  placeholder="Choose backup .hfb…"
                  leftSection={<IconUpload size={16} />}
                  clearable
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  disabled={!deviceFile || devicePreviewBusy}
                  loading={devicePreviewBusy}
                  onClick={() => void handleDevicePreview()}
                  miw={180}
                >
                  {devicePreviewBusy ? "Reading…" : "Preview & Restore"}
                </Button>
              </Group>
            </Stack>
          ) : null}

          {/* ── Drive restore tab ── */}
          {restoreSource === "drive" ? (
            <Stack gap="sm">
              {!driveConnected && !gdriveLoading ? (
                <Text c="dimmed" size="sm">
                  Connect Google Drive below to restore from a cloud backup.
                </Text>
              ) : null}

              {driveBackupsError ? (
                <Alert color="red" variant="light" withCloseButton onClose={() => setDriveBackupsError(null)}>
                  {driveBackupsError}
                </Alert>
              ) : null}
              {driveRestoreError ? (
                <Alert color="red" variant="light" withCloseButton onClose={() => setDriveRestoreError(null)}>
                  {driveRestoreError}
                </Alert>
              ) : null}
              {driveRestorePolling ? (
                <Alert color="blue" variant="light">
                  Restoring… you will be signed out when complete.
                </Alert>
              ) : null}

              {driveConnected ? (
                <>
                  <Group justify="flex-end">
                    <Button
                      type="button"
                      size="xs"
                      variant="subtle"
                      loading={driveBackupsLoading}
                      disabled={driveBackupsLoading || driveRestorePolling}
                      onClick={() => void loadDriveBackups()}
                    >
                      Refresh
                    </Button>
                  </Group>

                  {driveBackupsLoading ? (
                    <Stack gap={6}>
                      <Skeleton height={44} radius="sm" />
                      <Skeleton height={44} radius="sm" />
                      <Skeleton height={44} radius="sm" />
                    </Stack>
                  ) : driveBackups === null ? (
                    <Text size="sm" c="dimmed">Loading…</Text>
                  ) : driveBackups.length === 0 ? (
                    <Text size="sm" c="dimmed">No backups found in this Drive folder yet.</Text>
                  ) : (
                    <Stack gap={0}>
                      {driveBackups.slice(0, 10).map((f, i) => (
                        <Group
                          key={f.fileId}
                          justify="space-between"
                          wrap="nowrap"
                          py="sm"
                          style={{ borderTop: i > 0 ? "1px solid var(--mantine-color-dark-5)" : undefined }}
                        >
                          <Stack gap={0}>
                            <Text size="sm">{formatBackupDate(f.createdAt)}</Text>
                            {f.sizeBytes != null ? (
                              <Text size="xs" c="dimmed">{(f.sizeBytes / 1024).toFixed(0)} KB</Text>
                            ) : null}
                          </Stack>
                          {authRole === "owner" ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="default"
                              loading={drivePreviewBusy === f.fileId}
                              disabled={!!drivePreviewBusy || driveRestorePolling}
                              onClick={() => void handleDrivePreview(f.fileId, f.fileName)}
                            >
                              {drivePreviewBusy === f.fileId ? "Loading…" : "Preview & Restore"}
                            </Button>
                          ) : null}
                        </Group>
                      ))}
                      {driveBackups.length > 10 ? (
                        <Text size="xs" c="dimmed" mt="xs">
                          Showing 10 most recent. Older backups are on Drive but not listed here.
                        </Text>
                      ) : null}
                    </Stack>
                  )}
                </>
              ) : null}
            </Stack>
          ) : null}
        </Box>
      ) : null}

      {/* ── Google Drive ──────────────────────────────────────────────── */}
      {canManage ? (
        <Box>
          <Divider mb="md" label="Google Drive" labelPosition="left" />

          {authRole === "admin" ? (
            <Text c="dimmed" size="sm">
              View-only: connection status for your household. Only a household owner can connect, disconnect, or run backups.
            </Text>
          ) : null}

          {gdriveLoading ? <Text c="dimmed" size="sm">Loading…</Text> : null}

          {authRole === "owner" && gdriveError ? (
            <Alert color="red" variant="light" mt="xs" withCloseButton onClose={() => setGdriveError(null)}>
              {gdriveError}
            </Alert>
          ) : null}
          {authRole === "owner" && gdriveSuccess ? (
            <Alert color="green" variant="light" mt="xs" withCloseButton onClose={() => setGdriveSuccess(null)}>
              {gdriveSuccess}
            </Alert>
          ) : null}

          {!gdriveLoading && driveConnected ? (
            <Paper withBorder p="md" radius="md" mt="xs">
              <Stack gap="md">
                {/* Connection header */}
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Stack gap={4}>
                    <Group gap="xs">
                      <Badge color="fsForest" variant="light">Connected</Badge>
                      <Text size="sm" fw={500}>{gdriveStatus?.folderName ?? gdriveStatus?.folderId}</Text>
                    </Group>
                    {gdriveStatus?.connectedAt ? (
                      <Text size="xs" c="dimmed">
                        Connected {new Date(gdriveStatus.connectedAt).toLocaleDateString()}
                      </Text>
                    ) : null}
                  </Stack>
                  {authRole === "owner" ? (
                    <Button
                      type="button"
                      variant="subtle"
                      color="gray"
                      size="xs"
                      onClick={() => setGdriveDisconnectConfirm(true)}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </Group>

                {gdriveStatus?.needsReauth ? (
                  <Alert
                    color="orange"
                    variant="light"
                    title="Google Drive authorization expired"
                  >
                    Backups have been paused. Reconnect to resume automatic backups.
                    {authRole === "owner" ? (
                      <Button
                        variant="filled"
                        color="orange"
                        size="xs"
                        mt="xs"
                        onClick={() => void handleGDriveConnect(gdriveStatus?.folderId)}
                      >
                        Reconnect Google Drive
                      </Button>
                    ) : null}
                  </Alert>
                ) : null}

                {gdriveStatus?.lastError ? (
                  <Alert color="red" variant="light">
                    Connection error: {gdriveStatus.lastError}
                  </Alert>
                ) : null}

                {/* Last failed job alert */}
                {authRole === "owner" &&
                !driveBackupPolling &&
                !driveBackupResult &&
                backupHistory &&
                backupHistory.length > 0 &&
                backupHistory[0].status === "failed" ? (
                  <Alert color="red" variant="light" title="Last backup failed">
                    {backupHistory[0].errorText ?? "Unknown error"}
                  </Alert>
                ) : null}

                {/* Automatic backup settings */}
                {authRole === "owner" ? (
                  <Box>
                    <Text size="sm" fw={500} mb="xs">Automatic backups</Text>
                    <Group align="flex-end" gap="sm" wrap="wrap">
                      <Select
                        label="Frequency"
                        size="xs"
                        data={[
                          { value: "0", label: "Disabled" },
                          { value: "12", label: "Every 12 hours" },
                          { value: "24", label: "Every 24 hours" },
                          { value: "48", label: "Every 48 hours" },
                          { value: "72", label: "Every 3 days" },
                          { value: "168", label: "Weekly" }
                        ]}
                        value={gdriveSchedulerFreq}
                        onChange={(v) => setGdriveSchedulerFreq(v ?? "24")}
                      />
                      <NumberInput
                        label="Keep last"
                        description="backups on Drive"
                        min={1}
                        max={30}
                        size="xs"
                        value={gdriveSchedulerRetention}
                        onChange={(v) => setGdriveSchedulerRetention(v ?? 7)}
                        w={110}
                      />
                      <Button
                        type="button"
                        size="xs"
                        loading={gdriveSchedulerSaving}
                        onClick={() => void handleSaveScheduler()}
                      >
                        Save
                      </Button>
                      {gdriveSchedulerSavedFlash ? (
                        <Text size="sm" style={{ color: "var(--fs-forest)" }} fw={500}>Saved</Text>
                      ) : null}
                    </Group>
                  </Box>
                ) : null}
              </Stack>
            </Paper>
          ) : null}

          {!gdriveLoading && !driveConnected ? (
            authRole === "owner" ? (
              <Stack gap="sm" mt="xs" maw={560}>
                <TextInput
                  label="Drive Folder ID"
                  description="Top-level folder from the Drive URL (…/folders/THIS_PART). Backups go in a TEST or PROD subfolder inside it."
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                  value={gdriveFolderIdInput}
                  onChange={(e) => setGdriveFolderIdInput(e.currentTarget.value)}
                  disabled={gdriveConnecting}
                />
                <Text size="xs" c="dimmed">
                  You will be redirected to Google to approve access, then returned to Settings.
                  The server must have Google OAuth env vars configured.
                </Text>
                <Group>
                  <Button
                    type="button"
                    loading={gdriveConnecting}
                    disabled={!gdriveFolderIdInput.trim()}
                    onClick={() => void handleGDriveConnect()}
                  >
                    {gdriveConnecting ? "Starting…" : "Connect with Google Drive"}
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
              message="This will remove the stored Google connection and disable automated backups. You can reconnect at any time."
              confirmLabel="Disconnect"
              cancelLabel="Cancel"
              danger
              onClose={() => setGdriveDisconnectConfirm(false)}
              onConfirm={() => void handleGDriveDisconnect()}
            />
          ) : null}
        </Box>
      ) : null}

      {/* ── Shared Preview Modal ──────────────────────────────────────── */}
      <Modal
        opened={previewModalOpen}
        onClose={closePreviewModal}
        title={
          previewSource === "drive" && previewDriveFileName
            ? `Preview: ${previewDriveFileName}`
            : "Backup Preview"
        }
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
            {restoreMessage && previewSource === "device" ? (
              <Alert color={restoreSuccess ? "green" : "red"}>{restoreMessage}</Alert>
            ) : null}
            {restoreSuccess ? (
              <Alert color="yellow" variant="light">
                Google Drive connection has been reset. Go to Settings → Data → Backup to reconnect.
              </Alert>
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={closePreviewModal}>Cancel</Button>
              <Button
                color="red"
                onClick={() => {
                  setPreviewModalOpen(false);
                  setPreviewData(null);
                  if (previewSource === "drive" && previewDriveFileId) {
                    void handleDriveRestore(previewDriveFileId);
                  } else {
                    void handleDeviceRestore();
                  }
                }}
              >
                Restore from this backup
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </Stack>
  );
}
