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

function leafCategoriesPayload(householdId: string) {
  const all = listCategoriesForHousehold(householdId);
  return all
    .filter((c) => !categoryHasChildren(c.id))
    .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
}

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
    transactions,
    categories,
    expectedJsonSchema: {
      results:
        "array of { transactionId: string, suggestedCategoryId: string|null, confidence: number(0..1), suggestedNewCategoryName: string|null, reason: string }"
    }
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

  const body = {
    model: env.OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You classify bank transaction descriptions into existing categories. Prefer an existing category id whenever reasonable. You MUST return one result object per input transactionId. Return strict JSON only."
      },
      {
        role: "user",
        content: JSON.stringify(buildUserContentObject(householdId, items, descMax))
      }
    ]
  };

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
