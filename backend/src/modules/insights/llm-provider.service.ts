import { z } from "zod";

import { getChatAdapter, chatModel } from "../../llm/index.js";
import { log } from "../../logger.js";
import type { InsightPayload } from "./insights.types.js";

const PROMPT_VERSION = "v1.2";

export { PROMPT_VERSION };

const insightPayloadSchema = z.object({
  healthRating: z.enum(["strong", "on_track", "needs_attention", "at_risk"]),
  healthRationale: z.string(),
  localBenchmark: z.string(),
  nationalBenchmark: z.string(),
  whatsWorking: z.array(z.string()),
  concerns: z.array(z.string()),
  spendingAnalysis: z.array(z.string()),
  investmentGaps: z.array(z.string()),
  nextSteps: z.array(z.string())
});

function parseInsightPayload(raw: string): InsightPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("LLM returned non-JSON");
  }
  const out = insightPayloadSchema.safeParse(parsed);
  if (!out.success) {
    // Attempt to extract JSON object from response (Anthropic sometimes wraps in prose)
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const out2 = insightPayloadSchema.safeParse(JSON.parse(match[0]));
      if (out2.success) return out2.data;
    }
    throw new Error(`LLM JSON shape invalid: ${out.error.message}`);
  }
  return out.data;
}

function buildSystemPrompt(): string {
  return `You are a personal finance advisor AI. You will receive a structured summary of a household's financial data.
Your job is to produce a structured financial health analysis.

IMPORTANT:
- You never receive names, account numbers, or transaction descriptions — only aggregated totals and category averages.
- Base demographic benchmarks on your knowledge of US personal finance norms for the stated age, income, city and state.
- Provide local (city/state) AND national benchmarks separately.
- Be specific and actionable. Avoid generic advice.
- Return ONLY valid JSON matching the schema below. No prose outside the JSON.

Key field definitions in the input:
- avgMonthlyInflow: take-home income only (Income category transactions).
- avgMonthlyLifestyleSpend: discretionary lifestyle categories (shopping, food, home, etc.) — excludes loan payments.
- avgMonthlyCommittedExpenses: loan obligations (mortgage, auto, HELOC) — cannot be easily reduced.
- cashBufferRate: (income - lifestyle - committed) / income — fraction left after all obligations.
- topCategories: lifestyle spend only; loan and investment categories are reported separately.
- investmentPortfolioTrend: total investment/retirement/HSA/529 balances by month. Month-over-month changes reflect BOTH contributions and market movements — do not assume all changes are due to new contributions.
- avgMonthlyCommittedExpenses includes a "Loans > Personal" subcategory which represents informal cash lending to friends or family (not a bank loan). These outflows will be offset by repayment inflows in a future month and net to zero over time. Do not treat a spike in this category as increased debt burden or discretionary overspending — it is a temporary receivable.

Output JSON schema:
{
  "healthRating": "strong" | "on_track" | "needs_attention" | "at_risk",
  "healthRationale": string,
  "localBenchmark": string,
  "nationalBenchmark": string,
  "whatsWorking": string[],
  "concerns": string[],
  "spendingAnalysis": string[],
  "investmentGaps": string[],
  "nextSteps": string[]
}`;
}

function buildUserPrompt(input: object): string {
  return `Household financial summary:\n${JSON.stringify(input, null, 2)}\n\nProvide the financial health analysis as JSON.`;
}

/**
 * Sends the assembled financial context to the configured LLM provider.
 * Returns structured InsightPayload. Throws on timeout or provider error.
 */
export async function generateInsight(promptInput: object): Promise<InsightPayload> {
  const adapter = getChatAdapter();
  const { content } = await adapter.complete(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(promptInput) },
    ],
    { model: chatModel(), maxTokens: 2000 }
  );
  if (!content) throw new Error("LLM returned empty content");
  return parseInsightPayload(content);
}
