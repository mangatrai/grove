import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { formatAccountForSelect } from "../import/accountDisplay";

const TABS = ["profile", "household", "accounts", "notifications", "security"] as const;
type SettingsTab = (typeof TABS)[number];

function isTab(s: string | null): s is SettingsTab {
  return s !== null && (TABS as readonly string[]).includes(s);
}

type HouseholdSettingsResponse = {
  monthlySavingsTargetUsd: number | null;
  salaryDepositFinancialAccountId: string | null;
  employers: Array<{
    id: string;
    displayName: string;
    parserProfileId?: string;
    parserMapping?: Record<string, unknown>;
  }>;
};

type AccountRow = {
  id: string;
  institution: string;
  type: string;
  account_mask: string | null;
};

type EmployerDraft = { id?: string; displayName: string; parserProfileId: string };

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
  const [salaryAccountId, setSalaryAccountId] = useState("");
  const [employerDrafts, setEmployerDrafts] = useState<EmployerDraft[]>([
    { displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }
  ]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadingHousehold, setLoadingHousehold] = useState(true);
  const [savingHousehold, setSavingHousehold] = useState(false);
  const [householdError, setHouseholdError] = useState<string | null>(null);

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
      setSalaryAccountId(r.salaryDepositFinancialAccountId ?? "");
      if (r.employers && r.employers.length > 0) {
        setEmployerDrafts(
          r.employers.map((e) => ({
            id: e.id,
            displayName: e.displayName,
            parserProfileId: e.parserProfileId ?? "ibm_pay_contributions_pdf"
          }))
        );
      } else {
        setEmployerDrafts([{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }]);
      }
    } catch (e: unknown) {
      setHouseholdError(e instanceof Error ? e.message : "Could not load settings");
      setTargetDraft("");
      setSalaryAccountId("");
      setEmployerDrafts([{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }]);
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
      await apiJson<HouseholdSettingsResponse>("/household/settings", {
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

  async function saveSalaryAccount() {
    if (!token) {
      return;
    }
    setSavingHousehold(true);
    setHouseholdError(null);
    try {
      await apiJson<HouseholdSettingsResponse>("/household/settings", {
        method: "PATCH",
        body: JSON.stringify({
          salaryDepositFinancialAccountId: salaryAccountId === "" ? null : salaryAccountId
        })
      });
      await loadHousehold();
    } catch (e: unknown) {
      setHouseholdError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingHousehold(false);
    }
  }

  async function saveEmployers() {
    if (!token) {
      return;
    }
    const employers = employerDrafts
      .map((e) => ({
        id: e.id,
        displayName: e.displayName.trim(),
        parserProfileId: e.parserProfileId,
        parserMapping: {} as Record<string, unknown>
      }))
      .filter((e) => e.displayName.length > 0);
    setSavingHousehold(true);
    setHouseholdError(null);
    try {
      await apiJson<HouseholdSettingsResponse>("/household/settings", {
        method: "PATCH",
        body: JSON.stringify({ employers })
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

  const bankAccounts = accounts.filter((a) => a.type !== "payslip");

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
              Monthly savings target feeds <strong>safe-to-spend</strong> on the cash summary. Income / payslip fields
              below are optional — they document where salary lands and which employers you expect payslips from (v1:
              IBM parser placeholder; more parsers and onboarding flows later — see <code>docs/PAYSLIP_V1.md</code>).
            </p>
            {householdError ? <p className="error">{householdError}</p> : null}
            {loadingHousehold ? <p className="muted">Loading…</p> : null}
            {!loadingHousehold ? (
              <>
                <div className="settings-household-form" style={{ marginBottom: "1.5rem" }}>
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

                <h3 className="settings-panel__title" style={{ fontSize: "1.05rem" }}>
                  Salary deposit account (optional)
                </h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  Where your paycheck typically deposits — used for future matching (not required for import). Pick a
                  bank account; payslip “bucket” accounts are excluded here.
                </p>
                <div className="settings-household-form">
                  <label className="settings-field">
                    Account
                    <select
                      value={salaryAccountId}
                      onChange={(e) => setSalaryAccountId(e.target.value)}
                      disabled={savingHousehold}
                    >
                      <option value="">— Not set —</option>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {formatAccountForSelect(a)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-household-actions">
                    <button type="button" disabled={savingHousehold} onClick={() => void saveSalaryAccount()}>
                      Save salary account
                    </button>
                  </div>
                </div>

                <h3 className="settings-panel__title" style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>
                  Employers (payslip sources)
                </h3>
                <p className="muted" style={{ marginTop: 0 }}>
              Add one row per employer and choose which <strong>payslip format</strong> applies. IBM is fully supported;
              ADP is registered for onboarding but parsing is not implemented yet.
                </p>
                {employerDrafts.map((row, idx) => (
                  <div key={idx} className="row" style={{ marginBottom: "0.5rem", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
                    <label className="settings-field" style={{ flex: "1 1 12rem" }}>
                      Employer name
                      <input
                        type="text"
                        value={row.displayName}
                        placeholder="e.g. Acme Corp"
                        onChange={(e) => {
                          const next = [...employerDrafts];
                          next[idx] = { ...next[idx], displayName: e.target.value };
                          setEmployerDrafts(next);
                        }}
                        disabled={savingHousehold}
                      />
                    </label>
                    <label className="settings-field" style={{ flex: "1 1 11rem" }}>
                      Payslip format
                      <select
                        value={row.parserProfileId}
                        onChange={(e) => {
                          const next = [...employerDrafts];
                          next[idx] = { ...next[idx], parserProfileId: e.target.value };
                          setEmployerDrafts(next);
                        }}
                        disabled={savingHousehold}
                      >
                        <option value="ibm_pay_contributions_pdf">IBM Pay &amp; Contributions (PDF)</option>
                        <option value="adp_payslip_pdf">ADP (PDF — placeholder)</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={savingHousehold || employerDrafts.length <= 1}
                      onClick={() => setEmployerDrafts(employerDrafts.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="settings-household-actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingHousehold}
                    onClick={() =>
                      setEmployerDrafts([
                        ...employerDrafts,
                        { displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }
                      ])
                    }
                  >
                    Add employer
                  </button>
                  <button type="button" disabled={savingHousehold} onClick={() => void saveEmployers()}>
                    Save employers
                  </button>
                </div>
              </>
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
