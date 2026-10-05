import { ambiente } from "./config.js";
import { obterPool, fecharPool } from "./postgres.js";

/**
 * Apaga o schema público inteiro e recria.
 *
 * Existe para o ciclo de desenvolvimento, onde o banco é descartável. Nunca
 * rode isto apontando para produção: não há confirmação e a operação é
 * irreversível.
 *
 * A verificação de segurança tem duas etapas:
 * 1. O alvo precisa ser um banco local, sempre — não só em produção. Um
 *    `DATABASE_URL` apontando para o Neon de produção não deve ser apagado nem
 *    em `NODE_ENV=development`.
 * 2. Em produção, exige também `ALLOW_DB_RESET=true`.
 *
 * `ambiente` vem de `config.js`, que é quem carrega o `.env`. Ler
 * `process.env` direto aqui dependeria de outro módulo ter importado `config`
 * antes: como o valor do `.env` só existe depois do `dotenv`, a guarda
 * rodaria sobre um ambiente vazio e passaria.
 */
const isLocalhost = ambiente.databaseUrl.includes("localhost") || ambiente.databaseUrl.includes("127.0.0.1");

if (!isLocalhost) {
  console.error("db:reset só pode rodar contra um banco local.");
  process.exit(1);
}
if (ambiente.producao && process.env.ALLOW_DB_RESET !== "true") {
  console.error("db:reset em produção exige ALLOW_DB_RESET=true.");
  process.exit(1);
}

const pool = obterPool();
await pool.query("DROP SCHEMA public CASCADE");
await pool.query("CREATE SCHEMA public");
console.log("Schema apagado. Rode `npm run db:setup` para recriar.");
await fecharPool();
