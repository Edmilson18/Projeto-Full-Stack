import { obterPool, fecharPool } from "./postgres.js";

/**
 * Apaga o schema público inteiro e recria.
 *
 * Existe para o ciclo de desenvolvimento, onde o banco é descartável. Nunca
 * rode isto apontando para produção: não há confirmação e a operação é
 * irreversível.
 */
const url = process.env.DATABASE_URL ?? "";
if (!url.includes("localhost") && !url.includes("127.0.0.1") && process.env.NODE_ENV === "production") {
  console.error("db:reset só pode rodar contra um banco local.");
  process.exit(1);
}

const pool = obterPool();
await pool.query("DROP SCHEMA public CASCADE");
await pool.query("CREATE SCHEMA public");
console.log("Schema apagado. Rode `npm run db:setup` para recriar.");
await fecharPool();
