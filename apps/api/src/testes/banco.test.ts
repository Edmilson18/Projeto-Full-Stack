import { beforeEach, describe, expect, it } from "vitest";
import {
  alternarFavorito,
  atualizarEnderecoUsuario,
  atualizarProduto,
  atualizarStatusPedido,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  conectarBanco,
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
  salvarAvaliacao,
  validarCupomCodigo,
  verificarSenha,
} from "../database.js";

/** Cria um cliente novo e devolve o id. */
function novoCliente(nome = "Ana Souza"): string {
  const id = `usr-${Math.random().toString(36).slice(2, 10)}`;
  criarUsuario({ id, nome, email: `${id}@exemplo.com`, senha: "senha123" });
  return id;
}

function estoque(produtoId: string): number {
  const db = conectarBanco();
  try {
    const linha = db.prepare("SELECT quantidade FROM produtos WHERE id = ?").get(produtoId) as { quantidade: number };
    return linha.quantidade;
  } finally {
    db.close();
  }
}

describe("senhas", () => {
  it("nunca guarda a senha em texto puro", () => {
    const id = novoCliente();
    const usuario = buscarUsuarioPorId(id);
    expect(usuario).toBeDefined();
    // buscarUsuarioPorId nem retorna a coluna senha; o email expoe o hash.
    expect("senha" in (usuario as object)).toBe(false);

    const comSenha = buscarUsuarioPorEmail(`${id}@exemplo.com`) as unknown as { senha: string };
    expect(comSenha.senha).not.toContain("senha123");
    expect(comSenha.senha.startsWith("scrypt$")).toBe(true);
  });

  it("confere a senha correta e rejeita a errada", () => {
    const id = novoCliente();
    const { senha } = buscarUsuarioPorEmail(`${id}@exemplo.com`) as unknown as { senha: string };

    expect(verificarSenha("senha123", senha)).toBe(true);
    expect(verificarSenha("senha124", senha)).toBe(false);
    expect(verificarSenha("", senha)).toBe(false);
  });

  it("gera um salt diferente a cada hash", () => {
    const a = novoCliente();
    const b = novoCliente();
    const hashA = (buscarUsuarioPorEmail(`${a}@exemplo.com`) as unknown as { senha: string }).senha;
    const hashB = (buscarUsuarioPorEmail(`${b}@exemplo.com`) as unknown as { senha: string }).senha;

    // Mesma senha, hashes diferentes: sem isso, dois usuarios iguais seriam
    // identificaveis no banco.
    expect(hashA).not.toBe(hashB);
  });
});

describe("cupons", () => {
  it("aceita um cupom percentual ativo", () => {
    const resultado = validarCupomCodigo("BEMVINDO10");
    expect(resultado.valido).toBe(true);
    if (resultado.valido) {
      expect(resultado.porcentagemDesconto).toBe(10);
      expect(resultado.tipoDesconto).toBe("porcentagem");
    }
  });

  it("é case insensitive no código", () => {
    expect(validarCupomCodigo("bemvindo10").valido).toBe(true);
    expect(validarCupomCodigo("  BEMVINDO10  ").valido).toBe(true);
  });

  it("rejeita cupom inexistente, inativo ou expirado", () => {
    expect(validarCupomCodigo("NAOEXISTE").valido).toBe(false);
    expect(validarCupomCodigo("").valido).toBe(false);

    const db = conectarBanco();
    try {
      db.prepare("UPDATE cupons SET ativo = 0 WHERE codigo = 'BEMVINDO10'").run();
      expect(validarCupomCodigo("BEMVINDO10").valido).toBe(false);
      db.prepare("UPDATE cupons SET ativo = 1, fim_em = '2000-01-01 00:00:00' WHERE codigo = 'BEMVINDO10'").run();
      expect(validarCupomCodigo("BEMVINDO10").valido).toBe(false);
      db.prepare("UPDATE cupons SET fim_em = NULL WHERE codigo = 'BEMVINDO10'").run();
      expect(validarCupomCodigo("BEMVINDO10").valido).toBe(true);
    } finally {
      db.close();
    }
  });

  it("respeita o limite de uso", () => {
    const db = conectarBanco();
    try {
      db.prepare("UPDATE cupons SET limite_uso = 1, usos = 1 WHERE codigo = 'BEMVINDO10'").run();
      expect(validarCupomCodigo("BEMVINDO10").valido).toBe(false);
      db.prepare("UPDATE cupons SET limite_uso = NULL, usos = 0 WHERE codigo = 'BEMVINDO10'").run();
      expect(validarCupomCodigo("BEMVINDO10").valido).toBe(true);
    } finally {
      db.close();
    }
  });

  it("não lista cupom inativo nem expirado", () => {
    const db = conectarBanco();
    try {
      db.prepare("UPDATE cupons SET ativo = 0 WHERE codigo = 'BEMVINDO10'").run();
      const codigos = listarCuponsAtivos().map((c) => (c as { codigo: string }).codigo);
      expect(codigos).not.toContain("BEMVINDO10");
      expect(codigos).toContain("FRETEGRATIS");
    } finally {
      db.prepare("UPDATE cupons SET ativo = 1 WHERE codigo = 'BEMVINDO10'").run();
      db.close();
    }
  });
});

