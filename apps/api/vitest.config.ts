import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integração com PostgreSQL e módulos nativos do Node.
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testes/preparacao.ts"],

    // Mantém o consumo de conexões previsível durante as suítes de integração.
    // Cenários concorrentes são coordenados dentro de cada teste.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,

    // Isola do banco de desenvolvimento: o schema de teste é criado e apagado
    // a cada execução, em src/testes/preparacao.ts.
    env: {
      NODE_ENV: "test",
      ADMIN_PASSWORD: "admin123",
      TRUSTED_PROXIES: "",
    },

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/testes/**"],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
