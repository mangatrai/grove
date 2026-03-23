import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default("4000"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  SEED_OWNER_EMAIL: z.string().email().default("owner@example.com"),
  SEED_OWNER_PASSWORD: z.string().min(8).default("ChangeMe123!")
});

export const env = envSchema.parse(process.env);
