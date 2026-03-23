import express from "express";

import { authRouter } from "./modules/auth/auth.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";

export function buildApp() {
  const app = express();

  app.use(express.json());
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);

  return app;
}
