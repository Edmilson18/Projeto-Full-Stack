import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const raizProjeto = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, raizProjeto, "VITE_");
  const apiUrl = process.env.VITE_API_URL ?? env.VITE_API_URL ?? "http://localhost:3000";

  return {
    envDir: raizProjeto,
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      host: "0.0.0.0",
      proxy: {
        // A API sobe em outro processo. A URL pode ser configurada via VITE_API_URL.
        "/api": {
          target: apiUrl,
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
  };
});
