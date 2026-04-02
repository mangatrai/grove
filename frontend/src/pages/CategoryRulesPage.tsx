import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";

type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
};

type MatchType = "contains" | "prefix" | "regex";

type BuiltinRuleRow = {
  origin: "builtin";
  ruleId: string;
  flow: "inflow" | "outflow";
  categoryId: string;
  keywords: string[];
  summary: string;
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

const emptyForm = {
  patterns: "",
  matchType: "contains" as MatchType,
  categoryId: "",
  priority: 100,
  confidence: 0.85,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<typeof emptyForm | null>(null);
  const [ruleFilter, setRuleFilter] = useState("");
  const [testDesc, setTestDesc] = useState("");
  const [testAmount, setTestAmount] = useState("-10");
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [recatMsg, setRecatMsg] = useState<string | null>(null);
  const [sessionPreviewId, setSessionPreviewId] = useState("");
  const [previewRows, setPreviewRows] = useState<
    Array<{
      rawId: string;
      txnDate: string;
      amount: number;
      description: string;
      normalizedDescription: string;
      classification: {
        categoryId: string | null;
        ruleId: string | null;
        source: string;
        reason: string;
      };
    }>
  >([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const leaves = useMemo(() => assignableCategories(categories), [categories]);

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
    return builtinRules.filter(
      (b) =>
        b.ruleId.toLowerCase().includes(q) ||
        b.summary.toLowerCase().includes(q) ||
        b.keywords.some((k) => k.toLowerCase().includes(q)) ||
        categoryLabel(
          categories.find((c) => c.id === b.categoryId) ?? {
            id: b.categoryId,
            name: b.categoryId,
            parentId: null
          },
          categories
        )
          .toLowerCase()
          .includes(q)
    );
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

  async function loadSessionPreview() {
    const sid = sessionPreviewId.trim();
    if (!sid) {
      setError("Enter an import session id (from Import workspace after parse).");
      return;
    }
    setPreviewLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ rows: typeof previewRows }>("/categories/rules/rule-learning-preview", {
        method: "POST",
        body: JSON.stringify({ sessionId: sid })
      });
      setPreviewRows(res.rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preview failed");
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
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
          <strong>Household rules</strong> in the table below are checked <strong>before</strong> built-in keyword rules
          (lower priority numbers run first). Only <strong>leaf</strong> categories can be assigned.
        </p>
        <p className="muted">
          Built-in rules are read-only heuristics from the app (same engine as import). Add household rules to override or
          cover merchants the defaults miss.
        </p>
        <p className="muted">
          <Link to="/categories">Back to categories</Link>
          {" · "}
          <Link to="/transactions">Transactions</Link>
          {" · "}
          <Link to="/import">Import workspace</Link> (create a session, parse, then paste session id for rule-learning
          preview)
        </p>

        {error ? <p className="error">{error}</p> : null}
        {recatMsg ? <p className="muted">{recatMsg}</p> : null}

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

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Rule-learning preview (import session)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          After you <strong>parse</strong> files in an import session, paste the session id here to preview categories for
          each raw row (no ledger write).
        </p>
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="category-rules-page__field" style={{ minWidth: "18rem", flex: "1 1 18rem" }}>
            Import session id
            <input
              value={sessionPreviewId}
              onChange={(e) => setSessionPreviewId(e.target.value)}
              placeholder="uuid"
              autoComplete="off"
            />
          </label>
          <button type="button" disabled={previewLoading} onClick={() => void loadSessionPreview()}>
            {previewLoading ? "Loading…" : "Load preview"}
          </button>
        </div>
        {previewRows.length > 0 ? (
          <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
            <table className="ledger-table category-rules-page__table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Description</th>
                  <th scope="col">Preview category</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) => {
                  const cid = r.classification.categoryId;
                  const cat = cid ? categories.find((c) => c.id === cid) : null;
                  return (
                    <tr key={r.rawId}>
                      <td>{r.txnDate}</td>
                      <td>{r.amount}</td>
                      <td>
                        <code style={{ fontSize: "0.78rem" }}>{r.description}</code>
                      </td>
                      <td>{cat ? categoryLabel(cat, categories) : "—"}</td>
                      <td>{r.classification.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Built-in rules (read-only)</h2>
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && filteredBuiltin.length === 0 ? <p className="muted">No built-in rules match filter.</p> : null}
        {!loading && filteredBuiltin.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table category-rules-page__table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Rule id</th>
                  <th scope="col">Flow</th>
                  <th scope="col">Category</th>
                  <th scope="col">Keywords</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {filteredBuiltin.map((b) => {
                  const cat = categories.find((c) => c.id === b.categoryId);
                  return (
                    <tr key={b.ruleId}>
                      <td>Built-in</td>
                      <td>
                        <code>{b.ruleId}</code>
                      </td>
                      <td>{b.flow}</td>
                      <td>{cat ? categoryLabel(cat, categories) : b.categoryId}</td>
                      <td>
                        <code style={{ fontSize: "0.75rem" }}>{b.keywords.join(", ")}</code>
                      </td>
                      <td>{b.summary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Add household rules</h2>
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
