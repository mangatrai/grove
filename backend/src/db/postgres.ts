import postgres from "postgres";

import { env } from "../config/env.js";

export function createPostgres() {
  return postgres({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    max: 10,
    ssl: env.DATABASE_SSL ? "require" : false
  });
}
