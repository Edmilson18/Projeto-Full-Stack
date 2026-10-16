import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADMIN, iniciarContexto, type Cliente } from "./ajuda.js";
import { limparSessoes } from "../rotas/auth.js";
import { randomUUID } from "node:crypto";

let contexto: Awaited<ReturnType<typeof iniciarContexto>>;
let novo: () => Cliente;

beforeAll(async () => {
  contexto = await iniciarContexto();
  novo = contexto.novoCliente;
});

afterAll(async () => {
  await contexto?.encerrar();
});

/** Cria um cliente novo, autenticado, com papel de cliente comum. */
async function clienteComum(): Promise<Cliente> {
  const cliente = novo();
  const email = `teste-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;
  const cadastro = await cliente.post("/api/cadastro", { nome: "Cliente Teste", email, senha: "senha123" });
  expect(cadastro.status).toBe(201);
  return cliente;
}

describe("autenticação", () => {
  it("faz login com credenciais válidas e devolve o cookie de sessão", async () => {
    const cliente = novo();
    const resposta = await cliente.post("/api/login", ADMIN);

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.usuario).toMatchObject({ email: ADMIN.email, role: "admin" });
    expect(cliente.cookie).toContain("loja_session=");
  });

  it("nunca devolve o hash da senha no login", async () => {
    const resposta = await novo().post("/api/login", ADMIN);
    expect(JSON.stringify(resposta.corpo)).not.toContain("scrypt$");
  });

  it("rejeita senha errada com 401 e sem cookie", async () => {
    const cliente = novo();
    const resposta = await cliente.post("/api/login", { email: ADMIN.email, senha: "senha-errada" });

    expect(resposta.status).toBe(401);
    expect(resposta.corpo.erro).toMatch(/inválido/i);
    expect(cliente.cookie).toBeNull();
  });

  it("rejeita e-mail inexistente com a mesma mensagem de senha errada", async () => {
    // A senha precisa ter 6 caracteres: com uma mais curta, o Zod recusa com
    // 400 antes de qualquer consulta, e o teste deixaria de medir o que
    // realmente quer medir, que é a impossibilidade de enumerar contas.
    const respostaExistente = await novo().post("/api/login", { email: ADMIN.email, senha: "senhaErrada1" });
    const respostaInexistente = await novo().post("/api/login", {
      email: "ninguem@exemplo.com",
      senha: "senhaErrada1",
    });

    // Mensagem igual impede enumerar quais e-mails existem na base.
    expect(respostaInexistente.status).toBe(401);
    expect(respostaInexistente.corpo.erro).toBe(respostaExistente.corpo.erro);
  });

  it("informa o usuário na sessão quando autenticado", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    const resposta = await cliente.get("/api/sessao");

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.usuario.email).toBe(ADMIN.email);
  });

  it("devolve usuário nulo quando anônimo", async () => {
    const resposta = await novo().get("/api/sessao");
    expect(resposta.status).toBe(200);
    expect(resposta.corpo.usuario).toBeNull();
  });

  it("encerra a sessão no logout", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    const saida = await cliente.post("/api/logout");
    expect(saida.status).toBe(200);

    // Depois do logout a sessão precisa estar inválida.
    const depois = await cliente.get("/api/sessao");
    expect(depois.corpo.usuario).toBeNull();
  });
});

describe("cadastro", () => {
  it("cria conta e autentica na hora", async () => {
    const cliente = novo();
    const email = `novo-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;
    const resposta = await cliente.post("/api/cadastro", { nome: "Maria Souza", email, senha: "senha123" });

    expect(resposta.status).toBe(201);
    expect(resposta.corpo.usuario).toMatchObject({ email, role: "cliente" });
    expect(cliente.cookie).toContain("loja_session=");
  });

  it("recusa e-mail duplicado com 409", async () => {
    const email = `dup-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;
    await novo().post("/api/cadastro", { nome: "Primeiro", email, senha: "senha123" });
    const segunda = await novo().post("/api/cadastro", { nome: "Segundo", email, senha: "senha123" });

    expect(segunda.status).toBe(409);
    expect(segunda.corpo.erro).toMatch(/já está cadastrado/i);
  });

  it("valida nome, e-mail e senha", async () => {
    const cliente = novo();
    expect((await cliente.post("/api/cadastro", { nome: "A", email: "a@b.com", senha: "123456" })).status).toBe(400);
    expect((await cliente.post("/api/cadastro", { nome: "Ana", email: "invalido", senha: "123456" })).status).toBe(400);
    expect((await cliente.post("/api/cadastro", { nome: "Ana", email: "a@b.com", senha: "123" })).status).toBe(400);
  });

  it("não deixa o cadastro escolher o próprio papel de admin", async () => {
    const cliente = novo();
    const email = `sneaky-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;
    const resposta = await cliente.post("/api/cadastro", { nome: "Sneaky", email, senha: "senha123", role: "admin" });

    expect(resposta.corpo.usuario.role).toBe("cliente");
  });
});

