import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the local backend so VITE_API_URL can stay empty.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.DEV_BACKEND_URL || "http://localhost:4000", changeOrigin: true } },
  },
});
