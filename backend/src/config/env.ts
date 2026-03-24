import dotenv from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

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
  SEED_OWNER_PASSWORD: z.string().min(8).default("ChangeMe123!")
});

export const env = envSchema.parse(process.env);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
