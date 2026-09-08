import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const diretorioBanco = path.resolve(__dirname, "..", "database");
const caminhoBanco = path.resolve(diretorioBanco, "loja.db");
const caminhoSchema = path.resolve(diretorioBanco, "schema.sql");

export function conectarBanco() {
  return new DatabaseSync(caminhoBanco);
}

export function inicializarBanco(): void {
  fs.mkdirSync(diretorioBanco, { recursive: true });

  const schema = fs.readFileSync(caminhoSchema, "utf-8");
  const db = conectarBanco();

  try {
    migrarEstrutura(db);
    db.exec(schema);
    db.prepare("UPDATE cupons SET tipo_desconto = 'frete_gratis', porcentagem_desconto = 0 WHERE codigo = 'FRETEGRATIS'").run();
    garantirAdministrador(db);
    console.log("Banco de dados inicializado com sucesso.");
    console.log(`Arquivo do banco: ${caminhoBanco}`);
  } finally {
    db.close();
  }
}

function migrarEstrutura(db: DatabaseSync): void {
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  if (tabelas.some((tabela) => tabela.name === "usuarios")) {
    const colunasUsuarios = db.prepare("PRAGMA table_info(usuarios)").all() as Array<{ name: string }>;
    if (!colunasUsuarios.some((coluna) => coluna.name === "role")) db.exec("ALTER TABLE usuarios ADD COLUMN role TEXT NOT NULL DEFAULT 'cliente';");
  }
  if (tabelas.some((tabela) => tabela.name === "produtos")) {
    const colunasProdutos = db.prepare("PRAGMA table_info(produtos)").all() as Array<{ name: string }>;
    if (!colunasProdutos.some((coluna) => coluna.name === "imagem")) db.exec("ALTER TABLE produtos ADD COLUMN imagem TEXT;");
    if (!colunasProdutos.some((coluna) => coluna.name === "ativo")) db.exec("ALTER TABLE produtos ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1;");
  }
  adicionarColunas(db, "usuarios", ["cep TEXT", "rua TEXT", "numero TEXT", "complemento TEXT", "bairro TEXT", "cidade TEXT", "estado TEXT"]);
  adicionarColunas(db, "cupons", ["tipo_desconto TEXT NOT NULL DEFAULT 'porcentagem'", "valor_minimo REAL NOT NULL DEFAULT 0", "inicio_em DATETIME", "fim_em DATETIME", "limite_uso INTEGER", "usos INTEGER NOT NULL DEFAULT 0"]);
  adicionarColunas(db, "pedidos", ["metodo_pagamento TEXT", "status_pagamento TEXT NOT NULL DEFAULT 'pendente'", "cep_entrega TEXT", "rua_entrega TEXT", "numero_entrega TEXT", "complemento_entrega TEXT", "bairro_entrega TEXT", "cidade_entrega TEXT", "estado_entrega TEXT"]);
}

