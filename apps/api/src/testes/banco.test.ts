import { beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  desfavoritarProduto,
  favoritarProduto,
  atualizarEnderecoUsuario,
  atualizarProduto,
  atualizarStatusPedido,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  buscarPerfilUsuario,
  criarPedido,
  criarUsuario,
  inativarProduto,
  inserirProduto,
  listarAvaliacoes,
  listarCategorias,
  listarCuponsAtivos,
  listarFavoritos,
  listarPedidosDoUsuario,
  listarProdutos,
  redefinirSenhaComToken,
  criarTokenRedefinicaoSenha,
  criarSessao,
  obterSessao,
  listarDashboard,
  salvarAvaliacao,
  validarCupomCodigo,
  verificarSenha,
} from "../database.js";
import { obterPool } from "../postgres.js";
import { semear } from "../seed.js";
import { bancoLocal, conexaoPostgres } from "../seguranca.js";

/** Cria um cliente novo e devolve o id. */
async function novoCliente(nome = "Ana Souza"): Promise<string> {
  const id = `usr-${Math.random().toString(36).slice(2, 10)}`;
  await criarUsuario({ id, nome, email: `${id}@exemplo.com`, senha: "senha123" });
  return id;
}

async function estoque(produtoId: string): Promise<number> {
  const resultado = await obterPool().query<{ quantidade: number }>("SELECT quantidade FROM produtos WHERE id = $1", [
    produtoId,
  ]);
  return resultado.rows[0]?.quantidade ?? 0;
}

async function zerarCupons() {
  await obterPool().query(
    "UPDATE cupons SET ativo = true, limite_uso = NULL, usos = 0, fim_em = NULL WHERE codigo = 'BEMVINDO10'",
  );
}

describe("senhas", () => {
  it("nunca guarda a senha em texto puro", async () => {
    const id = await novoCliente();

    // buscarUsuarioPorId nem retorna a coluna senha; o email expoe o hash.
    const usuario = await buscarUsuarioPorId(id);
    expect(usuario).not.toHaveProperty("senha");

    const comSenha = await buscarUsuarioPorEmail(`${id}@exemplo.com`);
    expect(comSenha?.senha).not.toContain("senha123");
    expect(comSenha?.senha.startsWith("scrypt$")).toBe(true);
  });

  it("confere a senha correta e rejeita a errada", async () => {
    const id = await novoCliente();
    const comSenha = await buscarUsuarioPorEmail(`${id}@exemplo.com`);
    const senha = comSenha?.senha ?? "";

    expect(verificarSenha("senha123", senha)).toBe(true);
    expect(verificarSenha("senha124", senha)).toBe(false);
    expect(verificarSenha("", senha)).toBe(false);
  });

  it("gera um salt diferente a cada hash", async () => {
    const a = await novoCliente();
    const b = await novoCliente();
    const hashA = (await buscarUsuarioPorEmail(`${a}@exemplo.com`))?.senha ?? "";
    const hashB = (await buscarUsuarioPorEmail(`${b}@exemplo.com`))?.senha ?? "";

    // Mesma senha, hashes diferentes: sem isso, dois usuários iguais seriam
    // identificaveis no banco.
    expect(hashA).not.toBe(hashB);
  });
});

describe("cupons", () => {
  beforeEach(async () => {
    await zerarCupons();
  });

  it("aceita um cupom percentual ativo", async () => {
    const resultado = await validarCupomCodigo("BEMVINDO10");
    expect(resultado.valido).toBe(true);
    if (resultado.valido) {
      expect(resultado.porcentagemDesconto).toBe(10);
      expect(resultado.tipoDesconto).toBe("porcentagem");
    }
  });

  it("é case insensitive no código", async () => {
    expect((await validarCupomCodigo("bemvindo10")).valido).toBe(true);
    expect((await validarCupomCodigo("  BEMVINDO10  ")).valido).toBe(true);
  });

  it("rejeita cupom inexistente, inativo ou expirado", async () => {
    expect((await validarCupomCodigo("NAOEXISTE")).valido).toBe(false);
    expect((await validarCupomCodigo("")).valido).toBe(false);

    await obterPool().query("UPDATE cupons SET ativo = false WHERE codigo = 'BEMVINDO10'");
    expect((await validarCupomCodigo("BEMVINDO10")).valido).toBe(false);

    await obterPool().query("UPDATE cupons SET ativo = true, fim_em = '2000-01-01' WHERE codigo = 'BEMVINDO10'");
    expect((await validarCupomCodigo("BEMVINDO10")).valido).toBe(false);

    await obterPool().query("UPDATE cupons SET fim_em = NULL WHERE codigo = 'BEMVINDO10'");
    expect((await validarCupomCodigo("BEMVINDO10")).valido).toBe(true);
  });

  it("respeita o limite de uso", async () => {
    // Este é o caso que o SQLite resolvia por acidente e o PostgreSQL não:
    // `limite_uso <= usos` com limite NULL daria NULL, e o cupom pareceria
    // válido. O `IS NOT NULL` do WHERE é o que corrige.
    await obterPool().query("UPDATE cupons SET limite_uso = 1, usos = 1 WHERE codigo = 'BEMVINDO10'");
    expect((await validarCupomCodigo("BEMVINDO10")).valido).toBe(false);

    await obterPool().query("UPDATE cupons SET limite_uso = NULL, usos = 0 WHERE codigo = 'BEMVINDO10'");
    expect((await validarCupomCodigo("BEMVINDO10")).valido).toBe(true);
  });

  it("não lista cupom inativo nem expirado", async () => {
    await obterPool().query("UPDATE cupons SET ativo = false WHERE codigo = 'BEMVINDO10'");
    const codigos = (await listarCuponsAtivos()).map((cupom) => cupom.codigo);
    expect(codigos).not.toContain("BEMVINDO10");
    expect(codigos).toContain("FRETEGRATIS");
  });

  it("não anuncia cupom que atingiu o limite de uso", async () => {
    await obterPool().query("UPDATE cupons SET limite_uso = 1, usos = 1 WHERE codigo = 'BEMVINDO10'");
    expect((await listarCuponsAtivos()).map((cupom) => cupom.codigo)).not.toContain("BEMVINDO10");
  });
});

