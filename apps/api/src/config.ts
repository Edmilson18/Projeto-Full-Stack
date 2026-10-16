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
  proxiesConfiaveis: (process.env.TRUSTED_PROXIES ?? "")
    .split(",")
    .map((proxy) => proxy.trim())
    .filter(Boolean),
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
  raiz: raizProjeto,
  /**
   * A sessão não usa assinatura de cookie, e `COOKIE_SECRET` foi removido.
   *
   * O valor do cookie é um token de 32 bytes aleatórios, e o banco guarda
   * somente o SHA-256 dele: um cookie forjado não tem como casar com a base.
   * Assinar o cookie por cima acrescentaria uma chave a proteger e rotacionar
   * sem fechar nenhuma brecha, enquanto a variável continuava sendo exigida em
   * produção — ou seja, um segredo que não protegia nada e ainda podia derrubar
   * o boot por estar faltando ou vir do placeholder do compose.
   */
};
