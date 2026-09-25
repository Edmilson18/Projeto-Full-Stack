import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as carregarEnv } from "dotenv";

// Três níveis acima: `src/` -> `apps/api/` -> `apps/` -> raiz do repositório.
// Funciona igual compilado, porque `dist/` fica na mesma profundidade que `src/`.
const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// O dotenv é carregado aqui, e não em quem importa, porque o ESM avalia os
// módulos importados antes do corpo de quem importa. Se ficasse no entrypoint,
// qualquer módulo que lesse process.env no topo veria um ambiente vazio.
carregarEnv({ path: path.join(raizProjeto, ".env") });

export const ambiente = {
  producao: process.env.NODE_ENV === "production",
  porta: Number(process.env.PORT ?? 3000),

  /**
   * Schema do PostgreSQL a usar. O padrão é `public`.
   *
   * A suíte aponta para um schema próprio, criado e apagado a cada execução.
   * Isso precisa estar aqui, e não no pool de teste, porque `obterPool()` é o
   * mesmo que o código de produção usa: se o `search_path` ficasse só no pool
   * de teste, qualquer função de `database.ts` — que chama `obterPool()` —
   * escreveria no schema de desenvolvimento.
   */
  schema: process.env.DATABASE_SCHEMA ?? "public",

  /** Conexão do PostgreSQL. Em desenvolvimento vem do docker-compose. */
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://loja:loja_local_dev@localhost:5433/loja",
  /** TLS é obrigatório em produção: o Neon só aceita conexão criptografada. */
  databaseSsl: process.env.DATABASE_SSL === "true",

  /** Build do frontend, servido pelo Node em produção. */
  dist: path.join(raizProjeto, "apps", "web", "dist"),
  /**
   * Origem do frontend em produção, usada na verificação de `Origin` das rotas
   * que alteram dados. Sem isso, um site terceiro poderia disparar um POST
   * autenticado pela sessão do usuário.
   */
  origemPermitida: process.env.APP_URL ?? "http://localhost:3000",
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
