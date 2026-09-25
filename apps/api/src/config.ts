import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as carregarEnv } from "dotenv";

// Três níveis acima: `src/` -> `apps/api/` -> `apps/` -> raiz do repositório.
// Funciona igual compilado, porque `dist/` fica na mesma profundidade que `src/`.
// Com apenas um `..` o caminho resolveria para `apps/api`, e o servidor não
// acharia o `.env` nem o `database/`.
const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
  /** Build do frontend, servido pelo Node em producao. */
  dist: path.join(raizProjeto, "apps", "web", "dist"),
  /** Painéis antigos, que o `admin.html` e o `dashboard.html` ainda carregam. */
  buildLegado: path.join(raizProjeto, "build"),
  raiz: raizProjeto,
  /**
   * Assinatura dos cookies. Ausente em desenvolvimento, onde não é preciso:
   * `signed: false` no cookie, mas o valor precisa existir para o plugin não
   * recusar a inicialização.
   */
  cookieSecret: process.env.COOKIE_SECRET ?? "desenvolvimento-sem-assinatura",
};

export const ehTeste = process.env.NODE_ENV === "test";
