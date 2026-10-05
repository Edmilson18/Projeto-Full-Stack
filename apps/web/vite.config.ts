import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_URL = process.env.VITE_API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      // A API sobe em outro processo. A URL pode ser configurada via VITE_API_URL.
      "/api": {
        target: API_URL,
        changeOrigin: true,
        cookieDomainRewrite: "localhost",
      },
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
