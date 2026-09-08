import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inicializarBanco, inserirProduto, listarCategorias, listarProdutos, listarMaisVendidos, buscarUsuarioPorEmail, buscarUsuarioPorId, listarDashboard, criarUsuario, listarPedidosDoUsuario, criarPedido, verificarSenha, atualizarSenhaUsuario, buscarPerfilUsuario, atualizarEnderecoUsuario, listarPedidosAdmin, atualizarStatusPedido, atualizarProduto, inativarProduto, listarFavoritos, alternarFavorito, listarAvaliacoes, salvarAvaliacao } from "./database.js";
import { validarCadastro, validarProduto } from "./validacao.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raizProjeto = path.resolve(__dirname, "..");
const diretorioDist = path.resolve(raizProjeto, "dist");
const porta = Number(process.env.PORT ?? 3000);
const sessoes = new Map<string, { usuarioId: string; expiraEm: number }>();
const DURACAO_SESSAO_MS = 1000 * 60 * 60 * 12;

const tipoConteudo: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function lerArquivoLocal(caminho: string) {
  return fs.readFile(caminho);
}

function cookies(request: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries(String(request.headers.cookie ?? "").split(";").map((parte) => parte.trim().split("=")).filter(([chave, valor]) => chave && valor));
}

function obterUsuarioDaSessao(request: http.IncomingMessage) {
  const token = cookies(request).loja_session;
  const sessao = token ? sessoes.get(token) : undefined;
  if (!sessao || sessao.expiraEm < Date.now()) { if (token) sessoes.delete(token); return undefined; }
  return buscarUsuarioPorId(sessao.usuarioId);
}

function criarSessao(resposta: http.ServerResponse, usuarioId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  sessoes.set(token, { usuarioId, expiraEm: Date.now() + DURACAO_SESSAO_MS });
  resposta.setHeader("Set-Cookie", `loja_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_SESSAO_MS / 1000}`);
}

function encerrarSessao(request: http.IncomingMessage, resposta: http.ServerResponse) {
  const token = cookies(request).loja_session;
  if (token) sessoes.delete(token);
  resposta.setHeader("Set-Cookie", "loja_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function parseBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => {
      if (chunks.reduce((total, item) => total + item.length, 0) > 1_000_000) {
        reject(new Error("A solicitação é grande demais."));
        request.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    request.on("end", () => {
      const conteudo = Buffer.concat(chunks).toString("utf-8");

      if (!conteudo.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(conteudo));
      } catch (erro) {
        reject(new Error("JSON inválido."));
      }
    });

    request.on("error", reject);
  });
}