describe("permissões administrativas", () => {
  it("responde 401 para anônimo e 403 para cliente comum", async () => {
    const anonimo = novo();
    for (const [metodo, rota] of [
      ["get", "/api/dashboard"],
      ["get", "/api/admin/relatorios?inicio=2026-10-01&fim=2026-10-16"],
      ["get", "/api/admin/produtos"],
      ["get", "/api/admin/pedidos"],
    ] as const) {
      // 401 para anônimo: autenticar resolve. 403 para cliente comum: há
      // sessão, mas o papel não basta. A distinção é o que permite ao
      // frontend decidir entre abrir o modal de login e mostrar erro.
      expect((await anonimo[metodo](rota)).status).toBe(401);
    }

    const cliente = await clienteComum();
    for (const [metodo, rota] of [
      ["get", "/api/dashboard"],
      ["get", "/api/admin/relatorios?inicio=2026-10-01&fim=2026-10-16"],
      ["get", "/api/admin/produtos"],
      ["get", "/api/admin/pedidos"],
    ] as const) {
      expect((await cliente[metodo](rota)).status).toBe(403);
    }
  });

  it("bloqueia cliente comum nas rotas de escrita", async () => {
    const cliente = await clienteComum();
    const criar = await cliente.post("/api/produtos", {
      nome: "Produto Picado",
      preco: 10,
      quantidade: 1,
      categoriaId: "cat-outros",
    });
    expect(criar.status).toBe(403);

    const editar = await cliente.put("/api/produtos/prod-teclado", {
      nome: "X",
      preco: 1,
      quantidade: 1,
      categoriaId: "cat-outros",
    });
    expect(editar.status).toBe(403);

    const apagar = await cliente.delete("/api/produtos/prod-teclado");
    expect(apagar.status).toBe(403);
  });

  it("libera o admin", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    const resposta = await cliente.get("/api/dashboard");
    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toHaveProperty("totalProdutos");
    const relatorio = await cliente.get("/api/admin/relatorios?inicio=2000-01-01&fim=2099-12-31");
    expect(relatorio.status).toBe(200);
    expect(relatorio.corpo).toEqual(
      expect.objectContaining({
        totalReceita: expect.any(Number),
        totalPedidos: expect.any(Number),
        produtosVendidos: expect.any(Number),
        vendasPorDia: expect.any(Array),
        vendasPorCategoria: expect.any(Array),
      }),
    );
  });

  it("valida o período dos relatórios", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    const resposta = await cliente.get("/api/admin/relatorios?inicio=2026-10-20&fim=2026-10-01");
    expect(resposta.status).toBe(400);
  });
});

