import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import {
  Alert,
  Anchor,
  Box,
  Button,
  Checkbox,
  Divider,
  Fieldset,
  Group,
  Modal,
  MultiSelect,
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
import { IconTrash } from "@tabler/icons-react";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { RecurringTagModal, type RecurringOverride } from "../components/RecurringTagModal";
import { formatAccountForSelect, formatAccountFreshness } from "../import/accountDisplay";
import { US_INSTITUTION_LABELS } from "../import/institutionCatalog";
import { CurrencyInput } from "../components/CurrencyInput";
import { formatUsd } from "../utils/format";
import { BackupRestoreSection } from "./settings/BackupRestoreSection";
import { GroveLoader } from "../components/GroveLoader";

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
  sub_type: string | null;
  memo: string | null;
  liquidity: string | null;
  property_id: string | null;
  account_mask: string | null;
  last_uploaded_at?: string | null;
  last_statement_end_date?: string | null;
  owner_scope?: "household" | "person";
  owner_person_profile_id?: string | null;
  default_parser_profile_id?: string | null;
};

// ─── Account type / sub-type picker data ─────────────────────────────────────

const ACCOUNT_TYPE_GROUPS: HierarchicalPickerGroup[] = [
  {
    group: "general",
    items: [
      { value: "checking",    label: "Checking",    searchText: "bank liquid" },
      { value: "savings",     label: "Savings",     searchText: "bank liquid hysa" },
      { value: "investment",  label: "Investment",  searchText: "brokerage reit crypto semi-liquid" },
      { value: "retirement",  label: "Retirement",  searchText: "401k ira pension restricted" },
      { value: "health",      label: "Health",      searchText: "hsa fsa hra able benefits" },
      { value: "education",   label: "Education",   searchText: "529 college coverdell" },
      { value: "credit_card", label: "Credit Card", searchText: "liability revolving" },
      { value: "loan",        label: "Loan",        searchText: "mortgage auto debt liability" },
      { value: "cash",        label: "Cash",        searchText: "cash on hand wallet petty cash liquid" },
      { value: "payslip",     label: "Payslip",     searchText: "income payroll" }
    ]
  },
  {
    group: "Subtypes",
    items: [
      { value: "checking/personal", label: "Checking > Personal" },
      { value: "checking/joint",    label: "Checking > Joint" },
      { value: "checking/business", label: "Checking > Business" },
      { value: "checking/student",  label: "Checking > Student" },
      { value: "savings/regular",      label: "Savings > Regular" },
      { value: "savings/high_yield",   label: "Savings > High-Yield (HYSA)", searchText: "hysa high yield" },
      { value: "savings/money_market", label: "Savings > Money Market" },
      { value: "savings/cd",           label: "Savings > CD (Certificate of Deposit)", searchText: "certificate deposit" },
      { value: "investment/brokerage",     label: "Investment > Brokerage" },
      { value: "investment/reit",          label: "Investment > REIT", searchText: "real estate investment trust" },
      { value: "investment/crypto",        label: "Investment > Crypto" },
      { value: "investment/stock_options", label: "Investment > Stock Options / RSU", searchText: "rsu espp equity" },
      { value: "investment/annuity",       label: "Investment > Annuity" },
      { value: "retirement/401k_traditional", label: "Retirement > 401(k) Traditional" },
      { value: "retirement/401k_roth",        label: "Retirement > 401(k) Roth" },
      { value: "retirement/ira_traditional",  label: "Retirement > IRA Traditional" },
      { value: "retirement/ira_roth",         label: "Retirement > IRA Roth" },
      { value: "retirement/sep_ira",          label: "Retirement > SEP-IRA", searchText: "self employed" },
      { value: "retirement/simple_ira",       label: "Retirement > SIMPLE IRA" },
      { value: "retirement/403b",             label: "Retirement > 403(b)", searchText: "nonprofit" },
      { value: "retirement/457b",             label: "Retirement > 457(b)", searchText: "government public sector" },
      { value: "retirement/pension",          label: "Retirement > Pension" },
      { value: "health/hsa",  label: "Health > HSA",  searchText: "health savings account triple tax" },
      { value: "health/fsa",  label: "Health > FSA",  searchText: "flexible spending" },
      { value: "health/hra",  label: "Health > HRA",  searchText: "health reimbursement" },
      { value: "health/able", label: "Health > ABLE", searchText: "disability savings" },
      { value: "education/529",        label: "Education > 529 Plan",    searchText: "college savings" },
      { value: "education/coverdell",  label: "Education > Coverdell ESA" },
      { value: "education/ugma_utma",  label: "Education > UGMA / UTMA", searchText: "custodial" },
      { value: "credit_card/rewards",  label: "Credit Card > Rewards / Cashback" },
      { value: "credit_card/travel",   label: "Credit Card > Travel" },
      { value: "credit_card/store",    label: "Credit Card > Store" },
      { value: "credit_card/secured",  label: "Credit Card > Secured" },
      { value: "credit_card/business", label: "Credit Card > Business" },
      { value: "loan/mortgage_primary",    label: "Loan > Mortgage (Primary Home)",        searchText: "primary residence home" },
      { value: "loan/mortgage_investment", label: "Loan > Mortgage (Investment Property)", searchText: "rental investment" },
      { value: "loan/mortgage_vacation",   label: "Loan > Mortgage (Vacation Home)",       searchText: "vacation second home" },
      { value: "loan/heloc",               label: "Loan > HELOC",                          searchText: "home equity line credit" },
      { value: "loan/home_equity_loan",    label: "Loan > Home Equity Loan",               searchText: "home equity fixed" },
      { value: "loan/auto",                label: "Loan > Auto",                           searchText: "car vehicle" },
      { value: "loan/personal",            label: "Loan > Personal" },
      { value: "loan/student_federal",     label: "Loan > Student Loan (Federal)",         searchText: "federal student" },
      { value: "loan/student_private",     label: "Loan > Student Loan (Private)",         searchText: "private student" },
      { value: "loan/business",            label: "Loan > Business" },
      { value: "loan/medical",             label: "Loan > Medical",                        searchText: "medical debt" }
    ]
  }
];