function adicionarColunas(db: DatabaseSync, tabela: string, definicoes: string[]): void {
  const existe = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela);
  if (!existe) return;
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>;
  for (const definicao of definicoes) {
    const nome = definicao.split(" ")[0];
    if (!colunas.some((coluna) => coluna.name === nome)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${definicao}`);
  }
}

function garantirAdministrador(db: DatabaseSync): void {
  const admin = db.prepare("SELECT id, senha FROM usuarios WHERE email = 'admin@lojaficticia.com'").get() as { id: string; senha: string } | undefined;
  if (!admin) {
    db.prepare("INSERT INTO usuarios (id, nome, email, senha, role) VALUES (?, ?, ?, ?, ?)")
      .run("usr-admin", "Administrador", "admin@lojaficticia.com", criarHashSenha("admin123"), "admin");
  } else {
    db.exec("UPDATE usuarios SET role = 'admin' WHERE email = 'admin@lojaficticia.com';");
    if (!admin.senha.startsWith("scrypt$")) {
      db.prepare("UPDATE usuarios SET senha = ? WHERE id = ?").run(criarHashSenha(admin.senha), admin.id);
    }
  }
}

function criarHashSenha(senha: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(senha, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verificarSenha(senha: string, senhaArmazenada: string): boolean {
  // Mantém compatibilidade com bancos criados antes da adoção de hash.
  if (!senhaArmazenada.startsWith("scrypt$")) return senha === senhaArmazenada;
  const [, salt, hash] = senhaArmazenada.split("$");
  if (!salt || !hash) return false;
  const tentativa = scryptSync(senha, salt, 64);
  const esperado = Buffer.from(hash, "hex");
  return esperado.length === tentativa.length && timingSafeEqual(esperado, tentativa);
}

export function listarProdutos(incluirInativos = false) {
  const db = conectarBanco();

  try {
    return db.prepare(
      `SELECT p.id, p.nome, p.descricao, p.preco, p.quantidade, p.imagem, p.ativo, p.categoria_id as categoriaId, c.nome as categoria
       FROM produtos p
       INNER JOIN categorias c ON c.id = p.categoria_id
       ${incluirInativos ? "" : "WHERE p.ativo = 1"}
       ORDER BY p.nome ASC`
    ).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

export function listarCategorias() {
  const db = conectarBanco();

  try {
    return db.prepare(`SELECT id, nome FROM categorias ORDER BY nome ASC`).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

export function buscarUsuarioPorEmail(email: string) {
  const db = conectarBanco();

  try {
    return db.prepare(`SELECT id, nome, email, senha, role FROM usuarios WHERE email = ?`).get(email) as
      | { id: string; nome: string; email: string; senha: string; role: string } 
      | undefined;
  } finally {
    db.close();
  }
}

export function buscarUsuarioPorId(id: string) {
  const db = conectarBanco();

  try {
    return db.prepare(`SELECT id, nome, email, role FROM usuarios WHERE id = ?`).get(id) as
      | { id: string; nome: string; email: string; role: string }
      | undefined;
  } finally {
    db.close();
  }
}

export function criarUsuario(usuario: { id: string; nome: string; email: string; senha: string }) {
  const db = conectarBanco();

  try {
    db.prepare(
      `INSERT INTO usuarios (id, nome, email, senha, role)
       VALUES (@id, @nome, @email, @senha, 'cliente')`
    ).run({ ...usuario, senha: criarHashSenha(usuario.senha) });
  } finally {
    db.close();
  }
}

export function listarMaisVendidos() {
  const db = conectarBanco();
  try {
    return db.prepare(`SELECT p.id, p.nome, p.descricao, p.preco, p.quantidade, p.imagem, p.ativo, c.nome as categoria, COALESCE(SUM(i.quantidade), 0) as vendidos
      FROM produtos p LEFT JOIN itens_pedido i ON i.produto_id = p.id
      INNER JOIN categorias c ON c.id = p.categoria_id
      WHERE p.ativo = 1 GROUP BY p.id ORDER BY vendidos DESC, p.nome ASC LIMIT 3`).all() as Array<Record<string, unknown>>;
  } finally { db.close(); }
}

export function atualizarSenhaUsuario(id: string, senha: string) {
  const db = conectarBanco();
  try {
    db.prepare("UPDATE usuarios SET senha = ? WHERE id = ?").run(criarHashSenha(senha), id);
  } finally {
    db.close();
  }
}

export function listarPedidosDoUsuario(usuarioId: string) {
  const db = conectarBanco();

  try {
    const pedidos = db.prepare(
      `SELECT id, subtotal, desconto, frete, total_final, status, metodo_pagamento, status_pagamento, criado_em
       FROM pedidos WHERE usuario_id = ? ORDER BY criado_em DESC`
    ).all(usuarioId) as Array<Record<string, unknown>>;

    return pedidos.map((pedido) => ({
      ...pedido,
      itens: db.prepare(
        `SELECT i.produto_id, i.quantidade, i.preco_unitario, i.subtotal, p.nome, p.imagem
         FROM itens_pedido i INNER JOIN produtos p ON p.id = i.produto_id
         WHERE i.pedido_id = ?`
      ).all(String(pedido.id)),
    }));
  } finally {
    db.close();
  }
}

export function atualizarEnderecoUsuario(id: string, endereco: Record<string, string>) {
  const db = conectarBanco();
  try {
    db.prepare(`UPDATE usuarios SET cep=@cep, rua=@rua, numero=@numero, complemento=@complemento, bairro=@bairro, cidade=@cidade, estado=@estado WHERE id=@id`).run({ id, ...endereco });
  } finally { db.close(); }
}

export function buscarPerfilUsuario(id: string) {
  const db = conectarBanco();
  try { return db.prepare(`SELECT id, nome, email, role, cep, rua, numero, complemento, bairro, cidade, estado FROM usuarios WHERE id = ?`).get(id) as Record<string, unknown> | undefined; }
  finally { db.close(); }
}

export function criarPedido(usuarioId: string, itens: Array<{ produtoId: string; quantidade: number }>, codigoCupom?: string, pagamento?: string) {
  if (!itens.length) throw new Error("O carrinho está vazio.");

  const db = conectarBanco();
  const pedidoId = crypto.randomUUID();

  try {
    db.exec("BEGIN TRANSACTION");
    let subtotal = 0;
    const itensCalculados: Array<{ id: string; produtoId: string; quantidade: number; preco: number; subtotal: number }> = [];

    for (const item of itens) {
      const produto = db.prepare("SELECT id, preco, quantidade FROM produtos WHERE id = ?").get(item.produtoId) as
        | { id: string; preco: number; quantidade: number }
        | undefined;
      if (!produto || !Number.isInteger(item.quantidade) || item.quantidade < 1) throw new Error("Produto ou quantidade inválida.");
      if (produto.quantidade < item.quantidade) throw new Error("Um dos produtos não tem estoque suficiente.");

      const itemSubtotal = produto.preco * item.quantidade;
      subtotal += itemSubtotal;
      itensCalculados.push({ id: crypto.randomUUID(), produtoId: produto.id, quantidade: item.quantidade, preco: produto.preco, subtotal: itemSubtotal });
      db.prepare("UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?").run(item.quantidade, produto.id);
    }

    const cupom = codigoCupom
      ? db.prepare("SELECT id, porcentagem_desconto, tipo_desconto, valor_minimo, limite_uso, usos FROM cupons WHERE codigo = ? AND ativo = 1 AND (inicio_em IS NULL OR inicio_em <= CURRENT_TIMESTAMP) AND (fim_em IS NULL OR fim_em >= CURRENT_TIMESTAMP)").get(codigoCupom.trim().toUpperCase()) as { id: string; porcentagem_desconto: number; tipo_desconto: string; valor_minimo: number; limite_uso: number | null; usos: number } | undefined
      : undefined;
    if (codigoCupom && !cupom) throw new Error("Cupom inválido ou inativo.");
    if (cupom && subtotal < Number(cupom.valor_minimo)) throw new Error("O valor mínimo para este cupom não foi atingido.");
    if (cupom?.limite_uso !== null && cupom && cupom.usos >= cupom.limite_uso) throw new Error("Este cupom atingiu o limite de uso.");
    const desconto = cupom?.tipo_desconto === "valor_fixo" ? Math.min(subtotal, Number(cupom.porcentagem_desconto)) : subtotal * (Number(cupom?.porcentagem_desconto ?? 0) / 100);
    const frete = cupom?.tipo_desconto === "frete_gratis" || subtotal - desconto >= 150 ? 0 : 20;
    const totalFinal = subtotal - desconto + frete;

    db.prepare(
      `INSERT INTO pedidos (id, usuario_id, subtotal, desconto, frete, total_final, status, metodo_pagamento, status_pagamento, cep_entrega, rua_entrega, numero_entrega, complemento_entrega, bairro_entrega, cidade_entrega, estado_entrega)
       SELECT ?, ?, ?, ?, ?, ?, 'processando', ?, 'aprovado', cep, rua, numero, complemento, bairro, cidade, estado FROM usuarios WHERE id = ?`
    ).run(pedidoId, usuarioId, subtotal, desconto, frete, totalFinal, pagamento ?? "pix", usuarioId);

    const inserirItem = db.prepare(
      `INSERT INTO itens_pedido (id, pedido_id, produto_id, quantidade, preco_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const item of itensCalculados) {
      inserirItem.run(item.id, pedidoId, item.produtoId, item.quantidade, item.preco, item.subtotal);
    }
    if (cupom) db.prepare("UPDATE cupons SET usos = usos + 1 WHERE id = ?").run(cupom.id);

    db.exec("COMMIT");
    return { id: pedidoId, subtotal, desconto, frete, total_final: totalFinal, status: "processando", metodo_pagamento: pagamento ?? "pix", status_pagamento: "aprovado" };
  } catch (erro) {
    db.exec("ROLLBACK");
    throw erro;
  } finally {
    db.close();
  }
}