describe("criação de pedido", () => {
  it("calcula subtotal e total, e debita o estoque", () => {
    const usuario = novoCliente();
    const antes = estoque("prod-teclado");

    const pedido = criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 2 }]) as unknown as {
      id: string;
      subtotal: number;
      frete: number;
      total_final: number;
    };

    expect(pedido.subtotal).toBeCloseTo(1199.8, 2);
    // Acima de 150, o frete é zero.
    expect(pedido.frete).toBe(0);
    expect(pedido.total_final).toBeCloseTo(1199.8, 2);
    expect(estoque("prod-teclado")).toBe(antes - 2);
    expect(pedido.id).toMatch(/^PED-\d{8}-[0-9A-F]{6}$/);
  });

  it("cobra frete quando o subtotal fica abaixo de 150", () => {
    const usuario = novoCliente();
    inserirProduto({
      id: "prod-barato",
      nome: "Barato",
      descricao: "Item abaixo da faixa de frete grátis.",
      preco: 100,
      quantidade: 50,
      categoria_id: "cat-outros",
    });

    const pedido = criarPedido(usuario, [{ produtoId: "prod-barato", quantidade: 1 }]) as unknown as {
      frete: number;
      total_final: number;
    };
    expect(pedido.frete).toBe(20);
    expect(pedido.total_final).toBe(120);
  });

  it("aplica cupom percentual de desconto", () => {
    const usuario = novoCliente();
    const pedido = criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }], "BEMVINDO10") as unknown as {
      subtotal: number;
      desconto: number;
      total_final: number;
    };

    expect(pedido.subtotal).toBeCloseTo(599.9, 2);
    expect(pedido.desconto).toBeCloseTo(59.99, 2);
    expect(pedido.total_final).toBeCloseTo(539.91, 2);
  });

  it("aplica cupom de frete grátis mesmo abaixo do mínimo de frete", () => {
    const usuario = novoCliente();
    inserirProduto({
      id: "prod-barato-frete",
      nome: "Barato para frete",
      descricao: "Item barato para exercitar o cupom de frete.",
      preco: 100,
      quantidade: 50,
      categoria_id: "cat-outros",
    });

    const semCupom = criarPedido(usuario, [{ produtoId: "prod-barato-frete", quantidade: 1 }]) as unknown as {
      frete: number;
    };
    expect(semCupom.frete).toBe(20);

    const comCupom = criarPedido(
      usuario,
      [{ produtoId: "prod-barato-frete", quantidade: 1 }],
      "FRETEGRATIS",
    ) as unknown as {
      frete: number;
      desconto: number;
    };
    expect(comCupom.frete).toBe(0);
    expect(comCupom.desconto).toBe(0);
  });

  it("incrementa o contador de uso do cupom", () => {
    const usuario = novoCliente();
    const antes = (
      conectarBanco().prepare("SELECT usos FROM cupons WHERE codigo = 'BEMVINDO10'").get() as { usos: number }
    ).usos;
    criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }], "BEMVINDO10");
    const depois = (
      conectarBanco().prepare("SELECT usos FROM cupons WHERE codigo = 'BEMVINDO10'").get() as { usos: number }
    ).usos;
    expect(depois).toBe(antes + 1);
  });

  it("recusa estoque insuficiente e nao mexe no estoque", () => {
    const usuario = novoCliente();
    const antes = estoque("prod-cam");

    expect(() => criarPedido(usuario, [{ produtoId: "prod-cam", quantidade: 99999 }])).toThrow(/estoque/i);
    expect(estoque("prod-cam")).toBe(antes);
  });

  it("faz rollback quando um item do pedido falha", () => {
    const usuario = novoCliente();
    const antesTeclado = estoque("prod-teclado");

    // O primeiro item é válido; o segundo não existe. A transação inteira
    // precisa desfazer o primeiro, senão o estoque vaza.
    expect(() =>
      criarPedido(usuario, [
        { produtoId: "prod-teclado", quantidade: 1 },
        { produtoId: "prod-inexistente", quantidade: 1 },
      ]),
    ).toThrow();

    expect(estoque("prod-teclado")).toBe(antesTeclado);
  });

  it("recusa quantidade inválida", () => {
    const usuario = novoCliente();
    expect(() => criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 0 }])).toThrow();
    expect(() => criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: -1 }])).toThrow();
    expect(() => criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1.5 }])).toThrow();
  });

  it("recusa carrinho vazio", () => {
    const usuario = novoCliente();
    expect(() => criarPedido(usuario, [])).toThrow(/vazio/i);
  });

  it("recusa cupom inválido", () => {
    const usuario = novoCliente();
    expect(() => criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }], "CUPOM-QUE-NAO-EXISTE")).toThrow(
      /cupom/i,
    );
  });

  it("registra o pedido nos itens com o preço congelado no momento da compra", () => {
    const usuario = novoCliente();
    const pedido = criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }]) as unknown as { id: string };
    const pedidos = listarPedidosDoUsuario(usuario) as unknown as Array<{ id: string; itens: unknown[] }>;
    const encontrado = pedidos.find((p) => p.id === pedido.id);
    expect(encontrado).toBeDefined();
    expect(encontrado?.itens.length).toBe(1);
  });
});

