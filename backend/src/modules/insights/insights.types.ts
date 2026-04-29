export type InsightScope = "household" | "personal";

export type FinancialHealthRating = "strong" | "on_track" | "needs_attention" | "at_risk";

export interface InsightPayload {
  healthRating: FinancialHealthRating;
  healthRationale: string;
  localBenchmark: string;
  nationalBenchmark: string;
  whatsWorking: string[];
  concerns: string[];
  spendingAnalysis: string[];
  investmentGaps: string[];
  nextSteps: string[];
}

export interface InsightRecord {
  id: string;
  householdId: string;
  scope: InsightScope;
  userId: string | null;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  payload: InsightPayload;
}

export interface InsightJob {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  insightId: string | null;
  errorText: string | null;
  createdAt: string;
  completedAt: string | null;
}