/**
 * Repõe o estoque dos produtos do seed e zera os cupons.
 *
 * Sem isso, os testes de pedido competem pelo mesmo `prod-teclado`: cada um
 * desconta unidades, e depois de alguns o estoque zera. A falha aparece como
 * "produto sem estoque", que não tem nada a ver com o que o teste queria
 * verificar. Com SQLite cada arquivo tinha um banco próprio; com PostgreSQL o
 * isolamento é por schema, e o estado dentro do schema é compartilhado.
 */
async function reporEstado(): Promise<void> {
  await obterPool().query("UPDATE produtos SET quantidade = 100 WHERE id = ANY($1::text[])", [
    ["prod-teclado", "prod-mouse", "prod-monitor", "prod-cadeira", "prod-headset", "prod-cam"],
  ]);
  await obterPool().query("UPDATE cupons SET ativo = true, limite_uso = NULL, usos = 0, fim_em = NULL");
}

/**
 * Cria um produto de teste, ou atualiza se já existir.
 *
 * O `inserirProduto` puro falharia com violação de chave primária na segunda
 * rodada, porque o schema de teste é recriado só uma vez por execução, e não
 * por teste.
 */
async function criarProdutoDeTeste(produto: {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  quantidade: number;
}) {
  await obterPool().query(
    `INSERT INTO produtos (id, nome, descricao, preco_centavos, quantidade, categoria_id, ativo)
     VALUES ($1, $2, $3, $4, $5, 'cat-outros', true)
     ON CONFLICT (id) DO UPDATE
       SET nome = EXCLUDED.nome, preco_centavos = EXCLUDED.preco_centavos,
           quantidade = EXCLUDED.quantidade, ativo = true`,
    [produto.id, produto.nome, produto.descricao, Math.round(produto.preco * 100), produto.quantidade],
  );
}