export function listarDashboard() {
  const db = conectarBanco();

  try {
    const totalProdutos = db.prepare(`SELECT COUNT(*) as total FROM produtos`).get() as { total: number };
    const totalUsuarios = db.prepare(`SELECT COUNT(*) as total FROM usuarios`).get() as { total: number };
    const totalPedidos = db.prepare(`SELECT COUNT(*) as total FROM pedidos`).get() as { total: number };
    const totalVendas = db.prepare(`SELECT COALESCE(SUM(total_final), 0) as total FROM pedidos WHERE status != 'cancelado'`).get() as { total: number };
    const vendasRecentes = db.prepare(
      `SELECT p.id, u.nome as cliente, p.total_final as valor, p.status, p.criado_em
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       ORDER BY p.criado_em DESC
       LIMIT 5`
    ).all() as Array<Record<string, unknown>>;
    const vendasPorCategoria = db.prepare(
      `SELECT c.nome as categoria, COALESCE(SUM(i.subtotal), 0) as total
       FROM itens_pedido i
       INNER JOIN produtos pr ON pr.id = i.produto_id
       INNER JOIN categorias c ON c.id = pr.categoria_id
       GROUP BY c.id, c.nome ORDER BY total DESC`
    ).all() as Array<Record<string, unknown>>;
    const vendasPorDia = db.prepare(
      `SELECT substr(criado_em, 1, 10) as data, COALESCE(SUM(total_final), 0) as total
       FROM pedidos WHERE status != 'cancelado' GROUP BY data ORDER BY data DESC LIMIT 14`
    ).all() as Array<Record<string, unknown>>;
    const estoqueBaixo = db.prepare(
      `SELECT id, nome, quantidade FROM produtos WHERE quantidade <= 5 ORDER BY quantidade ASC, nome ASC LIMIT 6`
    ).all() as Array<Record<string, unknown>>;
    const pedidosPorStatus = db.prepare(
      `SELECT status, COUNT(*) as total FROM pedidos GROUP BY status ORDER BY total DESC`
    ).all() as Array<Record<string, unknown>>;

    const ticketMedio = db.prepare(`SELECT COALESCE(AVG(total_final), 0) as total FROM pedidos WHERE status != 'cancelado'`).get() as { total: number };
    const produtosVendidos = db.prepare(`SELECT COALESCE(SUM(i.quantidade), 0) as total FROM itens_pedido i INNER JOIN pedidos p ON p.id=i.pedido_id WHERE p.status != 'cancelado'`).get() as { total: number };
    return {
      totalProdutos: Number(totalProdutos.total ?? 0),
      totalUsuarios: Number(totalUsuarios.total ?? 0),
      totalPedidos: Number(totalPedidos.total ?? 0),
      totalVendas: Number(totalVendas.total ?? 0),
      ticketMedio: Number(ticketMedio.total ?? 0),
      produtosVendidos: Number(produtosVendidos.total ?? 0),
      vendasRecentes,
      vendasPorCategoria,
      vendasPorDia,
      estoqueBaixo,
      pedidosPorStatus,
    };
  } finally {
    db.close();
  }
}