describe("produtos", () => {
  it("lista produtos ativos para qualquer visitante", async () => {
    const resposta = await novo().get("/api/produtos");
    expect(resposta.status).toBe(200);
    expect(Array.isArray(resposta.corpo)).toBe(true);
    expect(resposta.corpo.length).toBeGreaterThan(0);
  });

  it("admin cadastra, edita e inativa produto", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);

    const criado = await cliente.post("/api/produtos", {
      nome: "Produto de Teste HTTP",
      descricao: "Criado pela suite de integracao.",
      preco: 99.9,
      quantidade: 4,
      categoriaId: "cat-outros",
    });
    expect(criado.status).toBe(201);
    const id = criado.corpo.produto.id;

    const editado = await cliente.put(`/api/produtos/${id}`, {
      nome: "Produto Editado",
      preco: 149.9,
      quantidade: 8,
      categoriaId: "cat-outros",
    });
    expect(editado.status).toBe(200);

    const inativado = await cliente.delete(`/api/produtos/${id}`);
    expect(inativado.status).toBe(200);

    const lista = await cliente.get("/api/produtos");
    expect(lista.corpo.map((p: { id: string }) => p.id)).not.toContain(id);
  });

  it("devolve o produto criado, com id e categoria", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);

    const criado = await cliente.post("/api/produtos", {
      nome: "Produto devolvido",
      descricao: "Confere o corpo da resposta da criação.",
      preco: 42.5,
      quantidade: 3,
      categoriaId: "cat-outros",
    });

    expect(criado.status).toBe(201);
    // `categoria` e o NOME da categoria, como na listagem, e o preco vem em
    // reais: o contrato de saida e o mesmo dos outros endpoints de produto.
    expect(criado.corpo.produto).toMatchObject({
      nome: "Produto devolvido",
      preco: 42.5,
      quantidade: 3,
      ativo: true,
    });
    expect(typeof criado.corpo.produto.id).toBe("string");
    expect(typeof criado.corpo.produto.categoria).toBe("string");
  });

  it("responde 404 ao editar ou inativar um produto inexistente", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);

    // O corpo precisa passar por `produtoInput`, senão a resposta seria 400 por
    // validação de entrada e o teste não provaria nada sobre o 404.
    const editado = await cliente.put("/api/produtos/prod-que-nao-existe", {
      nome: "Produto Inexistente",
      preco: 10,
      quantidade: 1,
      categoriaId: "cat-outros",
    });
    expect(editado.status).toBe(404);

    const inativado = await cliente.delete("/api/produtos/prod-que-nao-existe");
    expect(inativado.status).toBe(404);
  });

  it("responde 400 quando a categoria não existe", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);

    // Sem a checagem, o banco recusaria pela chave estrangeira e a rota
    // responderia 500, como se fosse falha de infraestrutura.
    const resposta = await cliente.post("/api/produtos", {
      nome: "Produto sem categoria",
      preco: 10,
      quantidade: 1,
      categoriaId: "cat-que-nao-existe",
    });
    expect(resposta.status).toBe(400);
  });

  it("responde 404 ao favoritar ou avaliar um produto inexistente", async () => {
    const cliente = await clienteComum();

    const favorito = await cliente.put("/api/favoritos/prod-que-nao-existe", {});
    expect(favorito.status).toBe(404);

    const removido = await cliente.delete("/api/favoritos/prod-que-nao-existe");
    expect(removido.status).toBe(404);

    const avaliacao = await cliente.post("/api/avaliacoes/prod-que-nao-existe", { nota: 5, comentario: "" });
    expect(avaliacao.status).toBe(404);
  });

  it("recusa produto com dados inválidos", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);

    const semPreco = await cliente.post("/api/produtos", { nome: "X", quantidade: 1, categoriaId: "cat-outros" });
    expect(semPreco.status).toBe(400);

    const precoNegativo = await cliente.post("/api/produtos", {
      nome: "X",
      preco: -5,
      quantidade: 1,
      categoriaId: "cat-outros",
    });
    expect(precoNegativo.status).toBe(400);

    const semCategoria = await cliente.post("/api/produtos", {
      nome: "Produto",
      preco: 10,
      quantidade: 1,
      categoriaId: "",
    });
    expect(semCategoria.status).toBe(400);
  });

  it("aceita foto local e endereço externo, e recusa o que não é imagem", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);

    const corpo = {
      descricao: "A foto faz parte do pacote de imagens locais.",
      preco: 10,
      quantidade: 1,
      categoriaId: "cat-outros",
    };

    // Caminho local servido pelo próprio site: é o formato das fotos do seed,
    // e a validação antiga só aceitava http/https.
    const local = await cliente.post("/api/produtos", {
      ...corpo,
      nome: "Produto com foto local",
      imagem: "/imagens/teclado.jpg",
    });
    expect(local.status).toBe(201);
    expect(local.corpo.produto.imagem).toBe("/imagens/teclado.jpg");

    // O endereço externo continua sendo aceito: fotos de catálogo de
    // terceiros ainda são um formato válido.
    const externa = await cliente.post("/api/produtos", {
      ...corpo,
      nome: "Produto com foto externa",
      imagem: "https://exemplo.com/foto.jpg",
    });
    expect(externa.status).toBe(201);

    // Sem a barra o navegador resolveria contra a página atual
    // (`/produto/imagens/x.jpg`) e a foto quebraria sem erro nenhum.
    const relativo = await cliente.post("/api/produtos", {
      ...corpo,
      nome: "Produto com foto relativa",
      imagem: "imagens/teclado.jpg",
    });
    expect(relativo.status).toBe(400);
  });
});

