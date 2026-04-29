import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { assembleHouseholdPromptInput, assemblePersonalPromptInput } from "./insight-prompt.service.js";
import { generateInsight, PROMPT_VERSION } from "./llm-provider.service.js";
import type { InsightJob, InsightPayload, InsightRecord, InsightScope } from "./insights.types.js";

type ServiceOk<T> = { ok: true; data: T };
type ServiceErr = { ok: false; code: string; message: string };
type ServiceResult<T> = ServiceOk<T> | ServiceErr;

type InsightRow = {
  id: string;
  household_id: string;
  scope: InsightScope;
  user_id: string | null;
  generated_at: Date | string;
  provider: string;
  model: string;
  prompt_version: string;
  payload_json: InsightPayload | string | Record<string, unknown>;
};

type JobRow = {
  id: string;
  status: InsightJob["status"];
  insight_id: string | null;
  error_text: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  household_id: string;
  scope: InsightScope;
  target_user_id: string | null;
};

function rowToRecord(row: InsightRow): InsightRecord {
  const payload =
    typeof row.payload_json === "string"
      ? (JSON.parse(row.payload_json) as InsightPayload)
      : (row.payload_json as InsightPayload);
  const genAt =
    row.generated_at instanceof Date ? row.generated_at.toISOString() : String(row.generated_at);
  return {
    id: row.id,
    householdId: row.household_id,
    scope: row.scope,
    userId: row.user_id,
    generatedAt: genAt,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    payload
  };
}

function jobRowToJob(row: JobRow): InsightJob {
  return {
    id: row.id,
    status: row.status,
    insightId: row.insight_id,
    errorText: row.error_text,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    completedAt:
      row.completed_at == null
        ? null
        : row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : String(row.completed_at)
  };
}

function scopeUserClause(scope: InsightScope, userId: string | null): { sql: string; params: unknown[] } {
  if (scope === "household") {
    return { sql: " AND scope = 'household' AND user_id IS NULL ", params: [] };
  }
  return { sql: " AND scope = 'personal' AND user_id = ? ", params: [userId] };
}

export async function getLatestInsight(
  householdId: string,
  scope: InsightScope,
  userId: string | null
): Promise<ServiceResult<InsightRecord | null>> {
  const { sql, params } = scopeUserClause(scope, userId);
  const row = await qGet<InsightRow>(
    `SELECT id, household_id, scope, user_id, generated_at, provider, model, prompt_version, payload_json
       FROM household_ai_insight
      WHERE household_id = ?
        ${sql}
      ORDER BY generated_at DESC
      LIMIT 1`,
    householdId,
    ...params
  );
  return { ok: true, data: row ? rowToRecord(row) : null };
}

export async function listInsightHistory(
  householdId: string,
  scope: InsightScope,
  userId: string | null,
  limit = 20,
  offset = 0
): Promise<ServiceResult<InsightRecord[]>> {
  const { sql, params } = scopeUserClause(scope, userId);
  const rows = await qAll<InsightRow>(
    `SELECT id, household_id, scope, user_id, generated_at, provider, model, prompt_version, payload_json
       FROM household_ai_insight
      WHERE household_id = ?
        ${sql}
      ORDER BY generated_at DESC
      LIMIT ? OFFSET ?`,
    householdId,
    ...params,
    limit,
    offset
  );
  return { ok: true, data: rows.map(rowToRecord) };
}

export async function getInsightById(householdId: string, id: string): Promise<ServiceResult<InsightRecord>> {
  const row = await qGet<InsightRow>(
    `SELECT id, household_id, scope, user_id, generated_at, provider, model, prompt_version, payload_json
       FROM household_ai_insight
      WHERE household_id = ? AND id = ?
      LIMIT 1`,
    householdId,
    id
  );
  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Insight not found" };
  }
  return { ok: true, data: rowToRecord(row) };
}

export async function enqueueInsightJob(
  householdId: string,
  requestedByUserId: string,
  scope: InsightScope,
  targetUserId: string | null
): Promise<ServiceResult<string>> {
  const id = randomUUID();
  await qExec(
    `INSERT INTO insight_job (id, household_id, requested_by_user_id, scope, target_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    householdId,
    requestedByUserId,
    scope,
    targetUserId
  );
  return { ok: true, data: id };
}

export async function getInsightJob(householdId: string, jobId: string): Promise<ServiceResult<InsightJob>> {
  const row = await qGet<JobRow>(
    `SELECT id, status, insight_id, error_text, created_at, completed_at, household_id, scope, target_user_id
       FROM insight_job
      WHERE id = ? AND household_id = ?
      LIMIT 1`,
    jobId,
    householdId
  );
  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Job not found" };
  }
  return { ok: true, data: jobRowToJob(row) };
}

export async function runInsightJob(jobId: string, householdId: string): Promise<void> {
  const updated = await qGet<{ id: string }>(
    `UPDATE insight_job SET status = 'running' WHERE id = ? AND household_id = ? AND status = 'queued' RETURNING id`,
    jobId,
    householdId
  );
  if (!updated) {
    const existing = await qGet<{ status: string }>(
      `SELECT status FROM insight_job WHERE id = ? AND household_id = ?`,
      jobId,
      householdId
    );
    if (!existing) {
      log.warn("insight job missing or wrong household", { jobId, householdId });
    }
    return;
  }

  try {
    const job = await qGet<{
      scope: InsightScope;
      target_user_id: string | null;
    }>(`SELECT scope, target_user_id FROM insight_job WHERE id = ? AND household_id = ?`, jobId, householdId);
    if (!job) {
      throw new Error("Job not found");
    }

    const input =
      job.scope === "household"
        ? await assembleHouseholdPromptInput(householdId)
        : await assemblePersonalPromptInput(householdId, job.target_user_id as string);

    const payload = await generateInsight(input);

    const insightId = randomUUID();
    const model = env.LLM_PROVIDER === "anthropic" ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL;
    await qExec(
      `INSERT INTO household_ai_insight
         (id, household_id, scope, user_id, provider, model, prompt_version, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB))`,
      insightId,
      householdId,
      job.scope,
      job.target_user_id ?? null,
      env.LLM_PROVIDER,
      model,
      PROMPT_VERSION,
      JSON.stringify(payload)
    );

    await qExec(
      `UPDATE insight_job SET status = 'complete', insight_id = ?, completed_at = NOW() WHERE id = ? AND household_id = ?`,
      insightId,
      jobId,
      householdId
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("insight generation failed", { jobId, err: msg });
    await qExec(
      `UPDATE insight_job SET status = 'failed', error_text = ?, completed_at = NOW() WHERE id = ? AND household_id = ?`,
      msg,
      jobId,
      householdId
    );
  }
}
