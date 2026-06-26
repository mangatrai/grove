import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.VITE_PROXY_API ?? "http://127.0.0.1:4000";

export default defineConfig({
  // Load root `.env` so `FRONTEND_PORT`, `VITE_*`, etc. match backend when using `npm run dev:frontend` from the monorepo.
  envDir: path.resolve(__dirname, ".."),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    host: true,
    port: Number(process.env.FRONTEND_PORT ?? 3000),
    proxy: {
      "/auth": api,
      "/categories": api,
      "/imports": api,
      "/payslips": api,
      "/transactions": api,
      "/resolution": api,
      "/reports": api,
      "/health": api,
      "/household": api,
      "/exports": api,
      "/gdrive": api,
      "/gcal": api,
      "/api/family": api,
      "/budget": api,
      "/recurring-overrides": api,
      "/insights": api,
      "/notifications": api,
      // ESPP API only — do not proxy bare `/espp` (same path as the React route).
      "/espp/stock-quote": api,
      "/espp/batches": api,
      "/espp/summary": api,
      "/espp/import": api,
      "/espp/sales": api,
      "/api": api
    }
  }
});
