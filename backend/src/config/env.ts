import dotenv from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

/** Integer env with default; empty or invalid falls back to `defaultVal`. */
function optionalIntEnv(defaultVal: number, min: number, max: number) {
  return z.preprocess(
    (val: unknown) => {
      if (val === undefined || val === "") return defaultVal;
      const n = Number(val);
      return Number.isFinite(n) ? Math.trunc(n) : defaultVal;
    },
    z.number().int().min(min).max(max)
  );
}

function optionalFloatEnv(defaultVal: number, min: number, max: number) {
  return z.preprocess(
    (val: unknown) => {
      if (val === undefined || val === "") return defaultVal;
      const n = Number(val);
      return Number.isFinite(n) ? n : defaultVal;
    },
    z.number().min(min).max(max)
  );
}

function optionalBoolEnv(defaultVal: boolean) {
  return z.preprocess((val: unknown) => {
    if (val === undefined || val === "") return defaultVal;
    const s = String(val).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return defaultVal;
  }, z.boolean());
}

const envSchema = z.object({
  PORT: z.string().default("4000"),
  MODE: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["TEST", "PROD"]))
    .default("TEST"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars").default("local-dev-jwt-secret-change-me"),
  DATABASE_HOST: z.string().min(1, "DATABASE_HOST is required"),
  DATABASE_PORT: optionalIntEnv(5432, 1, 65535),
  DATABASE_USER: z.string().min(1, "DATABASE_USER is required"),
  DATABASE_PASSWORD: z.string().default(""),
  DATABASE_NAME: z.string().min(1, "DATABASE_NAME is required"),
  /** Set false for local Postgres without TLS (e.g. docker-compose on localhost). */
  DATABASE_SSL: optionalBoolEnv(true),
  /** Minimum `transferPairScore` to auto-assign `transfer_group_id` on a mutual 1:1 amount/date match. */
  TRANSFER_MIN_AUTO_PAIR_SCORE: optionalIntEnv(45, 0, 100),
  /** Multi-candidate: narrow if best score ≥ this and runner-up is below best by at least the gap. */
  TRANSFER_DISAMBIG_STRONG_MIN_SCORE: optionalIntEnv(70, 0, 100),
  TRANSFER_DISAMBIG_STRONG_GAP: optionalIntEnv(20, 0, 100),
  /** Multi-candidate: weaker narrow if best ≥ this and runner-up score is below this ceiling. */
  TRANSFER_DISAMBIG_WEAK_MIN_SCORE: optionalIntEnv(45, 0, 100),
  TRANSFER_DISAMBIG_WEAK_MAX_SECOND_SCORE: optionalIntEnv(25, 0, 100),
  AI_CATEGORY_ENABLED: optionalBoolEnv(false),
  /** Max transactions per OpenAI chat request when batching categorization (1–128). */
  AI_CATEGORY_BATCH_SIZE: optionalIntEnv(28, 1, 128),
  /** Concurrent OpenAI requests for different chunks of the same AI run (1–8). Use 1 to avoid rate limits. */
  AI_CATEGORY_MAX_PARALLEL: optionalIntEnv(1, 1, 8),
  AI_CATEGORY_AUTO_APPLY_MIN: optionalFloatEnv(0.9, 0, 1),
  AI_CATEGORY_REVIEW_MIN: optionalFloatEnv(0.6, 0, 1),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  /**
   * Minimum severity emitted to stdout/stderr (`debug` = most verbose, `silent` = none).
   * Used by `backend/src/logger.ts`; set in repo root `.env`.
   */
  LOG_LEVEL: z.preprocess(
    (val: unknown) => {
      if (val === undefined || val === "") return "info";
      return String(val).trim().toLowerCase();
    },
    z.enum(["debug", "info", "warn", "error", "silent"])
  ),
  /** Optional repo-relative or absolute path; append timestamped lines (tee with stdout/stderr). Empty = file sink off. */
  LOG_FILE: z.preprocess((val: unknown) => {
    if (val === undefined || val === "") return undefined;
    const s = String(val).trim();
    return s === "" ? undefined : s;
  }, z.string().optional()),
  /** Max characters logged per debug line for OpenAI request/response bodies (`LOG_LEVEL=debug`). */
  LOG_AI_DEBUG_BODY_MAX_CHARS: optionalIntEnv(4000, 200, 50_000),
  /** Unstructured Platform API (Jobs). Deloitte payslip PDFs require `UNSTRUCTURED_API_KEY` set. */
  UNSTRUCTURED_API_KEY: z.string().optional(),
  UNSTRUCTURED_API_URL: z.string().default("https://platform.unstructuredapp.io/api/v1"),
  /** Min milliseconds between Unstructured job status polls per file (default 2 min). */
  UNSTRUCTURED_POLL_INTERVAL_MS: optionalIntEnv(120_000, 10_000, 3_600_000),
  /** Min milliseconds between background polls for async LLM payslip import (default 2 min). */
  PAYSLIP_ASYNC_POLL_INTERVAL_MS: optionalIntEnv(120_000, 10_000, 3_600_000),
  /** Jobs API `request_data.template_id` for Deloitte payslips. */
  UNSTRUCTURED_DELOITTE_TEMPLATE_ID: z.string().default("hi_res_and_enrichment")
});

export const env = envSchema.parse(process.env);

function resolveConfiguredPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(repoRoot, filePath);
}

/** Absolute path for on-disk log append, or `undefined` if `LOG_FILE` is unset. */
export function resolveLogFilePath(): string | undefined {
  if (!env.LOG_FILE?.trim()) {
    return undefined;
  }
  return resolveConfiguredPath(env.LOG_FILE.trim());
}
