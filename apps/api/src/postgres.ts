import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { ambiente } from "./config.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PASTA_MIGRACOES = path.join(RAIZ, "database", "migrations");

/**
 * Pool de conexões.
 *
 * O `pg` abre uma conexão TCP por requisição se deixado solto. Em serverless
 * isso estoura o limite de conexões do Postgres, porque cada instância fria
 * criaria a sua. O pool mantém um número fixo e reutiliza.
 *
 * Em Vercel, que é o alvo de deploy, é preciso usar o driver HTTP do Neon
 * (`@neondatabase/serverless`) em vez deste: o pool TCP não sobrevive ao
 * ambiente serverless. Ver docs/adr/005-banco-postgresql-neon.md.
 */
let pool: Pool | null = null;

export function obterPool(): Pool {
  if (pool) return pool;

  // `ambiente` vem de config.ts, que é quem carrega o dotenv. Ler process.env
  // aqui direto veria um ambiente vazio, porque o ESM avalia os imports antes
  // do corpo de quem importa.
  pool = new Pool({
    connectionString: ambiente.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // O `search_path` é o que isola a suíte: sem ele, todo `obterPool()`
    // cairia no schema `public` e os testes escreveriam no banco de
    // desenvolvimento.
    options: `-c search_path=${ambiente.schema}`,
    // TLS é obrigatório no Neon, que só aceita conexão criptografada. Fica
    // desligado por padrão porque o Postgres local não usa TLS.
    ...(ambiente.databaseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  pool.on("error", (erro) => {
    console.error("[postgres] erro em cliente ocioso do pool:", erro.message);
  });

  return pool;
}

export function fecharPool(): Promise<void> {
  if (!pool) return Promise.resolve();
  const atual = pool;
  pool = null;
  return atual.end();
}

/** Executa uma função dentro de uma transação, com rollback em erro. */
export async function emTransacao<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await obterPool().connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (erro) {
    await client.query("ROLLBACK");
    throw erro;
  } finally {
    client.release();
  }
}

// ── Migrações ─────────────────────────────────────────────────────────────

type MigracaoAplicada = { nome: string; aplicada_em: Date };

/**
 * Aplica as migrações que ainda não rodaram, em ordem de nome.
 *
 * A lista de aplicadas fica na tabela `migracoes`, criada aqui se não existir.
 * Cada migração roda dentro de uma transação: se ela falhar pela metade, o
 * banco fica como estava.
 */
export async function aplicarMigracoes(): Promise<string[]> {
  const client = await obterPool().connect();
  const aplicadas: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migracoes (
        nome        TEXT PRIMARY KEY,
        aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const registro = await client.query<MigracaoAplicada>("SELECT nome FROM migracoes");
    const jaAplicadas = new Set(registro.rows.map((linha) => linha.nome));

    const arquivos = fs
      .readdirSync(PASTA_MIGRACOES)
      .filter((arquivo) => arquivo.endsWith(".sql"))
      .sort();

    for (const arquivo of arquivos) {
      if (jaAplicadas.has(arquivo)) continue;

      const sql = fs.readFileSync(path.join(PASTA_MIGRACOES, arquivo), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO migracoes (nome) VALUES ($1)", [arquivo]);
        await client.query("COMMIT");
        aplicadas.push(arquivo);
      } catch (erro) {
        await client.query("ROLLBACK");
        throw new Error(`Migração ${arquivo} falhou: ${erro instanceof Error ? erro.message : erro}`, { cause: erro });
      }
    }
  } finally {
    client.release();
  }

  return aplicadas;
}