describe("criação de pedido", () => {
  beforeEach(async () => {
    await reporEstado();
  });

  it("recusa produto inativo sem alterar estoque nem criar pedido", async () => {
    const usuario = await novoCliente();
    await criarProdutoDeTeste({
      id: "prod-inativo-compra",
      nome: "Inativo",
      descricao: "Teste",
      preco: 10,
      quantidade: 2,
    });
    await inativarProduto("prod-inativo-compra");
    await expect(criarPedido(usuario, [{ produtoId: "prod-inativo-compra", quantidade: 1 }])).rejects.toThrow(
      /inválid/i,
    );
    expect(await estoque("prod-inativo-compra")).toBe(2);
    expect(await listarPedidosDoUsuario(usuario)).toHaveLength(0);
  });

  it("recusa total fora da faixa do banco e desfaz os débitos de estoque", async () => {
    const usuario = await novoCliente();
    await criarProdutoDeTeste({
      id: "prod-valor-alto",
      nome: "Valor alto",
      descricao: "Teste",
      preco: 100_000,
      quantidade: 999,
    });
    await expect(criarPedido(usuario, [{ produtoId: "prod-valor-alto", quantidade: 999 }])).rejects.toThrow(
      /limite permitido/i,
    );
    expect(await estoque("prod-valor-alto")).toBe(999);
    expect(await listarPedidosDoUsuario(usuario)).toHaveLength(0);
  });

  it("calcula subtotal e total, e debita o estoque", async () => {
    const usuario = await novoCliente();
    const antes = await estoque("prod-teclado");

    const pedido = await criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 2 }]);

    expect(pedido.subtotal).toBeCloseTo(1199.8, 2);
    // Acima de R$ 150, o frete é zero.
    expect(pedido.frete).toBe(0);
    expect(pedido.total_final).toBeCloseTo(1199.8, 2);
    expect(await estoque("prod-teclado")).toBe(antes - 2);
    expect(pedido.id).toMatch(/^PED-\d{8}-[0-9A-F]{6}$/);
  });

  it("cobra frete quando o subtotal fica abaixo de 150", async () => {
    const usuario = await novoCliente();
    await criarProdutoDeTeste({
      id: "prod-barato",
      nome: "Barato",
      descricao: "Item abaixo da faixa de frete grátis.",
      preco: 100,
      quantidade: 50,
    });

    const pedido = await criarPedido(usuario, [{ produtoId: "prod-barato", quantidade: 1 }]);
    expect(pedido.frete).toBe(20);
    expect(pedido.total_final).toBe(120);
  });

  it("aplica cupom percentual de desconto", async () => {
    await zerarCupons();
    const usuario = await novoCliente();
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }], "BEMVINDO10");

    expect(pedido.subtotal).toBeCloseTo(599.9, 2);
    expect(pedido.desconto).toBeCloseTo(59.99, 2);
    expect(pedido.total_final).toBeCloseTo(539.91, 2);
  });

  it("aplica cupom de frete grátis mesmo abaixo do mínimo de frete", async () => {
    const usuario = await novoCliente();
    await criarProdutoDeTeste({
      id: "prod-barato-frete",
      nome: "Barato para frete",
      descricao: "Item barato para exercitar o cupom de frete.",
      preco: 100,
      quantidade: 50,
    });

    expect((await criarPedido(usuario, [{ produtoId: "prod-barato-frete", quantidade: 1 }])).frete).toBe(20);

    const comCupom = await criarPedido(usuario, [{ produtoId: "prod-barato-frete", quantidade: 1 }], "FRETEGRATIS");
    expect(comCupom.frete).toBe(0);
    expect(comCupom.desconto).toBe(0);
  });

  it("incrementa o contador de uso do cupom", async () => {
    await zerarCupons();
    const usuario = await novoCliente();

    const antes = (await obterPool().query<{ usos: number }>("SELECT usos FROM cupons WHERE codigo = 'BEMVINDO10'"))
      .rows[0]?.usos;
    await criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }], "BEMVINDO10");
    const depois = (await obterPool().query<{ usos: number }>("SELECT usos FROM cupons WHERE codigo = 'BEMVINDO10'"))
      .rows[0]?.usos;

    expect(depois).toBe((antes ?? 0) + 1);
  });

  it("recusa estoque insuficiente e não mexe no estoque", async () => {
    const usuario = await novoCliente();
    const antes = await estoque("prod-cam");

    await expect(criarPedido(usuario, [{ produtoId: "prod-cam", quantidade: 99_999 }])).rejects.toThrow(/estoque/i);
    expect(await estoque("prod-cam")).toBe(antes);
  });

  it("faz rollback quando um item do pedido falha", async () => {
    const usuario = await novoCliente();
    const antes = await estoque("prod-teclado");

    // O primeiro item é válido; o segundo não existe. A transação inteira
    // precisa desfazer o primeiro, senão o estoque vaza.
    await expect(
      criarPedido(usuario, [
        { produtoId: "prod-teclado", quantidade: 1 },
        { produtoId: "prod-inexistente", quantidade: 1 },
      ]),
    ).rejects.toThrow();

    expect(await estoque("prod-teclado")).toBe(antes);
  });

  it("recusa quantidade inválida", async () => {
    const usuario = await novoCliente();
    await expect(criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 0 }])).rejects.toThrow();
    await expect(criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: -1 }])).rejects.toThrow();
    await expect(criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1.5 }])).rejects.toThrow();
  });

  it("recusa carrinho vazio", async () => {
    const usuario = await novoCliente();
    await expect(criarPedido(usuario, [])).rejects.toThrow(/vazio/i);
  });

  it("recusa cupom inválido", async () => {
    const usuario = await novoCliente();
    await expect(
      criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }], "CUPOM-QUE-NAO-EXISTE"),
    ).rejects.toThrow(/cupom/i);
  });

  it("registra o pedido com os itens e o preço congelado", async () => {
    const usuario = await novoCliente();
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }]);

    const pedidos = await listarPedidosDoUsuario(usuario);
    const encontrado = pedidos.find((p) => p.id === pedido.id);
    expect(encontrado).toBeDefined();
    expect(encontrado?.itens).toHaveLength(1);
    expect(encontrado?.itens[0]?.preco_unitario).toBeCloseTo(599.9, 2);
  });
});