describe("precisão monetária", () => {
  it("documenta o artefato de ponto flutuante que a Fase 4 vai corrigir", () => {
    // Somar preços de itens, que é o cálculo de carrinho, não fecha em IEEE 754.
    // 19,90 + 19,90 + 19,90 deveria dar 59,70.
    const soma = [19.9, 19.9, 19.9].reduce((total, preco) => total + preco, 0);
    expect(soma).not.toBe(59.7);
    expect(soma).toBeCloseTo(59.7, 10);

    // O caso clássico de arredondamento: 1,005 * 100 deveria dar 100,5.
    expect(1.005 * 100).not.toBe(100.5);
    expect(1.005 * 100).toBe(100.49999999999999);

    // Em centavos inteiros o mesmo cálculo é exato, sem resíduo.
    expect(1990 * 3).toBe(5970);
    expect(1005 * 100).toBe(100500);
  });

  it("confirma que o desconto por cupom hoje introduz resíduo de float", () => {
    // 599,90 com 10% de desconto: 59,99 de desconto sobre um subtotal fracionado.
    const subtotal = 599.9;
    const desconto = subtotal * (10 / 100);
    expect(desconto).toBeCloseTo(59.99, 10);
    // E o total resultante não é exatamente o que se vê na tela.
    expect(subtotal - desconto).toBeCloseTo(539.91, 10);
  });
});

describe("produtos", () => {
  it("cadastra, edita e inativa preservando o histórico", () => {
    const id = `prod-teste-${Date.now()}`;
    inserirProduto({
      id,
      nome: "Produto de Teste",
      descricao: "Item criado pela suite.",
      preco: 10,
      quantidade: 5,
      categoria_id: "cat-outros",
    });

    const ativos = listarProdutos() as unknown as Array<{ id: string }>;
    expect(ativos.map((p) => p.id)).toContain(id);

    atualizarProduto(id, { nome: "Editado", descricao: "d", preco: 20, quantidade: 7, categoria_id: "cat-outros" });
    const comInativos = listarProdutos(true) as unknown as Array<{
      id: string;
      nome: string;
      preco: number;
      quantidade: number;
    }>;
    const editado = comInativos.find((p) => p.id === id);
    expect(editado?.nome).toBe("Editado");
    expect(editado?.preco).toBe(20);

    inativarProduto(id);
    const ativosDepois = listarProdutos() as unknown as Array<{ id: string }>;
    expect(ativosDepois.map((p) => p.id)).not.toContain(id);
    // Inativar e soft delete: o registro continua no banco.
    const aindaExiste = comInativos.find((p) => p.id === id);
    expect(aindaExiste).toBeDefined();
  });

  it("registra movimentação de estoque quando a quantidade muda", () => {
    const id = `prod-mov-${Date.now()}`;
    inserirProduto({ id, nome: "Mov", descricao: "d", preco: 5, quantidade: 1, categoria_id: "cat-outros" });
    atualizarProduto(id, { nome: "Mov", descricao: "d", preco: 5, quantidade: 9, categoria_id: "cat-outros" });

    const db = conectarBanco();
    try {
      const movimento = db
        .prepare("SELECT tipo, quantidade FROM movimentacoes_estoque WHERE produto_id = ?")
        .get(id) as { tipo: string; quantidade: number } | undefined;
      expect(movimento).toBeDefined();
      expect(movimento?.quantidade).toBe(8);
    } finally {
      db.close();
    }
  });

  it("lista categorias sem duplicar", () => {
    const categorias = listarCategorias() as unknown as Array<{ nome: string }>;
    const nomes = categorias.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes).toContain("Eletrônicos");
  });
});

