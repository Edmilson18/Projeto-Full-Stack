import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, iniciarContexto, type Cliente } from "./ajuda.js";

/**
 * Cupons.
 *
 * Cada teste cria o próprio cupom por SQL em vez de usar os do `seed`. Motivo:
 * os cupons do seed são compartilhados por toda a suíte, e os testes de limite
 * de uso e de concorrência **consumem** o cupom — depois deles, qualquer
 * reexecução dependente da ordem dos testes passaria a medir outra coisa.
 *
 * Todos os valores monetários aqui são centavos, que é a unidade do banco.
 */

let contexto: Awaited<ReturnType<typeof iniciarContexto>>;
let novo: () => Cliente;

beforeAll(async () => {
  contexto = await iniciarContexto();
  novo = contexto.novoCliente;
});

afterAll(async () => {
  await contexto.encerrar();
});

/**
 * Produto barato, para o frete de R$ 20 continuar valendo nos testes — todos os
 * produtos do seed custam acima de R$ 150, o que zeraria o frete e tornaria o
 * cupom de frete grátis indistinguível do comportamento normal.
 */
const PRECO_BARATO_CENTAVOS = 1_000; // R$ 10,00

/** Produto caro, para ultrapassar o valor mínimo de R$ 500 do cupom. */
const PRECO_CARO_CENTAVOS = 189_900; // R$ 1.899,00

let idProdutoBarato = "";
let idProdutoCaro = "";

type Cupom = {
  codigo: string;
  tipo: "porcentagem" | "valor_fixo" | "frete_gratis";
  porcentagem?: number;
  valorFixo?: number;
  valorMinimo?: number;
  limiteUso?: number | null;
  expirado?: boolean;
  ativo?: boolean;
};

/**
 * Insere um cupom com estado controlado.
 *
 * Ocupação (`usos`) e validade (`inicio_em`/`fim_em`) não têm caminho em
 * `criarCupom`, que é a função de produção; aqui é preciso produzi-los para
 * testar expiração e limite de uso.
 */
async function criarCupomDeTeste(cupom: Cupom) {
  const { obterPool } = await import("../postgres.js");
  await obterPool().query(
    `INSERT INTO cupons (id, codigo, desconto_centavos, porcentagem_desconto, tipo_desconto,
                         valor_minimo_centavos, inicio_em, fim_em, limite_uso, usos, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, now() - interval '1 day',
             CASE WHEN $7::boolean THEN now() - interval '1 hour' ELSE NULL END,
             $8, 0, $9)`,
    [
      `cup-teste-${cupom.codigo.toLowerCase()}`,
      cupom.codigo,
      cupom.valorFixo ?? 0,
      cupom.porcentagem ?? 0,
      cupom.tipo,
      cupom.valorMinimo ?? 0,
      cupom.expirado ?? false,
      cupom.limiteUso ?? null,
      cupom.ativo ?? true,
    ],
  );
}

async function usosDoCupom(codigo: string) {
  const { obterPool } = await import("../postgres.js");
  const consulta = await obterPool().query<{ usos: number }>("SELECT usos FROM cupons WHERE codigo = $1", [codigo]);
  return consulta.rows[0]?.usos ?? 0;
}

/** Cria os dois produtos usados pelos testes. */
async function criarProdutosDeTeste() {
  const admin = novo();
  await admin.post("/api/login", ADMIN);

  for (const [nome, preco, quantidade] of [
    ["Produto Barato de Teste", PRECO_BARATO_CENTAVOS / 100, 50],
    ["Produto Caro de Teste", PRECO_CARO_CENTAVOS / 100, 50],
  ] as const) {
    const criado = await admin.post("/api/produtos", {
      nome,
      descricao: "Criado pela suíte de cupons.",
      preco,
      quantidade,
      categoriaId: "cat-informatica",
    });
    expect(criado.status).toBe(201);
    // A rota devolve o produto criado — inclusive o `id` gerado pelo servidor.
    if (nome.startsWith("Produto Barato")) idProdutoBarato = criado.corpo.produto.id;
    else idProdutoCaro = criado.corpo.produto.id;
  }
}

