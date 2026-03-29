import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";

const TABS = ["profile", "household", "accounts", "notifications", "security"] as const;
type SettingsTab = (typeof TABS)[number];

function isTab(s: string | null): s is SettingsTab {
  return s !== null && (TABS as readonly string[]).includes(s);
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
  const [loadingHousehold, setLoadingHousehold] = useState(true);
  const [savingHousehold, setSavingHousehold] = useState(false);
  const [householdError, setHouseholdError] = useState<string | null>(null);

  const loadHousehold = useCallback(async () => {
    setLoadingHousehold(true);
    setHouseholdError(null);
    try {
      const r = await apiJson<{ monthlySavingsTargetUsd: number | null }>("/household/settings");
      setTargetDraft(r.monthlySavingsTargetUsd != null ? String(r.monthlySavingsTargetUsd) : "");
    } catch (e: unknown) {
      setHouseholdError(e instanceof Error ? e.message : "Could not load settings");
      setTargetDraft("");
    } finally {
      setLoadingHousehold(false);
    }
  }, []);

  useEffect(() => {
    if (!token || tab !== "household") {
      return;
    }
    void loadHousehold();
  }, [token, tab, loadHousehold]);

  async function saveHouseholdTarget(value: number | null) {
    if (!token) {
      return;
    }
    setSavingHousehold(true);
    setHouseholdError(null);
    try {
      await apiJson<{ monthlySavingsTargetUsd: number | null }>("/household/settings", {
        method: "PATCH",
        body: JSON.stringify({ monthlySavingsTargetUsd: value })
      });
      await loadHousehold();
    } catch (e: unknown) {
      setHouseholdError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingHousehold(false);
    }
  }

  const tabLinks = useMemo(
    () =>
      TABS.map((id) => (
        <button
          key={id}
          type="button"
          className={`settings-tab ${tab === id ? "settings-tab--active" : ""}`}
          onClick={() => setTab(id)}
        >
          {id === "profile"
            ? "Profile"
            : id === "household"
              ? "Household"
              : id === "accounts"
                ? "Accounts"
                : id === "notifications"
                  ? "Notifications"
                  : "Security"}
        </button>
      )),
    [tab, setTab]
  );

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div>
      <div className="card">
        <h1>Settings</h1>
        <p className="muted">
          Manage your account and household preferences. Quick edits for cash-flow targets also stay on{" "}
          <Link to="/">Home</Link>.
        </p>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {tabLinks}
        </div>

        {tab === "profile" ? (
          <div className="settings-panel" role="tabpanel">
            <h2 className="settings-panel__title">Profile</h2>
            <p className="muted">
              Email, display name, and phone will live here when user-profile APIs are available. For now, sign in
              controls identity.
            </p>
          </div>
        ) : null}

        {tab === "household" ? (
          <div className="settings-panel" role="tabpanel">
            <h2 className="settings-panel__title">Household</h2>
            <p className="muted">
              Monthly savings target (USD) feeds <strong>safe-to-spend</strong> on the cash summary. Same field as the
              slider on Home — change either place.
            </p>
            {householdError ? <p className="error">{householdError}</p> : null}
            {loadingHousehold ? <p className="muted">Loading…</p> : null}
            {!loadingHousehold ? (
              <div className="settings-household-form">
                <label className="settings-field">
                  Monthly savings target (USD)
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="e.g. 500"
                    value={targetDraft}
                    onChange={(e) => setTargetDraft(e.target.value)}
                    disabled={savingHousehold}
                  />
                </label>
                <div className="settings-household-actions">
                  <button
                    type="button"
                    disabled={savingHousehold}
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
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingHousehold}
                    onClick={() => void saveHouseholdTarget(null)}
                  >
                    Clear target
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "accounts" ? (
          <div className="settings-panel" role="tabpanel">
            <h2 className="settings-panel__title">Connected accounts</h2>
            <p className="muted">
              Financial accounts are added through import and the accounts list. A consolidated “connected accounts” view
              and bank linking are not in this build.
            </p>
          </div>
        ) : null}

        {tab === "notifications" ? (
          <div className="settings-panel" role="tabpanel">
            <h2 className="settings-panel__title">Notifications</h2>
            <p className="muted">No notification service is configured for the local MVP. This tab is reserved.</p>
          </div>
        ) : null}

        {tab === "security" ? (
          <div className="settings-panel" role="tabpanel">
            <h2 className="settings-panel__title">Security</h2>
            <p className="muted">Password change and session management APIs are not exposed in this MVP UI yet.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