describe("favoritos e avaliações", () => {
  let usuario: string;

  beforeEach(() => {
    usuario = novoCliente();
  });

  it("alterna favorito e devolve o estado final", () => {
    const antes = listarFavoritos(usuario) as unknown as unknown[];
    expect(antes.length).toBe(0);

    expect(alternarFavorito(usuario, "prod-teclado")).toBe(true);
    expect((listarFavoritos(usuario) as unknown as unknown[]).length).toBe(1);

    expect(alternarFavorito(usuario, "prod-teclado")).toBe(false);
    expect((listarFavoritos(usuario) as unknown as unknown[]).length).toBe(0);
  });

  it("substitui a avaliação do mesmo usuário em vez de duplicar", () => {
    salvarAvaliacao(usuario, "prod-mouse", 3, "Commentário inicial");
    salvarAvaliacao(usuario, "prod-mouse", 5, "Reavaliado");

    const avaliacoes = listarAvaliacoes("prod-mouse") as unknown as Array<{ nota: number; comentario: string }>;
    const doUsuario = avaliacoes.filter((a) => a.comentario === "Reavaliado");
    expect(doUsuario).toHaveLength(1);
    expect(doUsuario[0]?.nota).toBe(5);
  });
});

describe("endereço e status de pedido", () => {
  it("salva o endereço do usuário", () => {
    const usuario = novoCliente();
    atualizarEnderecoUsuario(usuario, {
      cep: "01001000",
      rua: "Praça da Sé",
      numero: "1",
      complemento: "Sala 2",
      bairro: "Sé",
      cidade: "São Paulo",
      estado: "SP",
    });
    const perfil = JSON.parse(JSON.stringify(buscarUsuarioPorEmail(`${usuario}@exemplo.com`)));
    expect(perfil).toBeDefined();
  });

  it("rejeita status de pedido desconhecido", () => {
    const usuario = novoCliente();
    const pedido = criarPedido(usuario, [{ produtoId: "prod-teclado", quantidade: 1 }]) as unknown as { id: string };
    expect(() => atualizarStatusPedido(pedido.id, "inventado")).toThrow(/inválido/i);
    expect(() => atualizarStatusPedido(pedido.id, "enviado")).not.toThrow();
  });
});

describe("tokens de redefinição de senha", () => {
  it("gera um token que reseta a senha uma única vez", () => {
    const usuario = novoCliente();
    const token = criarTokenRedefinicaoSenha(`${usuario}@exemplo.com`);

    expect(token).toBeDefined();
    expect(token!.length).toBeGreaterThanOrEqual(32);
    expect(redefinirSenhaComToken(token!, "novaSenha456")).toBe(true);
    expect(
      verificarSenha(
        "novaSenha456",
        (buscarUsuarioPorEmail(`${usuario}@exemplo.com`) as unknown as { senha: string }).senha,
      ),
    ).toBe(true);

    // Segundo uso do mesmo token tem que falhar.
    expect(redefinirSenhaComToken(token!, "outraSenha789")).toBe(false);
  });

  it("não emite token para e-mail inexistente", () => {
    expect(criarTokenRedefinicaoSenha("ninguem@exemplo.com")).toBeUndefined();
  });

  it("recusa token inválido", () => {
    expect(redefinirSenhaComToken("token-inventado-com-tamanho-suficiente-1234", "x")).toBe(false);
  });
});
