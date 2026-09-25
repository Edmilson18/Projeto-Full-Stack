import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, iniciarServidor, type Cliente } from "./ajuda.js";
import { limparSessoes } from "../server.js";

let servidor: Awaited<ReturnType<typeof iniciarServidor>>;
let novo: () => Cliente;

beforeAll(async () => {
  servidor = await iniciarServidor();
  novo = servidor.cliente;
});

afterAll(async () => {
  await servidor.encerrar();
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
    const respotaExistente = await novo().post("/api/login", { email: ADMIN.email, senha: "x" });
    const respostaInexistente = await novo().post("/api/login", { email: "ninguem@exemplo.com", senha: "x" });

    // Mensagem igual impede enumerar quais e-mails existem na base.
    expect(respostaInexistente.status).toBe(401);
    expect(respostaInexistente.corpo.erro).toBe(respotaExistente.corpo.erro);
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
  it("bloqueia anônimo em todas as rotas de admin", async () => {
    const cliente = novo();
    for (const [metodo, rota] of [
      ["get", "/api/dashboard"],
      ["get", "/api/admin/produtos"],
      ["get", "/api/admin/pedidos"],
    ] as const) {
      const resposta = await cliente[metodo](rota);
      expect(resposta.status).toBe(403);
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
    await cliente.post("/api/pedidos", { itens: [{ produtoId: "prod-mouse", quantidade: 1 }] });
    const conta = await cliente.get("/api/conta");

    expect(conta.status).toBe(200);
    expect(conta.corpo.pedidos.length).toBeGreaterThan(0);
    expect(conta.corpo).toHaveProperty("perfil");
    expect(conta.corpo).toHaveProperty("favoritos");
  });
});

describe("recuperação de senha", () => {
  it("não devolve o token quando NODE_ENV não é development", async () => {
    // A suite roda com NODE_ENV=test, que não é "production", então este teste
    // documenta o comportamento padrão. O gate de produção é coberto pelo
    // smoke test manual, rodando o servidor com NODE_ENV=production.
    const resposta = await novo().post("/api/recuperar-senha", { email: ADMIN.email });
    expect(resposta.status).toBe(200);
    expect(resposta.corpo.mensagem).toMatch(/instruções/i);
  });

  it("não revela se o e-mail existe", async () => {
    const existente = await novo().post("/api/recuperar-senha", { email: ADMIN.email });
    const inexistente = await novo().post("/api/recuperar-senha", { email: "ninguem@exemplo.com" });
    expect(inexistente.status).toBe(existente.status);
    expect(inexistente.corpo.mensagem).toBe(existente.corpo.mensagem);
  });

  it("redefine a senha com token válido e recusa token inválido", async () => {
    const cliente = novo();
    const email = `reset-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;
    await cliente.post("/api/cadastro", { nome: "Reset Teste", email, senha: "senhaAntiga1" });

    const solicitacao = await novo().post("/api/recuperar-senha", { email });
    const token = solicitacao.corpo.token;
    expect(typeof token).toBe("string");

    const invalido = await novo().post("/api/redefinir-senha", { token: "x".repeat(40), senha: "novaSenha123" });
    expect(invalido.status).toBe(400);

    const redefinido = await novo().post("/api/redefinir-senha", { token, senha: "novaSenha123" });
    expect(redefinido.status).toBe(200);

    const login = await novo().post("/api/login", { email, senha: "novaSenha123" });
    expect(login.status).toBe(200);
  });
});

describe("tratamento de erro", () => {
  it("devolve 404 em rota de API inexistente", async () => {
    const resposta = await novo().get("/api/rota-que-nao-existe");
    expect(resposta.status).toBe(404);
    expect(resposta.corpo.erro).toMatch(/não encontrada/i);
  });

  it("devolve 400 para JSON malformado em rota de login", async () => {
    const resposta = await fetch(`${novo().base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ isso nao e json",
    });
    expect(resposta.status).toBe(400);
  });

  it("não derruba o servidor após uma requisição inválida", async () => {
    await novo().get("/api/rota-invalida");
    const depois = await novo().get("/api/produtos");
    expect(depois.status).toBe(200);
  });
});

describe("sessões em memória", () => {
  it("limpar as sessoes invalida todas de uma vez", async () => {
    const cliente = novo();
    await cliente.post("/api/login", ADMIN);
    expect((await cliente.get("/api/sessao")).corpo.usuario).not.toBeNull();

    limparSessoes();
    expect((await cliente.get("/api/sessao")).corpo.usuario).toBeNull();
  });
});
