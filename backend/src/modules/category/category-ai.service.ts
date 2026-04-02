import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { categoryHasChildren, categoryUsableByHousehold, listCategoriesForHousehold } from "./categories.service.js";

export type AiSuggestion = {
  suggestedCategoryId: string | null;
  confidence: number;
  suggestedNewCategoryName: string | null;
  reason: string;
  model: string;
};

type AiInput = {
  householdId: string;
  transactionId: string;
  normalizedDescription: string;
  signedAmount: number;
};

export type AiBatchInput = {
  transactionId: string;
  normalizedDescription: string;
  signedAmount: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function truncateForDebug(s: string): string {
  const max = env.LOG_AI_DEBUG_BODY_MAX_CHARS;
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]`;
}

function normalizeAiSuggestion(raw: unknown): Omit<AiSuggestion, "model"> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const suggestedCategoryId =
    typeof r.suggestedCategoryId === "string" && r.suggestedCategoryId.trim().length > 0
      ? r.suggestedCategoryId.trim()
      : null;
  const suggestedNewCategoryName =
    typeof r.suggestedNewCategoryName === "string" && r.suggestedNewCategoryName.trim().length > 0
      ? r.suggestedNewCategoryName.trim()
      : null;
  const confidence = clamp01(typeof r.confidence === "number" ? r.confidence : Number(r.confidence ?? 0));
  const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 800) : "";
  return { suggestedCategoryId, suggestedNewCategoryName, confidence, reason };
}

function finalizeSuggestion(householdId: string, parsed: Omit<AiSuggestion, "model"> | null): AiSuggestion | null {
  if (!parsed) {
    return null;
  }
  if (parsed.suggestedCategoryId) {
    if (
      !categoryUsableByHousehold(parsed.suggestedCategoryId, householdId) ||
      categoryHasChildren(parsed.suggestedCategoryId)
    ) {
      return {
        ...parsed,
        suggestedCategoryId: null,
        model: env.OPENAI_MODEL
      };
    }
  }
  return { ...parsed, model: env.OPENAI_MODEL };
}

/** Leaf categories: id + name only (smaller prompt than including parentId). */
function leafCategoriesPayload(householdId: string) {
  const all = listCategoriesForHousehold(householdId);
  return all.filter((c) => !categoryHasChildren(c.id)).map((c) => ({ id: c.id, name: c.name }));
}

const CLASSIFICATION_GUIDELINES = [
  "Use high confidence (e.g. 0.9+) when merchant, ACH descriptors, amount sign, and direction clearly match one leaf.",
  "Use lower confidence when several leaves are plausible.",
  "Employer or payroll: credits with DES:PAYMENTS, CCD, PMT, or similar from a known employer name → prefer salary/wages (or the household leaf for earned income), not generic corporate or misc income.",
  "Telecom: T-MOBILE, TMOBILE, VERIZON, AT&T, etc. on debit → Utilities or Subscriptions, never Groceries.",
  "Mortgage/home loan: LOAN PAYMT, MORTGAGE, UWM, escrow, home equity → prefer a housing/mortgage leaf over generic Debt Payments when such a leaf exists.",
  "Zelle/Venmo/P2P: read memo text; reimbursement vs transfer vs shared expense.",
  "If no leaf fits well: set suggestedCategoryId to null, set suggestedNewCategoryName to a short specific label (e.g. Mortgage — LenderName), and explain in reason.",
  "If a broad leaf is correct but a subtype is obvious, pick the best leaf and name the subtype in reason; you may suggest suggestedNewCategoryName for a future subcategory."
].join(" ");

/** Rough char budget for the JSON user payload (categories + transactions); split batch if exceeded. */
const MAX_ESTIMATED_USER_JSON_CHARS = 100_000;
/** When a single row still exceeds the budget, cap description length sent to OpenAI. */
const SINGLE_ITEM_DESC_TRUNCATE_CHARS = 12_000;

function buildUserContentObject(
  householdId: string,
  items: AiBatchInput[],
  normalizedDescriptionMax?: number
) {
  const categories = leafCategoriesPayload(householdId);
  const transactions = items.map((it) => {
    let nd = it.normalizedDescription;
    if (
      normalizedDescriptionMax != null &&
      nd.length > normalizedDescriptionMax
    ) {
      nd = nd.slice(0, normalizedDescriptionMax);
    }
    return {
      transactionId: it.transactionId,
      transaction: {
        normalizedDescription: nd,
        signedAmount: it.signedAmount,
        direction: it.signedAmount >= 0 ? "credit" : "debit"
      }
    };
  });
  return {
    task: "Assign categories for multiple transactions.",
    guidelines: CLASSIFICATION_GUIDELINES,
    transactions,
    categories,
    resultsShape:
      "Top-level JSON must include results: array of { transactionId, suggestedCategoryId, confidence 0..1, suggestedNewCategoryName, reason } — one entry per input transactionId."
  };
}

function estimateUserContentChars(householdId: string, items: AiBatchInput[]): number {
  return JSON.stringify(buildUserContentObject(householdId, items)).length;
}

export async function suggestCategoryWithAi(input: AiInput): Promise<AiSuggestion | null> {
  const map = await suggestCategoriesWithAiBatch(input.householdId, [
    {
      transactionId: input.transactionId,
      normalizedDescription: input.normalizedDescription,
      signedAmount: input.signedAmount
    }
  ]);
  return map.get(input.transactionId) ?? null;
}

/**
 * One OpenAI request for many transactions. Returns a map keyed by `transactionId` (raw row id).
 * Missing keys mean no suggestion (same as a failed single call).
 */
export async function suggestCategoriesWithAiBatch(
  householdId: string,
  items: AiBatchInput[]
): Promise<Map<string, AiSuggestion | null>> {
  const out = new Map<string, AiSuggestion | null>();
  if (items.length === 0) {
    return out;
  }
  for (const it of items) {
    out.set(it.transactionId, null);
  }

  if (!env.AI_CATEGORY_ENABLED) {
    return out;
  }
  if (!env.OPENAI_API_KEY?.trim()) {
    log.warn("[category-ai] AI_CATEGORY_ENABLED is on but OPENAI_API_KEY is missing; skipping.");
    return out;
  }

  const est = estimateUserContentChars(householdId, items);
  if (est > MAX_ESTIMATED_USER_JSON_CHARS) {
    if (items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      log.debug(
        `[category-ai] payload ~${est} chars > limit; splitting batch ${items.length} -> ${mid} + ${items.length - mid}`
      );
      const leftMap = await suggestCategoriesWithAiBatch(householdId, items.slice(0, mid));
      const rightMap = await suggestCategoriesWithAiBatch(householdId, items.slice(mid));
      for (const [k, v] of rightMap) {
        leftMap.set(k, v);
      }
      return leftMap;
    }
    log.warn(
      `[category-ai] single-transaction prompt large (~${est} chars); truncating description for API`
    );
  }

  const descMax =
    items.length === 1 && est > MAX_ESTIMATED_USER_JSON_CHARS
      ? SINGLE_ITEM_DESC_TRUNCATE_CHARS
      : undefined;

  const userObject = buildUserContentObject(householdId, items, descMax);
  const userJson = JSON.stringify(userObject);

  const systemContent =
    "You classify bank transactions into the household's existing leaf categories (use category id when it fits). " +
    "Follow the guidelines in the user JSON. You MUST return strict JSON with a top-level results array: one object per input transactionId (same ids). " +
    "Include suggestedNewCategoryName when no leaf is adequate or to name a clearer subtype. Return JSON only.";

  const body = {
    model: env.OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemContent
      },
      {
        role: "user",
        content: userJson
      }
    ]
  };

  log.debug(
    `[category-ai] OpenAI request: ${items.length} txn(s), user JSON ${userJson.length} chars\n${truncateForDebug(userJson)}`
  );

  const t0 = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn(
        `[category-ai] OpenAI HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ""}`
      );
      return out;
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return out;
    }
    log.debug(`[category-ai] OpenAI raw content (${content.length} chars)\n${truncateForDebug(content)}`);
    let root: unknown;
    try {
      root = JSON.parse(content) as unknown;
    } catch {
      return out;
    }
    if (!root || typeof root !== "object") {
      return out;
    }
    const results = (root as Record<string, unknown>).results;
    if (!Array.isArray(results)) {
      return out;
    }
    const preview = results.map((row) => {
      if (!row || typeof row !== "object") {
        return {};
      }
      const o = row as Record<string, unknown>;
      return {
        transactionId: o.transactionId,
        suggestedCategoryId: o.suggestedCategoryId,
        confidence: o.confidence
      };
    });
    log.debug(`[category-ai] parsed results (${results.length}): ${truncateForDebug(JSON.stringify(preview))}`);
    for (const row of results) {
      const parsed = normalizeAiSuggestion(row);
      const tid =
        row && typeof row === "object" && typeof (row as Record<string, unknown>).transactionId === "string"
          ? String((row as Record<string, unknown>).transactionId).trim()
          : "";
      if (!tid || !out.has(tid)) {
        continue;
      }
      out.set(tid, finalizeSuggestion(householdId, parsed));
    }
  } catch (err) {
    log.warn("[category-ai] batch request failed:", err instanceof Error ? err.message : err);
    return out;
  }
  log.info(`[category-ai] batch ok: ${items.length} txn(s) in ${Date.now() - t0}ms`);
  return out;
}
