import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { setTimeout as aguardar } from "node:timers/promises";
import { ambiente } from "./config.js";
import { conexaoPostgres } from "./seguranca.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PASTA_MIGRACOES = path.join(RAIZ, "database", "migrations");

/**
 * Pool de conexões.
 *
 * Reutiliza conexões dentro de cada processo. O limite total depende também
 * do número de instâncias e deve ser dimensionado para a hospedagem escolhida.
 */
let pool: Pool | null = null;

export function obterPool(): Pool {
  if (pool) return pool;

  // Trava de segurança. Em teste, o `search_path` precisa apontar para um
  // schema isolado, definido em `src/testes/preparacao.ts`. Se o arquivo for
  // rodado fora do Vitest — por exemplo `npx vitest` a partir da raiz, onde
  // o `vitest.config.ts` do api não é carregado — o setup não roda, o schema
  // não é definido, e a suíte grava no banco de desenvolvimento sem aviso.
  //
  // Preferível falhar na inicialização a silenciosamente poluir o `public`.
  if (process.env.NODE_ENV === "test" && !process.env.DATABASE_SCHEMA) {
    throw new Error(
      "DATABASE_SCHEMA não definida em ambiente de teste. Rode a suíte com `npm test` na raiz, " +
        "que executa `vitest` dentro de apps/api e carrega o vitest.config.ts certo. " +
        "Rodar `npx vitest` na raiz escreveria no banco de desenvolvimento.",
    );
  }

  // `ambiente` vem de config.ts, que é quem carrega o dotenv. Ler process.env
  // aqui direto veria um ambiente vazio, porque o ESM avalia os imports antes
  // do corpo de quem importa.
  pool = new Pool({
    ...conexaoPostgres(ambiente.databaseUrl, ambiente.databaseSsl),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // O `search_path` é o que isola a suíte: sem ele, todo `obterPool()`
    // cairia no schema `public` e os testes escreveriam no banco de
    // desenvolvimento.
    options: `-c search_path=${ambiente.schema}`,
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

/**
 * Até três tentativas para deadlock/serialização, sempre após rollback.
 * O callback deve conter somente operações transacionais no banco: nenhum
 * envio de e-mail, HTTP ou outro efeito externo que possa ser repetido.
 * Erros de conexão/COMMIT ambíguo e falhas de negócio não são repetidos.
 */
export async function emTransacao<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    const client = await obterPool().connect();
    let descartar = false;
    try {
      await client.query("BEGIN");
      const resultado = await fn(client);
      await client.query("COMMIT");
      return resultado;
    } catch (erro) {
      try {
        await client.query("ROLLBACK");
      } catch {
        descartar = true;
      }
      const codigo = typeof erro === "object" && erro !== null && "code" in erro ? erro.code : null;
      if (descartar || tentativa >= 3 || (codigo !== "40P01" && codigo !== "40001")) throw erro;
    } finally {
      client.release(descartar);
    }
    await aguardar(10 * tentativa + Math.random() * 20);
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
export async function aplicarMigracoes(conexoes: Pool = obterPool()): Promise<string[]> {
  const client = await conexoes.connect();
  const aplicadas: string[] = [];
  let travada = false;
  let descartar = false;

  try {
    // A trava vem antes até da criação do registro. É por banco/schema e
    // pertence à conexão, cobrindo os commits de todas as migrações do lote.
    await client.query(
      "SELECT pg_advisory_lock(hashtext(current_database()), hashtext(current_schema() || ':migracoes'))",
    );
    travada = true;
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
      .toSorted();

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
    if (travada) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext(current_database()), hashtext(current_schema() || ':migracoes'))",
        );
      } catch {
        // Fechar a conexão libera a trava mesmo se o desbloqueio falhar.
        descartar = true;
      }
    }
    client.release(descartar);
  }

  return aplicadas;
}
