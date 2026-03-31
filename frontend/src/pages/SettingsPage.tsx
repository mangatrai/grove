import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
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
  owner_scope?: "household" | "person";
  owner_person_profile_id?: string | null;
  default_parser_profile_id?: string | null;
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
        searchText: p.label
      }))
    }
  ];
}

type EmployerDraft = { id?: string; displayName: string; parserProfileId: string };

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
  salaryAccountId: string;
  employers: EmployerDraft[];
};

type HouseholdMemberDraft = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  relationship: string;
};

type MeResponse = { user: { role: "owner" | "admin" | "member" } };

const PROFILE_ICON_KEYS = ["person", "home", "wallet", "briefcase", "star"] as const;

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
    salaryAccountId: "",
    employers: [{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }]
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
    salaryAccountId: "",
    employers: [{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }]
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
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [accountDraft, setAccountDraft] = useState({
    id: "",
    type: "checking",
    institution: "",
    accountMask: "",
    belongsTo: "household" as BelongsToChoice,
    defaultParserProfileId: ""
  });

  const canManageHousehold = authRole === "owner" || authRole === "admin";

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
        salaryAccountId: settings.salaryDepositFinancialAccountId ?? "",
        employers:
          settings.employers.length > 0
            ? settings.employers.map((e) => ({
                id: e.id,
                displayName: e.displayName,
                parserProfileId: e.parserProfileId ?? "ibm_pay_contributions_pdf"
              }))
            : [{ displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }]
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
    } catch (e: unknown) {
      setHouseholdError(e instanceof Error ? e.message : "Could not load settings");
      setTargetDraft("");
    } finally {
      setLoadingHousehold(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<MeResponse>("/auth/me")
      .then((r) => setAuthRole(r.user.role))
      .catch(() => setAuthRole(null));
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
  }, [token, tab, canManageHousehold]);

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
      const body = {
        type: accountDraft.type,
        institution: accountDraft.institution.trim(),
        accountMask: accountDraft.accountMask.trim() || null,
        ownerScope: belongsTo.ownerScope,
        ownerPersonProfileId: belongsTo.ownerPersonProfileId,
        defaultParserProfileId: accountDraft.defaultParserProfileId || null
      };
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
        defaultParserProfileId: ""
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

  async function saveProfile() {
    if (!token) {
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const iconKey = profileDraft.avatarIconKey.trim() || PROFILE_ICON_KEYS[0];
      await apiJson<HouseholdProfileResponse>("/household/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: profileDraft.firstName.trim(),
          lastName: profileDraft.lastName.trim(),
          email: profileDraft.email.trim() || null,
          phoneNumber: profileDraft.phone.trim() || null,
          avatarKey: iconKey,
          salaryDepositFinancialAccountId: profileDraft.salaryAccountId === "" ? null : profileDraft.salaryAccountId,
          employers: profileDraft.employers
            .map((e) => ({
              id: e.id,
              displayName: e.displayName.trim(),
              parserProfileId: e.parserProfileId,
              parserMapping: {} as Record<string, unknown>
            }))
            .filter((e) => e.displayName.length > 0)
        })
      });
      setProfileSuccess("Profile saved.");
      await loadProfile();
    } catch (e: unknown) {
      setProfileError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSavingProfile(false);
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
          relationship: row.relationship as "self" | "spouse" | "child" | "dependent" | "other"
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
    } catch (e: unknown) {
      setSecurityError(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setChangingPassword(false);
    }
  }

  const tabLinks = useMemo(
    () =>
      TABS.filter((id) => id !== "household" || canManageHousehold).map((id) => (
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
    [tab, setTab, canManageHousehold]
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
            <p className="muted" style={{ marginTop: 0 }}>
              <strong>Avatar icon</strong> is stored as <code>avatarKey</code> on your profile. Below is a local preview;
              the app shell and other screens are not wired to it yet — same saved value will be used when we add
              avatars in the header and elsewhere.
            </p>
            <div className="row" style={{ alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div
                className="settings-avatar-preview"
                style={{
                  width: "3rem",
                  height: "3rem",
                  borderRadius: "50%",
                  background: "var(--muted-bg, #e8eaed)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.5rem",
                  flexShrink: 0
                }}
                title={`avatarKey: ${profileDraft.avatarIconKey}`}
                aria-label={`Avatar preview: ${profileDraft.avatarIconKey}`}
              >
                {avatarEmojiPreview(profileDraft.avatarIconKey)}
              </div>
            </div>
            {profileError ? <p className="error">{profileError}</p> : null}
            {profileSuccess ? <p className="success">{profileSuccess}</p> : null}
            {loadingProfile ? <p className="muted">Loading…</p> : null}
            {!loadingProfile ? (
              <div className="settings-household-form" style={{ maxWidth: "none" }}>
                <div className="row" style={{ gap: "0.75rem", flexWrap: "nowrap", justifyContent: "flex-start" }}>
                  <label className="settings-field" style={{ flex: "0 0 14rem" }}>
                    First name
                    <input
                      type="text"
                      value={profileDraft.firstName}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, firstName: e.target.value }))}
                      disabled={savingProfile}
                      placeholder="First name"
                    />
                  </label>
                  <label className="settings-field" style={{ flex: "0 0 14rem" }}>
                    Last name
                    <input
                      type="text"
                      value={profileDraft.lastName}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, lastName: e.target.value }))}
                      disabled={savingProfile}
                      placeholder="Last name"
                    />
                  </label>
                </div>
                <label className="settings-field">
                  Email
                  <input
                    type="email"
                    value={profileDraft.email}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, email: e.target.value }))}
                    disabled={savingProfile}
                    placeholder="you@example.com"
                  />
                </label>
                <label className="settings-field">
                  Phone
                  <input
                    type="tel"
                    value={profileDraft.phone}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, phone: e.target.value }))}
                    disabled={savingProfile}
                    placeholder="+1 555 000 0000"
                  />
                </label>
                <label className="settings-field">
                  Avatar icon
                  <select
                    value={profileDraft.avatarIconKey}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, avatarIconKey: e.target.value }))}
                    disabled={savingProfile}
                  >
                    {PROFILE_ICON_KEYS.map((iconKey) => (
                      <option key={iconKey} value={iconKey}>
                        {iconKey}
                      </option>
                    ))}
                  </select>
                </label>
                <h3
                  className="settings-panel__title"
                  style={{ fontSize: "1.05rem", marginBottom: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}
                >
                  Employer Setup
                  <span
                    aria-label="Employer setup info"
                    title="Use this section to set your employer name, salary deposit account, and payslip format mapping for import/upload."
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "1rem",
                      height: "1rem",
                      borderRadius: "50%",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-muted)",
                      fontSize: "0.72rem",
                      cursor: "help"
                    }}
                  >
                    i
                  </span>
                </h3>
                {profileDraft.employers.map((row, idx) => (
                  <div
                    key={idx}
                    className="row"
                    style={{ marginBottom: "0.5rem", alignItems: "flex-end", flexWrap: "nowrap", gap: "0.5rem" }}
                  >
                    <label className="settings-field" style={{ flex: "1 1 12rem" }}>
                      Employers
                      <input
                        type="text"
                        value={row.displayName}
                        placeholder="e.g. Acme Corp"
                        onChange={(e) => {
                          const next = [...profileDraft.employers];
                          next[idx] = { ...next[idx], displayName: e.target.value };
                          setProfileDraft((prev) => ({ ...prev, employers: next }));
                        }}
                        disabled={savingProfile}
                      />
                    </label>
                    <label className="settings-field" style={{ flex: "1 1 12rem" }}>
                      Salary deposit account (optional)
                      <select
                        value={profileDraft.salaryAccountId}
                        onChange={(e) => setProfileDraft((prev) => ({ ...prev, salaryAccountId: e.target.value }))}
                        disabled={savingProfile}
                      >
                        <option value="">— Not set —</option>
                        {accounts
                          .filter((a) => a.type !== "payslip")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {formatAccountForSelect(a)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="settings-field" style={{ flex: "1 1 11rem" }}>
                      Payslip format
                      <select
                        value={row.parserProfileId}
                        onChange={(e) => {
                          const next = [...profileDraft.employers];
                          next[idx] = { ...next[idx], parserProfileId: e.target.value };
                          setProfileDraft((prev) => ({ ...prev, employers: next }));
                        }}
                        disabled={savingProfile}
                      >
                        <option value="ibm_pay_contributions_pdf">IBM Pay &amp; Contributions (PDF)</option>
                        <option value="adp_payslip_pdf">ADP (PDF — placeholder)</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={savingProfile || profileDraft.employers.length <= 1}
                      onClick={() =>
                        setProfileDraft((prev) => ({
                          ...prev,
                          employers: prev.employers.filter((_, i) => i !== idx)
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="settings-household-actions" style={{ marginTop: "0.25rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingProfile}
                    onClick={() =>
                      setProfileDraft((prev) => ({
                        ...prev,
                        employers: [...prev.employers, { displayName: "", parserProfileId: "ibm_pay_contributions_pdf" }]
                      }))
                    }
                  >
                    Add employer
                  </button>
                  <button type="button" disabled={savingProfile} onClick={() => void saveProfile()}>
                    {savingProfile ? "Saving…" : "Save profile"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "household" ? (
          <div className="settings-panel" role="tabpanel">
            <h2 className="settings-panel__title">Household</h2>
            <p className="muted">Manage household members, roles, and relationships.</p>
            <h3 className="settings-panel__title" style={{ fontSize: "1.05rem", marginTop: 0 }}>
              Household members
            </h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Track household members for role and relationship context.
            </p>
            {membersError ? <p className="error">{membersError}</p> : null}
            {membersSuccess ? <p className="success">{membersSuccess}</p> : null}
            {loadingMembers ? <p className="muted">Loading members…</p> : null}
            {!loadingMembers ? (
              <>
                {memberDrafts.map((member, idx) => (
                  <div
                    key={member.id ?? `draft-${idx}`}
                    className="row"
                    style={{ marginBottom: "0.5rem", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}
                  >
                    <label className="settings-field" style={{ flex: "1 1 10rem" }}>
                      First name
                      <input
                        type="text"
                        value={member.firstName}
                        placeholder="Alex"
                        onChange={(e) => {
                          const next = [...memberDrafts];
                          next[idx] = { ...next[idx], firstName: e.target.value };
                          setMemberDrafts(next);
                        }}
                        disabled={savingMemberIndex !== null}
                      />
                    </label>
                    <label className="settings-field" style={{ flex: "1 1 10rem" }}>
                      Last name
                      <input
                        type="text"
                        value={member.lastName}
                        placeholder="Doe"
                        onChange={(e) => {
                          const next = [...memberDrafts];
                          next[idx] = { ...next[idx], lastName: e.target.value };
                          setMemberDrafts(next);
                        }}
                        disabled={savingMemberIndex !== null}
                      />
                    </label>
                    <label className="settings-field" style={{ flex: "1 1 14rem" }}>
                      Email
                      <input
                        type="email"
                        value={member.email}
                        placeholder="alex@example.com"
                        onChange={(e) => {
                          const next = [...memberDrafts];
                          next[idx] = { ...next[idx], email: e.target.value };
                          setMemberDrafts(next);
                        }}
                        disabled={savingMemberIndex !== null}
                      />
                    </label>
                    <label className="settings-field" style={{ flex: "1 1 10rem" }}>
                      Role
                      <select
                        value={member.role}
                        onChange={(e) => {
                          const next = [...memberDrafts];
                          next[idx] = { ...next[idx], role: e.target.value };
                          setMemberDrafts(next);
                        }}
                        disabled={savingMemberIndex !== null}
                      >
                        <option value="head">Head</option>
                        <option value="member">Member</option>
                      </select>
                    </label>
                    <label className="settings-field" style={{ flex: "1 1 10rem" }}>
                      Relationship
                      <select
                        value={member.relationship}
                        onChange={(e) => {
                          const next = [...memberDrafts];
                          next[idx] = { ...next[idx], relationship: e.target.value };
                          setMemberDrafts(next);
                        }}
                        disabled={savingMemberIndex !== null}
                      >
                        <option value="self">Self</option>
                        <option value="spouse">Spouse</option>
                        <option value="child">Child</option>
                        <option value="dependent">Dependent</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                  </div>
                ))}
                <div className="settings-household-actions" style={{ marginBottom: "1rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingMemberIndex !== null}
                    onClick={() =>
                      setMemberDrafts((prev) => [
                        ...prev,
                        { firstName: "", lastName: "", email: "", role: "member", relationship: "other" }
                      ])
                    }
                  >
                    Add another row
                  </button>
                  <button type="button" disabled={savingMemberIndex !== null} onClick={() => void saveHouseholdMembers()}>
                    {savingMemberIndex !== null ? "Saving…" : "Save household"}
                  </button>
                </div>
              </>
            ) : null}
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

              </>
            ) : null}
          </div>
        ) : null}

        {tab === "accounts" ? (
          <div className="settings-panel" role="tabpanel">
            <h2 className="settings-panel__title">Connected accounts</h2>
            <p className="muted">Manual onboarding for financial accounts, owner assignment, and parser defaults.</p>
            {accountError ? <p className="error">{accountError}</p> : null}
            {accountSuccess ? <p className="success">{accountSuccess}</p> : null}
            <div className="settings-household-form">
              <label className="settings-field">
                Institution
                <input
                  type="text"
                  value={accountDraft.institution}
                  onChange={(e) => setAccountDraft((d) => ({ ...d, institution: e.target.value }))}
                  disabled={savingAccount}
                  placeholder="e.g. Bank of America"
                />
              </label>
              <div className="row">
                <label className="settings-field" style={{ flex: "1 1 10rem" }}>
                  Account type
                  <select
                    value={accountDraft.type}
                    onChange={(e) => setAccountDraft((d) => ({ ...d, type: e.target.value }))}
                    disabled={savingAccount}
                  >
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="credit_card">Credit card</option>
                    <option value="loan">Loan</option>
                    <option value="mortgage">Mortgage</option>
                    <option value="investment">Investment</option>
                    <option value="payslip">Payslip</option>
                  </select>
                </label>
                <label className="settings-field" style={{ flex: "1 1 10rem" }}>
                  Account mask (optional)
                  <input
                    type="text"
                    value={accountDraft.accountMask}
                    onChange={(e) => setAccountDraft((d) => ({ ...d, accountMask: e.target.value }))}
                    disabled={savingAccount}
                    placeholder="1234"
                  />
                </label>
                <label className="settings-field" style={{ flex: "1 1 12rem" }}>
                  Default parser (optional)
                  <select
                    value={accountDraft.defaultParserProfileId}
                    onChange={(e) => setAccountDraft((d) => ({ ...d, defaultParserProfileId: e.target.value }))}
                    disabled={savingAccount}
                  >
                    <option value="">— none —</option>
                    <option value="boa_checking_csv">BoA checking CSV</option>
                    <option value="boa_credit_card_csv">BoA credit card CSV</option>
                    <option value="chase_card_csv">Chase card CSV</option>
                    <option value="citi_card_csv">Citi card CSV</option>
                    <option value="marcus_online_savings_pdf">Marcus savings PDF</option>
                    <option value="ibm_pay_contributions_pdf">IBM payslip PDF</option>
                    <option value="adp_payslip_pdf">ADP payslip PDF</option>
                    <option value="generic_tabular">Generic tabular</option>
                  </select>
                </label>
              </div>
              <div className="row">
                <label className="settings-field" style={{ flex: "1 1 18rem" }}>
                  Belongs-to
                  <HierarchicalSearchPicker
                    value={accountDraft.belongsTo}
                    onChange={(v) => setAccountDraft((d) => ({ ...d, belongsTo: (v ?? "household") as BelongsToChoice }))}
                    groups={buildBelongsToGroups(accountOwners)}
                    placeholder="Select who this account belongs to"
                    ariaLabel="Connected account belongs-to"
                    disabled={savingAccount}
                  />
                </label>
              </div>
              <div className="settings-household-actions">
                <button type="button" disabled={savingAccount} onClick={() => void saveConnectedAccount()}>
                  {savingAccount ? "Saving…" : accountDraft.id ? "Update account" : "Add account"}
                </button>
                {accountDraft.id ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingAccount}
                    onClick={() =>
                      setAccountDraft({
                        id: "",
                        type: "checking",
                        institution: "",
                        accountMask: "",
                        belongsTo: "household",
                        defaultParserProfileId: ""
                      })
                    }
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </div>
            <div style={{ marginTop: "1rem", overflowX: "auto" }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Type</th>
                    <th>Mask</th>
                    <th>Belongs-to</th>
                    <th>Default parser</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.institution}</td>
                      <td>{a.type}</td>
                      <td>{a.account_mask ?? "—"}</td>
                      <td>
                        {a.owner_scope === "person"
                          ? formatBelongsToLabel(
                              accountOwners.find((p) => p.id === a.owner_person_profile_id)?.label ?? "Member"
                            )
                          : "Household"}
                      </td>
                      <td>{a.default_parser_profile_id ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
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
                              defaultParserProfileId: a.default_parser_profile_id ?? ""
                            })
                          }
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            {securityError ? <p className="error">{securityError}</p> : null}
            {securitySuccess ? <p className="success">{securitySuccess}</p> : null}
            <div className="settings-household-form">
              <label className="settings-field">
                Current password
                <input
                  type="password"
                  value={passwordDraft.currentPassword}
                  onChange={(e) =>
                    setPasswordDraft((prev) => ({ ...prev, currentPassword: e.target.value }))
                  }
                  disabled={changingPassword}
                  autoComplete="current-password"
                />
              </label>
              <label className="settings-field">
                New password
                <input
                  type="password"
                  value={passwordDraft.newPassword}
                  onChange={(e) => setPasswordDraft((prev) => ({ ...prev, newPassword: e.target.value }))}
                  disabled={changingPassword}
                  autoComplete="new-password"
                />
              </label>
              <label className="settings-field">
                Confirm new password
                <input
                  type="password"
                  value={passwordDraft.confirmPassword}
                  onChange={(e) =>
                    setPasswordDraft((prev) => ({ ...prev, confirmPassword: e.target.value }))
                  }
                  disabled={changingPassword}
                  autoComplete="new-password"
                />
              </label>
              <div className="settings-household-actions">
                <button type="button" disabled={changingPassword} onClick={() => void changePassword()}>
                  {changingPassword ? "Updating…" : "Change password"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