async function servirArquivo(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
  const rota = url === "/" || url === "/login.html" ? "/index.html" : url;
  const usaBuildFrontend = rota === "/index.html" || rota.startsWith("/assets/");
  const caminhoArquivo = usaBuildFrontend
    ? path.join(diretorioDist, rota.replace(/^\//, ""))
    : path.join(raizProjeto, rota.replace(/^\//, ""));

  try {
    const conteudo = await lerArquivoLocal(caminhoArquivo);
    const extensao = path.extname(caminhoArquivo).toLowerCase();
    res.writeHead(200, { "Content-Type": tipoConteudo[extensao] ?? "application/octet-stream" });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado.");
  }
}

async function tratarApi(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
  const responder = (status: number, dados: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(dados));
  };
  const usuarioSessao = obterUsuarioDaSessao(req);
  const exigirAdmin = () => {
    if (!usuarioSessao || usuarioSessao.role !== "admin") {
      responder(403, { erro: "Acesso restrito ao administrador." });
      return false;
    }
    return true;
  };

  if (req.method === "POST" && url === "/api/login") {
    try {
      const corpo = await parseBody(req);
      const email = String(corpo.email ?? "").trim().toLowerCase();
      const senha = String(corpo.senha ?? "").trim();

      const usuario = buscarUsuarioPorEmail(email);

      if (!usuario || !verificarSenha(senha, usuario.senha)) {
        responder(401, { erro: "E-mail ou senha inválidos." });
        return;
      }

      if (!usuario.senha.startsWith("scrypt$")) atualizarSenhaUsuario(usuario.id, senha);

      criarSessao(res, usuario.id);
      responder(200, {
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          role: usuario.role,
        },
      });
      return;
    } catch (erro) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ erro: erro instanceof Error ? erro.message : "Erro ao fazer login." }));
      return;
    }
  }

  if (req.method === "POST" && url === "/api/logout") {
    encerrarSessao(req, res);
    responder(200, { mensagem: "Sessão encerrada." });
    return;
  }

  if (req.method === "GET" && url === "/api/sessao") {
    responder(200, { usuario: usuarioSessao ?? null });
    return;
  }

  if (req.method === "POST" && url === "/api/cadastro") {
    try {
      const corpo = await parseBody(req);
      const nome = String(corpo.nome ?? "").trim();
      const email = String(corpo.email ?? "").trim().toLowerCase();
      const senha = String(corpo.senha ?? "").trim();
      const erroCadastro = validarCadastro(nome, email, senha);
      if (erroCadastro) {
        responder(400, { erro: erroCadastro });
        return;
      }
      if (buscarUsuarioPorEmail(email)) {
        responder(409, { erro: "Este e-mail já está cadastrado." });
        return;
      }
      const usuario = { id: crypto.randomUUID(), nome, email, senha };
      criarUsuario(usuario);
      criarSessao(res, usuario.id);
      responder(201, { usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: "cliente" } });
      return;
    } catch (erro) {
      responder(400, { erro: erro instanceof Error ? erro.message : "Não foi possível criar a conta." });
      return;
    }
  }

  if (req.method === "GET" && url === "/api/produtos") {
    const produtos = listarProdutos();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(produtos));
    return;
  }

  if (req.method === "GET" && url === "/api/produtos/mais-vendidos") {
    responder(200, listarMaisVendidos());
    return;
  }

  if (req.method === "GET" && url === "/api/categorias") {
    const categorias = listarCategorias();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(categorias));
    return;
  }

  if (req.method === "GET" && url === "/api/dashboard") {
    if (!exigirAdmin()) return;
    const dashboard = listarDashboard();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(dashboard));
    return;
  }

  if (req.method === "GET" && url === "/api/conta") {
    if (!usuarioSessao) { responder(401, { erro: "Faça login para acessar sua conta." }); return; }
    responder(200, { perfil: buscarPerfilUsuario(usuarioSessao.id), pedidos: listarPedidosDoUsuario(usuarioSessao.id), favoritos: listarFavoritos(usuarioSessao.id) });
    return;
  }

  if (req.method === "PUT" && url === "/api/conta/endereco") {
    if (!usuarioSessao) { responder(401, { erro: "Faça login para salvar seu endereço." }); return; }
    const corpo = await parseBody(req);
    const endereco = Object.fromEntries(["cep", "rua", "numero", "complemento", "bairro", "cidade", "estado"].map((campo) => [campo, String(corpo[campo] ?? "").trim()]));
    if (!endereco.cep || !endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade || endereco.estado.length !== 2) { responder(400, { erro: "Preencha o endereço completo, incluindo a UF." }); return; }
    atualizarEnderecoUsuario(usuarioSessao.id, endereco);
    responder(200, { perfil: buscarPerfilUsuario(usuarioSessao.id) });
    return;
  }

  if (req.method === "POST" && url === "/api/pedidos") {
    try {
      const corpo = await parseBody(req);
      const itens = Array.isArray(corpo.itens) ? corpo.itens.map((item) => ({
        produtoId: String((item as Record<string, unknown>).produtoId ?? ""),
        quantidade: Number((item as Record<string, unknown>).quantidade ?? 0),
      })) : [];
      if (!usuarioSessao) {
        responder(401, { erro: "Faça login para finalizar a compra." });
        return;
      }
      responder(201, { pedido: criarPedido(usuarioSessao.id, itens, String(corpo.cupomCodigo ?? "") || undefined, String(corpo.metodoPagamento ?? "pix")) });
      return;
    } catch (erro) {
      responder(400, { erro: erro instanceof Error ? erro.message : "Não foi possível concluir o pedido." });
      return;
    }
  }

  if (req.method === "POST" && url.startsWith("/api/favoritos/")) {
    if (!usuarioSessao) { responder(401, { erro: "Faça login para salvar favoritos." }); return; }
    responder(200, { favorito: alternarFavorito(usuarioSessao.id, decodeURIComponent(url.replace("/api/favoritos/", ""))) });
    return;
  }

  if (req.method === "GET" && url.startsWith("/api/avaliacoes/")) { responder(200, listarAvaliacoes(decodeURIComponent(url.replace("/api/avaliacoes/", "")))); return; }
  if (req.method === "POST" && url.startsWith("/api/avaliacoes/")) {
    if (!usuarioSessao) { responder(401, { erro: "Faça login para avaliar." }); return; }
    const corpo = await parseBody(req); const nota = Number(corpo.nota); const comentario = String(corpo.comentario ?? "").trim();
    if (!Number.isInteger(nota) || nota < 1 || nota > 5 || comentario.length > 600) { responder(400, { erro: "Avaliação inválida." }); return; }
    salvarAvaliacao(usuarioSessao.id, decodeURIComponent(url.replace("/api/avaliacoes/", "")), nota, comentario); responder(201, { mensagem: "Avaliação registrada." }); return;
  }

  if (req.method === "POST" && url === "/api/produtos") {
    if (!exigirAdmin()) return;
    try {
      const corpo = await parseBody(req);
      const nome = String(corpo.nome ?? "").trim();
      const descricao = String(corpo.descricao ?? "").trim();
      const categoriaId = String(corpo.categoriaId ?? "").trim();
      const preco = Number(corpo.preco ?? 0);
      const quantidade = Number(corpo.quantidade ?? 0);
      const imagem = String(corpo.imagem ?? "").trim();

      const erroProduto = validarProduto({ nome, preco, quantidade, categoriaId, descricao, imagem });
      if (erroProduto) {
        responder(400, { erro: erroProduto });
        return;
      }

      const produto = {
        id: crypto.randomUUID(),
        nome,
        descricao: descricao || "Produto novo da loja.",
        preco,
        quantidade,
        categoria_id: categoriaId,
        imagem: imagem || undefined,
      };

      inserirProduto(produto);

      res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ mensagem: "Produto cadastrado com sucesso.", produto }));
      return;
    } catch (erro) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ erro: erro instanceof Error ? erro.message : "Erro ao cadastrar produto." }));
      return;
    }
  }

  if (req.method === "GET" && url === "/api/admin/produtos") {
    if (!exigirAdmin()) return;
    responder(200, listarProdutos(true));
    return;
  }
  if (req.method === "PUT" && url.startsWith("/api/produtos/")) {
    if (!exigirAdmin()) return;
    const corpo = await parseBody(req); const id = decodeURIComponent(url.replace("/api/produtos/", ""));
    const produto = { nome: String(corpo.nome ?? "").trim(), descricao: String(corpo.descricao ?? "").trim(), preco: Number(corpo.preco), quantidade: Number(corpo.quantidade), categoria_id: String(corpo.categoriaId ?? "").trim(), imagem: String(corpo.imagem ?? "").trim() || undefined, ativo: corpo.ativo !== false };
    const erro = validarProduto({ ...produto, categoriaId: produto.categoria_id }); if (erro) { responder(400, { erro }); return; }
    atualizarProduto(id, produto); responder(200, { mensagem: "Produto atualizado." }); return;
  }
  if (req.method === "DELETE" && url.startsWith("/api/produtos/")) { if (!exigirAdmin()) return; inativarProduto(decodeURIComponent(url.replace("/api/produtos/", ""))); responder(200, { mensagem: "Produto inativado." }); return; }
  if (req.method === "GET" && url === "/api/admin/pedidos") { if (!exigirAdmin()) return; responder(200, listarPedidosAdmin()); return; }
  if (req.method === "PATCH" && url.startsWith("/api/admin/pedidos/")) { if (!exigirAdmin()) return; const corpo = await parseBody(req); atualizarStatusPedido(decodeURIComponent(url.replace("/api/admin/pedidos/", "")), String(corpo.status ?? "")); responder(200, { mensagem: "Status atualizado." }); return; }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ erro: "Rota não encontrada." }));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    await tratarApi(req, res, pathname);
    return;
  }

  if (pathname.startsWith("/build/")) {
    await servirArquivo(req, res, pathname);
    return;
  }

  if (["/", "/index.html", "/admin.html", "/dashboard.html", "/login.html", "/style.css"].includes(pathname)) {
    await servirArquivo(req, res, pathname);
    return;
  }

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  await servirArquivo(req, res, pathname);
});

inicializarBanco();

servidor.listen(porta, () => {
  console.log(`Servidor da loja rodando em http://localhost:${porta}`);
});
