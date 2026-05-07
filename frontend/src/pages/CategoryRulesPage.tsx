import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Link, Navigate } from "react-router-dom";
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Code,
  FileInput,
  Group,
  NumberInput,
  Paper,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";
import {
  buildRulesCsvLines,
  categoryPathForCsv,
  parseRulesCsv,
  type RulesCsvHeader
} from "../import/rulesCsv";

type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  isDefault?: boolean;
  householdScoped?: boolean;
};

type MatchType = "contains" | "prefix" | "regex";

type AmountScope = "any" | "credit_only" | "debit_only";

type BuiltinRuleRow = {
  origin: "builtin";
  id: string;
  ruleKey: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  amountScope: AmountScope;
  confidence: number;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type CategoryRule = {
  id: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  amountScope: AmountScope;
  confidence: number;
  priority: number;
  enabled: boolean;
};

function categoryLabel(cat: CategoryRow, all: CategoryRow[]): string {
  if (!cat.parentId) {
    return cat.name;
  }
  const p = all.find((x) => x.id === cat.parentId);
  return p ? `${p.name} › ${cat.name}` : cat.name;
}

function assignableCategories(categories: CategoryRow[]): CategoryRow[] {
  const idsWithChildren = new Set(
    categories.filter((c) => c.parentId).map((c) => c.parentId as string)
  );
  return categories.filter((c) => !idsWithChildren.has(c.id)).sort((a, b) => {
    const la = categoryLabel(a, categories);
    const lb = categoryLabel(b, categories);
    return la.localeCompare(lb);
  });
}

function amountScopeShort(s: AmountScope): string {
  switch (s) {
    case "any": return "Any amount";
    case "credit_only": return "Credits only";
    case "debit_only": return "Debits only";
    default: return s;
  }
}

function MatchTypeBadge({ type }: { type: MatchType }) {
  const cfg: Record<MatchType, { label: string; color: string }> = {
    contains: { label: "CONTAINS", color: "blue" },
    prefix:   { label: "PREFIX",   color: "violet" },
    regex:    { label: "REGEX",    color: "yellow" },
  };
  const { label, color } = cfg[type] ?? { label: type.toUpperCase(), color: "gray" };
  return <Badge variant="light" color={color} size="sm">{label}</Badge>;
}

function AmountScopeBadge({ scope }: { scope: AmountScope }) {
  const cfg: Record<AmountScope, { label: string; color: string; variant: string }> = {
    any:         { label: "ANY",    color: "gray",  variant: "outline" },
    credit_only: { label: "CREDIT", color: "green", variant: "light" },
    debit_only:  { label: "DEBIT",  color: "red",   variant: "light" },
  };
  const { label, color, variant } = cfg[scope] ?? { label: scope.toUpperCase(), color: "gray", variant: "outline" };
  return <Badge variant={variant} color={color} size="sm">{label}</Badge>;
}

const MATCH_TYPE_OPTIONS = [
  { value: "contains", label: "Contains (substring)" },
  { value: "prefix",   label: "Prefix" },
  { value: "regex",    label: "Regex (case-insensitive)" },
];
const MATCH_TYPE_SHORT = [
  { value: "contains", label: "contains" },
  { value: "prefix",   label: "prefix" },
  { value: "regex",    label: "regex" },
];
const AMOUNT_SCOPE_OPTIONS = [
  { value: "any",          label: "Any amount" },
  { value: "credit_only",  label: "Credits only" },
  { value: "debit_only",   label: "Debits only" },
];
const AMOUNT_SCOPE_SHORT = [
  { value: "any",          label: "any" },
  { value: "credit_only",  label: "credit only" },
  { value: "debit_only",   label: "debit only" },
];

const emptyForm = {
  patterns: "",
  matchType: "contains" as MatchType,
  categoryId: "",
  amountScope: "any" as AmountScope,
  priority: 100,
  confidence: 0.85,
  enabled: true
};

const emptyGlobalForm = {
  ruleKey: "",
  pattern: "",
  matchType: "contains" as MatchType,
  categoryId: "",
  amountScope: "debit_only" as AmountScope,
  priority: 100,
  confidence: 0.7,
  enabled: true
};

type RuleConfirmAction =
  | { kind: "household"; id: string }
  | { kind: "householdAll" }
  | { kind: "builtin"; id: string };

export function CategoryRulesPage() {
  const token = useAuthToken();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [builtinRules, setBuiltinRules] = useState<BuiltinRuleRow[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [globalForm, setGlobalForm] = useState(emptyGlobalForm);
  const [authRole, setAuthRole] = useState<"owner" | "admin" | "member" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<typeof emptyForm | null>(null);
  const [editingBuiltinId, setEditingBuiltinId] = useState<string | null>(null);
  const [editBuiltinDraft, setEditBuiltinDraft] = useState<typeof emptyGlobalForm | null>(null);
  const [ruleFilter, setRuleFilter] = useState("");
  const [testDesc, setTestDesc] = useState("");
  const [testAmount, setTestAmount] = useState("-10");
  const [ruleConfirm, setRuleConfirm] = useState<RuleConfirmAction | null>(null);
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [recatMsg, setRecatMsg] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"household" | "builtin">("household");
  const [importCsvError, setImportCsvError] = useState<string | null>(null);
  const [importCsvRows, setImportCsvRows] = useState<
    Array<Partial<Record<RulesCsvHeader, string>> & Record<string, string>>
  >([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [openedSections, setOpenedSections] = useState<string[]>([]);

  const leaves = useMemo(() => assignableCategories(categories), [categories]);

  const globalBuiltinLeaves = useMemo(
    () => leaves.filter((c) => !c.householdScoped),
    [leaves]
  );

  const leaveOptions = useMemo(
    () => leaves.map((c) => ({ value: c.id, label: categoryLabel(c, categories) })),
    [leaves, categories]
  );

  const globalLeafOptions = useMemo(
    () => globalBuiltinLeaves.map((c) => ({ value: c.id, label: categoryLabel(c, categories) })),
    [globalBuiltinLeaves, categories]
  );

  const canEditGlobals = authRole === "owner" || authRole === "admin";

  useEffect(() => {
    if (!canEditGlobals && importMode === "builtin") {
      setImportMode("household");
    }
  }, [canEditGlobals, importMode]);

  const load = useCallback(async () => {
    const [catRes, rulesRes] = await Promise.all([
      apiJson<{ categories: CategoryRow[] }>("/categories"),
      apiJson<{ builtinRules: BuiltinRuleRow[]; rules: CategoryRule[] }>("/categories/rules")
    ]);
    setCategories(catRes.categories);
    setBuiltinRules(rulesRes.builtinRules ?? []);
    setRules(rulesRes.rules);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ user: { role: "owner" | "admin" | "member" } }>("/auth/me")
      .then((r) => setAuthRole(r.user.role))
      .catch(() => setAuthRole(null));
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setRules([]);
        setBuiltinRules([]);
        setCategories([]);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  const filteredBuiltin = useMemo(() => {
    const q = ruleFilter.trim().toLowerCase();
    if (!q) return builtinRules;
    return builtinRules.filter((b) => {
      const cat = categories.find((c) => c.id === b.categoryId);
      const cn = cat ? categoryLabel(cat, categories).toLowerCase() : "";
      return (
        b.ruleKey.toLowerCase().includes(q) ||
        b.pattern.toLowerCase().includes(q) ||
        cn.includes(q) ||
        b.matchType.includes(q) ||
        b.amountScope.toLowerCase().includes(q)
      );
    });
  }, [builtinRules, ruleFilter, categories]);

  const filteredHousehold = useMemo(() => {
    const q = ruleFilter.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) => {
      const cat = categories.find((c) => c.id === r.categoryId);
      const cn = cat ? categoryLabel(cat, categories).toLowerCase() : "";
      const scope = (r.amountScope ?? "any").toLowerCase();
      return (
        r.pattern.toLowerCase().includes(q) ||
        cn.includes(q) ||
        r.matchType.includes(q) ||
        scope.includes(q)
      );
    });
  }, [rules, ruleFilter, categories]);

  const builtinRuleGroups = useMemo(() => {
    const m = new Map<string, BuiltinRuleRow[]>();
    for (const b of filteredBuiltin) {
      const k = `${b.categoryId}\u0000${b.amountScope}`;
      m.set(k, [...(m.get(k) ?? []), b]);
    }
    return [...m.entries()].sort(([ka], [kb]) => {
      const [aCat, aScope] = ka.split("\u0000");
      const [bCat, bScope] = kb.split("\u0000");
      const catA = categories.find((c) => c.id === aCat);
      const catB = categories.find((c) => c.id === bCat);
      const la = catA ? categoryLabel(catA, categories) : aCat;
      const lb = catB ? categoryLabel(catB, categories) : bCat;
      const d = la.localeCompare(lb);
      if (d !== 0) return d;
      return aScope.localeCompare(bScope);
    });
  }, [filteredBuiltin, categories]);

  const householdRuleGroups = useMemo(() => {
    const m = new Map<string, CategoryRule[]>();
    for (const r of filteredHousehold) {
      const scope = r.amountScope ?? "any";
      const k = `${r.categoryId}\u0000${scope}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([ka], [kb]) => {
      const [aCat, aScope] = ka.split("\u0000");
      const [bCat, bScope] = kb.split("\u0000");
      const catA = categories.find((c) => c.id === aCat);
      const catB = categories.find((c) => c.id === bCat);
      const la = catA ? categoryLabel(catA, categories) : aCat;
      const lb = catB ? categoryLabel(catB, categories) : bCat;
      const d = la.localeCompare(lb);
      if (d !== 0) return d;
      return aScope.localeCompare(bScope);
    });
  }, [filteredHousehold, categories]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const patterns = form.patterns.trim();
    if (patterns.length < 2) {
      setError("Enter at least one pattern (2+ characters). Use a new line or comma between multiple.");
      return;
    }
    if (!form.categoryId) {
      setError("Choose a category (leaf).");
      return;
    }
    setSaving(true);
    try {
      await apiJson<{ rules?: CategoryRule[]; rule?: CategoryRule }>("/categories/rules", {
        method: "POST",
        body: JSON.stringify({
          patterns,
          matchType: form.matchType,
          categoryId: form.categoryId,
          amountScope: form.amountScope,
          priority: form.priority,
          confidence: form.confidence,
          enabled: form.enabled
        })
      });
      setForm(emptyForm);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create rule");
    } finally {
      setSaving(false);
    }
  }

  async function patchRule(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await apiJson(`/categories/rules/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  function requestDeleteHouseholdRule(id: string) {
    setRuleConfirm({ kind: "household", id });
  }

  function requestDeleteAllHouseholdRules() {
    if (rules.length === 0) return;
    setRuleConfirm({ kind: "householdAll" });
  }

  const handleRuleConfirm = useCallback(async () => {
    if (!ruleConfirm) return;
    if (ruleConfirm.kind === "household") {
      const id = ruleConfirm.id;
      setError(null);
      try {
        await apiFetch(`/categories/rules/${id}`, { method: "DELETE" });
        setEditingId(null);
        setEditDraft(null);
        await load();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Delete failed");
        throw err;
      }
      return;
    }
    if (ruleConfirm.kind === "householdAll") {
      setError(null);
      setRecatMsg(null);
      setSaving(true);
      try {
        const res = await apiJson<{ deleted: number }>("/categories/rules/household", { method: "DELETE" });
        setRecatMsg(`Deleted ${res.deleted} household rule(s).`);
        setEditingId(null);
        setEditDraft(null);
        await load();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Delete all failed");
        throw err;
      } finally {
        setSaving(false);
      }
      return;
    }
    const id = ruleConfirm.id;
    if (!canEditGlobals) return;
    setError(null);
    try {
      const res = await apiFetch(`/categories/rules/builtin/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      setEditingBuiltinId(null);
      setEditBuiltinDraft(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
      throw err;
    }
  }, [ruleConfirm, canEditGlobals, load]);

  function startEdit(r: CategoryRule) {
    setEditingId(r.id);
    setEditDraft({
      patterns: r.pattern,
      matchType: r.matchType,
      categoryId: r.categoryId,
      amountScope: r.amountScope ?? "any",
      priority: r.priority,
      confidence: r.confidence,
      enabled: r.enabled
    });
  }

  async function saveEdit() {
    if (!editingId || !editDraft) return;
    const pattern = editDraft.patterns.trim();
    if (pattern.length < 2) {
      setError("Pattern must be at least 2 characters.");
      return;
    }
    if (!editDraft.categoryId) {
      setError("Choose a category.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/categories/rules/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          pattern,
          matchType: editDraft.matchType,
          categoryId: editDraft.categoryId,
          amountScope: editDraft.amountScope,
          priority: editDraft.priority,
          confidence: editDraft.confidence,
          enabled: editDraft.enabled
        })
      });
      setEditingId(null);
      setEditDraft(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function onCreateGlobal(e: FormEvent) {
    e.preventDefault();
    if (!canEditGlobals) return;
    setError(null);
    const pattern = globalForm.pattern.trim();
    if (pattern.length < 2) {
      setError("Enter a pattern (2+ characters) for the built-in rule.");
      return;
    }
    if (!globalForm.categoryId) {
      setError("Choose a category (leaf).");
      return;
    }
    setSaving(true);
    try {
      await apiJson("/categories/rules/builtin", {
        method: "POST",
        body: JSON.stringify({
          ruleKey: globalForm.ruleKey.trim() || undefined,
          pattern,
          matchType: globalForm.matchType,
          categoryId: globalForm.categoryId,
          amountScope: globalForm.amountScope,
          priority: globalForm.priority,
          confidence: globalForm.confidence,
          enabled: globalForm.enabled
        })
      });
      setGlobalForm(emptyGlobalForm);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create built-in rule");
    } finally {
      setSaving(false);
    }
  }

  async function patchBuiltinRule(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await apiJson(`/categories/rules/builtin/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  function requestDeleteBuiltinRule(id: string) {
    if (!canEditGlobals) return;
    setRuleConfirm({ kind: "builtin", id });
  }

  function startEditBuiltin(r: BuiltinRuleRow) {
    setEditingBuiltinId(r.id);
    setEditBuiltinDraft({
      ruleKey: r.ruleKey,
      pattern: r.pattern,
      matchType: r.matchType,
      categoryId: r.categoryId,
      amountScope: r.amountScope,
      priority: r.priority,
      confidence: r.confidence,
      enabled: r.enabled
    });
  }

  async function saveEditBuiltin() {
    if (!editingBuiltinId || !editBuiltinDraft) return;
    const pattern = editBuiltinDraft.pattern.trim();
    if (pattern.length < 2) {
      setError("Pattern must be at least 2 characters.");
      return;
    }
    if (!editBuiltinDraft.categoryId) {
      setError("Choose a category.");
      return;
    }
    const rk = editBuiltinDraft.ruleKey.trim();
    if (rk.length < 2) {
      setError("Rule key must be at least 2 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/categories/rules/builtin/${editingBuiltinId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ruleKey: rk,
          pattern,
          matchType: editBuiltinDraft.matchType,
          categoryId: editBuiltinDraft.categoryId,
          amountScope: editBuiltinDraft.amountScope,
          priority: editBuiltinDraft.priority,
          confidence: editBuiltinDraft.confidence,
          enabled: editBuiltinDraft.enabled
        })
      });
      setEditingBuiltinId(null);
      setEditBuiltinDraft(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function cancelEditBuiltin() {
    setEditingBuiltinId(null);
    setEditBuiltinDraft(null);
  }

  async function runTest() {
    if (!testDesc.trim()) {
      setError("Enter a description to test.");
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    setError(null);
    try {
      const amt = Number(testAmount);
      const res = await apiJson<{ normalizedDescription: string; classification: unknown }>("/categories/rules/test", {
        method: "POST",
        body: JSON.stringify({ description: testDesc, signedAmount: amt })
      });
      setTestResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestLoading(false);
    }
  }

  function buildExportCsvRows(originFilter: "all" | "builtin" | "household"): Array<Record<RulesCsvHeader, string>> {
    const out: Array<Record<RulesCsvHeader, string>> = [];
    if (originFilter !== "household") {
      for (const b of builtinRules) {
        const cat = categories.find((c) => c.id === b.categoryId);
        out.push({
          origin: "builtin", id: b.id, rule_key: b.ruleKey, pattern: b.pattern,
          match_type: b.matchType, amount_scope: b.amountScope, category_id: b.categoryId,
          category_path: cat ? categoryPathForCsv(cat, categories) : "",
          priority: String(b.priority), confidence: String(b.confidence),
          enabled: b.enabled ? "true" : "false"
        });
      }
    }
    if (originFilter !== "builtin") {
      for (const r of rules) {
        const cat = categories.find((c) => c.id === r.categoryId);
        out.push({
          origin: "household", id: r.id, rule_key: "", pattern: r.pattern,
          match_type: r.matchType, amount_scope: r.amountScope ?? "any", category_id: r.categoryId,
          category_path: cat ? categoryPathForCsv(cat, categories) : "",
          priority: String(r.priority), confidence: String(r.confidence),
          enabled: r.enabled ? "true" : "false"
        });
      }
    }
    return out;
  }

  function downloadRulesCsvFile(rows: Array<Record<RulesCsvHeader, string>>, filenameStem: string) {
    const csv = buildRulesCsvLines(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameStem}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFileChange(file: File | null) {
    setSelectedFile(file);
    setImportCsvError(null);
    setImportSummary(null);
    setImportCsvRows([]);
    if (!file) return;
    void file.text().then((text) => {
      const parsed = parseRulesCsv(text);
      if (parsed.error) {
        setImportCsvError(parsed.error);
        return;
      }
      setImportCsvRows(parsed.rows);
    });
  }

  function parseBoolCell(v: string | undefined, defaultTrue: boolean): boolean {
    const s = (v ?? "").trim().toLowerCase();
    if (s === "" || s === "1" || s === "true" || s === "yes") return true;
    if (s === "0" || s === "false" || s === "no") return false;
    return defaultTrue;
  }

  async function runCsvImport() {
    setImportSummary(null);
    setError(null);
    const filtered = importCsvRows.filter((row) => {
      const o = (row.origin ?? "").trim().toLowerCase();
      if (importMode === "household") return o === "" || o === "household";
      return o === "" || o === "builtin";
    });
    if (filtered.length === 0) {
      setImportCsvError("No rows match the selected import mode (check the origin column).");
      return;
    }

    const matchTypes = new Set<MatchType>(["contains", "prefix", "regex"]);
    const amountScopes = new Set<AmountScope>(["any", "credit_only", "debit_only"]);

    if (importMode === "household") {
      const rulesToImport: Array<{
        pattern: string; matchType: MatchType; categoryId?: string; categoryPath?: string;
        amountScope?: AmountScope; confidence?: number; priority?: number; enabled?: boolean;
      }> = [];
      for (const row of filtered) {
        const pattern = (row.pattern ?? "").trim();
        const mt = row.match_type as MatchType;
        if (pattern.length < 2 || !matchTypes.has(mt)) continue;
        const categoryId = (row.category_id ?? "").trim();
        const categoryPath = (row.category_path ?? "").trim();
        if (!categoryId && !categoryPath) continue;
        let amountScope: AmountScope = "any";
        const ascope = (row.amount_scope ?? "").trim().toLowerCase();
        if (ascope && amountScopes.has(ascope as AmountScope)) amountScope = ascope as AmountScope;
        const priority = Number(row.priority);
        const confidence = Number(row.confidence);
        rulesToImport.push({
          pattern, matchType: mt, amountScope,
          ...(categoryId ? { categoryId } : {}),
          ...(categoryPath ? { categoryPath } : {}),
          ...(Number.isFinite(confidence) ? { confidence } : {}),
          ...(Number.isInteger(priority) ? { priority } : {}),
          enabled: parseBoolCell(row.enabled, true)
        });
      }
      if (rulesToImport.length === 0) {
        setImportCsvError("No valid rows to import (need pattern, match_type, and category_id or category_path).");
        return;
      }
      setImportBusy(true);
      try {
        const res = await apiJson<{
          created: CategoryRule[];
          errors: Array<{ index: number; message: string; code?: string }>;
        }>("/categories/rules/bulk", { method: "POST", body: JSON.stringify({ rules: rulesToImport }) });
        setImportSummary(
          `Household import: ${res.created.length} created, ${res.errors.length} row error(s).` +
            (res.errors.length ? ` First: ${res.errors[0]?.message ?? ""}` : "")
        );
        setImportCsvRows([]);
        setSelectedFile(null);
        await load();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Bulk import failed");
      } finally {
        setImportBusy(false);
      }
      return;
    }

    const rulesBuiltin: Array<{
      pattern: string; matchType: MatchType; categoryId?: string; categoryPath?: string;
      amountScope: AmountScope; ruleKey?: string; confidence?: number; priority?: number; enabled?: boolean;
    }> = [];
    for (const row of filtered) {
      const pattern = (row.pattern ?? "").trim();
      const mt = row.match_type as MatchType;
      if (pattern.length < 2 || !matchTypes.has(mt)) continue;
      const categoryId = (row.category_id ?? "").trim();
      const categoryPath = (row.category_path ?? "").trim();
      if (!categoryId && !categoryPath) continue;
      let amountScope: AmountScope = "debit_only";
      const ascope = (row.amount_scope ?? "").trim().toLowerCase();
      if (ascope && amountScopes.has(ascope as AmountScope)) amountScope = ascope as AmountScope;
      const rk = (row.rule_key ?? "").trim();
      const priority = Number(row.priority);
      const confidence = Number(row.confidence);
      rulesBuiltin.push({
        pattern, matchType: mt, amountScope,
        ...(categoryId ? { categoryId } : {}),
        ...(categoryPath ? { categoryPath } : {}),
        ...(rk ? { ruleKey: rk } : {}),
        ...(Number.isFinite(confidence) ? { confidence } : {}),
        ...(Number.isInteger(priority) ? { priority } : {}),
        enabled: parseBoolCell(row.enabled, true)
      });
    }
    if (rulesBuiltin.length === 0) {
      setImportCsvError("No valid rows to import (need pattern, match_type, and category_id or category_path).");
      return;
    }
    setImportBusy(true);
    try {
      const res = await apiJson<{
        created: BuiltinRuleRow[];
        errors: Array<{ index: number; message: string; code?: string }>;
      }>("/categories/rules/builtin/bulk", { method: "POST", body: JSON.stringify({ rules: rulesBuiltin }) });
      setImportSummary(
        `Built-in import: ${res.created.length} created, ${res.errors.length} row error(s).` +
          (res.errors.length ? ` First: ${res.errors[0]?.message ?? ""}` : "")
      );
      setImportCsvRows([]);
      setSelectedFile(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk import failed");
    } finally {
      setImportBusy(false);
    }
  }

  async function runRecategorize(mode: "uncategorized_only" | "all") {
    setRecatMsg(null);
    setError(null);
    try {
      const res = await apiJson<{ examined: number; updated: number }>("/categories/rules/recategorize", {
        method: "POST",
        body: JSON.stringify({ mode })
      });
      setRecatMsg(`Re-categorized: ${res.updated} updated of ${res.examined} examined.`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Re-apply failed");
    }
  }

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <Paper p="md">
      <Stack gap="md">
        {/* Header */}
        <Group align="center" wrap="wrap">
          <Title order={1} size="h2" style={{ margin: 0 }}>Classification rules</Title>
          <HelpIcon label="Household rules run first (lower priority numbers run first within each group), then built-in (global) rules. Only leaf categories can be assigned. Built-in rules apply to all households on this server; owners and admins can edit them." />
          <Group ml="auto" gap="md" fz="sm">
            <Anchor component={Link} to="/categories">Categories</Anchor>
            <Anchor component={Link} to="/transactions">Transactions</Anchor>
            <Anchor component={Link} to="/imports">Import</Anchor>
          </Group>
        </Group>

        {error ? <Alert color="red">{error}</Alert> : null}
        {recatMsg ? <Text c="dimmed" size="sm">{recatMsg}</Text> : null}

        {/* Collapsible utility sections */}
        <Accordion multiple value={openedSections} onChange={setOpenedSections} variant="separated">
          <Accordion.Item value="import-export">
            <Accordion.Control>
              <Group gap={6}>
                <Text fw={600}>Import / export (CSV)</Text>
                <HelpIcon label="Export built-in, household, or both in one file (origin column). Import is create-only — use Delete all household rules before re-importing a full file for a clean slate. Use category_id or category_path (e.g. Home › HOA Fees)." />
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Group wrap="wrap" gap="xs">
                  <Button variant="default" size="sm" onClick={() => downloadRulesCsvFile(buildExportCsvRows("all"), "classification-rules-all")} disabled={loading}>
                    Export all (CSV)
                  </Button>
                  <Button variant="default" size="sm" onClick={() => downloadRulesCsvFile(buildExportCsvRows("builtin"), "classification-rules-builtin")} disabled={loading}>
                    Export built-in (CSV)
                  </Button>
                  <Button variant="default" size="sm" onClick={() => downloadRulesCsvFile(buildExportCsvRows("household"), "classification-rules-household")} disabled={loading}>
                    Export household (CSV)
                  </Button>
                  <Button variant="default" size="sm" color="red"
                    onClick={requestDeleteAllHouseholdRules}
                    disabled={loading || saving || rules.length === 0}
                    title="Remove every household rule so you can re-import a CSV without duplicates"
                  >
                    Delete all household rules
                  </Button>
                </Group>
                <Group align="flex-end" gap="md" wrap="wrap">
                  <Select
                    label="Import as"
                    value={importMode}
                    onChange={(v) => setImportMode((v ?? "household") as "household" | "builtin")}
                    disabled={importBusy}
                    miw={180}
                    data={[
                      { value: "household", label: "Household rules" },
                      { value: "builtin", label: "Built-in (global) rules", disabled: !canEditGlobals },
                    ]}
                  />
                  <FileInput
                    label="CSV file"
                    value={selectedFile}
                    onChange={onImportFileChange}
                    accept=".csv,text/csv"
                    disabled={importBusy}
                    miw={220}
                    clearable
                  />
                  <Button disabled={importBusy || importCsvRows.length === 0} loading={importBusy} onClick={() => void runCsvImport()}>
                    Import rows
                  </Button>
                </Group>
                {importCsvError ? <Alert color="red">{importCsvError}</Alert> : null}
                {importSummary ? <Text c="dimmed" size="sm">{importSummary}</Text> : null}
                {importCsvRows.length > 0 ? (
                  <Stack gap={4}>
                    <Text size="sm" c="dimmed">Preview (first 15 rows, filtered by import mode).</Text>
                    <Table.ScrollContainer minWidth={500}>
                      <Table striped withTableBorder>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>origin</Table.Th>
                            <Table.Th>pattern</Table.Th>
                            <Table.Th>match_type</Table.Th>
                            <Table.Th>amount_scope</Table.Th>
                            <Table.Th>category_path</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {importCsvRows
                            .filter((row) => {
                              const o = (row.origin ?? "").trim().toLowerCase();
                              if (importMode === "household") return o === "" || o === "household";
                              return o === "" || o === "builtin";
                            })
                            .slice(0, 15)
                            .map((row, i) => (
                              <Table.Tr key={i}>
                                <Table.Td>{row.origin ?? "—"}</Table.Td>
                                <Table.Td><Code>{(row.pattern ?? "").slice(0, 48)}</Code></Table.Td>
                                <Table.Td>{row.match_type ?? "—"}</Table.Td>
                                <Table.Td>{row.amount_scope ?? "—"}</Table.Td>
                                <Table.Td>{(row.category_path ?? "").slice(0, 40) || row.category_id?.slice(0, 8) || "—"}</Table.Td>
                              </Table.Tr>
                            ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </Stack>
                ) : null}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="search-test">
            <Accordion.Control>
              <Group gap={6}>
                <Text fw={600}>Search &amp; test</Text>
                <HelpIcon label="Filter rules by keyword. Test a bank description + amount against all rules to see which category it would be assigned." />
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Group align="flex-end" gap="md" wrap="wrap">
                  <TextInput
                    label="Filter rules"
                    value={ruleFilter}
                    onChange={(e) => setRuleFilter(e.target.value)}
                    placeholder="keyword, rule id, category…"
                    autoComplete="off"
                    miw={180}
                    style={{ flex: "1 1 180px" }}
                  />
                  <TextInput
                    label="Test description (normalized like import)"
                    value={testDesc}
                    onChange={(e) => setTestDesc(e.target.value)}
                    placeholder="Paste bank description"
                    autoComplete="off"
                    style={{ flex: "2 1 240px" }}
                  />
                  <TextInput
                    label="Signed amount"
                    value={testAmount}
                    onChange={(e) => setTestAmount(e.target.value)}
                    inputMode="decimal"
                    w={100}
                  />
                  <Button loading={testLoading} onClick={() => void runTest()}>
                    Run test
                  </Button>
                </Group>
                {testResult ? (
                  <Code block style={{ fontSize: "0.82rem", maxHeight: "10rem", overflow: "auto" }}>
                    {JSON.stringify(testResult, null, 2)}
                  </Code>
                ) : null}

                <Title order={3} size="h5" mt="xs">Re-apply rules to ledger</Title>
                <Text size="sm" c="dimmed">
                  Runs the same matcher as import over existing posted rows. <strong>Uncategorized only</strong> is safest;{" "}
                  <strong>All posted</strong> overwrites categories when a rule matches.
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Button variant="default" size="sm" onClick={() => void runRecategorize("uncategorized_only")}>
                    Re-apply (uncategorized only)
                  </Button>
                  <Button variant="default" size="sm" onClick={() => void runRecategorize("all")}>
                    Re-apply (all posted)
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        {/* Built-in rules */}
        <Stack gap="xs">
          <Group gap={6}>
            <Title order={2} size="h4" style={{ margin: 0 }}>Built-in (global) rules</Title>
            <HelpIcon label="These rules apply to every household on this server. Grouped by target category and amount scope. Only installation default leaf categories are valid targets. Owners and admins can edit." />
          </Group>
          {loading ? <Skeleton height={60} /> : null}
          {!loading && filteredBuiltin.length === 0 ? <Text c="dimmed" size="sm">No built-in rules match filter.</Text> : null}
          {!loading && filteredBuiltin.length > 0 ? (
            <Accordion multiple variant="separated">
              {builtinRuleGroups.map(([key, groupRules]) => {
                const [catId, scopeStr] = key.split("\u0000");
                const scope = scopeStr as AmountScope;
                const cat = categories.find((c) => c.id === catId);
                const pri = groupRules.map((g) => g.priority);
                const priMin = Math.min(...pri);
                const priMax = Math.max(...pri);
                const priRange = priMin === priMax ? `priority ${priMin}` : `priority ${priMin}–${priMax}`;
                const summaryTitle = `${cat ? categoryLabel(cat, categories) : "(unknown category)"} · ${amountScopeShort(scope)} · ${groupRules.length} rule(s) · ${priRange}`;
                return (
                  <Accordion.Item key={key} value={key}>
                    <Accordion.Control><Text fw={600} size="sm">{summaryTitle}</Text></Accordion.Control>
                    <Accordion.Panel>
                      <Table.ScrollContainer minWidth={700}>
                        <Table striped withTableBorder>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Source</Table.Th>
                              <Table.Th>On</Table.Th>
                              <Table.Th>Rule key</Table.Th>
                              <Table.Th>Pattern</Table.Th>
                              <Table.Th>Match</Table.Th>
                              <Table.Th>Amount</Table.Th>
                              <Table.Th>Category</Table.Th>
                              <Table.Th>Pri</Table.Th>
                              <Table.Th>Conf</Table.Th>
                              <Table.Th />
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {groupRules.map((b) => {
                              const rowCat = categories.find((c) => c.id === b.categoryId);
                              const isEditing = editingBuiltinId === b.id;
                              return (
                                <Table.Tr key={b.id}>
                                  <Table.Td>Built-in</Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <Checkbox
                                        checked={editBuiltinDraft.enabled}
                                        onChange={(e) => setEditBuiltinDraft((d) => d ? { ...d, enabled: e.currentTarget.checked } : d)}
                                      />
                                    ) : (
                                      <Checkbox
                                        checked={b.enabled}
                                        onChange={() => void patchBuiltinRule(b.id, { enabled: !b.enabled })}
                                        disabled={!canEditGlobals}
                                        aria-label={`Enable built-in rule ${b.ruleKey}`}
                                      />
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <TextInput value={editBuiltinDraft.ruleKey} onChange={(e) => setEditBuiltinDraft((d) => d ? { ...d, ruleKey: e.target.value } : d)} size="xs" />
                                    ) : (
                                      <Code>{b.ruleKey}</Code>
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <TextInput value={editBuiltinDraft.pattern} onChange={(e) => setEditBuiltinDraft((d) => d ? { ...d, pattern: e.target.value } : d)} size="xs" />
                                    ) : (
                                      <Code>{b.pattern}</Code>
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <Select size="xs" value={editBuiltinDraft.matchType} onChange={(v) => setEditBuiltinDraft((d) => d ? { ...d, matchType: (v ?? "contains") as MatchType } : d)} data={MATCH_TYPE_SHORT} w={110} />
                                    ) : (
                                      <MatchTypeBadge type={b.matchType} />
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <Select size="xs" value={editBuiltinDraft.amountScope} onChange={(v) => setEditBuiltinDraft((d) => d ? { ...d, amountScope: (v ?? "any") as AmountScope } : d)} data={AMOUNT_SCOPE_SHORT} w={110} />
                                    ) : (
                                      <AmountScopeBadge scope={b.amountScope} />
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <Select size="xs" value={editBuiltinDraft.categoryId} onChange={(v) => setEditBuiltinDraft((d) => d ? { ...d, categoryId: v ?? "" } : d)} data={globalLeafOptions} w={160} />
                                    ) : rowCat ? categoryLabel(rowCat, categories) : <Text c="dimmed" size="sm">(missing)</Text>}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <NumberInput size="xs" min={0} max={10000} value={editBuiltinDraft.priority} onChange={(v) => setEditBuiltinDraft((d) => d ? { ...d, priority: Number(v) } : d)} w={70} />
                                    ) : b.priority}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editBuiltinDraft ? (
                                      <NumberInput size="xs" min={0} max={1} step={0.05} value={editBuiltinDraft.confidence} onChange={(v) => setEditBuiltinDraft((d) => d ? { ...d, confidence: Number(v) } : d)} w={70} />
                                    ) : b.confidence.toFixed(2)}
                                  </Table.Td>
                                  <Table.Td>
                                    {canEditGlobals ? (
                                      isEditing ? (
                                        <Group gap={4} wrap="nowrap">
                                          <Button size="xs" disabled={saving} onClick={() => void saveEditBuiltin()}>Save</Button>
                                          <Button size="xs" variant="default" onClick={cancelEditBuiltin}>Cancel</Button>
                                          <ActionIcon size="sm" variant="subtle" color="red" title="Delete rule" onClick={() => requestDeleteBuiltinRule(b.id)}>
                                            <IconTrash size={13} />
                                          </ActionIcon>
                                        </Group>
                                      ) : (
                                        <ActionIcon size="sm" variant="subtle" color="gray" title="Edit rule" onClick={() => startEditBuiltin(b)}>
                                          <IconPencil size={13} />
                                        </ActionIcon>
                                      )
                                    ) : <Text c="dimmed">—</Text>}
                                  </Table.Td>
                                </Table.Tr>
                              );
                            })}
                          </Table.Tbody>
                        </Table>
                      </Table.ScrollContainer>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          ) : null}

          {canEditGlobals ? (
            <Stack gap="xs" mt="sm">
              <Group gap={6}>
                <Title order={3} size="h5" style={{ margin: 0 }}>Add built-in rule</Title>
                <HelpIcon label="Applies to all households on this server. Category must be an installation default leaf — for custom categories, use a household rule instead." />
              </Group>
              <form onSubmit={(e) => void onCreateGlobal(e)}>
                <Group align="flex-end" gap="md" wrap="wrap">
                  <TextInput label="Rule key (optional)" value={globalForm.ruleKey} onChange={(e) => setGlobalForm((f) => ({ ...f, ruleKey: e.target.value }))} placeholder="auto from pattern if empty" autoComplete="off" miw={160} />
                  <TextInput label="Pattern" value={globalForm.pattern} onChange={(e) => setGlobalForm((f) => ({ ...f, pattern: e.target.value }))} placeholder="substring or regex" autoComplete="off" required style={{ flex: "2 1 200px" }} />
                  <Select label="Match type" value={globalForm.matchType} onChange={(v) => setGlobalForm((f) => ({ ...f, matchType: (v ?? "contains") as MatchType }))} data={MATCH_TYPE_OPTIONS} miw={180} />
                  <Select label="Amount scope" value={globalForm.amountScope} onChange={(v) => setGlobalForm((f) => ({ ...f, amountScope: (v ?? "any") as AmountScope }))} data={AMOUNT_SCOPE_OPTIONS} miw={150} />
                  <Select label="Category" value={globalForm.categoryId} onChange={(v) => setGlobalForm((f) => ({ ...f, categoryId: v ?? "" }))} data={globalLeafOptions} placeholder="Select…" required miw={180} />
                  <NumberInput label="Priority" min={0} max={10000} step={1} value={globalForm.priority} onChange={(v) => setGlobalForm((f) => ({ ...f, priority: Number(v) }))} w={90} />
                  <NumberInput label="Confidence" min={0} max={1} step={0.05} value={globalForm.confidence} onChange={(v) => setGlobalForm((f) => ({ ...f, confidence: Number(v) }))} w={90} />
                  <Checkbox label="Enabled" checked={globalForm.enabled} onChange={(e) => setGlobalForm((f) => ({ ...f, enabled: e.currentTarget.checked }))} mt={24} />
                  <Button type="submit" loading={saving} disabled={globalBuiltinLeaves.length === 0} mt={24}>
                    Add built-in rule
                  </Button>
                </Group>
              </form>
            </Stack>
          ) : null}
        </Stack>

        {/* Household rules */}
        <Stack gap="xs">
          <Group gap={6}>
            <Title order={2} size="h4" style={{ margin: 0 }}>Add household rules</Title>
            <HelpIcon label="Household rules run before built-ins and can target any assignable leaf category, including ones you created. They override global rules when both match." />
          </Group>
          <form onSubmit={(e) => void onCreate(e)}>
            <Group align="flex-end" gap="md" wrap="wrap">
              <Textarea
                label="Pattern(s) — one per line or comma-separated (regex with commas: one pattern per line)"
                rows={4}
                value={form.patterns}
                onChange={(e) => setForm((f) => ({ ...f, patterns: e.target.value }))}
                placeholder={"whole foods\ntarget\n^ach credit"}
                autoComplete="off"
                style={{ flex: "1 1 100%", width: "100%" }}
              />
              <Select label="Match type" value={form.matchType} onChange={(v) => setForm((f) => ({ ...f, matchType: (v ?? "contains") as MatchType }))} data={MATCH_TYPE_OPTIONS} miw={180} />
              <Select label="Amount scope" value={form.amountScope} onChange={(v) => setForm((f) => ({ ...f, amountScope: (v ?? "any") as AmountScope }))} data={AMOUNT_SCOPE_OPTIONS} miw={150} />
              <Select label="Category" value={form.categoryId} onChange={(v) => setForm((f) => ({ ...f, categoryId: v ?? "" }))} data={leaveOptions} placeholder="Select…" required miw={180} />
              <NumberInput label="Priority" min={0} max={10000} step={1} value={form.priority} onChange={(v) => setForm((f) => ({ ...f, priority: Number(v) }))} w={90} />
              <NumberInput label="Confidence" min={0} max={1} step={0.05} value={form.confidence} onChange={(v) => setForm((f) => ({ ...f, confidence: Number(v) }))} w={90} />
              <Checkbox label="Enabled" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.currentTarget.checked }))} mt={24} />
              <Button type="submit" loading={saving} disabled={leaves.length === 0} mt={24}>
                Add rule(s)
              </Button>
            </Group>
          </form>
          {leaves.length === 0 && !loading ? (
            <Text size="sm" c="dimmed">
              Add leaf categories under <Anchor component={Link} to="/categories">Categories</Anchor> before creating rules.
            </Text>
          ) : null}

          <Group gap={6} mt="sm">
            <Title order={2} size="h4" style={{ margin: 0 }}>Your household rules</Title>
            <HelpIcon label="Grouped by target category and amount scope. Household rules run before built-in rules for every transaction import." />
          </Group>
          {!loading && filteredHousehold.length === 0 ? <Text c="dimmed" size="sm">No household rules match filter.</Text> : null}
          {!loading && filteredHousehold.length > 0 ? (
            <Accordion multiple variant="separated">
              {householdRuleGroups.map(([groupKey, groupRules]) => {
                const [catId, scopeStr] = groupKey.split("\u0000");
                const scope = (scopeStr ?? "any") as AmountScope;
                const cat = categories.find((c) => c.id === catId);
                const pri = groupRules.map((g) => g.priority);
                const priMin = Math.min(...pri);
                const priMax = Math.max(...pri);
                const priRange = priMin === priMax ? `priority ${priMin}` : `priority ${priMin}–${priMax}`;
                const summaryTitle = `${cat ? categoryLabel(cat, categories) : "(unknown category)"} · ${amountScopeShort(scope)} · ${groupRules.length} rule(s) · ${priRange}`;
                return (
                  <Accordion.Item key={groupKey} value={groupKey}>
                    <Accordion.Control><Text fw={600} size="sm">{summaryTitle}</Text></Accordion.Control>
                    <Accordion.Panel>
                      <Table.ScrollContainer minWidth={650}>
                        <Table striped withTableBorder>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Source</Table.Th>
                              <Table.Th>On</Table.Th>
                              <Table.Th>Pattern</Table.Th>
                              <Table.Th>Match</Table.Th>
                              <Table.Th>Amount</Table.Th>
                              <Table.Th>Category</Table.Th>
                              <Table.Th>Pri</Table.Th>
                              <Table.Th>Conf</Table.Th>
                              <Table.Th />
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {groupRules.map((r) => {
                              const rowCat = categories.find((c) => c.id === r.categoryId);
                              const isEditing = editingId === r.id;
                              return (
                                <Table.Tr key={r.id}>
                                  <Table.Td>Household</Table.Td>
                                  <Table.Td>
                                    {isEditing && editDraft ? (
                                      <Checkbox checked={editDraft.enabled} onChange={(e) => setEditDraft((d) => d ? { ...d, enabled: e.currentTarget.checked } : d)} />
                                    ) : (
                                      <Checkbox checked={r.enabled} onChange={() => void patchRule(r.id, { enabled: !r.enabled })} aria-label={`Enable rule ${r.pattern}`} />
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editDraft ? (
                                      <Textarea value={editDraft.patterns} onChange={(e) => setEditDraft((d) => d ? { ...d, patterns: e.target.value } : d)} autosize minRows={1} maxRows={4} size="xs" />
                                    ) : (
                                      <Code>{r.pattern}</Code>
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editDraft ? (
                                      <Select size="xs" value={editDraft.matchType} onChange={(v) => setEditDraft((d) => d ? { ...d, matchType: (v ?? "contains") as MatchType } : d)} data={MATCH_TYPE_SHORT} w={110} />
                                    ) : (
                                      <MatchTypeBadge type={r.matchType} />
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editDraft ? (
                                      <Select size="xs" value={editDraft.amountScope} onChange={(v) => setEditDraft((d) => d ? { ...d, amountScope: (v ?? "any") as AmountScope } : d)} data={AMOUNT_SCOPE_SHORT} w={110} />
                                    ) : (
                                      <AmountScopeBadge scope={r.amountScope ?? "any"} />
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editDraft ? (
                                      <Select size="xs" value={editDraft.categoryId} onChange={(v) => setEditDraft((d) => d ? { ...d, categoryId: v ?? "" } : d)} data={leaveOptions} w={160} />
                                    ) : rowCat ? categoryLabel(rowCat, categories) : <Text c="dimmed" size="sm">(missing)</Text>}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editDraft ? (
                                      <NumberInput size="xs" min={0} max={10000} value={editDraft.priority} onChange={(v) => setEditDraft((d) => d ? { ...d, priority: Number(v) } : d)} w={70} />
                                    ) : r.priority}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing && editDraft ? (
                                      <NumberInput size="xs" min={0} max={1} step={0.05} value={editDraft.confidence} onChange={(v) => setEditDraft((d) => d ? { ...d, confidence: Number(v) } : d)} w={70} />
                                    ) : r.confidence.toFixed(2)}
                                  </Table.Td>
                                  <Table.Td>
                                    {isEditing ? (
                                      <Group gap={4} wrap="nowrap">
                                        <Button size="xs" disabled={saving} onClick={() => void saveEdit()}>Save</Button>
                                        <Button size="xs" variant="default" onClick={cancelEdit}>Cancel</Button>
                                        <ActionIcon size="sm" variant="subtle" color="red" title="Delete rule" onClick={() => requestDeleteHouseholdRule(r.id)}>
                                          <IconTrash size={13} />
                                        </ActionIcon>
                                      </Group>
                                    ) : (
                                      <Group gap={4} wrap="nowrap">
                                        <ActionIcon size="sm" variant="subtle" color="gray" title="Edit rule" onClick={() => startEdit(r)}>
                                          <IconPencil size={13} />
                                        </ActionIcon>
                                        <ActionIcon size="sm" variant="subtle" color="red" title="Delete rule" onClick={() => requestDeleteHouseholdRule(r.id)}>
                                          <IconTrash size={13} />
                                        </ActionIcon>
                                      </Group>
                                    )}
                                  </Table.Td>
                                </Table.Tr>
                              );
                            })}
                          </Table.Tbody>
                        </Table>
                      </Table.ScrollContainer>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          ) : null}
        </Stack>
      </Stack>

      <ConfirmDialog
        opened={ruleConfirm !== null}
        title={
          ruleConfirm?.kind === "household" ? "Delete household rule?" :
          ruleConfirm?.kind === "householdAll" ? "Delete all household rules?" :
          ruleConfirm?.kind === "builtin" ? "Delete built-in rule?" : ""
        }
        message={
          ruleConfirm?.kind === "household" ? "Delete this household rule? This cannot be undone." :
          ruleConfirm?.kind === "householdAll" ? `Delete all ${rules.length} household rule(s)? Built-in (global) rules are not affected. This cannot be undone.` :
          ruleConfirm?.kind === "builtin" ? "Delete this built-in rule? This affects all households on this server." : ""
        }
        confirmLabel="Delete"
        danger
        closeOnClickOutside={false}
        onClose={() => setRuleConfirm(null)}
        onConfirm={handleRuleConfirm}
      />
    </Paper>
  );
}
