import { env } from "../../config/env.js";
import { categoryHasChildren, categoryUsableByHousehold, listCategoriesForHousehold } from "./categories.service.js";

type AiSuggestion = {
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

export async function suggestCategoryWithAi(input: AiInput): Promise<AiSuggestion | null> {
  if (!env.AI_CATEGORY_ENABLED || !env.OPENAI_API_KEY) {
    return null;
  }

  const all = listCategoriesForHousehold(input.householdId);
  const categories = all
    .filter((c) => !categoryHasChildren(c.id))
    .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));

  const body = {
    model: env.OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You classify bank transaction descriptions into existing categories. Prefer an existing category id whenever reasonable. Return strict JSON only."
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Assign category for one transaction.",
          transactionId: input.transactionId,
          transaction: {
            normalizedDescription: input.normalizedDescription,
            signedAmount: input.signedAmount,
            direction: input.signedAmount >= 0 ? "credit" : "debit"
          },
          categories,
          expectedJsonSchema: {
            suggestedCategoryId: "string|null",
            confidence: "number(0..1)",
            suggestedNewCategoryName: "string|null",
            reason: "short string"
          }
        })
      }
    ]
  };

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
      return null;
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    const parsed = normalizeAiSuggestion(JSON.parse(content) as unknown);
    if (!parsed) {
      return null;
    }
    if (parsed.suggestedCategoryId) {
      if (
        !categoryUsableByHousehold(parsed.suggestedCategoryId, input.householdId) ||
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
  } catch {
    return null;
  }
}