describe("precisão monetária", () => {
  it("fecha a conta em centavos inteiros, o que o float não fazia", async () => {
    // Este é o teste que a fase do SQLite não conseguia passar. Com REAL,
    // 19,90 * 3 dava 59,699999999999996 e a soma de itens não batia com o
    // total. Com centavos inteiros, a aritmética é exata.
    const usuario = await novoCliente();
    await criarProdutoDeTeste({
      id: "prod-tres-unidades",
      nome: "Produto de 19,90",
      descricao: "Usado para verificar a soma de itens.",
      preco: 19.9,
      quantidade: 100,
    });

    const pedido = await criarPedido(usuario, [{ produtoId: "prod-tres-unidades", quantidade: 3 }]);

    // 19,90 * 3 = 59,70 exato. Em float seria 59,699999999999996.
    // Abaixo de R$ 150 entra o frete de R$ 20, então o total vai a 79,70.
    expect(pedido.subtotal).toBe(59.7);
    expect(pedido.frete).toBe(20);
    expect(pedido.total_final).toBe(79.7);
    expect(pedido.subtotal * 100).toBe(5970);
  });

  it("fecha o desconto percentual sem resíduo", async () => {
    await zerarCupons();
    const usuario = await novoCliente();
    await criarProdutoDeTeste({
      id: "prod-desconto",
      nome: "Produto para desconto",
      descricao: "Base do cálculo de desconto.",
      preco: 33.33,
      quantidade: 50,
    });

    const pedido = await criarPedido(usuario, [{ produtoId: "prod-desconto", quantidade: 3 }], "BEMVINDO10");

    // 33,33 * 3 = 99,99. Com 10% de desconto, 9,999 arredonda para 10,00 — o
    // Math.round é o que fecha. Sem ele o total ficaria 1 centavo fora.
    // 99,99 - 10,00 = 89,99, ainda abaixo de 150, então entra o frete de 20.
    expect(pedido.subtotal).toBe(99.99);
    expect(pedido.desconto).toBe(10);
    expect(pedido.frete).toBe(20);
    expect(pedido.total_final).toBe(109.99);
  });

  it("soma os itens e confere com o total gravado no banco", async () => {
    // A propriedade que o REAL quebrava: a soma dos itens tem que ser igual ao
    // total do pedido, não apenas "próximo" dele.
    const usuario = await novoCliente();
    await criarProdutoDeTeste({
      id: "prod-conferencia",
      nome: "Produto para conferência",
      descricao: "Verifica soma de itens contra o total.",
      preco: 19.9,
      quantidade: 100,
    });

    const pedido = await criarPedido(usuario, [{ produtoId: "prod-conferencia", quantidade: 3 }]);

    const gravado = await obterPool().query<{
      subtotal_centavos: number;
      total_centavos: number;
      frete_centavos: number;
    }>("SELECT subtotal_centavos, total_centavos, frete_centavos FROM pedidos WHERE id = $1", [pedido.id]);

    const linha = gravado.rows[0];
    expect(linha).toBeDefined();
    // 5970 + 2000 = 7970. Inteiro, exato, sem resíduo de ponto flutuante.
    expect(linha?.total_centavos).toBe((linha?.subtotal_centavos ?? 0) + (linha?.frete_centavos ?? 0));
    expect(linha?.total_centavos).toBe(7970);
  });
});

describe("produtos", () => {
  it("cadastra, edita e inativa preservando o histórico", async () => {
    const id = `prod-teste-${Date.now()}`;
    await inserirProduto({
      id,
      nome: "Produto de Teste",
      descricao: "Item criado pela suite.",
      preco: 10,
      quantidade: 5,
      categoria_id: "cat-outros",
    });

    expect((await listarProdutos()).map((p) => p.id)).toContain(id);

    await atualizarProduto(id, {
      nome: "Editado",
      descricao: "d",
      preco: 20,
      quantidade: 7,
      categoria_id: "cat-outros",
    });
    const comInativos = await listarProdutos(true);
    const editado = comInativos.find((p) => p.id === id);
    expect(editado?.nome).toBe("Editado");
    expect(editado?.preco).toBe(20);

    await inativarProduto(id);
    expect((await listarProdutos()).map((p) => p.id)).not.toContain(id);
    // Inativar é soft delete: o registro continua no banco.
    expect((await listarProdutos(true)).find((p) => p.id === id)).toBeDefined();
  });

  it("registra movimentação de estoque quando a quantidade muda", async () => {
    const id = `prod-mov-${Date.now()}`;
    await inserirProduto({ id, nome: "Mov", descricao: "d", preco: 5, quantidade: 1, categoria_id: "cat-outros" });
    await atualizarProduto(id, { nome: "Mov", descricao: "d", preco: 5, quantidade: 9, categoria_id: "cat-outros" });

    const movimento = await obterPool().query<{ tipo: string; quantidade: number }>(
      "SELECT tipo, quantidade FROM movimentacoes_estoque WHERE produto_id = $1",
      [id],
    );
    expect(movimento.rows[0]).toBeDefined();
    expect(movimento.rows[0]?.quantidade).toBe(8);
  });

  it("lista categorias sem duplicar", async () => {
    const categorias = await listarCategorias();
    const nomes = categorias.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes).toContain("Eletrônicos");
  });
});

