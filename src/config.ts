import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as carregarEnv } from "dotenv";

const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// O dotenv e carregado aqui, e nao em quem importa, porque o ESM avalia os
// modulos importados antes do corpo de quem importa. Se ficasse em server.ts,
// qualquer modulo que lesse process.env no topo do arquivo veria um ambiente
// vazio.
carregarEnv({ path: path.join(raizProjeto, ".env") });

const bancoPadrao = path.join(raizProjeto, "database", "loja.db");

export const ambiente = {
  producao: process.env.NODE_ENV === "production",
  porta: Number(process.env.PORT ?? 3000),
  /** Caminho do arquivo SQLite. Redirecionavel para isolar testes. */
  banco: process.env.DATABASE_FILE ? path.resolve(raizProjeto, process.env.DATABASE_FILE) : bancoPadrao,
  /** O schema versionado nunca muda com o ambiente; e a fonte do seed. */
  schema: path.join(raizProjeto, "database", "schema.sql"),
  dist: path.join(raizProjeto, "dist"),
  raiz: raizProjeto,
};

export const ehTeste = process.env.NODE_ENV === "test";
