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

const envSchema = z.object({
  PORT: z.string().default("4000"),
  MODE: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["TEST", "PROD"]))
    .default("TEST"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars").default("local-dev-jwt-secret-change-me"),
  DB_PATH: z.string().optional(),
  DB_PATH_TEST: z.string().default("./data/household-finance-test.sqlite"),
  DB_PATH_PROD: z.string().default("./data/household-finance-prod.sqlite"),
  SEED_OWNER_EMAIL: z.string().email().default("owner@example.com"),
  SEED_OWNER_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  /** Minimum `transferPairScore` to auto-assign `transfer_group_id` on a mutual 1:1 amount/date match. */
  TRANSFER_MIN_AUTO_PAIR_SCORE: optionalIntEnv(45, 0, 100),
  /** Multi-candidate: narrow if best score ≥ this and runner-up is below best by at least the gap. */
  TRANSFER_DISAMBIG_STRONG_MIN_SCORE: optionalIntEnv(70, 0, 100),
  TRANSFER_DISAMBIG_STRONG_GAP: optionalIntEnv(20, 0, 100),
  /** Multi-candidate: weaker narrow if best ≥ this and runner-up score is below this ceiling. */
  TRANSFER_DISAMBIG_WEAK_MIN_SCORE: optionalIntEnv(45, 0, 100),
  TRANSFER_DISAMBIG_WEAK_MAX_SECOND_SCORE: optionalIntEnv(25, 0, 100)
});

export const env = envSchema.parse(process.env);

function resolveConfiguredPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(repoRoot, filePath);
}

export function resolveDbPath(): string {
  if (env.DB_PATH) {
    return resolveConfiguredPath(env.DB_PATH);
  }
  if (env.MODE === "PROD") {
    return resolveConfiguredPath(env.DB_PATH_PROD);
  }
  return resolveConfiguredPath(env.DB_PATH_TEST);
}
