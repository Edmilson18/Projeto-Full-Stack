import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Os módulos rodam no Node: SQLite, crypto, fs.
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testes/preparacao.ts"],

    // Um único banco SQLite não tolera vários processos gravando ao mesmo
    // tempo. No Vitest 4+ o `singleFork` virou `maxWorkers: 1`.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,

    // Isola do banco de desenvolvimento. O arquivo é recriado a cada execução,
    // em src/testes/preparacao.ts.
    env: {
      NODE_ENV: "test",
      DATABASE_FILE: ".cache/teste.db",
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
