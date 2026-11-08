import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: same-origin /api via proxy to Django (no CORS, cookies and CSRF behave as in production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.VITE_API_TARGET ?? "http://localhost:8000" },
  },
});
