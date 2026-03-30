import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { apiFetch, apiJson, getToken } from "../api";
import { formatAccountForSelect } from "../import/accountDisplay";
import {
  inferParserProfile,
  profilesEquivalent,
  type FinancialAccountLike
} from "../import/inferParserProfile";
import { friendlyParserLabel } from "../import/profileLabels";

type ImportFileRow = {
  id: string;
  file_name: string;
  status: string;
  financial_account_id: string | null;
  parser_profile_id: string | null;
};

type FinancialAccount = {
  id: string;
  type: string;
  institution: string;
  account_mask: string | null;
  currency: string;
};

function formatProfileLabel(id: string): string {
  return id.replace(/_/g, " ");
}

function accountById(accounts: FinancialAccount[], id: string): FinancialAccount | undefined {
  return accounts.find((a) => a.id === id);
}

/** Parses JSON error bodies from `apiJson` failures (e.g. 409 INVALID_TRANSITION). */
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
};

type ImportSessionSummary = {
  sessionId: string;
  totals: {
    rawRows: number;
    canonicalRows: number;
    nearDuplicatesFlagged: number;
    openItemsNeedingReview: number;
    notPostedExactDuplicateOrSkipped: number;
  };
  files: ImportSessionFileSummaryRow[];
};

export function ImportWorkspacePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showAdvanced = searchParams.get("advanced") === "1";
  const token = getToken();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [files, setFiles] = useState<ImportFileRow[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);

  const [drafts, setDrafts] = useState<Record<string, { accountId: string; profileId: string }>>({});
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
    const nextDrafts: Record<string, { accountId: string; profileId: string }> = {};
    for (const f of detail.files) {
      nextDrafts[f.id] = {
        accountId: f.financial_account_id ?? "",
        profileId: f.parser_profile_id ?? ""
      };
    }
    setDrafts(nextDrafts);

    const accRes = await apiJson<{ accounts: FinancialAccount[] }>("/imports/accounts");
    setAccounts(accRes.accounts);

    try {
      const sum = await apiJson<ImportSessionSummary>(`/imports/sessions/${sessionId}/summary`);
      setSessionSummary(sum);
    } catch {
      setSessionSummary(null);
    }
  }, [sessionId]);

  const undoLedgerPost = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    const posted = sessionSummary?.totals.canonicalRows ?? 0;
    if (posted === 0) {
      return;
    }
    const ok = window.confirm(
      "Remove all transactions this import posted to the ledger? Parsed file rows stay so you can run import again. After the session is finalized, this rollback is no longer available."
    );
    if (!ok) {
      return;
    }
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
    } finally {
      setUndoBusy(false);
    }
  }, [sessionId, sessionSummary?.totals.canonicalRows, load]);

  const finalizeSession = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    const ok = window.confirm(
      "Finalize this import session? After finalizing, the session is locked: you cannot undo ledger posting for this import, and this cannot be reversed from the app."
    );
    if (!ok) {
      return;
    }
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
    } finally {
      setFinalizeBusy(false);
    }
  }, [sessionId, load]);

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
    async (fileId: string, accountId: string, profileId: string) => {
      if (!sessionId || !accountId || !profileId) {
        return;
      }
      setError(null);
      try {
        await apiJson(`/imports/sessions/${sessionId}/files/${fileId}`, {
          method: "PATCH",
          body: JSON.stringify({
            financialAccountId: accountId,
            parserProfileId: profileId
          })
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
          [fileId]: { accountId: "", profileId: "" }
        }));
        return;
      }

      const inferred = inferParserProfile(account as FinancialAccountLike, file?.file_name);
      if (inferred) {
        setDrafts((d) => ({
          ...d,
          [fileId]: { accountId, profileId: inferred }
        }));
        await persistBinding(fileId, accountId, inferred);
        return;
      }

      setDrafts((d) => ({
        ...d,
        [fileId]: { accountId, profileId: "" }
      }));
      const hint = showAdvanced
        ? ""
        : " If you’re debugging, add ?advanced=1 to this page’s URL to pick a format manually.";
      setError(
        `We couldn’t match this file to a supported import for that account.${hint}`
      );
    },
    [accounts, files, persistBinding, showAdvanced]
  );

  const onOverrideProfileChange = useCallback(
    async (fileId: string, profileId: string) => {
      const accountId = drafts[fileId]?.accountId ?? "";
      setDrafts((d) => ({
        ...d,
        [fileId]: { accountId, profileId }
      }));
      if (accountId && profileId) {
        await persistBinding(fileId, accountId, profileId);
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
      const out = await apiJson<{ parsedFiles: number; parsedRows: number; skippedFiles: unknown[] }>(
        `/imports/sessions/${sessionId}/parse`,
        { method: "POST", body: JSON.stringify(body) }
      );
      setMessage(`Parse OK: ${out.parsedFiles} file(s), ${out.parsedRows} row(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parse failed");
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
      const parseOut = await apiJson<{ parsedFiles: number; parsedRows: number }>(
        `/imports/sessions/${sessionId}/parse`,
        { method: "POST", body: JSON.stringify(body) }
      );
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
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setPipelineBusy(false);
    }
  }

  if (!sessionId) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <p className="muted">Loading session…</p>;
  }

  return (
    <div>
      <div className="card">
        <h1>Import session</h1>
        <p className="muted">
          Session <code>{sessionId}</code> — status: <strong>{sessionStatus ?? "—"}</strong>
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
              CSV, XLSX, and PDF are supported. Files upload as soon as you pick them. If a file was already added to
              this session, it&apos;s skipped and everything else still uploads.
            </p>
            <input
              ref={fileInputRef}
              name="files"
              type="file"
              multiple
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

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Files & account</h2>
        <p className="muted">
          For each file, pick the account it belongs to. The menu shows the institution, account type, and last four
          digits when available so you can tell accounts apart. We detect the file format automatically — you
          don&apos;t choose parsers unless you use advanced mode.
        </p>
        <p
          className="muted"
          style={{
            marginTop: "0.65rem",
            padding: "0.65rem 0.75rem",
            borderLeft: "3px solid var(--hf-border-strong, #94a3b8)",
            background: "var(--hf-callout-bg, rgba(148, 163, 184, 0.12))"
          }}
        >
          <strong>Employer payslip (IBM):</strong> For a pay-stub PDF (e.g. SuccessFactors / Pay and Contributions),
          pick <strong>{friendlyParserLabel("ibm_pay_contributions_pdf")}</strong> if we don&apos;t auto-detect it, or use a filename like
          “payslip” or “paystub” for a suggestion. Parse may show <strong>0</strong> ledger lines — that&apos;s
          expected. Run <strong>canonicalize</strong> anyway to finish the session and clear staging; summaries appear
          under <Link to="/payslips">Payslips</Link>, not in the transaction ledger.
        </p>
        {files.length === 0 ? (
          <p className="muted">No files yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Account</th>
                <th>Format</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const acc = accountById(accounts, drafts[f.id]?.accountId ?? "");
                const inferred = inferParserProfile(acc as FinancialAccountLike | undefined, f.file_name);
                const savedProfile = f.parser_profile_id ?? drafts[f.id]?.profileId ?? "";
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
                    </td>
                    <td>
                      <select
                        value={drafts[f.id]?.accountId ?? ""}
                        onChange={(e) => void onAccountChange(f.id, e.target.value)}
                      >
                        <option value="">— choose account —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {formatAccountForSelect(a)}
                          </option>
                        ))}
                      </select>
                    </td>
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
                  const ledgerHref = `/transactions?sessionId=${sessionId}`;
                  const reviewHref = `/transactions?sessionId=${sessionId}&needsReview=true`;
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
                        {row.openItemsNeedingReview > 0 ? (
                          <>
                            <dt>Open review items</dt>
                            <dd>{row.openItemsNeedingReview}</dd>
                          </>
                        ) : null}
                      </dl>
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

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Run import</h2>
        <p className="muted">
          One step parses every file and then loads transactions into your ledger (dedupe included). Use separate
          steps only if you need to debug.
        </p>
        <div className="row">
          <button
            type="button"
            disabled={!allFilesBound || pipelineBusy}
            onClick={() => void runImport()}
            title={!allFilesBound ? "Each file needs an account and format saved" : undefined}
          >
            {pipelineBusy ? "Working…" : "Run import"}
          </button>
        </div>
        {!allFilesBound && files.length > 0 ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Choose an account for every file first. Formats save automatically when we can detect them.
          </p>
        ) : null}
        <details style={{ marginTop: "1rem" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            Separate steps (parse only / canonicalize only)
          </summary>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="secondary" disabled={!allFilesBound || pipelineBusy} onClick={() => void runParse()}>
              Parse session
            </button>
            <button type="button" className="secondary" disabled={pipelineBusy} onClick={() => void runCanonicalize()}>
              Canonicalize (dedupe)
            </button>
          </div>
        </details>
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
                onClick={() => void undoLedgerPost()}
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
                onClick={() => void finalizeSession()}
              >
                {finalizeBusy ? "Working…" : "Finalize session"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