describe("avaliação abre a cada compra e fecha ao avaliar", () => {
  /**
   * A trava precisa valer no servidor. A interface esconder o formulário é
   * conveniência, não proteção: qualquer um pode chamar `POST /api/avaliacoes`
   * direto, e sem a checagem aqui a mesma pessoa avaliaria o mesmo produto
   * quantas vezes quisesse.
   */
  it("recusa a avaliação de quem nunca comprou o produto", async () => {
    const cliente = await clienteComum();

    const resposta = await cliente.post("/api/avaliacoes/prod-monitor", { nota: 1, comentario: "spam" });

    expect(resposta.status).toBe(403);
    expect(resposta.corpo.erro).toMatch(/após uma nova compra/i);
  });

  it("aceita a avaliação logo depois da compra", async () => {
    const cliente = await clienteComum();
    const compra = await cliente.post("/api/pedidos", {
      itens: [{ produtoId: "prod-cam", quantidade: 1 }],
      metodoPagamento: "pix",
    });
    expect(compra.status).toBe(201);

    const resposta = await cliente.post("/api/avaliacoes/prod-cam", { nota: 5, comentario: "Ótima câmera" });

    expect(resposta.status).toBe(201);
  });

  it("apenas uma avaliação simultânea consome a janela da compra", async () => {
    const cliente = await clienteComum();
    const { inserirProduto, listarCategorias } = await import("../database.js");
    const produtoId = randomUUID();
    const categoriaId = (await listarCategorias())[0]!.id;
    await inserirProduto({
      id: produtoId,
      nome: "Avaliação concorrente",
      descricao: "Teste isolado",
      preco: 10,
      quantidade: 2,
      categoria_id: categoriaId,
    });
    expect((await cliente.post("/api/pedidos", { itens: [{ produtoId, quantidade: 1 }] })).status).toBe(201);
    const respostas = await Promise.all([
      cliente.post(`/api/avaliacoes/${produtoId}`, { nota: 2, comentario: "Primeira" }),
      cliente.post(`/api/avaliacoes/${produtoId}`, { nota: 5, comentario: "Segunda" }),
    ]);
    expect(respostas.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([201, 403]);
    const conta = await cliente.get("/api/conta");
    expect(conta.corpo.minhasAvaliacoes).toHaveLength(1);
    const vencedora = respostas[0]?.status === 201 ? 2 : 5;
    expect(conta.corpo.minhasAvaliacoes[0].nota).toBe(vencedora);
  });

  it.each(["12", "XX", "S"])("recusa a UF inválida %s", async (estado) => {
    const cliente = await clienteComum();
    const resposta = await cliente.put("/api/conta/endereco", {
      cep: "01001000",
      rua: "Praça da Sé",
      numero: "1",
      bairro: "Sé",
      cidade: "São Paulo",
      estado,
    });
    expect(resposta.status).toBe(400);
  });

  it("conta a compra em qualquer pedido que não esteja cancelado", async () => {
    const cliente = await clienteComum();
    await cliente.post("/api/pedidos", {
      itens: [{ produtoId: "prod-headset", quantidade: 1 }],
      metodoPagamento: "pix",
    });

    // Pedido em `processando` já libera: exigir a mercadoria entregue jogaria
    // fora a avaliação fresca, que é a que diz algo sobre a experiência atual.
    const resposta = await cliente.post("/api/avaliacoes/prod-headset", { nota: 4, comentario: "" });

    expect(resposta.status).toBe(201);
  });

  it("não aceita avaliar um produto diferente do que foi comprado", async () => {
    const cliente = await clienteComum();
    await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-mouse", quantidade: 1 }], metodoPagamento: "pix" });

    const resposta = await cliente.post("/api/avaliacoes/prod-teclado", { nota: 5, comentario: "" });

    expect(resposta.status).toBe(403);
  });

  it("ignora pedido cancelado", async () => {
    const cliente = await clienteComum();
    const compra = await cliente.post("/api/pedidos", {
      itens: [{ produtoId: "prod-cadeira", quantidade: 1 }],
      metodoPagamento: "pix",
    });

    const admin = novo();
    await admin.post("/api/login", ADMIN);
    const cancelamento = await admin.patch(`/api/admin/pedidos/${compra.corpo.pedido.id}`, {
      status: "cancelado",
    });
    expect(cancelamento.status).toBe(200);

    const resposta = await cliente.post("/api/avaliacoes/prod-cadeira", { nota: 5, comentario: "" });

    expect(resposta.status).toBe(403);
  });

  it("devolve as próprias avaliações na conta, com id e data", async () => {
    const cliente = await clienteComum();
    await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-cam", quantidade: 1 }], metodoPagamento: "pix" });
    await cliente.post("/api/avaliacoes/prod-cam", { nota: 2, comentario: "Deu problema" });

    const conta = await cliente.get("/api/conta");

    // A rota pública de avaliações devolve `nome` em vez de id, e nome não
    // identifica ninguém. É esta lista, que vem da conta com sessão, que
    // permite reconhecer a própria avaliação — e a `criado_em` é o que fecha
    // a janela, comparando com a data da última compra.
    expect(conta.corpo.minhasAvaliacoes).toHaveLength(1);
    expect(conta.corpo.minhasAvaliacoes[0]).toMatchObject({
      produto_id: "prod-cam",
      nota: 2,
      comentario: "Deu problema",
    });
    expect(conta.corpo.minhasAvaliacoes[0].criado_em).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("bloqueia uma segunda avaliação depois da primeira", async () => {
    const cliente = await clienteComum();
    await cliente.post("/api/pedidos", {
      itens: [{ produtoId: "prod-monitor", quantidade: 1 }],
      metodoPagamento: "pix",
    });

    const primeira = await cliente.post("/api/avaliacoes/prod-monitor", { nota: 4, comentario: "" });
    expect(primeira.status).toBe(201);

    // Esta é a regra: a janela fecha ao avaliar. Sem nova compra, a segunda
    // tentativa é recusada — era exatamente o que faltava.
    const segunda = await cliente.post("/api/avaliacoes/prod-monitor", { nota: 1, comentario: "mudei de ideia" });

    expect(segunda.status).toBe(403);
  });

  it("reabre a janela com uma nova compra, para atualizar a nota", async () => {
    const cliente = await clienteComum();
    await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-cam", quantidade: 1 }], metodoPagamento: "pix" });
    await cliente.post("/api/avaliacoes/prod-cam", { nota: 1, comentario: "Acho ruim" });

    const semCompraNova = await cliente.post("/api/avaliacoes/prod-cam", { nota: 5, comentario: "" });
    expect(semCompraNova.status).toBe(403);

    await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-cam", quantidade: 1 }], metodoPagamento: "pix" });

    const comCompraNova = await cliente.post("/api/avaliacoes/prod-cam", {
      nota: 5,
      comentario: "Depois de trocar, ótimo",
    });

    expect(comCompraNova.status).toBe(201);
  });

  it("atualizar a avaliação substitui a anterior, sem criar uma segunda", async () => {
    const cliente = await clienteComum();
    await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-cam", quantidade: 1 }], metodoPagamento: "pix" });

    // A lista pública é compartilhada entre os testes deste arquivo — outros
    // casos também avaliam `prod-cam` — então o que importa é que a contagem
    // suba 1, não que valha 1.
    const antes = await cliente.get("/api/avaliacoes/prod-cam");

    await cliente.post("/api/avaliacoes/prod-cam", { nota: 1, comentario: "Acho ruim" });
    await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-cam", quantidade: 1 }], metodoPagamento: "pix" });
    await cliente.post("/api/avaliacoes/prod-cam", { nota: 5, comentario: "Depois de trocar, ótimo" });

    const depois = await cliente.get("/api/avaliacoes/prod-cam");
    // Duas compras, duas avaliações, mas uma linha a mais: a segunda
    // substituiu a primeira.
    expect(depois.corpo).toHaveLength(antes.corpo.length + 1);

    const conta = await cliente.get("/api/conta");
    const minhas = conta.corpo.minhasAvaliacoes.filter((a: { produto_id: string }) => a.produto_id === "prod-cam");
    expect(minhas).toHaveLength(1);
    expect(minhas[0]).toMatchObject({ nota: 5, comentario: "Depois de trocar, ótimo" });
  });

  it("exige login antes de qualquer coisa", async () => {
    const resposta = await novo().post("/api/avaliacoes/prod-monitor", { nota: 5, comentario: "" });
    expect(resposta.status).toBe(401);
  });

  it("não deixa a avaliação recusada aparecer na lista", async () => {
    const cliente = await clienteComum();
    const antes = await cliente.get("/api/avaliacoes/prod-monitor");

    await cliente.post("/api/avaliacoes/prod-monitor", { nota: 1, comentario: "spam" });

    const depois = await cliente.get("/api/avaliacoes/prod-monitor");
    expect(depois.corpo).toEqual(antes.corpo);
  });
});

describe("pedidos pela API", () => {
  it("exige login para finalizar a compra", async () => {
    const resposta = await novo().post("/api/pedidos", { itens: [{ produtoId: "prod-teclado", quantidade: 1 }] });
    expect(resposta.status).toBe(401);
  });

  it("cria pedido para cliente autenticado", async () => {
    const cliente = await clienteComum();
    const resposta = await cliente.post("/api/pedidos", {
      itens: [{ produtoId: "prod-teclado", quantidade: 1 }],
      metodoPagamento: "pix",
    });

    expect(resposta.status).toBe(201);
    expect(resposta.corpo.pedido.id).toMatch(/^PED-/);
    expect(resposta.corpo.pedido.status).toBe("processando");
  });

  it("devolve o pedido em /api/conta", async () => {
    const cliente = await clienteComum();
    const criado = await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-mouse", quantidade: 1 }] });
    // Sem esta checagem, uma falha no POST leria como "não tem pedido" e a
    // causa real ficaria escondida atrás de um sintoma de outro lugar.
    expect(criado.status).toBe(201);

    const conta = await cliente.get("/api/conta");

    expect(conta.status).toBe(200);
    expect(conta.corpo.pedidos.length).toBeGreaterThan(0);
    expect(conta.corpo).toHaveProperty("perfil");
    expect(conta.corpo).toHaveProperty("favoritos");
  });

  it("permite atualizar o nome da conta, sem alterar o e-mail", async () => {
    const cliente = await clienteComum();
    const antes = await cliente.get("/api/conta");
    const atualizado = await cliente.put("/api/conta/nome", { nome: "Ana Cliente" });
    const depois = await cliente.get("/api/conta");

    expect(atualizado.status).toBe(200);
    expect(atualizado.corpo.usuario.nome).toBe("Ana Cliente");
    expect(depois.corpo.perfil.nome).toBe("Ana Cliente");
    expect(depois.corpo.perfil.email).toBe(antes.corpo.perfil.email);
    expect((await novo().put("/api/conta/nome", { nome: "Sem sessão" })).status).toBe(401);
  });

  it("favorita e desfavorita pelo estado desejado, sem inverter no repetido", async () => {
    const cliente = await clienteComum();

    const primeiro = await cliente.put("/api/favoritos/prod-mouse", {});
    expect(primeiro.status).toBe(200);
    expect(primeiro.corpo.favorito).toBe(true);

    // Repetir o PUT tem de continuar favoritado. Com o toggle antigo, a segunda
    // chamada desmarca: era o clique duplo invertendo o coração na tela.
    const repetido = await cliente.put("/api/favoritos/prod-mouse", {});
    expect(repetido.status).toBe(200);
    expect(repetido.corpo.favorito).toBe(true);

    let conta = await cliente.get("/api/conta");
    expect(conta.corpo.favoritos.map((p: { id: string }) => p.id)).toContain("prod-mouse");

    const removido = await cliente.delete("/api/favoritos/prod-mouse");
    expect(removido.status).toBe(200);
    expect(removido.corpo.favorito).toBe(false);

    const removidoDeNovo = await cliente.delete("/api/favoritos/prod-mouse");
    expect(removidoDeNovo.status).toBe(200);
    expect(removidoDeNovo.corpo.favorito).toBe(false);

    conta = await cliente.get("/api/conta");
    expect(conta.corpo.favoritos.map((p: { id: string }) => p.id)).not.toContain("prod-mouse");
  });
});

describe("recuperação de senha", () => {
  it("não expõe token nem promete envio quando a recuperação está desabilitada", async () => {
    const resposta = await novo().post("/api/recuperar-senha", { email: ADMIN.email });
    expect(resposta.status).toBe(503);
    expect(resposta.corpo.erro).toMatch(/indisponível/i);
    expect(resposta.corpo).not.toHaveProperty("token");
  });

  it("não revela se o e-mail existe", async () => {
    const existente = await novo().post("/api/recuperar-senha", { email: ADMIN.email });
    const inexistente = await novo().post("/api/recuperar-senha", { email: "ninguem@exemplo.com" });
    expect(inexistente.status).toBe(existente.status);
    expect(inexistente.corpo).toEqual(existente.corpo);
    expect(inexistente.corpo).not.toHaveProperty("token");
  });

  it("redefine a senha com token válido e recusa token inválido", async () => {
    const cliente = novo();
    const email = `reset-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;
    await cliente.post("/api/cadastro", { nome: "Reset Teste", email, senha: "senhaAntiga1" });

    const { criarTokenRedefinicaoSenha } = await import("../database.js");
    const token = await criarTokenRedefinicaoSenha(email);
    expect(typeof token).toBe("string");

    const invalido = await novo().post("/api/redefinir-senha", { token: "x".repeat(40), senha: "novaSenha123" });
    expect(invalido.status).toBe(400);

    const redefinido = await novo().post("/api/redefinir-senha", { token, senha: "novaSenha123" });
    expect(redefinido.status).toBe(200);

    const login = await novo().post("/api/login", { email, senha: "novaSenha123" });
    expect(login.status).toBe(200);
  });

  it.each([undefined, "test", "production", "staging"])(
    "recusa expor token em NODE_ENV=%s mesmo com flag ativa",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("ALLOW_LOCAL_PASSWORD_RESET", "true");
      try {
        const resposta = await novo().post("/api/recuperar-senha", { email: ADMIN.email });
        expect(resposta.status).toBe(503);
        expect(resposta.corpo).not.toHaveProperty("token");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("permite demonstrar a redefinição somente com development e flag explícita", async () => {
    const email = `local-${randomUUID()}@exemplo.com`;
    const cliente = novo();
    await cliente.post("/api/cadastro", { nome: "Demonstração Local", email, senha: "senhaAntiga123" });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_PASSWORD_RESET", "false");
    try {
      expect((await novo().post("/api/recuperar-senha", { email })).status).toBe(503);
      vi.stubEnv("ALLOW_LOCAL_PASSWORD_RESET", "true");
      const resposta = await novo().post("/api/recuperar-senha", { email });
      expect(resposta.status).toBe(200);
      expect(typeof resposta.corpo.token).toBe("string");
      expect(
        (await novo().post("/api/redefinir-senha", { token: resposta.corpo.token, senha: "senhaNova123" })).status,
      ).toBe(200);
      expect((await cliente.get("/api/sessao")).corpo.usuario).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("tratamento de erro", () => {
  it("devolve 404 em rota de API inexistente", async () => {
    const resposta = await novo().get("/api/rota-que-nao-existe");
    expect(resposta.status).toBe(404);
    expect(resposta.corpo.erro).toMatch(/não encontrada/i);
  });

  it("devolve 400 para JSON malformado em rota de login", async () => {
    // `inject` com string crua simula corpo que não é JSON, que é o que o
    // tratador de erro do Fastify precisa converter em 400.
    const resposta = await contexto.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { "content-type": "application/json" },
      payload: "{ isso nao e json",
    });
    expect(resposta.statusCode).toBe(400);
  });

  it("devolve 400 com a mensagem do Zod quando o corpo não casa com o schema", async () => {
    const cliente = novo();
    const resposta = await cliente.post("/api/login", { email: "nao-e-email", senha: "123" });
    expect(resposta.status).toBe(400);
    // A mensagem vem do schema, não de uma string duplicada na rota.
    expect(typeof resposta.corpo.erro).toBe("string");
    expect(resposta.corpo.erro.length).toBeGreaterThan(0);
  });

  it("não derruba o servidor após uma requisição inválida", async () => {
    await novo().get("/api/rota-invalida");
    const depois = await novo().get("/api/produtos");
    expect(depois.status).toBe(200);
  });
});

describe("sessoes persistidas no banco", () => {
  it("sobrevive a uma nova instancia do app, que antes perdia tudo", async () => {
    const login = await novo().post("/api/login", ADMIN);
    expect(login.status).toBe(200);

    // `novo()` cria um cliente novo, sem sessao. O login acima foi em outro.
    const comSessao = novo();
    await comSessao.post("/api/login", ADMIN);
    const token = comSessao.cookie;
    expect(token).toBeTruthy();

    // App novo, mesma sessao. Com o Map em memoria da Fase 3, ela
    // desapareceria junto com o processo anterior.
    const segundo = await iniciarContexto();
    try {
      const sessao = await segundo.novoCliente().get("/api/sessao", { cookie: token ?? "" });
      expect(sessao.corpo.usuario).not.toBeNull();
      expect(sessao.corpo.usuario.email).toBe(ADMIN.email);
    } finally {
      await segundo.encerrar();
    }
  });

  it("guarda so o hash do token, nunca o valor", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);

    const { obterPool } = await import("../postgres.js");
    const linhas = await obterPool().query<{ token_hash: string }>("SELECT token_hash FROM sessoes");
    expect(linhas.rows.length).toBeGreaterThan(0);

    // Um hash SHA-256 tem 64 hexadecimais. Se o token bruto estivesse no
    // banco, daria para forjar a sessao de qualquer usuario so lendo a base.
    for (const linha of linhas.rows) {
      expect(linha.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("recusa token forjado", async () => {
    const forjado = await novo().get("/api/sessao", { cookie: "loja_session=" + "a".repeat(64) });
    expect(forjado.corpo.usuario).toBeNull();
  });

  it("invalida a sessao no logout", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    expect((await cliente.get("/api/sessao")).corpo.usuario).not.toBeNull();

    await cliente.post("/api/logout");
    expect((await cliente.get("/api/sessao")).corpo.usuario).toBeNull();
  });

  it("descarta sessao expirada", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    const token = cliente.cookie;

    const { obterPool } = await import("../postgres.js");
    await obterPool().query("UPDATE sessoes SET expira_em = now() - interval '1 hour'");

    const depois = await novo().get("/api/sessao", { cookie: token ?? "" });
    expect(depois.corpo.usuario).toBeNull();
  });

  it("criar uma sessao substitui a anterior do mesmo usuario", async () => {
    const primeiro = novo();
    await primeiro.post("/api/login", ADMIN);
    const tokenAntigo = primeiro.cookie;

    const segundo = novo();
    await segundo.post("/api/login", ADMIN);

    // Sem a limpeza na criacao, abrir cinco abas deixaria cinco registros
    // validos ate expirarem, e um logout so derrubaria um deles.
    const antiga = await novo().get("/api/sessao", { cookie: tokenAntigo ?? "" });
    expect(antiga.corpo.usuario).toBeNull();
  });

  it("limpar as sessoes invalida todas de uma vez", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    expect((await cliente.get("/api/sessao")).corpo.usuario).not.toBeNull();

    await limparSessoes();
    expect((await cliente.get("/api/sessao")).corpo.usuario).toBeNull();
  });
});

describe("verificacao de origem", () => {
  it("recusa escrita vinda de origem de terceiros", async () => {
    const ctx = await iniciarContexto();
    try {
      const cliente = ctx.novoCliente();
      await cliente.post("/api/login", ADMIN, { origin: "https://site-malicioso.example" });

      const resposta = await cliente.post(
        "/api/produtos",
        { nome: "Injetado", preco: 1, quantidade: 1, categoriaId: "cat-outros" },
        { origin: "https://site-malicioso.example" },
      );
      expect(resposta.status).toBe(403);
      expect(resposta.corpo.erro).toMatch(/origem/i);
    } finally {
      await ctx.encerrar();
    }
  });

  it("aceita escrita da origem local", async () => {
    const ctx = await iniciarContexto();
    try {
      const cliente = ctx.novoCliente();
      await cliente.post("/api/login", ADMIN, { origin: "http://localhost:5173" });

      const resposta = await cliente.post(
        "/api/produtos",
        { nome: "Produto legitimo", preco: 10, quantidade: 1, categoriaId: "cat-outros" },
        { origin: "http://localhost:5173" },
      );
      expect(resposta.status).toBe(201);
    } finally {
      await ctx.encerrar();
    }
  });

  it("aceita leitura sem Origin, para nao quebrar health check", async () => {
    // Monitor e curl nao enviam Origin. Bloquear isso quebraria a
    // observabilidade, que e exatamente o que precisa funcionar.
    const ctx = await iniciarContexto();
    try {
      expect((await ctx.novoCliente().get("/api/produtos")).status).toBe(200);
      const login = await ctx.novoCliente().post("/api/login", { email: "x@y.com", senha: "errada123" });
      expect(login.status).toBe(401);
    } finally {
      await ctx.encerrar();
    }
  });
});

describe("auditoria", () => {
  it("registra a criacao do pedido", async () => {
    const cliente = await clienteComum();
    const criado = await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-teclado", quantidade: 1 }] });
    expect(criado.status).toBe(201);

    const { obterPool } = await import("../postgres.js");
    const registro = await obterPool().query<{ acao: string; usuario_id: string }>(
      "SELECT acao, usuario_id FROM auditoria WHERE entidade = 'pedido' AND entidade_id = $1",
      [criado.corpo.pedido.id],
    );
    expect(registro.rows).toHaveLength(1);
    expect(registro.rows[0]?.acao).toBe("criado");
    expect(registro.rows[0]?.usuario_id).toBeTruthy();
  });

  it("nao registra auditoria de um pedido que nao foi criado", async () => {
    // A auditoria passou a ser escrita dentro da transacao do pedido. Se ela
    // voltasse a ser uma chamada separada depois do commit, um pedido recusado
    // (cupom invalido) deixaria um registro de algo que nao existe.
    const cliente = await clienteComum();
    const recusado = await cliente.post("/api/pedidos", {
      itens: [{ produtoId: "prod-teclado", quantidade: 1 }],
      cupomCodigo: "CUPOM-QUE-NAO-EXISTE",
    });
    expect(recusado.status).toBe(400);

    const { obterPool } = await import("../postgres.js");
    const registro = await obterPool().query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM auditoria WHERE entidade = 'pedido' AND acao = 'criado'",
    );
    const antes = registro.rows[0]?.total ?? 0;

    const criado = await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-teclado", quantidade: 1 }] });
    expect(criado.status).toBe(201);

    const depois = await obterPool().query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM auditoria WHERE entidade = 'pedido' AND acao = 'criado'",
    );
    // Exatamente um a mais: o pedido recusado nao deixou rastro.
    expect(depois.rows[0]?.total).toBe(antes + 1);
  });

  it("registra a mudanca de status com o valor anterior", async () => {
    const cliente = await clienteComum();
    expect(
      (
        await cliente.put("/api/conta/endereco", {
          cep: "01001000",
          rua: "Praça da Sé",
          numero: "1",
          bairro: "Sé",
          cidade: "São Paulo",
          estado: "sp",
        })
      ).status,
    ).toBe(200);
    const criado = await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-mouse", quantidade: 1 }] });
    const id = criado.corpo.pedido.id;

    const admin = novo();
    await admin.post("/api/login", ADMIN);
    expect((await admin.patch(`/api/admin/pedidos/${id}`, { status: "enviado" })).status).toBe(200);

    const { obterPool } = await import("../postgres.js");
    const registro = await obterPool().query<{ antes: { status: string }; depois: { status: string } }>(
      "SELECT antes, depois FROM auditoria WHERE entidade_id = $1 AND acao = 'status_alterado'",
      [id],
    );
    // Guardar so o valor novo nao permitiria reconstruir a transicao.
    expect(registro.rows[0]?.antes.status).toBe("processando");
    expect(registro.rows[0]?.depois.status).toBe("enviado");
  });

  it("so o admin le a auditoria", async () => {
    const cliente = await clienteComum();
    expect((await cliente.get("/api/admin/pedidos/qualquer/auditoria")).status).toBe(403);
  });
});

describe("rate limit", () => {
  it("não aceita X-Forwarded-For arbitrário para contornar o limite", async () => {
    const comLimite = await iniciarContexto({ semRateLimit: false });
    try {
      const respostas: number[] = [];
      for (let tentativa = 0; tentativa < 12; tentativa++) {
        const resposta = await comLimite
          .novoCliente()
          .post(
            "/api/login",
            { email: "x@y.com", senha: "errada123" },
            { "x-forwarded-for": `203.0.113.${tentativa + 1}` },
          );
        respostas.push(resposta.status);
      }
      expect(respostas.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(respostas.slice(10)).toEqual([429, 429]);
    } finally {
      await comLimite.encerrar();
    }
  });

  it("bloqueia quando o limite é excedido", async () => {
    // Contexto separado, com o rate limit ligado. A suíte principal roda sem
    // ele, senão as próprias requisições dos outros testes seriam barradas.
    const comLimite = await iniciarContexto({ semRateLimit: false });
    try {
      const respostas: Array<{ status: number; corpo: { erro?: string } }> = [];
      // /api/login tem limite próprio de 10 por minuto.
      for (let tentativa = 0; tentativa < 14; tentativa++) {
        respostas.push(await comLimite.novoCliente().post("/api/login", { email: "x@y.com", senha: "errada123" }));
      }
      const bloqueada = respostas.find((resposta) => resposta.status === 429);
      expect(bloqueada?.corpo.erro).toBe("Você fez muitas tentativas. Aguarde um minuto e tente novamente.");
    } finally {
      await comLimite.encerrar();
    }
  });
});

describe("reenvio de pedido", () => {
  it("outra instância devolve o pedido original para a mesma tentativa", async () => {
    const cliente = await clienteComum();
    const entrada = { chaveIdempotencia: randomUUID(), itens: [{ produtoId: "prod-teclado", quantidade: 1 }] };
    const criado = await cliente.post("/api/pedidos", entrada);
    expect(criado.status).toBe(201);
    const segundoApp = await iniciarContexto();
    try {
      const repetido = await segundoApp.novoCliente().post("/api/pedidos", entrada, { cookie: cliente.cookie ?? "" });
      expect(repetido.status).toBe(201);
      expect(repetido.corpo).toEqual(criado.corpo);
      const pedidos = (await cliente.get("/api/conta")).corpo.pedidos;
      expect(pedidos).toHaveLength(1);
    } finally {
      await segundoApp.encerrar();
    }
  });
});