describe("favoritos e avaliações", () => {
  let usuario: string;

  beforeEach(async () => {
    usuario = await novoCliente();
  });

  it("grava o favorito pelo estado desejado, de forma idempotente", async () => {
    expect(await listarFavoritos(usuario)).toHaveLength(0);

    expect(await favoritarProduto(usuario, "prod-teclado")).toBe(true);
    expect(await listarFavoritos(usuario)).toHaveLength(1);

    // Repetir a mesma escrita não pode alternar o estado: era exatamente o que
    // fazia um clique duplo inverter o favorito.
    expect(await favoritarProduto(usuario, "prod-teclado")).toBe(true);
    expect(await listarFavoritos(usuario)).toHaveLength(1);

    expect(await desfavoritarProduto(usuario, "prod-teclado")).toBe(false);
    expect(await listarFavoritos(usuario)).toHaveLength(0);

    // Remover o que não existe também não muda nada, e não falha.
    expect(await desfavoritarProduto(usuario, "prod-teclado")).toBe(false);
    expect(await listarFavoritos(usuario)).toHaveLength(0);
  });

  it("substitui a avaliação do mesmo usuário em vez de duplicar", async () => {
    // Produto exclusivo deste teste: `prod-mouse` acumula avaliação de outros
    // testes que rodam na mesma execução, e a contagem não fecharia.
    await criarProdutoDeTeste({
      id: "prod-avaliado",
      nome: "Produto avaliado",
      descricao: "Recebe avaliação.",
      preco: 50,
      quantidade: 10,
    });

    await criarPedido(usuario, [{ produtoId: "prod-avaliado", quantidade: 1 }]);
    await salvarAvaliacao(usuario, "prod-avaliado", 3, "Comentário inicial");
    await expect(salvarAvaliacao(usuario, "prod-avaliado", 1, "Duplicada")).rejects.toMatchObject({ status: 403 });
    await criarPedido(usuario, [{ produtoId: "prod-avaliado", quantidade: 1 }]);
    await salvarAvaliacao(usuario, "prod-avaliado", 5, "Reavaliado");

    const avaliacoes = await listarAvaliacoes("prod-avaliado");
    expect(avaliacoes).toHaveLength(1);
    expect(avaliacoes[0]?.nota).toBe(5);
    expect(avaliacoes[0]?.comentario).toBe("Reavaliado");
  });

  it("cancelamento confirmado enquanto a avaliação espera impede a gravação", async () => {
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-mouse", quantidade: 1 }]);
    const client = await obterPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM pedidos WHERE id = $1 FOR UPDATE", [pedido.id]);
      const avaliacao = salvarAvaliacao(usuario, "prod-mouse", 2, "Cancelado");
      const rejeicao = expect(avaliacao).rejects.toMatchObject({ status: 403 });
      await client.query("UPDATE pedidos SET status = 'cancelado' WHERE id = $1", [pedido.id]);
      await client.query("COMMIT");
      await rejeicao;
      expect((await obterPool().query("SELECT id FROM avaliacoes WHERE usuario_id = $1", [usuario])).rows).toHaveLength(
        0,
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("endereço e status de pedido", () => {
  it("não reativa pedido sem estoque e não devolve unidades fictícias", async () => {
    const usuario = await novoCliente();
    const produtoId = "prod-ultima-unidade";
    await criarProdutoDeTeste({ id: produtoId, nome: "Última unidade", descricao: "Teste", preco: 10, quantidade: 1 });
    const primeiro = await criarPedido(usuario, [{ produtoId, quantidade: 1 }]);
    await atualizarStatusPedido(primeiro.id, "cancelado");
    await criarPedido(usuario, [{ produtoId, quantidade: 1 }]);

    await expect(atualizarStatusPedido(primeiro.id, "processando")).rejects.toThrow(/estoque insuficiente/i);
    expect((await listarPedidosDoUsuario(usuario)).find((pedido) => pedido.id === primeiro.id)?.status).toBe(
      "cancelado",
    );
    expect(await estoque(produtoId)).toBe(0);
    await atualizarStatusPedido(primeiro.id, "cancelado");
    expect(await estoque(produtoId)).toBe(0);
    const auditoria = await obterPool().query(
      "SELECT 1 FROM auditoria WHERE entidade_id = $1 AND depois->>'status' = 'processando' AND acao = 'status_alterado'",
      [primeiro.id],
    );
    expect(auditoria.rows).toHaveLength(0);
  });

  it("reativa com estoque suficiente e reserva as unidades novamente", async () => {
    const usuario = await novoCliente();
    const produtoId = "prod-reativavel";
    await criarProdutoDeTeste({ id: produtoId, nome: "Reativável", descricao: "Teste", preco: 10, quantidade: 2 });
    const pedido = await criarPedido(usuario, [{ produtoId, quantidade: 2 }]);
    await atualizarStatusPedido(pedido.id, "cancelado");
    expect(await estoque(produtoId)).toBe(2);
    await atualizarStatusPedido(pedido.id, "processando");
    expect(await estoque(produtoId)).toBe(0);
  });

  it("salva o endereço do usuário", async () => {
    const usuario = await novoCliente();
    await atualizarEnderecoUsuario(usuario, {
      cep: "01001000",
      rua: "Praça da Sé",
      numero: "1",
      complemento: "Sala 2",
      bairro: "Sé",
      cidade: "São Paulo",
      estado: "SP",
    });
    const perfil = await buscarPerfilUsuario(usuario);
    expect(perfil?.cidade).toBe("São Paulo");
  });

  it("rejeita status de pedido desconhecido", async () => {
    const usuario = await novoCliente();
    await atualizarEnderecoUsuario(usuario, {
      cep: "01001000",
      rua: "Praça da Sé",
      numero: "1",
      complemento: "",
      bairro: "Sé",
      cidade: "São Paulo",
      estado: "SP",
    });
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }]);
    await expect(atualizarStatusPedido(pedido.id, "inventado")).rejects.toThrow(/inválido/i);
    await expect(atualizarStatusPedido(pedido.id, "enviado")).resolves.toBeUndefined();
  });

  it("rejeita saltos e retornos sem alterar estoque ou auditoria", async () => {
    const usuario = await novoCliente();
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }]);
    const saldo = await estoque("prod-teclado");
    await expect(atualizarStatusPedido(pedido.id, "finalizado")).rejects.toMatchObject({ status: 409 });
    await expect(atualizarStatusPedido(pedido.id, "enviado")).rejects.toThrow(/endereço/i);
    await atualizarStatusPedido(pedido.id, "cancelado");
    await expect(atualizarStatusPedido(pedido.id, "enviado")).rejects.toMatchObject({ status: 409 });
    expect(await estoque("prod-teclado")).toBe(saldo + 1);
    const historico = await obterPool().query(
      "SELECT depois FROM auditoria WHERE entidade_id = $1 AND acao = 'status_alterado'",
      [pedido.id],
    );
    expect(historico.rows).toEqual([{ depois: { status: "cancelado" } }]);
  });

  it("finalização é terminal e repetir o estado não cria auditoria", async () => {
    const usuario = await novoCliente();
    await atualizarEnderecoUsuario(usuario, {
      cep: "01001000",
      rua: "Praça da Sé",
      numero: "1",
      complemento: "",
      bairro: "Sé",
      cidade: "São Paulo",
      estado: "SP",
    });
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-mouse", quantidade: 1 }]);
    await atualizarStatusPedido(pedido.id, "enviado");
    await expect(atualizarStatusPedido(pedido.id, "cancelado")).rejects.toMatchObject({ status: 409 });
    await atualizarStatusPedido(pedido.id, "finalizado");
    await atualizarStatusPedido(pedido.id, "finalizado");
    await expect(atualizarStatusPedido(pedido.id, "processando")).rejects.toMatchObject({ status: 409 });
    const historico = await obterPool().query(
      "SELECT id FROM auditoria WHERE entidade_id = $1 AND acao = 'status_alterado'",
      [pedido.id],
    );
    expect(historico.rows).toHaveLength(2);
  });

  it.each([true, false])("congela o endereço do pedido no envio, endereço na compra=%s", async (enderecoNaCompra) => {
    const usuario = await novoCliente();
    const endereco = {
      cep: "01001000",
      rua: "Rua original",
      numero: "1",
      complemento: "",
      bairro: "Sé",
      cidade: "São Paulo",
      estado: "SP",
    };
    if (enderecoNaCompra) await atualizarEnderecoUsuario(usuario, endereco);
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-mouse", quantidade: 1 }]);
    await atualizarEnderecoUsuario(usuario, { ...endereco, rua: "Rua antes do envio" });
    await atualizarStatusPedido(pedido.id, "enviado");
    await atualizarEnderecoUsuario(usuario, { ...endereco, rua: "Rua depois do envio" });
    await atualizarStatusPedido(pedido.id, "finalizado");
    const gravado = await obterPool().query("SELECT rua_entrega FROM pedidos WHERE id = $1", [pedido.id]);
    expect(gravado.rows[0]?.rua_entrega).toBe(enderecoNaCompra ? "Rua original" : "Rua antes do envio");
  });

  it("cancelamentos concorrentes devolvem o estoque uma única vez", async () => {
    const usuario = await novoCliente();
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-cam", quantidade: 1 }]);
    const saldo = await estoque("prod-cam");
    await Promise.all([atualizarStatusPedido(pedido.id, "cancelado"), atualizarStatusPedido(pedido.id, "cancelado")]);
    expect(await estoque("prod-cam")).toBe(saldo + 1);
  });

  it("devolve o estoque ao cancelar um pedido", async () => {
    const usuario = await novoCliente();
    const antes = await estoque("prod-headset");

    const pedido = await criarPedido(usuario, [{ produtoId: "prod-headset", quantidade: 2 }]);
    expect(await estoque("prod-headset")).toBe(antes - 2);

    await atualizarStatusPedido(pedido.id, "cancelado");
    // Sem isso, o produto ficaria invisível para sempre depois de um cancelamento.
    expect(await estoque("prod-headset")).toBe(antes);
  });
});