const SUBTYPE_LABELS: Record<string, string> = {
  personal: "Personal", joint: "Joint", business: "Business", student: "Student",
  regular: "Regular", high_yield: "High-Yield", money_market: "Money Market", cd: "CD",
  brokerage: "Brokerage", reit: "REIT", crypto: "Crypto",
  stock_options: "Stock Options", annuity: "Annuity",
  "401k_traditional": "401(k) Trad", "401k_roth": "401(k) Roth",
  ira_traditional: "IRA Trad", ira_roth: "IRA Roth",
  sep_ira: "SEP-IRA", simple_ira: "SIMPLE IRA", "403b": "403(b)", "457b": "457(b)", pension: "Pension",
  hsa: "HSA", fsa: "FSA", hra: "HRA", able: "ABLE",
  "529": "529", coverdell: "Coverdell", ugma_utma: "UGMA/UTMA",
  rewards: "Rewards", travel: "Travel", store: "Store", secured: "Secured",
  mortgage_primary: "Mortgage (Primary)", mortgage_investment: "Mortgage (Investment)",
  mortgage_vacation: "Mortgage (Vacation)", heloc: "HELOC",
  home_equity_loan: "Home Equity Loan", auto: "Auto",
  student_federal: "Student (Federal)", student_private: "Student (Private)", medical: "Medical"
};

const TYPE_LABELS: Record<string, string> = {
  checking: "Checking", savings: "Savings", investment: "Investment",
  retirement: "Retirement", health: "Health", education: "Education",
  credit_card: "Credit Card", loan: "Loan", cash: "Cash", payslip: "Payslip"
};

function formatAccountTypeLabel(type: string, subType: string | null): string {
  const t = TYPE_LABELS[type] ?? type;
  if (!subType) return t;
  const st = SUBTYPE_LABELS[subType] ?? subType.replace(/_/g, " ");
  return `${t} · ${st}`;
}

const MORTGAGE_SUBTYPES = new Set(["mortgage_primary", "mortgage_investment", "mortgage_vacation"]);

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
    dateOfBirth: string | null;
    hasDob: boolean;
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
  /** YYYY-MM-DD or "" when not set. Setting this auto-computes age. */
  dateOfBirth: string;
  sex: "" | "male" | "female" | "nonbinary" | "prefer_not_to_say";
  individualGrossIncomeUsd: string;
  riskTolerance: "" | "conservative" | "moderate" | "aggressive";
  financialGoals: string[];
  employers: EmployerDraft[];
};

