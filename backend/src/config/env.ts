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

/** Float env with default; empty or invalid falls back to `defaultVal`. */
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
  /** IANA timezone for wall-clock schedulers and log timestamps. Must match Koyeb env var. */
  TZ: z.string().default("America/Chicago"),
  MODE: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["TEST", "PROD"]))
    .default("TEST"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars").default("local-dev-jwt-secret-do-not-use-in-prod-change-me!"),
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
  /**
   * Restrict CORS to this origin in PROD mode (e.g. https://finance.example.com).
   * Leave unset in TEST/dev — the API will allow all origins.
   * If unset in PROD the API sends no Allow-Origin header (browser requests blocked).
   */
  ALLOWED_ORIGIN: z.string().url().optional().or(z.literal("")),
  OPENAI_API_KEY: z.string().optional(),
  /** Fast/cheap model — payslip vision extraction, insights, summarization. */
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  /** Capable model for vision, agentic loops, and complex generation. */
  OPENAI_STRONG_MODEL: z.string().default("gpt-4o"),
  BACKUP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)")
    .optional(),
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Fast/cheap Anthropic model for one-shot completions. */
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  /** Capable Anthropic model for vision, agentic loops, and complex generation. */
  ANTHROPIC_STRONG_MODEL: z.string().default("claude-sonnet-5"),
  /** Embedding provider — independent of LLM_PROVIDER (Voyage AI, Cohere, etc. may differ). */
  EMBEDDING_PROVIDER: z.string().default("openai"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: optionalIntEnv(587, 1, 65535),
  SMTP_SECURE: optionalBoolEnv(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().optional().or(z.literal("")),
  /**
   * FIX #215: household inbox email ingestion — dedicated household Gmail account, IMAP + App
   * Password. Deliberately NOT routed through the per-parent Google OAuth integration
   * (`oauth_integrations`, used for Calendar/Drive) — see ADMIN_GUIDE for rationale.
   * Reuses `SMTP_USER`/`SMTP_PASS` for auth — the dedicated household mailbox's Gmail App
   * Password is the same credential already configured for SMTP send, so IMAP only needs the
   * protocol-specific bits (host/port/secure/folder actually differ from SMTP's).
   */
  FAMILY_INBOX_IMAP_HOST: z.string().optional(),
  FAMILY_INBOX_IMAP_PORT: optionalIntEnv(993, 1, 65535),
  FAMILY_INBOX_IMAP_SECURE: optionalBoolEnv(true),
  /** Gmail label mapped as an IMAP folder (defense-in-depth: only this folder is ever queried). */
  FAMILY_INBOX_IMAP_FOLDER: z.string().default("INBOX"),
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
  /** Min milliseconds between background polls for async LLM payslip import (default 2 min). */
  PAYSLIP_ASYNC_POLL_INTERVAL_MS: optionalIntEnv(120_000, 10_000, 3_600_000),
  /** Max inclusive span (days) for `GET /reports/cash-summary` when `dateFrom`+`dateTo` are set. Default ~3 years. */
  CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS: optionalIntEnv(1096, 31, 4000),
  /** Google OAuth2 (Drive + Calendar) — optional; required for GDrive connect / backup / Calendar OAuth. */
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  /** Full redirect URI registered in Google Cloud Console for Drive, e.g. http://localhost:4000/gdrive/oauth/callback */
  GOOGLE_REDIRECT_URI: z.string().default(""),
  /** Full redirect URI registered in Google Cloud Console for Calendar, e.g. http://localhost:4000/gcal/oauth/callback */
  GOOGLE_CALENDAR_REDIRECT_URI: z.string().default(""),
  /**
   * SPA origin for Google Drive OAuth return redirects when the API and UI differ (e.g. http://localhost:3000).
   * If unset: uses `PUBLIC_BASE_URL` when set; in `MODE=TEST` defaults to `http://localhost:3000`; in `MODE=PROD`
   * with neither set, redirects are relative to the API host (same-origin deployments only).
   */
  FRONTEND_APP_URL: z.string().default(""),
  /** RealtyAPI key for Redfin property valuation (D-2). Optional — feature degrades to manual if absent. */
  REALTY_API_KEY: z.string().optional(),
  /** Tavily search API key for AI protest assistant web search (PT-3). Optional — search_web tool disabled if absent. */
  TAVILY_API_KEY: z.string().optional(),
  /**
   * PA agent task loop (#164): max non-failed pa_task_run rows per household per calendar month.
   * Run-count ceiling chosen over a dollar ceiling — no price-table maintenance, predictable for the user.
   * At cap, runPATask() writes a refused_budget row and returns PA_BUDGET_EXCEEDED.
   */
  PA_TASK_MAX_RUNS_PER_MONTH: optionalIntEnv(60, 1, 10000),
  /**
   * PA agent task loop (#167): max non-failed pa_task_run rows per household per calendar day.
   * Second, tighter ceiling on top of PA_TASK_MAX_RUNS_PER_MONTH — cheap insurance against a
   * runaway frontend bug or a curious family member triggering many research loops in a row.
   */
  PA_TASK_MAX_RUNS_PER_DAY: optionalIntEnv(20, 1, 10000),
  /**
   * #223 Phase 2: auto-enqueue a gift-research PA task when a GIFT-IDEAS (21-day) occasion
   * nudge fires. Off by default — opt-in, since it silently spends PA budget on the household's
   * behalf without a direct ask.
   */
  PA_OCCASION_RESEARCH_ENABLED: optionalBoolEnv(false),
  /**
   * OpenAI embedding model for pgvector RAG (protest document store).
   * Changing this requires a new migration (different vector dims) and full re-embed of all chunks.
   * Defaults to text-embedding-3-small (1536 dims).
   */
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  /**
   * Word count per RAG chunk (word-based sliding window with 40-word overlap).
   * Smaller = sharper retrieval on structured docs (tables, dollar amounts); larger = more context per hit.
   * Changing this only affects new uploads — existing stored chunks are not re-processed.
   */
  RAG_CHUNK_WORDS: optionalIntEnv(150, 30, 1000),
  /**
   * Safety truncation: max characters passed to the embedding API per chunk.
   * Should be >= RAG_CHUNK_WORDS * ~8 (avg chars/word). Default 1500 comfortably covers 150-word chunks.
   */
  EMBEDDING_MAX_INPUT_CHARS: optionalIntEnv(1500, 200, 32000),
  /** Number of nearest-neighbour chunks returned by vector similarity search. */
  RAG_TOP_K: optionalIntEnv(5, 1, 20),
  /** Cosine similarity floor; chunks below this score are filtered out (0–1). */
  RAG_MIN_SIMILARITY: optionalFloatEnv(0.65, 0, 1)
});

