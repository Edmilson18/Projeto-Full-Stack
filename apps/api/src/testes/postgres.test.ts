import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { aplicarMigracoes, emTransacao, obterPool } from "../postgres.js";
import { ambiente } from "../config.js";
import { conexaoPostgres } from "../seguranca.js";
import { ErroApp } from "../erros.js";

describe("transações com falhas transitórias", () => {
  it.each(["40001", "40P01"])("repete %s após rollback, sem duplicar gravações", async (codigo) => {
    const id = randomUUID();
    let tentativas = 0;
    const resultado = await emTransacao(async (client) => {
      tentativas++;
      await client.query("INSERT INTO categorias (id, nome) VALUES ($1, $1)", [id]);
      if (tentativas === 1) {
        await client.query(`DO $$ BEGIN RAISE EXCEPTION 'conflito transitório' USING ERRCODE = '${codigo}'; END $$`);
      }
      return id;
    });
    expect(resultado).toBe(id);
    expect(tentativas).toBe(2);
    expect((await obterPool().query("SELECT id FROM categorias WHERE id = $1", [id])).rows).toHaveLength(1);
  });

  it("interrompe após três falhas e preserva o erro do banco", async () => {
    let tentativas = 0;
    await expect(
      emTransacao(async (client) => {
        tentativas++;
        await client.query("DO $$ BEGIN RAISE EXCEPTION 'sempre falha' USING ERRCODE = '40001'; END $$");
      }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(tentativas).toBe(3);
  });

  it("não repete falhas de negócio e desfaz a gravação", async () => {
    const id = randomUUID();
    let tentativas = 0;
    await expect(
      emTransacao(async (client) => {
        tentativas++;
        await client.query("INSERT INTO categorias (id, nome) VALUES ($1, $1)", [id]);
        throw ErroApp.conflito("Operação recusada");
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tentativas).toBe(1);
    expect((await obterPool().query("SELECT id FROM categorias WHERE id = $1", [id])).rows).toHaveLength(0);
  });

  it("não repete violações de integridade", async () => {
    const id = randomUUID();
    await obterPool().query("INSERT INTO categorias (id, nome) VALUES ($1, $1)", [id]);
    let tentativas = 0;
    await expect(
      emTransacao(async (client) => {
        tentativas++;
        await client.query("INSERT INTO categorias (id, nome) VALUES ($1, $1)", [id]);
      }),
    ).rejects.toMatchObject({ code: "23505" });
    expect(tentativas).toBe(1);
  });
});

async function comSchemaNovo(teste: (a: Pool, b: Pool, schema: string) => Promise<void>) {
  const schema = `teste_migracao_${randomUUID().replaceAll("-", "")}`;
  const configuracao = {
    ...conexaoPostgres(ambiente.databaseUrl, ambiente.databaseSsl),
    max: 1,
    options: `-c search_path=${schema} -c lock_timeout=3000`,
  };
  const a = new Pool(configuracao);
  const b = new Pool(configuracao);
  await obterPool().query(`CREATE SCHEMA "${schema}"`);
  try {
    await teste(a, b, schema);
  } finally {
    await Promise.allSettled([a.end(), b.end()]);
    await obterPool().query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

describe("migrações simultâneas", () => {
  it("duas instâncias aplicam cada arquivo uma única vez no schema vazio", async () => {
    await comSchemaNovo(async (a, b) => {
      const resultados = await Promise.allSettled([aplicarMigracoes(a), aplicarMigracoes(b)]);
      expect(resultados.every((r) => r.status === "fulfilled")).toBe(true);
      const arquivos = resultados.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      expect(arquivos.toSorted()).toEqual([
        "001_inicial.sql",
        "002_sessoes_e_auditoria.sql",
        "003_idempotencia_pedidos.sql",
        "004_limpar_pedidos_artificiais_do_admin.sql",
      ]);
      expect((await a.query("SELECT nome FROM migracoes")).rows).toHaveLength(4);
      expect(await aplicarMigracoes(b)).toEqual([]);
    });
  });

  it("falha desfaz o arquivo e libera a trava para outra instância", async () => {
    await comSchemaNovo(async (a, b, schema) => {
      // A migração 001 precisará criar uma FK para usuarios(id).
      await a.query("CREATE TABLE usuarios (coluna_errada text)");
      await expect(aplicarMigracoes(a)).rejects.toThrow(/Migração 001_inicial.sql falhou/);
      expect((await a.query("SELECT to_regclass($1) AS tabela", [`${schema}.categorias`])).rows[0]?.tabela).toBeNull();
      await a.query("DROP TABLE usuarios");
      expect(await aplicarMigracoes(b)).toHaveLength(4);
    });
  });

  it("migração remove apenas pedidos artificiais e os itens em cascata", async () => {
    await comSchemaNovo(async (a) => {
      await a.query(`
        CREATE TABLE usuarios (id TEXT PRIMARY KEY);
        CREATE TABLE pedidos (id TEXT PRIMARY KEY, usuario_id TEXT REFERENCES usuarios(id));
        CREATE TABLE itens_pedido (
          id TEXT PRIMARY KEY,
          pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE
        );
        CREATE TABLE migracoes (nome TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now());
        INSERT INTO usuarios (id) VALUES ('usr-admin');
        INSERT INTO pedidos (id, usuario_id) VALUES ('ped-demo-1', 'usr-admin'), ('pedido-real-1', 'usr-admin');
        INSERT INTO itens_pedido (id, pedido_id) VALUES ('item-demo', 'ped-demo-1'), ('item-real', 'pedido-real-1');
        INSERT INTO migracoes (nome) VALUES ('001_inicial.sql'), ('002_sessoes_e_auditoria.sql'), ('003_idempotencia_pedidos.sql');
      `);

      expect(await aplicarMigracoes(a)).toEqual(["004_limpar_pedidos_artificiais_do_admin.sql"]);
      expect((await a.query("SELECT id FROM pedidos ORDER BY id")).rows).toEqual([{ id: "pedido-real-1" }]);
      expect((await a.query("SELECT id FROM itens_pedido")).rows).toEqual([{ id: "item-real" }]);
    });
  });
});