/** Compute display-friendly age from a YYYY-MM-DD string. Returns "—" on invalid. */
function computeAgeDisplay(dob: string): string {
  const birth = new Date(`${dob}T12:00:00.000Z`);
  if (isNaN(birth.getTime())) return "—";
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const m = today.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age <= 150 ? String(age) : "—";
}

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

type InstitutionsResponse = {
  catalog: string[];
  custom: Array<{ id: string; displayName: string }>;
};

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
    age: p.age == null ? "" : String(p.age),
    dateOfBirth: p.dateOfBirth ?? "",
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
    dateOfBirth: "",
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
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [institutionCatalogList, setInstitutionCatalogList] = useState<string[]>([...US_INSTITUTION_LABELS]);
  const [institutionCustom, setInstitutionCustom] = useState<Array<{ id: string; displayName: string }>>([]);
  const [institutionModalOpen, setInstitutionModalOpen] = useState(false);
  const [institutionModalName, setInstitutionModalName] = useState("");
  const [institutionModalSaving, setInstitutionModalSaving] = useState(false);
  const [institutionModalError, setInstitutionModalError] = useState<string | null>(null);
  const [recurringOverrides, setRecurringOverrides] = useState<RecurringOverride[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [editingOverride, setEditingOverride] = useState<RecurringOverride | null>(null);
  const [accountDraft, setAccountDraft] = useState({
    id: "",
    typeSubtype: "checking",
    institution: "",
    accountMask: "",
    memo: "",
    liquidity: "" as "" | "liquid" | "semi_liquid" | "restricted",
    belongsTo: "household" as BelongsToChoice,
    initialBalance: "",
    initialBalanceDate: new Date().toISOString().slice(0, 10)
  });
  const [propertyModal, setPropertyModal] = useState<{
    open: boolean;
    accountId: string;
    propertyId: string | null;
    addressLine1: string;
    city: string;
    state: string;
    zip: string;
    propertyUse: "" | "primary" | "rental" | "vacation";
    marketValueUsd: string;
    asOfDate: string;
    saving: boolean;
    error: string | null;
    apiPropertyId: string | null;
    apiListingId: string | null;
    retrieving: boolean;
    retrieveError: string | null;
  }>({
    open: false, accountId: "", propertyId: null,
    addressLine1: "", city: "", state: "", zip: "",
    propertyUse: "", marketValueUsd: "",
    asOfDate: new Date().toISOString().slice(0, 10),
    saving: false, error: null,
    apiPropertyId: null, apiListingId: null,
    retrieving: false, retrieveError: null
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

  function openAddInstitutionModal() {
    setInstitutionModalName("");
    setInstitutionModalError(null);
    setInstitutionModalOpen(true);
  }

  async function submitCustomInstitution() {
    const name = institutionModalName.trim();
    if (!name) {
      setInstitutionModalError("Institution name is required.");
      return;
    }
    setInstitutionModalSaving(true);
    setInstitutionModalError(null);
    try {
      await apiJson("/imports/institutions/custom", {
        method: "POST",
        body: JSON.stringify({ displayName: name })
      });
      await loadInstitutions();
      setAccountDraft((d) => ({ ...d, institution: name }));
      setInstitutionModalOpen(false);
    } catch (e: unknown) {
      setInstitutionModalError(e instanceof Error ? e.message : "Could not add institution");
    } finally {
      setInstitutionModalSaving(false);
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
      const [typeVal, subTypeVal] = accountDraft.typeSubtype.split("/");
      const parsedInitialBalance = accountDraft.initialBalance.trim()
        ? parseFloat(accountDraft.initialBalance)
        : null;
      const body: Record<string, unknown> = {
        type: typeVal,
        subType: subTypeVal ?? null,
        memo: accountDraft.memo.trim() || null,
        liquidity: accountDraft.liquidity || null,
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
      let newAccountId: string | null = null;
      if (accountDraft.id) {
        await apiJson(`/imports/accounts/${encodeURIComponent(accountDraft.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        });
      } else {
        const created = await apiJson<{ id: string }>("/imports/accounts", { method: "POST", body: JSON.stringify(body) });
        newAccountId = created.id;
      }
      const r = await apiJson<{ accounts: AccountRow[] }>("/imports/accounts");
      setAccounts(r.accounts);
      setAccountSuccess(accountDraft.id ? "Account updated." : "Account created.");

      // Auto-open property modal when a mortgage account is newly created
      const [typeVal2, subTypeVal2] = accountDraft.typeSubtype.split("/");
      const justCreatedMortgage = !accountDraft.id && newAccountId
        && typeVal2 === "loan" && MORTGAGE_SUBTYPES.has(subTypeVal2 ?? "");

      setAccountDraft({
        id: "",
        typeSubtype: "checking",
        institution: "",
        accountMask: "",
        memo: "",
        liquidity: "",
        belongsTo: "household",
        initialBalance: "",
        initialBalanceDate: new Date().toISOString().slice(0, 10)
      });

      if (justCreatedMortgage) {
        setPropertyModal({
          open: true, accountId: newAccountId!, propertyId: null,
          addressLine1: "", city: "", state: "", zip: "", propertyUse: "",
          marketValueUsd: "", asOfDate: new Date().toISOString().slice(0, 10),
          saving: false, error: null,
          apiPropertyId: null, apiListingId: null, retrieving: false, retrieveError: null
        });
      }
    } catch (e: unknown) {
      setAccountError(e instanceof Error ? e.message : "Could not save account");
    } finally {
      setSavingAccount(false);
    }
  }

  async function openPropertyModal(a: AccountRow) {
    const base = {
      open: true, accountId: a.id, propertyId: a.property_id,
      addressLine1: "", city: "", state: "", zip: "",
      propertyUse: "" as "" | "primary" | "rental" | "vacation",
      marketValueUsd: "", asOfDate: new Date().toISOString().slice(0, 10),
      saving: false, error: null,
      apiPropertyId: null, apiListingId: null, retrieving: false, retrieveError: null
    };
    if (a.property_id) {
      try {
        const r = await apiJson<{
          property: {
            addressLine1: string | null; city: string | null;
            state: string | null; zip: string | null;
            propertyUse: string | null; latestValueUsd: number | null;
            latestValueAsOf: string | null;
          }
        }>(`/household/properties/${encodeURIComponent(a.property_id)}`);
        const p = r.property;
        setPropertyModal({
          ...base,
          addressLine1: p.addressLine1 ?? "",
          city: p.city ?? "",
          state: p.state ?? "",
          zip: p.zip ?? "",
          propertyUse: (p.propertyUse ?? "") as typeof base.propertyUse,
          marketValueUsd: p.latestValueUsd != null ? String(p.latestValueUsd) : "",
          asOfDate: p.latestValueAsOf ?? base.asOfDate
        });
      } catch {
        setPropertyModal(base);
      }
    } else {
      setPropertyModal(base);
    }
  }

  async function retrieveValuation() {
    if (!token) return;
    const addr = [
      propertyModal.addressLine1.trim(),
      propertyModal.city.trim(),
      propertyModal.state.trim(),
      propertyModal.zip.trim()
    ].filter(Boolean).join(", ");
    if (!addr) return;
    setPropertyModal((m) => ({ ...m, retrieving: true, retrieveError: null }));
    try {
      const r = await apiJson<{ estimate: number; apiPropertyId: string; apiListingId: string | null }>(
        "/household/properties/preview-valuation",
        { method: "POST", body: JSON.stringify({ address: addr }) }
      );
      setPropertyModal((m) => ({
        ...m,
        retrieving: false,
        marketValueUsd: String(Math.round(r.estimate)),
        asOfDate: new Date().toISOString().slice(0, 10),
        apiPropertyId: r.apiPropertyId,
        apiListingId: r.apiListingId
      }));
    } catch (e: unknown) {
      setPropertyModal((m) => ({
        ...m,
        retrieving: false,
        retrieveError: e instanceof Error ? e.message : "Could not retrieve valuation"
      }));
    }
  }

  async function savePropertyDetails() {
    if (!token) return;
    setPropertyModal((m) => ({ ...m, saving: true, error: null }));
    try {
      const body: Record<string, unknown> = {
        addressLine1: propertyModal.addressLine1.trim() || null,
        city: propertyModal.city.trim() || null,
        state: propertyModal.state.trim() || null,
        zip: propertyModal.zip.trim() || null,
        propertyUse: propertyModal.propertyUse || null,
        accountId: propertyModal.accountId
      };
      if (propertyModal.apiPropertyId) {
        body.apiPropertyId = propertyModal.apiPropertyId;
        body.apiListingId = propertyModal.apiListingId;
      }
      const valueUsd = parseFloat(propertyModal.marketValueUsd);
      if (!isNaN(valueUsd) && valueUsd >= 0) {
        body.initialValueUsd = valueUsd;
        body.initialValueAsOf = propertyModal.asOfDate;
      }

      if (propertyModal.propertyId) {
        // Update existing property
        await apiJson(`/household/properties/${encodeURIComponent(propertyModal.propertyId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            addressLine1: body.addressLine1,
            city: body.city,
            state: body.state,
            zip: body.zip,
            propertyUse: body.propertyUse
          })
        });
        if (!isNaN(valueUsd) && valueUsd >= 0) {
          await apiJson(`/household/properties/${encodeURIComponent(propertyModal.propertyId)}/values`, {
            method: "POST",
            body: JSON.stringify({ marketValueUsd: valueUsd, asOfDate: propertyModal.asOfDate })
          });
        }
      } else {
        // Create new property + link to account
        await apiJson("/household/properties", { method: "POST", body: JSON.stringify(body) });
      }

      const r = await apiJson<{ accounts: AccountRow[] }>("/imports/accounts");
      setAccounts(r.accounts);
      setPropertyModal((m) => ({ ...m, open: false, saving: false }));
    } catch (e: unknown) {
      setPropertyModal((m) => ({
        ...m,
        saving: false,
        error: e instanceof Error ? e.message : "Could not save property details"
      }));
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
      const dobTrim = profileDraft.dateOfBirth.trim();
      const age = ageTrim === "" ? null : Number(ageTrim);
      const individualIncome = incomeTrim === "" ? null : Number(incomeTrim);
      if (age !== null && (!Number.isInteger(age) || age < 1 || age > 129)) {
        throw new Error("Age must be an integer between 1 and 129.");
      }
      if (dobTrim !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(dobTrim)) {
        throw new Error("Date of birth must be a valid YYYY-MM-DD value.");
      }
      if (individualIncome !== null && (!Number.isFinite(individualIncome) || individualIncome < 0)) {
        throw new Error("Individual gross annual income must be a non-negative number.");
      }
      const body: Record<string, unknown> = {
        firstName: profileDraft.firstName.trim(),
        lastName: profileDraft.lastName.trim(),
        email: profileDraft.email.trim() || null,
        phoneNumber: profileDraft.phone.trim() || null,
        avatarKey: iconKey,
        sex: profileDraft.sex || null,
        individualGrossIncomeUsd: individualIncome,
        riskTolerance: profileDraft.riskTolerance || null,
        financialGoals: profileDraft.financialGoals,
        dateOfBirth: dobTrim === "" ? null : dobTrim,
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
      };
      // Only include manual age in payload when DOB is unset (manual age mode).
      // When DOB is set, the backend auto-clears age and computes it on read.
      if (dobTrim === "") {
        body.age = age;
      }
      await apiJson<HouseholdProfileResponse>("/household/profile", {
        method: "PATCH",
        body: JSON.stringify(body)
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
            {loadingProfile ? (
              <Group gap="sm"><GroveLoader size="sm" color="muted" /><Text size="sm" c="dimmed">Loading profile…</Text></Group>
            ) : null}
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
                    {profileDraft.dateOfBirth ? (
                      <Box>
                        <Text size="sm" fw={500} mb={4}>Date of birth</Text>
                        <Group gap="sm" align="center">
                          <TextInput
                            type="date"
                            size="sm"
                            value={profileDraft.dateOfBirth}
                            onChange={(e) =>
                              setProfileDraft((prev) => ({ ...prev, dateOfBirth: e.currentTarget.value }))
                            }
                            disabled={savingProfile}
                            aria-label="Date of birth"
                          />
                          <Button
                            type="button"
                            variant="subtle"
                            color="red"
                            size="xs"
                            disabled={savingProfile}
                            onClick={() => setProfileDraft((prev) => ({ ...prev, dateOfBirth: "" }))}
                          >
                            Clear DOB
                          </Button>
                        </Group>
                        <Text size="xs" c="dimmed" mt={4}>
                          Age: {computeAgeDisplay(profileDraft.dateOfBirth)}
                        </Text>
                      </Box>
                    ) : (
                      <Box>
                        <Text size="sm" fw={500} mb={4}>Date of birth</Text>
                        <TextInput
                          type="date"
                          size="sm"
                          placeholder="Set to auto-compute age"
                          value={profileDraft.dateOfBirth}
                          onChange={(e) =>
                            setProfileDraft((prev) => ({ ...prev, dateOfBirth: e.currentTarget.value }))
                          }
                          disabled={savingProfile}
                          aria-label="Date of birth"
                        />
                        <Text size="xs" c="dimmed" mt={4}>Or enter age manually:</Text>
                        <TextInput
                          size="sm"
                          inputMode="numeric"
                          placeholder="Age"
                          style={{ width: "6rem", marginTop: "0.25rem" }}
                          value={profileDraft.age}
                          onChange={(e) =>
                            setProfileDraft((prev) => ({ ...prev, age: e.currentTarget.value }))
                          }
                          disabled={savingProfile}
                          aria-label="Age (manual)"
                        />
                      </Box>
                    )}
                    <Group align="end" grow>
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
                      <CurrencyInput
                        label="Individual gross annual income"
                        description="Include base salary + regular bonuses + regular 1099 income. Exclude one-time items."
                        value={
                          profileDraft.individualGrossIncomeUsd === ""
                            ? undefined
                            : Number(profileDraft.individualGrossIncomeUsd)
                        }
                        onChange={(value) =>
                          setProfileDraft((prev) => ({
                            ...prev,
                            individualGrossIncomeUsd:
                              value == null ? "" : String(value)
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
            {loadingMembers ? (
              <Group gap="sm"><GroveLoader size="sm" color="muted" /><Text size="sm" c="dimmed">Loading members…</Text></Group>
            ) : null}
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
                              <Text size="sm" style={{ color: "var(--fs-forest)" }} fw={600}>
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
            {loadingHousehold ? (
              <Group gap="sm"><GroveLoader size="sm" color="muted" /><Text size="sm" c="dimmed">Loading household…</Text></Group>
            ) : null}
            {!loadingHousehold ? (
              <Stack mb="xl">
                <CurrencyInput
                  label="Monthly savings target (USD)"
                  placeholder="e.g. 500"
                  value={targetDraft === "" ? undefined : Number(targetDraft)}
                  onChange={(value) => setTargetDraft(value == null ? "" : String(value))}
                  disabled={savingHousehold}
                  style={{ maxWidth: 320 }}
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
                    <CurrencyInput
                      label="Combined gross household income"
                      description="Combined gross income for all earners: base salary + regular bonuses. Exclude one-time items."
                      value={householdIncomeDraft === "" ? undefined : Number(householdIncomeDraft)}
                      onChange={(value) =>
                        setHouseholdIncomeDraft(value == null ? "" : String(value))
                      }
                      disabled={savingHousehold}
                      style={{ maxWidth: 360 }}
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
                  footer={(close) => (
                    <Group justify="flex-start">
                      <Button
                        type="button"
                        variant="default"
                        disabled={savingAccount}
                        onClick={() => { close(); openAddInstitutionModal(); }}
                      >
                        Add institution name…
                      </Button>
                    </Group>
                  )}
                />
              </Fieldset>
              <Fieldset legend="Account type">
                <HierarchicalSearchPicker
                  value={accountDraft.typeSubtype}
                  onChange={(v) => v && setAccountDraft((d) => ({ ...d, typeSubtype: v }))}
                  groups={ACCOUNT_TYPE_GROUPS}
                  placeholder="Select type (e.g. Checking, Loan > Mortgage…)"
                  ariaLabel="Account type and subtype"
                  disabled={savingAccount}
                />
              </Fieldset>
              <Group align="end" grow>
                <TextInput
                  label="Account mask (optional)"
                  value={accountDraft.accountMask}
                  onChange={(e) => setAccountDraft((d) => ({ ...d, accountMask: e.currentTarget.value }))}
                  disabled={savingAccount}
                  placeholder="1234"
                />
                <Select
                  label="Liquidity override (optional)"
                  value={accountDraft.liquidity || null}
                  onChange={(v) => setAccountDraft((d) => ({ ...d, liquidity: (v ?? "") as typeof d.liquidity }))}
                  disabled={savingAccount}
                  clearable
                  placeholder="Auto (from type)"
                  data={[
                    { value: "liquid",      label: "Liquid" },
                    { value: "semi_liquid", label: "Semi-liquid" },
                    { value: "restricted",  label: "Restricted" }
                  ]}
                />
              </Group>
              <Textarea
                label="Memo (optional)"
                value={accountDraft.memo}
                onChange={(e) => setAccountDraft((d) => ({ ...d, memo: e.currentTarget.value }))}
                disabled={savingAccount}
                placeholder="Notes about this account (used in AI insights)"
                autosize
                minRows={1}
                maxRows={3}
              />
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
                  <CurrencyInput
                    label="Starting balance (optional)"
                    value={accountDraft.initialBalance === "" ? undefined : Number(accountDraft.initialBalance)}
                    onChange={(value) =>
                      setAccountDraft((d) => ({
                        ...d,
                        initialBalance: value == null ? "" : String(value)
                      }))
                    }
                    disabled={savingAccount}
                    placeholder="0.00"
                    style={{ maxWidth: 280 }}
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
                        typeSubtype: "checking",
                        institution: "",
                        accountMask: "",
                        memo: "",
                        liquidity: "",
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
                  {accounts.map((a) => {
                    const isMortgage = a.type === "loan" && MORTGAGE_SUBTYPES.has(a.sub_type ?? "");
                    return (
                    <Table.Tr key={a.id}>
                      <Table.Td>{a.institution}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatAccountTypeLabel(a.type, a.sub_type)}</Text>
                        {a.memo ? <Text size="xs" c="dimmed" truncate maw={200}>{a.memo}</Text> : null}
                      </Table.Td>
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
                        <Group gap="xs" wrap="nowrap">
                          <Button
                            type="button"
                            variant="default"
                            size="xs"
                            onClick={() =>
                              setAccountDraft({
                                id: a.id,
                                typeSubtype: a.sub_type ? `${a.type}/${a.sub_type}` : a.type,
                                institution: a.institution,
                                accountMask: a.account_mask ?? "",
                                memo: a.memo ?? "",
                                liquidity: (a.liquidity as typeof accountDraft.liquidity) ?? "",
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
                          {isMortgage ? (
                            <Button
                              type="button"
                              variant="light"
                              color={a.property_id ? "teal" : "blue"}
                              size="xs"
                              onClick={() => void openPropertyModal(a)}
                            >
                              {a.property_id ? "Property ✓" : "+ Property"}
                            </Button>
                          ) : null}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    );
                  })}
              </Table.Tbody>
            </Table>
            <Modal
              opened={institutionModalOpen}
              onClose={() => setInstitutionModalOpen(false)}
              title="Add institution"
              size="sm"
            >
              <Stack gap="md">
                <TextInput
                  label="Institution name"
                  description="Saved for everyone in your household."
                  placeholder="e.g. First National Bank"
                  value={institutionModalName}
                  onChange={(e) => setInstitutionModalName(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitCustomInstitution(); }}
                  disabled={institutionModalSaving}
                  data-autofocus
                />
                {institutionModalError ? <Alert color="red">{institutionModalError}</Alert> : null}
                <Group justify="flex-end">
                  <Button
                    variant="default"
                    disabled={institutionModalSaving}
                    onClick={() => setInstitutionModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    loading={institutionModalSaving}
                    onClick={() => void submitCustomInstitution()}
                  >
                    Add
                  </Button>
                </Group>
              </Stack>
            </Modal>
          </Stack>
        ) : null}

        {/* ── Property details modal ── */}
        <Modal
          opened={propertyModal.open}
          onClose={() => setPropertyModal((m) => ({ ...m, open: false }))}
          title="Property details"
          size="md"
        >
          <Stack>
            {propertyModal.error ? <Alert color="red">{propertyModal.error}</Alert> : null}
            <TextInput
              label="Street address"
              value={propertyModal.addressLine1}
              onChange={(e) => setPropertyModal((m) => ({ ...m, addressLine1: e.currentTarget.value }))}
              placeholder="123 Main St"
              disabled={propertyModal.saving}
            />
            <Group grow>
              <TextInput
                label="City"
                value={propertyModal.city}
                onChange={(e) => setPropertyModal((m) => ({ ...m, city: e.currentTarget.value }))}
                disabled={propertyModal.saving}
              />
              <TextInput
                label="State"
                value={propertyModal.state}
                onChange={(e) => setPropertyModal((m) => ({ ...m, state: e.currentTarget.value }))}
                placeholder="CA"
                maw={80}
                disabled={propertyModal.saving}
              />
              <TextInput
                label="ZIP"
                value={propertyModal.zip}
                onChange={(e) => setPropertyModal((m) => ({ ...m, zip: e.currentTarget.value }))}
                placeholder="94105"
                maw={100}
                disabled={propertyModal.saving}
              />
            </Group>
            <Select
              label="Property use"
              value={propertyModal.propertyUse || null}
              onChange={(v) => setPropertyModal((m) => ({ ...m, propertyUse: (v ?? "") as typeof m.propertyUse }))}
              disabled={propertyModal.saving}
              clearable
              placeholder="Select use"
              data={[
                { value: "primary", label: "Primary residence" },
                { value: "rental",  label: "Rental / investment property" },
                { value: "vacation", label: "Vacation home" }
              ]}
            />
            <Group grow align="end">
              <CurrencyInput
                label="Market value (USD)"
                value={propertyModal.marketValueUsd === "" ? undefined : Number(propertyModal.marketValueUsd)}
                onChange={(v) => setPropertyModal((m) => ({ ...m, marketValueUsd: v == null ? "" : String(v) }))}
                placeholder="0.00"
                disabled={propertyModal.saving}
              />
              <TextInput
                label="As of date"
                type="date"
                value={propertyModal.asOfDate}
                onChange={(e) => setPropertyModal((m) => ({ ...m, asOfDate: e.currentTarget.value }))}
                disabled={propertyModal.saving}
              />
            </Group>
            {propertyModal.retrieveError ? (
              <Alert color="orange" py={6}>{propertyModal.retrieveError}</Alert>
            ) : null}
            <Button
              variant="light"
              size="xs"
              loading={propertyModal.retrieving}
              disabled={propertyModal.saving || (!propertyModal.addressLine1.trim() && !propertyModal.city.trim())}
              onClick={() => void retrieveValuation()}
            >
              {propertyModal.apiPropertyId ? "Update Redfin estimate" : "Retrieve Redfin estimate"}
            </Button>
            <Text size="xs" c="dimmed">
              Market value creates a snapshot in property history. Add new snapshots any time to track appreciation.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPropertyModal((m) => ({ ...m, open: false }))} disabled={propertyModal.saving}>
                Cancel
              </Button>
              <Button loading={propertyModal.saving} onClick={() => void savePropertyDetails()}>
                Save property
              </Button>
            </Group>
          </Stack>
        </Modal>

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
                            <Table.Td>{o.amountAnchor != null ? `$${formatUsd(o.amountAnchor)}` : <Text c="dimmed" span>any</Text>}</Table.Td>
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

        <BackupRestoreSection authRole={authRole} active={tab === "data"} />
        </Tabs>
      </Paper>
      <ConfirmDialog
        opened={removeMemberConfirm !== null}
        title="Remove household member"
        message={
          <Stack gap={0}>
            {removeMemberError ? (
              <Alert color="red" mb="sm">
                {removeMemberError}
              </Alert>
            ) : null}
            {removeMemberDataCount && (removeMemberDataCount.transactions > 0 || removeMemberDataCount.payslips > 0) ? (
              <>
                {/* True warning: assigned records lose owner context if member is removed without reassignment */}
                <Alert color="yellow" mb="sm">
                <strong>Warning:</strong> This member has{" "}
                {removeMemberDataCount.transactions > 0 ? <><strong>{removeMemberDataCount.transactions}</strong> transaction(s)</> : null}
                {removeMemberDataCount.transactions > 0 && removeMemberDataCount.payslips > 0 ? " and " : null}
                {removeMemberDataCount.payslips > 0 ? <><strong>{removeMemberDataCount.payslips}</strong> payslip(s)</> : null}
                {" "}assigned to them. Those records will remain but show no owner. Use <strong>Transactions → Belongs-to</strong> filter to reassign before deleting.
              </Alert>
              </>
            ) : null}
            <Text size="sm" mb="sm">This member will be permanently removed from the household. This cannot be undone.</Text>
            {memberDrafts.find((m) => m.id === removeMemberConfirm)?.linkedUserId ? (
              <Checkbox
                checked={removeMemberDeleteLogin}
                onChange={(e) => setRemoveMemberDeleteLogin(e.currentTarget.checked)}
                label="Also delete their login account"
              />
            ) : null}
          </Stack>
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
          <Text size="sm">
            {emailEnabled
              ? "A password reset link will be sent to their email address. Their current session will be invalidated immediately."
              : "This will generate a new temporary password and immediately invalidate their current session. They will be required to change it on next login."}
          </Text>
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