export function listarPedidosAdmin() {
  const db = conectarBanco();
  try { return db.prepare(`SELECT p.id, p.total_final, p.status, p.status_pagamento, p.metodo_pagamento, p.criado_em, u.nome as cliente FROM pedidos p LEFT JOIN usuarios u ON u.id=p.usuario_id ORDER BY p.criado_em DESC`).all() as Array<Record<string, unknown>>; }
  finally { db.close(); }
}

export function atualizarStatusPedido(id: string, status: string) {
  const permitidos = ["processando", "enviado", "finalizado", "cancelado"];
  if (!permitidos.includes(status)) throw new Error("Status de pedido inválido.");
  const db = conectarBanco();
  try { db.prepare("UPDATE pedidos SET status = ? WHERE id = ?").run(status, id); }
  finally { db.close(); }
}

export function inserirProduto(produto: {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  quantidade: number;
  categoria_id: string;
  imagem?: string;
}) {
  const db = conectarBanco();

  try {
    db.prepare(
      `INSERT INTO produtos (id, nome, descricao, preco, quantidade, categoria_id, imagem)
       VALUES (@id, @nome, @descricao, @preco, @quantidade, @categoria_id, @imagem)`
    ).run({
      id: produto.id,
      nome: produto.nome,
      descricao: produto.descricao ?? null,
      preco: produto.preco,
      quantidade: produto.quantidade,
      categoria_id: produto.categoria_id,
      imagem: produto.imagem ?? null,
    });
  } finally {
    db.close();
  }
}