async function clienteComum(): Promise<Cliente> {
  const cliente = novo();
  const email = `cupom-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;
  const cadastro = await cliente.post("/api/cadastro", { nome: "Cliente Cupom", email, senha: "senha123" });
  expect(cadastro.status).toBe(201);
  return cliente;
}

/** Cria um pedido autenticado e devolve a resposta crua. */
function pedir(cliente: Cliente, produtoId: string, cupomCodigo?: string) {
  return cliente.post("/api/pedidos", {
    itens: [{ produtoId, quantidade: 1 }],
    ...(cupomCodigo ? { cupomCodigo } : {}),
  });
}

// ── Validação isolada (POST /api/cupons/validar) ───────────────────────────

describe("cupons · validação", () => {
  beforeAll(async () => {
    await criarProdutosDeTeste();
    await criarCupomDeTeste({ codigo: "TSTVAL10", tipo: "porcentagem", porcentagem: 10 });
    await criarCupomDeTeste({ codigo: "TSTEXPIRADO", tipo: "porcentagem", porcentagem: 50, expirado: true });
    await criarCupomDeTeste({ codigo: "TSTINATIVO", tipo: "porcentagem", porcentagem: 50, ativo: false });
    await criarCupomDeTeste({ codigo: "TSTESGOTADO", tipo: "porcentagem", porcentagem: 50, limiteUso: 1 });
    // Consome o único uso, para que a validação o recuse por limite.
    const { obterPool } = await import("../postgres.js");
    await obterPool().query("UPDATE cupons SET usos = limite_uso WHERE codigo = 'TSTESGOTADO'");
  });

  it("aceita um cupom válido e devolve os dados do desconto", async () => {
    const resposta = await novo().post("/api/cupons/validar", { codigo: "TSTVAL10" });

    expect(resposta.status).toBe(200);
    // O 200 vem mesmo quando o cupom é recusado: o resultado está no corpo.
    expect(resposta.corpo).toMatchObject({
      valido: true,
      codigo: "TSTVAL10",
      tipoDesconto: "porcentagem",
      porcentagemDesconto: 10,
    });
  });

  it("normaliza o código: espaços e minúsculas são aceitos", async () => {
    const resposta = await novo().post("/api/cupons/validar", { codigo: "  tstval10  " });
    expect(resposta.corpo).toMatchObject({ valido: true, codigo: "TSTVAL10" });
  });

  it("recusa um código inexistente", async () => {
    const resposta = await novo().post("/api/cupons/validar", { codigo: "NAOEXISTE" });

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.valido).toBe(false);
    expect(resposta.corpo.erro).toMatch(/inválido/i);
  });

  it("recusa um cupom expirado", async () => {
    const resposta = await novo().post("/api/cupons/validar", { codigo: "TSTEXPIRADO" });
    expect(resposta.corpo.valido).toBe(false);
  });

  it("recusa um cupom inativo", async () => {
    const resposta = await novo().post("/api/cupons/validar", { codigo: "TSTINATIVO" });
    expect(resposta.corpo.valido).toBe(false);
  });

  it("recusa um cupom que já esgotou o limite de uso", async () => {
    const resposta = await novo().post("/api/cupons/validar", { codigo: "TSTESGOTADO" });
    expect(resposta.corpo.valido).toBe(false);
  });

  it("recusa código em branco com 400, antes de consultar o banco", async () => {
    const resposta = await novo().post("/api/cupons/validar", { codigo: "   " });
    expect(resposta.status).toBe(400);
  });

  it("não lista cupom inativo nem expirado em GET /api/cupons", async () => {
    const resposta = await novo().get("/api/cupons");
    const codigos = resposta.corpo.map((linha: { codigo: string }) => linha.codigo);

    expect(resposta.status).toBe(200);
    expect(codigos).toContain("TSTVAL10");
    expect(codigos).not.toContain("TSTINATIVO");
    expect(codigos).not.toContain("TSTEXPIRADO");
    expect(codigos).not.toContain("TSTESGOTADO");
  });

  it("expõe o valor do desconto fixo em reais na listagem", async () => {
    await criarCupomDeTeste({ codigo: "TSTLISTAFIXO", tipo: "valor_fixo", valorFixo: 1250 });
    const resposta = await novo().get("/api/cupons");
    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toContainEqual(
      expect.objectContaining({ codigo: "TSTLISTAFIXO", tipoDesconto: "valor_fixo", desconto: 12.5 }),
    );
  });
});

// ── Aplicação no pedido ─────────────────────────────────────────────────────

describe("cupons · aplicação no pedido", () => {
  beforeAll(async () => {
    if (!idProdutoBarato) await criarProdutosDeTeste();

    await criarCupomDeTeste({ codigo: "TST50POR", tipo: "porcentagem", porcentagem: 50 });
    await criarCupomDeTeste({ codigo: "TSTFIXO50", tipo: "valor_fixo", valorFixo: 5_000 });
    await criarCupomDeTeste({ codigo: "TSTFRETEGRATIS", tipo: "frete_gratis" });
    await criarCupomDeTeste({ codigo: "TSTMIN500", tipo: "valor_fixo", valorFixo: 1_000, valorMinimo: 50_000 });
    await criarCupomDeTeste({ codigo: "TSTUNAUSO", tipo: "porcentagem", porcentagem: 10, limiteUso: 1 });
  });

  it("sem cupom, cobra o frete de R$ 20 abaixo do limite de frete grátis", async () => {
    const resposta = await pedir(await clienteComum(), idProdutoBarato);

    expect(resposta.status).toBe(201);
    expect(resposta.corpo.pedido).toMatchObject({
      subtotal: PRECO_BARATO_CENTAVOS / 100,
      desconto: 0,
      frete: 20,
      total_final: PRECO_BARATO_CENTAVOS / 100 + 20,
    });
  });

  it("aplica desconto percentual sobre o subtotal", async () => {
    const resposta = await pedir(await clienteComum(), idProdutoBarato, "TST50POR");

    expect(resposta.status).toBe(201);
    // R$ 10,00 - 50% = R$ 5,00 de desconto; total R$ 5,00 + R$ 20,00 de frete.
    expect(resposta.corpo.pedido).toMatchObject({
      subtotal: 10,
      desconto: 5,
      frete: 20,
      total_final: 25,
    });
  });

  it("arredonda o desconto percentual para centavos inteiros", async () => {
    // R$ 10,00 com 33% fecha exato; o arredondamento só aparece com um subtotal
    // que não fecha: R$ 0,99 com 10% dá R$ 0,099, que precisa virar R$ 0,10.
    await criarCupomDeTeste({ codigo: "TST10POR", tipo: "porcentagem", porcentagem: 10 });

    const { obterPool } = await import("../postgres.js");
    await obterPool().query("UPDATE produtos SET preco_centavos = 99 WHERE id = $1", [idProdutoBarato]);
    try {
      const resposta = await pedir(await clienteComum(), idProdutoBarato, "TST10POR");
      expect(resposta.status).toBe(201);
      // Math.round fecha a conta: 9,9 centavos vira 10 e não 9 nem 9,9.
      expect(resposta.corpo.pedido).toMatchObject({ subtotal: 0.99, desconto: 0.1, frete: 20, total_final: 20.89 });
    } finally {
      await obterPool().query("UPDATE produtos SET preco_centavos = $2 WHERE id = $1", [
        idProdutoBarato,
        PRECO_BARATO_CENTAVOS,
      ]);
    }
  });

  it("limita o desconto de valor fixo ao subtotal, sem total negativo", async () => {
    const resposta = await pedir(await clienteComum(), idProdutoBarato, "TSTFIXO50");

    expect(resposta.status).toBe(201);
    // Desconto de R$ 50 sobre subtotal de R$ 10 vira R$ 10, não -R$ 40.
    expect(resposta.corpo.pedido).toMatchObject({ subtotal: 10, desconto: 10, total_final: 20 });
    expect(resposta.corpo.pedido.total_final).toBeGreaterThanOrEqual(0);
  });

  it("zera o frete com cupom de frete grátis", async () => {
    const resposta = await pedir(await clienteComum(), idProdutoBarato, "TSTFRETEGRATIS");

    expect(resposta.status).toBe(201);
    expect(resposta.corpo.pedido).toMatchObject({ subtotal: 10, desconto: 0, frete: 0, total_final: 10 });
  });

  it("rejeita o cupom abaixo do valor mínimo, com o valor mínimo na mensagem", async () => {
    const resposta = await pedir(await clienteComum(), idProdutoBarato, "TSTMIN500");

    expect(resposta.status).toBe(400);
    expect(resposta.corpo.erro).toMatch(/mínimo/i);
  });

  it("aceita o mesmo cupom acima do valor mínimo", async () => {
    const resposta = await pedir(await clienteComum(), idProdutoCaro, "TSTMIN500");

    expect(resposta.status).toBe(201);
    // Subtotal R$ 1.899,00, desconto de R$ 10,00, frete grátis (acima de R$ 150).
    expect(resposta.corpo.pedido).toMatchObject({ desconto: 10, frete: 0, total_final: 1_889 });
  });

  it("recusa cupom inválido, expirado e inativo também na hora de pedir", async () => {
    const cliente = await clienteComum();

    for (const codigo of ["NAOEXISTE", "TSTEXPIRADO", "TSTINATIVO"]) {
      const resposta = await pedir(cliente, idProdutoBarato, codigo);
      expect(resposta.status).toBe(400);
      expect(resposta.corpo.erro).toMatch(/inválido/i);
    }
  });

  it("respeita o limite de uso: só o primeiro pedido passa", async () => {
    const primeiro = await pedir(await clienteComum(), idProdutoBarato, "TSTUNAUSO");
    expect(primeiro.status).toBe(201);
    expect(await usosDoCupom("TSTUNAUSO")).toBe(1);

    const segundo = await pedir(await clienteComum(), idProdutoBarato, "TSTUNAUSO");
    expect(segundo.status).toBe(400);
    expect(segundo.corpo.erro).toMatch(/inválido/i);

    // O cupom recusado não pode ter incremented o contador.
    expect(await usosDoCupom("TSTUNAUSO")).toBe(1);
  });

  it("não deixa o limite de uso ser furado por pedidos simultâneos", async () => {
    await criarCupomDeTeste({ codigo: "TSTCONCOR", tipo: "porcentagem", porcentagem: 10, limiteUso: 1 });

    const [primeiro, segundo] = await Promise.all([
      pedir(await clienteComum(), idProdutoBarato, "TSTCONCOR"),
      pedir(await clienteComum(), idProdutoBarato, "TSTCONCOR"),
    ]);

    const criados = [primeiro, segundo].filter((resposta) => resposta.status === 201);
    const recusados = [primeiro, segundo].filter((resposta) => resposta.status === 400);

    // `FOR UPDATE` no cupom serializa as duas transações; a segunda reavalia o
    // `WHERE` depois do commit da primeira e já não encontra o cupom válido.
    expect(criados).toHaveLength(1);
    expect(recusados).toHaveLength(1);
    expect(await usosDoCupom("TSTCONCOR")).toBe(1);
  });

  it("não deixa o estoque ser descontado duas vezes sob concorrência", async () => {
    const { obterPool } = await import("../postgres.js");
    // Um único item em estoque: das duas tentativas, só uma pode ser atendida.
    await obterPool().query("UPDATE produtos SET quantidade = 1 WHERE id = $1", [idProdutoBarato]);

    const [primeiro, segundo] = await Promise.all([
      pedir(await clienteComum(), idProdutoBarato),
      pedir(await clienteComum(), idProdutoBarato),
    ]);

    const atendidos = [primeiro, segundo].filter((resposta) => resposta.status === 201);
    const recusados = [primeiro, segundo].filter((resposta) => resposta.status === 400);

    expect(atendidos).toHaveLength(1);
    expect(recusados).toHaveLength(1);
    expect(recusados[0]?.corpo.erro).toMatch(/estoque/i);

    const depois = await obterPool().query<{ quantidade: number }>("SELECT quantidade FROM produtos WHERE id = $1", [
      idProdutoBarato,
    ]);
    expect(depois.rows[0]?.quantidade).toBe(0);

    // Restaura o estoque para os testes seguintes.
    await obterPool().query("UPDATE produtos SET quantidade = 50 WHERE id = $1", [idProdutoBarato]);
  });

  it("registra a auditoria do pedido com cupom dentro da mesma transação", async () => {
    const cliente = await clienteComum();
    const criado = await pedir(cliente, idProdutoBarato, "TSTFRETEGRATIS");
    expect(criado.status).toBe(201);

    const { obterPool } = await import("../postgres.js");
    const registro = await obterPool().query<{ acao: string }>(
      "SELECT acao FROM auditoria WHERE entidade = 'pedido' AND entidade_id = $1",
      [criado.corpo.pedido.id],
    );
    expect(registro.rows).toHaveLength(1);
    expect(registro.rows[0]?.acao).toBe("criado");
  });
});
