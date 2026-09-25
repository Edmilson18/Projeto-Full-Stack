import { afterAll, beforeAll } from "vitest";

/**
 * Isolamento da suíte.
 *
 * Cria um schema próprio no Postgres de teste, aplica as migrações dentro dele
 * e o apaga no final. O schema é criado com nome único por execução.
 *
 * O isolamento precisa estar em `DATABASE_SCHEMA`, e não em um pool separado,
 * porque `database.ts` chama `obterPool()` em todas as funções. Se o
 * `search_path` ficasse só no pool de teste, o código de produção continuaria
 * apontando para o `public` — que é o banco de desenvolvimento — e a suíte
 * escreveria nele. Foi exatamente o que aconteceu na primeira versão.
 */
const SCHEMA = `teste_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Precisa ser definido antes de qualquer import que carregue `config.ts`,
// porque o `search_path` é lido no momento em que o pool é criado.
process.env.DATABASE_SCHEMA = SCHEMA;

const { Pool } = await import("pg");
const { ambiente } = await import("../config.js");
const { fecharPool, aplicarMigracoes } = await import("../postgres.js");
const { garantirAdministrador } = await import("../database.js");
const { semear } = await import("../seed.js");

let admin: InstanceType<typeof Pool>;

beforeAll(async () => {
  // Pool separado, sem `search_path`: é o que cria e apaga o schema.
  admin = new Pool({ connectionString: ambiente.databaseUrl, max: 1 });

  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);

  await aplicarMigracoes();
  await garantirAdministrador();
  // O schema novo nasce vazio, então precisa do seed. Inclusive para os cupons
  // de teste, que o `public` tem e o schema isolado não.
  await semear();
});

afterAll(async () => {
  await fecharPool();
  await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin?.end();
});
