import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.VITE_PROXY_API ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: Number(process.env.FRONTEND_PORT ?? 3000),
    proxy: {
      "/auth": api,
      "/imports": api,
      "/transactions": api,
      "/health": api
    }
  }
});