export const env = envSchema.parse(process.env);

if (
  env.MODE === "PROD" &&
  env.JWT_SECRET === "local-dev-jwt-secret-do-not-use-in-prod-change-me!"
) {
  throw new Error("JWT_SECRET must be set to a unique secret in PROD mode — do not use the default value");
}

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

export function isEmailConfigured(): boolean {
  const smtpHost = env.SMTP_HOST?.trim() ?? "";
  const smtpUser = env.SMTP_USER?.trim() ?? "";
  const smtpPass = env.SMTP_PASS?.trim() ?? "";
  const smtpFrom = env.SMTP_FROM?.trim() ?? "";
  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim() ?? "";
  return (
    smtpHost.length > 0 &&
    smtpUser.length > 0 &&
    smtpPass.length > 0 &&
    smtpFrom.length > 0 &&
    publicBaseUrl.length > 0
  );
}

/**
 * FIX #215: separate from isEmailConfigured() — this gates IMAP inbox polling, not SMTP send.
 * Reuses SMTP_USER/SMTP_PASS as the IMAP credentials (same dedicated household Gmail account's
 * App Password works for both protocols) — only the IMAP host needs to be set independently.
 */
export function isEmailIngestConfigured(): boolean {
  const host = env.FAMILY_INBOX_IMAP_HOST?.trim() ?? "";
  const user = env.SMTP_USER?.trim() ?? "";
  const pass = env.SMTP_PASS?.trim() ?? "";
  return host.length > 0 && user.length > 0 && pass.length > 0;
}
