import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
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
    case "any":
      return "Any amount";
    case "credit_only":
      return "Credits only";
    case "debit_only":
      return "Debits only";
    default:
      return s;
  }
}

const emptyForm = {
  patterns: "",
  matchType: "contains" as MatchType,
  categoryId: "",
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

  const leaves = useMemo(() => assignableCategories(categories), [categories]);

  /** Global built-in rules may only target default taxonomy leaves (not household-created categories). */
  const globalBuiltinLeaves = useMemo(
    () => leaves.filter((c) => !c.householdScoped),
    [leaves]
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
    if (!q) {
      return builtinRules;
    }
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
    if (!q) {
      return rules;
    }
    return rules.filter((r) => {
      const cat = categories.find((c) => c.id === r.categoryId);
      const cn = cat ? categoryLabel(cat, categories).toLowerCase() : "";
      return r.pattern.toLowerCase().includes(q) || cn.includes(q) || r.matchType.includes(q);
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
      if (d !== 0) {
        return d;
      }
      return aScope.localeCompare(bScope);
    });
  }, [filteredBuiltin, categories]);

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
      await apiJson(`/categories/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  function startEdit(r: CategoryRule) {
    setEditingId(r.id);
    setEditDraft({
      patterns: r.pattern,
      matchType: r.matchType,
      categoryId: r.categoryId,
      priority: r.priority,
      confidence: r.confidence,
      enabled: r.enabled
    });
  }

  async function saveEdit() {
    if (!editingId || !editDraft) {
      return;
    }
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
    if (!canEditGlobals) {
      return;
    }
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
      await apiJson(`/categories/rules/builtin/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function deleteBuiltinRule(id: string) {
    if (!canEditGlobals || !window.confirm("Delete this built-in rule? This affects all households on this server.")) {
      return;
    }
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
    }
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
    if (!editingBuiltinId || !editBuiltinDraft) {
      return;
    }
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

  function exportRulesCsv() {
    const out: Array<Record<RulesCsvHeader, string>> = [];
    for (const b of builtinRules) {
      const cat = categories.find((c) => c.id === b.categoryId);
      out.push({
        origin: "builtin",
        id: b.id,
        rule_key: b.ruleKey,
        pattern: b.pattern,
        match_type: b.matchType,
        amount_scope: b.amountScope,
        category_id: b.categoryId,
        category_path: cat ? categoryPathForCsv(cat, categories) : "",
        priority: String(b.priority),
        confidence: String(b.confidence),
        enabled: b.enabled ? "true" : "false"
      });
    }
    for (const r of rules) {
      const cat = categories.find((c) => c.id === r.categoryId);
      out.push({
        origin: "household",
        id: r.id,
        rule_key: "",
        pattern: r.pattern,
        match_type: r.matchType,
        amount_scope: "any",
        category_id: r.categoryId,
        category_path: cat ? categoryPathForCsv(cat, categories) : "",
        priority: String(r.priority),
        confidence: String(r.confidence),
        enabled: r.enabled ? "true" : "false"
      });
    }
    const csv = buildRulesCsvLines(out);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `classification-rules-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFileChange(file: File | null) {
    setImportCsvError(null);
    setImportSummary(null);
    setImportCsvRows([]);
    if (!file) {
      return;
    }
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
    if (s === "" || s === "1" || s === "true" || s === "yes") {
      return true;
    }
    if (s === "0" || s === "false" || s === "no") {
      return false;
    }
    return defaultTrue;
  }

  async function runCsvImport() {
    setImportSummary(null);
    setError(null);
    const filtered = importCsvRows.filter((row) => {
      const o = (row.origin ?? "").trim().toLowerCase();
      if (importMode === "household") {
        return o === "" || o === "household";
      }
      return o === "" || o === "builtin";
    });
    if (filtered.length === 0) {
      setImportCsvError("No rows match the selected import mode (check the origin column).");
      return;
    }

    const matchTypes = new Set<MatchType>(["contains", "prefix", "regex"]);
    const amountScopes = new Set<AmountScope>(["any", "credit_only", "debit_only"]);

    if (importMode === "household") {
      const rules: Array<{
        pattern: string;
        matchType: MatchType;
        categoryId?: string;
        categoryPath?: string;
        confidence?: number;
        priority?: number;
        enabled?: boolean;
      }> = [];
      for (const row of filtered) {
        const pattern = (row.pattern ?? "").trim();
        const mt = row.match_type as MatchType;
        if (pattern.length < 2 || !matchTypes.has(mt)) {
          continue;
        }
        const categoryId = (row.category_id ?? "").trim();
        const categoryPath = (row.category_path ?? "").trim();
        if (!categoryId && !categoryPath) {
          continue;
        }
        const priority = Number(row.priority);
        const confidence = Number(row.confidence);
        rules.push({
          pattern,
          matchType: mt,
          ...(categoryId ? { categoryId } : {}),
          ...(categoryPath ? { categoryPath } : {}),
          ...(Number.isFinite(confidence) ? { confidence } : {}),
          ...(Number.isInteger(priority) ? { priority } : {}),
          enabled: parseBoolCell(row.enabled, true)
        });
      }
      if (rules.length === 0) {
        setImportCsvError("No valid rows to import (need pattern, match_type, and category_id or category_path).");
        return;
      }
      setImportBusy(true);
      try {
        const res = await apiJson<{
          created: CategoryRule[];
          errors: Array<{ index: number; message: string; code?: string }>;
        }>("/categories/rules/bulk", {
          method: "POST",
          body: JSON.stringify({ rules })
        });
        setImportSummary(
          `Household import: ${res.created.length} created, ${res.errors.length} row error(s).` +
            (res.errors.length ? ` First: ${res.errors[0]?.message ?? ""}` : "")
        );
        setImportCsvRows([]);
        await load();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Bulk import failed");
      } finally {
        setImportBusy(false);
      }
      return;
    }

    const rulesBuiltin: Array<{
      pattern: string;
      matchType: MatchType;
      categoryId?: string;
      categoryPath?: string;
      amountScope: AmountScope;
      ruleKey?: string;
      confidence?: number;
      priority?: number;
      enabled?: boolean;
    }> = [];
    for (const row of filtered) {
      const pattern = (row.pattern ?? "").trim();
      const mt = row.match_type as MatchType;
      if (pattern.length < 2 || !matchTypes.has(mt)) {
        continue;
      }
      const categoryId = (row.category_id ?? "").trim();
      const categoryPath = (row.category_path ?? "").trim();
      if (!categoryId && !categoryPath) {
        continue;
      }
      let amountScope: AmountScope = "debit_only";
      const ascope = (row.amount_scope ?? "").trim().toLowerCase();
      if (ascope && amountScopes.has(ascope as AmountScope)) {
        amountScope = ascope as AmountScope;
      }
      const rk = (row.rule_key ?? "").trim();
      const priority = Number(row.priority);
      const confidence = Number(row.confidence);
      rulesBuiltin.push({
        pattern,
        matchType: mt,
        amountScope,
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
      }>("/categories/rules/builtin/bulk", {
        method: "POST",
        body: JSON.stringify({ rules: rulesBuiltin })
      });
      setImportSummary(
        `Built-in import: ${res.created.length} created, ${res.errors.length} row error(s).` +
          (res.errors.length ? ` First: ${res.errors[0]?.message ?? ""}` : "")
      );
      setImportCsvRows([]);
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
    <div>
      <div className="card">
        <h1>Classification rules</h1>
        <p className="muted">
          <strong>Household rules</strong> run first, then <strong>built-in (global) rules</strong> stored in the database
          (lower priority numbers run first within each group). Only <strong>leaf</strong> categories can be assigned.
        </p>
        <p className="muted">
          Built-in rules apply to <strong>all households</strong> on this server. Owners and admins can edit them;
          members can view only. Add household rules to override globals for your home.
        </p>
        <p className="muted">
          <Link to="/categories">Back to categories</Link>
          {" · "}
          <Link to="/transactions">Transactions</Link>
          {" · "}
          <Link to="/imports">Import</Link> — upload, parse, and run the read-only <strong>classification matcher preview</strong> on the
          session page (recent sessions and <strong>Copy id</strong> live there too).
        </p>

        {error ? <p className="error">{error}</p> : null}
        {recatMsg ? <p className="muted">{recatMsg}</p> : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>Import / export (CSV)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Export includes both built-in and household rules in one file (<code>origin</code> column). Import is{" "}
          <strong>create-only</strong> (existing rule <code>id</code> values are ignored). Use{" "}
          <code>category_id</code> or <code>category_path</code> (e.g. <code>Home &gt; HOA Fees</code>).
        </p>
        <div className="category-rules-page__row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <button type="button" className="secondary" onClick={exportRulesCsv} disabled={loading}>
            Export rules (CSV)
          </button>
          <label className="category-rules-page__field" style={{ minWidth: "11rem" }}>
            Import as
            <select
              value={importMode}
              onChange={(e) => setImportMode(e.target.value as "household" | "builtin")}
              disabled={importBusy}
            >
              <option value="household">Household rules</option>
              <option value="builtin" disabled={!canEditGlobals}>
                Built-in (global) rules
              </option>
            </select>
          </label>
          <label className="category-rules-page__field" style={{ minWidth: "14rem" }}>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importBusy}
              onChange={(e) => onImportFileChange(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="button" disabled={importBusy || importCsvRows.length === 0} onClick={() => void runCsvImport()}>
            {importBusy ? "Importing…" : "Import rows"}
          </button>
        </div>
        {importCsvError ? <p className="error">{importCsvError}</p> : null}
        {importSummary ? <p className="muted">{importSummary}</p> : null}
        {importCsvRows.length > 0 ? (
          <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
            <p className="muted" style={{ marginTop: 0 }}>
              Preview (first 15 rows, filtered by import mode).
            </p>
            <table className="ledger-table category-rules-page__table">
              <thead>
                <tr>
                  <th>origin</th>
                  <th>pattern</th>
                  <th>match_type</th>
                  <th>amount_scope</th>
                  <th>category_path</th>
                </tr>
              </thead>
              <tbody>
                {importCsvRows
                  .filter((row) => {
                    const o = (row.origin ?? "").trim().toLowerCase();
                    if (importMode === "household") {
                      return o === "" || o === "household";
                    }
                    return o === "" || o === "builtin";
                  })
                  .slice(0, 15)
                  .map((row, i) => (
                    <tr key={i}>
                      <td>{row.origin ?? "—"}</td>
                      <td>
                        <code className="category-rules-page__pattern">{(row.pattern ?? "").slice(0, 48)}</code>
                      </td>
                      <td>{row.match_type ?? "—"}</td>
                      <td>{row.amount_scope ?? "—"}</td>
                      <td>{(row.category_path ?? "").slice(0, 40) || row.category_id?.slice(0, 8) || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>Search &amp; test</h2>
        <div className="category-rules-page__row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <label className="category-rules-page__field" style={{ minWidth: "12rem", flex: "1 1 12rem" }}>
            Filter rules
            <input
              value={ruleFilter}
              onChange={(e) => setRuleFilter(e.target.value)}
              placeholder="keyword, rule id, category…"
              autoComplete="off"
            />
          </label>
          <div style={{ flex: "2 1 18rem" }}>
            <label className="category-rules-page__field">
              Test description (normalized like import)
              <input
                value={testDesc}
                onChange={(e) => setTestDesc(e.target.value)}
                placeholder="Paste bank description"
                autoComplete="off"
              />
            </label>
          </div>
          <label className="category-rules-page__field category-rules-page__field--narrow">
            Signed amount
            <input
              value={testAmount}
              onChange={(e) => setTestAmount(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <button type="button" disabled={testLoading} onClick={() => void runTest()}>
            {testLoading ? "Running…" : "Run test"}
          </button>
        </div>
        {testResult ? (
          <pre
            className="muted"
            style={{ fontSize: "0.82rem", overflow: "auto", maxHeight: "10rem", marginTop: "0.5rem" }}
          >
            {JSON.stringify(testResult, null, 2)}
          </pre>
        ) : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>Re-apply rules to ledger</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Runs the same matcher as import over existing posted rows. <strong>Uncategorized only</strong> is safest;
          <strong>All posted</strong> overwrites categories when a rule matches.
        </p>
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="secondary" onClick={() => void runRecategorize("uncategorized_only")}>
            Re-apply (uncategorized only)
          </button>
          <button type="button" className="secondary" onClick={() => void runRecategorize("all")}>
            Re-apply (all posted)
          </button>
        </div>

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Built-in (global) rules</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Grouped by target category and amount scope. These rules apply to <strong>every household</strong> on this server;
          only installation default leaves are valid targets (see add form below).
        </p>
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && filteredBuiltin.length === 0 ? <p className="muted">No built-in rules match filter.</p> : null}
        {!loading && filteredBuiltin.length > 0 ? (
          <div>
            {builtinRuleGroups.map(([key, groupRules]) => {
              const [catId, scopeStr] = key.split("\u0000");
              const scope = scopeStr as AmountScope;
              const cat = categories.find((c) => c.id === catId);
              const summaryTitle = `${cat ? categoryLabel(cat, categories) : "(unknown category)"} · ${amountScopeShort(scope)} (${groupRules.length})`;
              return (
                <details key={key} style={{ marginBottom: "1rem" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>{summaryTitle}</summary>
                  <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
                    <table className="ledger-table category-rules-page__table">
                      <thead>
                        <tr>
                          <th scope="col">Source</th>
                          <th scope="col">On</th>
                          <th scope="col">Rule key</th>
                          <th scope="col">Pattern</th>
                          <th scope="col">Match</th>
                          <th scope="col">Amount</th>
                          <th scope="col">Category</th>
                          <th scope="col">Pri</th>
                          <th scope="col">Conf</th>
                          <th scope="col" />
                        </tr>
                      </thead>
                      <tbody>
                        {groupRules.map((b) => {
                          const rowCat = categories.find((c) => c.id === b.categoryId);
                          const isEditing = editingBuiltinId === b.id;
                          return (
                            <tr key={b.id}>
                              <td>Built-in</td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <input
                                    type="checkbox"
                                    checked={editBuiltinDraft.enabled}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) => (d ? { ...d, enabled: e.target.checked } : d))
                                    }
                                  />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={b.enabled}
                                    onChange={() => void patchBuiltinRule(b.id, { enabled: !b.enabled })}
                                    disabled={!canEditGlobals}
                                    aria-label={`Enable built-in rule ${b.ruleKey}`}
                                  />
                                )}
                              </td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <input
                                    value={editBuiltinDraft.ruleKey}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) => (d ? { ...d, ruleKey: e.target.value } : d))
                                    }
                                  />
                                ) : (
                                  <code className="category-rules-page__pattern">{b.ruleKey}</code>
                                )}
                              </td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <input
                                    value={editBuiltinDraft.pattern}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) => (d ? { ...d, pattern: e.target.value } : d))
                                    }
                                  />
                                ) : (
                                  <code className="category-rules-page__pattern">{b.pattern}</code>
                                )}
                              </td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <select
                                    value={editBuiltinDraft.matchType}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) =>
                                        d ? { ...d, matchType: e.target.value as MatchType } : d
                                      )
                                    }
                                  >
                                    <option value="contains">contains</option>
                                    <option value="prefix">prefix</option>
                                    <option value="regex">regex</option>
                                  </select>
                                ) : (
                                  b.matchType
                                )}
                              </td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <select
                                    value={editBuiltinDraft.amountScope}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) =>
                                        d ? { ...d, amountScope: e.target.value as AmountScope } : d
                                      )
                                    }
                                  >
                                    <option value="any">any</option>
                                    <option value="credit_only">credit only</option>
                                    <option value="debit_only">debit only</option>
                                  </select>
                                ) : (
                                  amountScopeShort(b.amountScope)
                                )}
                              </td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <select
                                    value={editBuiltinDraft.categoryId}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) =>
                                        d ? { ...d, categoryId: e.target.value } : d
                                      )
                                    }
                                  >
                                    {globalBuiltinLeaves.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {categoryLabel(c, categories)}
                                      </option>
                                    ))}
                                  </select>
                                ) : rowCat ? (
                                  categoryLabel(rowCat, categories)
                                ) : (
                                  <span className="muted">(missing)</span>
                                )}
                              </td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <input
                                    type="number"
                                    min={0}
                                    max={10000}
                                    className="category-rules-page__num"
                                    value={editBuiltinDraft.priority}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) =>
                                        d ? { ...d, priority: Number(e.target.value) } : d
                                      )
                                    }
                                  />
                                ) : (
                                  b.priority
                                )}
                              </td>
                              <td>
                                {isEditing && editBuiltinDraft ? (
                                  <input
                                    type="number"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    className="category-rules-page__num"
                                    value={editBuiltinDraft.confidence}
                                    onChange={(e) =>
                                      setEditBuiltinDraft((d) =>
                                        d ? { ...d, confidence: Number(e.target.value) } : d
                                      )
                                    }
                                  />
                                ) : (
                                  b.confidence.toFixed(2)
                                )}
                              </td>
                              <td>
                                {canEditGlobals ? (
                                  isEditing ? (
                                    <span className="category-rules-page__row-actions">
                                      <button type="button" disabled={saving} onClick={() => void saveEditBuiltin()}>
                                        Save
                                      </button>
                                      <button type="button" className="secondary" onClick={cancelEditBuiltin}>
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary"
                                        onClick={() => void deleteBuiltinRule(b.id)}
                                      >
                                        Delete
                                      </button>
                                    </span>
                                  ) : (
                                    <button type="button" className="secondary" onClick={() => startEditBuiltin(b)}>
                                      Edit
                                    </button>
                                  )
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        ) : null}

        {canEditGlobals ? (
          <>
            <h3 style={{ fontSize: "1rem", marginTop: "1rem" }}>Add built-in rule</h3>
            <form
              onSubmit={(e) => void onCreateGlobal(e)}
              className="category-rules-page__form category-rules-page__form--builtin"
            >
              <p className="muted category-rules-page__form-span" style={{ margin: 0 }}>
                Applies to <strong>all households</strong> on this server. Category must be an installation default leaf —
                for categories you created under Categories, add a <strong>household</strong> rule instead.
              </p>
              <label className="category-rules-page__field">
                Rule key (optional)
                <input
                  value={globalForm.ruleKey}
                  onChange={(e) => setGlobalForm((f) => ({ ...f, ruleKey: e.target.value }))}
                  placeholder="auto from pattern if empty"
                  autoComplete="off"
                />
              </label>
              <label className="category-rules-page__field category-rules-page__form-span">
                Pattern
                <input
                  value={globalForm.pattern}
                  onChange={(e) => setGlobalForm((f) => ({ ...f, pattern: e.target.value }))}
                  placeholder="substring or regex"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="category-rules-page__field">
                Match type
                <select
                  value={globalForm.matchType}
                  onChange={(e) =>
                    setGlobalForm((f) => ({ ...f, matchType: e.target.value as MatchType }))
                  }
                >
                  <option value="contains">Contains (substring)</option>
                  <option value="prefix">Prefix</option>
                  <option value="regex">Regex (case-insensitive)</option>
                </select>
              </label>
              <label className="category-rules-page__field">
                Amount scope
                <select
                  value={globalForm.amountScope}
                  onChange={(e) =>
                    setGlobalForm((f) => ({ ...f, amountScope: e.target.value as AmountScope }))
                  }
                >
                  <option value="any">Any amount</option>
                  <option value="credit_only">Credits only</option>
                  <option value="debit_only">Debits only</option>
                </select>
              </label>
              <label className="category-rules-page__field">
                Category
                <select
                  value={globalForm.categoryId}
                  onChange={(e) => setGlobalForm((f) => ({ ...f, categoryId: e.target.value }))}
                  required
                >
                  <option value="">Select…</option>
                  {globalBuiltinLeaves.map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryLabel(c, categories)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="category-rules-page__field category-rules-page__field--narrow">
                Priority
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  value={globalForm.priority}
                  onChange={(e) => setGlobalForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                />
              </label>
              <label className="category-rules-page__field category-rules-page__field--narrow">
                Confidence
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={globalForm.confidence}
                  onChange={(e) => setGlobalForm((f) => ({ ...f, confidence: Number(e.target.value) }))}
                />
              </label>
              <label className="category-rules-page__checkbox">
                <input
                  type="checkbox"
                  checked={globalForm.enabled}
                  onChange={(e) => setGlobalForm((f) => ({ ...f, enabled: e.target.checked }))}
                />{" "}
                Enabled
              </label>
              <button type="submit" disabled={saving || globalBuiltinLeaves.length === 0}>
                {saving ? "Saving…" : "Add built-in rule"}
              </button>
            </form>
          </>
        ) : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Add household rules</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Household rules run <strong>before</strong> built-ins and can target any assignable leaf for your home, including
          categories you added. They <strong>override</strong> global rules when both match.
        </p>
        <form onSubmit={(e) => void onCreate(e)} className="category-rules-page__form">
          <label className="category-rules-page__field" style={{ gridColumn: "1 / -1" }}>
            Pattern(s) — one per line or comma-separated (regex with commas: one pattern per line)
            <textarea
              rows={4}
              value={form.patterns}
              onChange={(e) => setForm((f) => ({ ...f, patterns: e.target.value }))}
              placeholder={"whole foods\ntarget\n^ach credit"}
              autoComplete="off"
            />
          </label>
          <label className="category-rules-page__field">
            Match type
            <select
              value={form.matchType}
              onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value as MatchType }))}
            >
              <option value="contains">Contains (substring)</option>
              <option value="prefix">Prefix</option>
              <option value="regex">Regex (case-insensitive)</option>
            </select>
          </label>
          <label className="category-rules-page__field">
            Category
            <select
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              <option value="">Select…</option>
              {leaves.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c, categories)}
                </option>
              ))}
            </select>
          </label>
          <label className="category-rules-page__field category-rules-page__field--narrow">
            Priority
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
            />
          </label>
          <label className="category-rules-page__field category-rules-page__field--narrow">
            Confidence
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={form.confidence}
              onChange={(e) => setForm((f) => ({ ...f, confidence: Number(e.target.value) }))}
            />
          </label>
          <label className="category-rules-page__checkbox">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />{" "}
            Enabled
          </label>
          <button type="submit" disabled={saving || leaves.length === 0}>
            {saving ? "Saving…" : "Add rule(s)"}
          </button>
        </form>

        {leaves.length === 0 && !loading ? (
          <p className="muted">
            Add leaf categories under <Link to="/categories">Categories</Link> before creating rules.
          </p>
        ) : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Your household rules</h2>
        {!loading && filteredHousehold.length === 0 ? <p className="muted">No household rules match filter.</p> : null}
        {!loading && filteredHousehold.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table category-rules-page__table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">On</th>
                  <th scope="col">Pattern</th>
                  <th scope="col">Match</th>
                  <th scope="col">Category</th>
                  <th scope="col">Pri</th>
                  <th scope="col">Conf</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {filteredHousehold.map((r) => {
                  const cat = categories.find((c) => c.id === r.categoryId);
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>Household</td>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            type="checkbox"
                            checked={editDraft.enabled}
                            onChange={(e) =>
                              setEditDraft((d) => (d ? { ...d, enabled: e.target.checked } : d))
                            }
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={() => void patchRule(r.id, { enabled: !r.enabled })}
                            aria-label={`Enable rule ${r.pattern}`}
                          />
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            value={editDraft.patterns}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, patterns: e.target.value } : d))}
                          />
                        ) : (
                          <code className="category-rules-page__pattern">{r.pattern}</code>
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <select
                            value={editDraft.matchType}
                            onChange={(e) =>
                              setEditDraft((d) =>
                                d ? { ...d, matchType: e.target.value as MatchType } : d
                              )
                            }
                          >
                            <option value="contains">contains</option>
                            <option value="prefix">prefix</option>
                            <option value="regex">regex</option>
                          </select>
                        ) : (
                          r.matchType
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <select
                            value={editDraft.categoryId}
                            onChange={(e) =>
                              setEditDraft((d) => (d ? { ...d, categoryId: e.target.value } : d))
                            }
                          >
                            {leaves.map((c) => (
                              <option key={c.id} value={c.id}>
                                {categoryLabel(c, categories)}
                              </option>
                            ))}
                          </select>
                        ) : cat ? (
                          categoryLabel(cat, categories)
                        ) : (
                          <span className="muted">(missing)</span>
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            className="category-rules-page__num"
                            value={editDraft.priority}
                            onChange={(e) =>
                              setEditDraft((d) =>
                                d ? { ...d, priority: Number(e.target.value) } : d
                              )
                            }
                          />
                        ) : (
                          r.priority
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            className="category-rules-page__num"
                            value={editDraft.confidence}
                            onChange={(e) =>
                              setEditDraft((d) =>
                                d ? { ...d, confidence: Number(e.target.value) } : d
                              )
                            }
                          />
                        ) : (
                          r.confidence.toFixed(2)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="category-rules-page__row-actions">
                            <button type="button" disabled={saving} onClick={() => void saveEdit()}>
                              Save
                            </button>
                            <button type="button" className="secondary" onClick={cancelEdit}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="secondary" onClick={() => startEdit(r)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
