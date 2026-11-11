/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: same-origin /api via proxy to Django (no CORS, cookies and CSRF behave as in production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The e2e stack reaches the dev server as http://frontend:5173 (docker-compose.e2e.yml).
    allowedHosts: process.env.VITE_ALLOWED_HOSTS ? process.env.VITE_ALLOWED_HOSTS.split(",") : [],
    proxy: { "/api": process.env.VITE_API_TARGET ?? "http://localhost:8000" },
  },
  // Unit tests for pure logic only (no DOM); browser flows are Playwright (e2e/).
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
