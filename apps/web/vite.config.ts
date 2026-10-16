import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const raizProjeto = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, raizProjeto, "VITE_");
  const apiUrl = process.env.VITE_API_URL ?? env.VITE_API_URL ?? "http://localhost:3000";

  return {
    envDir: raizProjeto,
    // A URL da API é usada só pelo proxy de desenvolvimento acima. O bundle
    // do navegador não precisa receber valores personalizados do ambiente.
    envPrefix: [],
    // O .env local pode definir NODE_ENV=development; fixe a versão de React
    // para produção no bundle gerado pelo comando `vite build`.
    define: {
      "process.env.NODE_ENV": JSON.stringify(command === "build" ? "production" : "development"),
    },
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
      sourcemap: false,
    },
  };
});