export function atualizarProduto(id: string, produto: { nome: string; descricao?: string; preco: number; quantidade: number; categoria_id: string; imagem?: string; ativo?: boolean }) {
  const db = conectarBanco();
  try {
    const anterior = db.prepare("SELECT quantidade FROM produtos WHERE id = ?").get(id) as { quantidade: number } | undefined;
    if (!anterior) throw new Error("Produto não encontrado.");
    db.prepare(`UPDATE produtos SET nome=@nome, descricao=@descricao, preco=@preco, quantidade=@quantidade, categoria_id=@categoria_id, imagem=@imagem, ativo=@ativo WHERE id=@id`).run({ id, ...produto, descricao: produto.descricao ?? null, imagem: produto.imagem ?? null, ativo: produto.ativo === false ? 0 : 1 });
    const diferenca = produto.quantidade - anterior.quantidade;
    if (diferenca) db.prepare("INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade, motivo) VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), id, diferenca > 0 ? "entrada" : "ajuste", diferenca, "Ajuste administrativo");
  } finally { db.close(); }
}

export function inativarProduto(id: string) {
  const db = conectarBanco();
  try { db.prepare("UPDATE produtos SET ativo = 0 WHERE id = ?").run(id); } finally { db.close(); }
}

export function listarFavoritos(usuarioId: string) {
  const db = conectarBanco();
  try { return db.prepare(`SELECT p.id, p.nome, p.descricao, p.preco, p.quantidade, p.imagem, c.nome categoria FROM favoritos f INNER JOIN produtos p ON p.id=f.produto_id INNER JOIN categorias c ON c.id=p.categoria_id WHERE f.usuario_id=? AND p.ativo=1 ORDER BY f.criado_em DESC`).all(usuarioId) as Array<Record<string, unknown>>; } finally { db.close(); }
}

export function alternarFavorito(usuarioId: string, produtoId: string) {
  const db = conectarBanco();
  try { const existe = db.prepare("SELECT 1 FROM favoritos WHERE usuario_id=? AND produto_id=?").get(usuarioId, produtoId); if (existe) db.prepare("DELETE FROM favoritos WHERE usuario_id=? AND produto_id=?").run(usuarioId, produtoId); else db.prepare("INSERT INTO favoritos (usuario_id, produto_id) VALUES (?, ?)").run(usuarioId, produtoId); return !existe; } finally { db.close(); }
}

export function listarAvaliacoes(produtoId: string) { const db = conectarBanco(); try { return db.prepare(`SELECT a.nota, a.comentario, a.criado_em, u.nome FROM avaliacoes a INNER JOIN usuarios u ON u.id=a.usuario_id WHERE a.produto_id=? ORDER BY a.criado_em DESC`).all(produtoId) as Array<Record<string, unknown>>; } finally { db.close(); } }
export function salvarAvaliacao(usuarioId: string, produtoId: string, nota: number, comentario: string) { const db = conectarBanco(); try { db.prepare(`INSERT INTO avaliacoes (id, usuario_id, produto_id, nota, comentario) VALUES (?, ?, ?, ?, ?) ON CONFLICT(usuario_id, produto_id) DO UPDATE SET nota=excluded.nota, comentario=excluded.comentario, criado_em=CURRENT_TIMESTAMP`).run(crypto.randomUUID(), usuarioId, produtoId, nota, comentario); } finally { db.close(); } }

if (process.argv.includes("--init")) {
  inicializarBanco();
}
