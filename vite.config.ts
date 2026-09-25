import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  test: {
    // Os módulos de src/ rodam no Node (SQLite, crypto, fs), não no browser.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/testes/preparacao.ts"],

    // Um único banco SQLite não tolera vários processos gravando ao mesmo tempo.
    // No Vitest 4+ o `singleFork` virou `maxWorkers: 1`; `poolOptions` foi
    // removido e todas as opções passaram a ser de primeiro nível.
    // O `isolate` fica no padrão (true) de propósito: com `false`, o arquivo de
    // setup roda uma vez por arquivo mas o módulo de banco é compartilhado, e o
    // arquivo SQLite fica aberto no processo e o `rmSync` leva EPERM.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,

    // Isola o teste do banco local de desenvolvimento. O arquivo e recriado a
    // cada execucao, em src/testes/preparacao.ts.
    env: {
      NODE_ENV: "test",
      DATABASE_FILE: ".tmp/teste.db",
    },

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/testes/**", "src/main.tsx"],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