describe("tokens de redefinição de senha", () => {
  it("revoga as sessões existentes ao redefinir a senha", async () => {
    const usuario = await novoCliente();
    const sessao = "sessao-anterior-a-recuperacao";
    const hash = createHash("sha256").update(sessao).digest("hex");
    await criarSessao(sessao, usuario, 60_000);
    expect(await obterSessao(hash)).toBe(usuario);
    const token = await criarTokenRedefinicaoSenha(`${usuario}@exemplo.com`);
    expect(await redefinirSenhaComToken(token ?? "", "novaSenha456")).toBe(true);
    expect(await obterSessao(hash)).toBeUndefined();
  });

  it("consome o token uma só vez entre duas redefinições concorrentes", async () => {
    const usuario = await novoCliente();
    const token = await criarTokenRedefinicaoSenha(`${usuario}@exemplo.com`);
    const resultados = await Promise.all([
      redefinirSenhaComToken(token ?? "", "primeiraSenha123"),
      redefinirSenhaComToken(token ?? "", "segundaSenha456"),
    ]);
    expect(resultados.filter(Boolean)).toHaveLength(1);
    const senhaFinal = (await buscarUsuarioPorEmail(`${usuario}@exemplo.com`))?.senha ?? "";
    expect(verificarSenha(resultados[0] ? "primeiraSenha123" : "segundaSenha456", senhaFinal)).toBe(true);
  });

  it("gera um token que reseta a senha uma única vez", async () => {
    const usuario = await novoCliente();
    const token = await criarTokenRedefinicaoSenha(`${usuario}@exemplo.com`);

    expect(token).toBeDefined();
    expect(token?.length).toBeGreaterThanOrEqual(32);
    expect(await redefinirSenhaComToken(token ?? "", "novaSenha456")).toBe(true);

    const depois = await buscarUsuarioPorEmail(`${usuario}@exemplo.com`);
    expect(verificarSenha("novaSenha456", depois?.senha ?? "")).toBe(true);

    // Segundo uso do mesmo token tem que falhar.
    expect(await redefinirSenhaComToken(token ?? "", "outraSenha789")).toBe(false);
  });

  it("não emite token para e-mail inexistente", async () => {
    expect(await criarTokenRedefinicaoSenha("ninguem@exemplo.com")).toBeUndefined();
  });

  it("recusa token inválido", async () => {
    expect(await redefinirSenhaComToken("token-inventado-com-tamanho-suficiente-1234", "x")).toBe(false);
  });
});

