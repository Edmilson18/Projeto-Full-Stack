import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, iniciarContexto, type Cliente } from "./ajuda.js";
import { limparSessoes } from "../rotas/auth.js";

let contexto: Awaited<ReturnType<typeof iniciarContexto>>;
let novo: () => Cliente;

beforeAll(async () => {
  contexto = await iniciarContexto();
  novo = contexto.novoCliente;
});

afterAll(async () => {
  await contexto.encerrar();
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
    const respotaExistente = await novo().post("/api/login", { email: ADMIN.email, senha: "senhaErrada1" });
    const respostaInexistente = await novo().post("/api/login", {
      email: "ninguem@exemplo.com",
      senha: "senhaErrada1",
    });

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
  it("responde 401 para anônimo e 403 para cliente comum", async () => {
    const anonimo = novo();
    for (const [metodo, rota] of [
      ["get", "/api/dashboard"],
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
    const cookie = novo().cookie;
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
    expect(cookie).toBeNull();
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
    const contexto = await iniciarContexto();
    try {
      const cliente = contexto.novoCliente();
      await cliente.post("/api/login", ADMIN, { origin: "https://site-malicioso.example" });

      const resposta = await cliente.post(
        "/api/produtos",
        { nome: "Injetado", preco: 1, quantidade: 1, categoriaId: "cat-outros" },
        { origin: "https://site-malicioso.example" },
      );
      expect(resposta.status).toBe(403);
      expect(resposta.corpo.erro).toMatch(/origem/i);
    } finally {
      await contexto.encerrar();
    }
  });

  it("aceita escrita da origem local", async () => {
    const contexto = await iniciarContexto();
    try {
      const cliente = contexto.novoCliente();
      await cliente.post("/api/login", ADMIN, { origin: "http://localhost:5173" });

      const resposta = await cliente.post(
        "/api/produtos",
        { nome: "Produto legitimo", preco: 10, quantidade: 1, categoriaId: "cat-outros" },
        { origin: "http://localhost:5173" },
      );
      expect(resposta.status).toBe(201);
    } finally {
      await contexto.encerrar();
    }
  });

  it("aceita leitura sem Origin, para nao quebrar health check", async () => {
    // Monitor e curl nao enviam Origin. Bloquear isso quebraria a
    // observabilidade, que e exatamente o que precisa funcionar.
    const contexto = await iniciarContexto();
    try {
      expect((await contexto.novoCliente().get("/api/produtos")).status).toBe(200);
      const login = await contexto.novoCliente().post("/api/login", { email: "x@y.com", senha: "errada123" });
      expect(login.status).toBe(401);
    } finally {
      await contexto.encerrar();
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

  it("registra a mudanca de status com o valor anterior", async () => {
    const cliente = await clienteComum();
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
  it("bloqueia quando o limite é excedido", async () => {
    // Contexto separado, com o rate limit ligado. A suíte principal roda sem
    // ele, senão as próprias requisições dos outros testes seriam barradas.
    const comLimite = await iniciarContexto({ semRateLimit: false });
    try {
      const respostas: number[] = [];
      // /api/login tem limite próprio de 10 por minuto.
      for (let tentativa = 0; tentativa < 14; tentativa++) {
        respostas.push(
          (await comLimite.novoCliente().post("/api/login", { email: "x@y.com", senha: "errada123" })).status,
        );
      }
      expect(respostas).toContain(429);
    } finally {
      await comLimite.encerrar();
    }
  });
});