describe("integridade da demonstração", () => {
  it("não cria nem mantém pedidos artificiais do administrador", async () => {
    await semear();
    const pedidosDeDemonstracao = await obterPool().query("SELECT id FROM pedidos WHERE id = ANY($1::text[])", [
      ["ped-demo-1", "ped-demo-2", "ped-demo-3", "ped-demo-4", "ped-demo-5", "ped-demo-6", "ped-demo-7", "ped-demo-8"],
    ]);
    expect(pedidosDeDemonstracao.rows).toEqual([]);
  });

  it("reexecutar seed preserva vendas e edições de produtos existentes", async () => {
    const usuario = await novoCliente();
    await obterPool().query(
      "UPDATE produtos SET quantidade = 3, nome = 'Nome personalizado', preco_centavos = 1234, imagem = '/minha-foto.jpg' WHERE id = 'prod-teclado'",
    );
    const pedido = await criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }]);
    await semear();
    const produto = await obterPool().query(
      "SELECT nome, quantidade, preco_centavos, imagem FROM produtos WHERE id = 'prod-teclado'",
    );
    expect(produto.rows[0]).toMatchObject({
      nome: "Nome personalizado",
      quantidade: 2,
      preco_centavos: 1234,
      imagem: "/minha-foto.jpg",
    });
    expect((await listarPedidosDoUsuario(usuario)).map((item) => item.id)).toContain(pedido.id);
  });

  it("calcula ticket médio com o mesmo conjunto de pedidos da receita", async () => {
    const dashboard = await listarDashboard();
    const esperados = await obterPool().query(
      "SELECT COALESCE(SUM(total_centavos), 0)::numeric / NULLIF(COUNT(*), 0) / 100 AS ticket FROM pedidos WHERE status <> 'cancelado'",
    );
    expect(dashboard.ticketMedio).toBeCloseTo(Number(esperados.rows[0]?.ticket ?? 0), 8);
  });

  it("mantém uma única sessão mesmo com logins simultâneos", async () => {
    const usuario = await novoCliente();
    await Promise.all([
      criarSessao("login-paralelo-a", usuario, 60_000),
      criarSessao("login-paralelo-b", usuario, 60_000),
    ]);
    const sessoes = await obterPool().query("SELECT token_hash FROM sessoes WHERE usuario_id = $1", [usuario]);
    expect(sessoes.rows).toHaveLength(1);
  });
});

describe("proteção do reset local", () => {
  it.each([
    "postgresql://usuario:senha@localhost:5433/loja",
    "postgres://usuario:senha@127.0.0.1/loja",
    "postgresql://usuario:senha@[::1]/loja",
  ])("aceita host local: %s", (url) => {
    expect(bancoLocal(url)).toBe(true);
  });

  it.each([
    "postgresql://usuario:localhost@banco.example/loja",
    "postgresql://localhost:senha@banco.example/loja",
    "postgresql://usuario:senha@banco.example/localhost",
    "postgresql://usuario:senha@localhost.example/loja",
    "postgresql://usuario:senha@banco.example/loja?host=127.0.0.1",
    "postgresql://usuario:senha@localhost/loja?host=banco.example",
    "postgresql://usuario:senha@localhost/loja?hostaddr=203.0.113.1",
    "https://localhost/loja",
    "localhost",
  ])("recusa um alvo que não é PostgreSQL local: %s", (url) => {
    expect(bancoLocal(url)).toBe(false);
  });
});

describe("TLS do PostgreSQL", () => {
  it.each(["no-verify", "disable", "prefer", "require"])("não permite sslmode=%s rebaixar TLS habilitado", (modo) => {
    const opcoes = conexaoPostgres(`postgresql://usuario:senha@banco.example/loja?sslmode=${modo}`, true);
    expect(new URL(opcoes.connectionString).searchParams.get("sslmode")).toBe("verify-full");
    expect(opcoes.ssl?.rejectUnauthorized).toBe(true);
  });
});

async function prepararCompra(id: string, quantidade = 3) {
  const usuario = await novoCliente();
  await criarProdutoDeTeste({ id, nome: "Produto de compra repetida", descricao: "Teste", preco: 200, quantidade });
  return { usuario, itens: [{ produtoId: id, quantidade: 1 }], chave: randomUUID() };
}

describe("idempotência da compra", () => {
  it("duas tentativas simultâneas criam um pedido e debitam estoque e cupom uma vez", async () => {
    const { usuario, itens, chave } = await prepararCompra("prod-idempotente");
    await zerarCupons();
    const [primeiro, segundo] = await Promise.all([
      criarPedido(usuario, itens, "BEMVINDO10", "pix", chave),
      criarPedido(usuario, itens, "BEMVINDO10", "pix", chave),
    ]);
    expect(segundo).toEqual(primeiro);
    expect(await estoque("prod-idempotente")).toBe(2);
    expect(await listarPedidosDoUsuario(usuario)).toHaveLength(1);
    const cupom = await obterPool().query("SELECT usos FROM cupons WHERE codigo = 'BEMVINDO10'");
    expect(cupom.rows[0]?.usos).toBe(1);
    const auditoria = await obterPool().query("SELECT id FROM auditoria WHERE entidade_id = $1 AND acao = 'criado'", [
      primeiro.id,
    ]);
    expect(auditoria.rows).toHaveLength(1);
  });

  it("recusa reutilizar a chave para uma compra diferente", async () => {
    const { usuario, itens, chave } = await prepararCompra("prod-chave-conflito");
    await criarPedido(usuario, itens, undefined, "pix", chave);
    await expect(
      criarPedido(usuario, [{ produtoId: "prod-chave-conflito", quantidade: 2 }], undefined, "pix", chave),
    ).rejects.toThrow(/outros itens ou condições/i);
    expect(await estoque("prod-chave-conflito")).toBe(2);
    expect(await listarPedidosDoUsuario(usuario)).toHaveLength(1);
  });

  it("isola a chave por usuário", async () => {
    const { usuario, itens, chave } = await prepararCompra("prod-chave-por-conta");
    const outroUsuario = await novoCliente();
    const primeiro = await criarPedido(usuario, itens, undefined, "pix", chave);
    const segundo = await criarPedido(outroUsuario, itens, undefined, "pix", chave);
    expect(primeiro.id).not.toBe(segundo.id);
    expect(await estoque("prod-chave-por-conta")).toBe(1);
  });

  it("permite repetir a tentativa depois de uma transação recusada", async () => {
    const { usuario, itens, chave } = await prepararCompra("prod-chave-rollback", 0);
    await expect(criarPedido(usuario, itens, undefined, "pix", chave)).rejects.toThrow(/estoque/i);
    await obterPool().query("UPDATE produtos SET quantidade = 1 WHERE id = 'prod-chave-rollback'");
    const criado = await criarPedido(usuario, itens, undefined, "pix", chave);
    expect((await criarPedido(usuario, itens, undefined, "pix", chave)).id).toBe(criado.id);
    expect(await estoque("prod-chave-rollback")).toBe(0);
  });

  it("reconhece os mesmos itens enviados em outra ordem", async () => {
    const { usuario, itens, chave } = await prepararCompra("prod-ordem-a");
    await criarProdutoDeTeste({
      id: "prod-ordem-b",
      nome: "Outro produto",
      descricao: "Teste",
      preco: 10,
      quantidade: 3,
    });
    const compra = [...itens, { produtoId: "prod-ordem-b", quantidade: 1 }];
    const primeiro = await criarPedido(usuario, compra, undefined, "pix", chave);
    expect(await criarPedido(usuario, compra.toReversed(), undefined, "pix", chave)).toEqual(primeiro);
    expect(await estoque("prod-ordem-a")).toBe(2);
    expect(await estoque("prod-ordem-b")).toBe(2);
  });

  it("chaves diferentes representam compras distintas", async () => {
    const { usuario, itens, chave } = await prepararCompra("prod-compras-distintas");
    const primeiro = await criarPedido(usuario, itens, undefined, "pix", chave);
    const segundo = await criarPedido(usuario, itens, undefined, "pix", randomUUID());
    expect(segundo.id).not.toBe(primeiro.id);
    expect(await estoque("prod-compras-distintas")).toBe(1);
  });
});
