import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { emTransacao, obterPool } from "./postgres.js";
import { aplicarMigracoes } from "./postgres.js";

// ── Autenticação ───────────────────────────────────────────────────────────

/**
 * Hash de senha com scrypt.
 *
 * O formato é `scrypt$<salt-hex>$<hash-hex>`. O salt é aleatório por usuário,
 * o que faz duas pessoas com a mesma senha terem hashes diferentes — sem isso,
 * o banco revelaria quais contas compartilham senha.
 */
function criarHashSenha(senha: string): string {
  const salt = randomBytes(16);
  const derivada = scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derivada.toString("hex")}`;
}

export function verificarSenha(senha: string, senhaArmazenada: string): boolean {
  const partes = senhaArmazenada.split("$");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;

  const [, saltHex, hashHex] = partes;
  const esperada = Buffer.from(hashHex ?? "", "hex");
  const derivada = scryptSync(senha, Buffer.from(saltHex ?? "", "hex"), esperada.length);
  // timingSafeEqual exige buffers do mesmo tamanho; comparar antes evita
  // que o tempo de resposta revele o tamanho do hash esperado.
  if (derivada.length !== esperada.length) return false;
  return timingSafeEqual(derivada, esperada);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function criarTokenRedefinicaoSenha(email: string): Promise<string | undefined> {
  return emTransacao(async (client) => {
    const usuario = await client.query<{ id: string }>('SELECT id FROM usuarios WHERE email = $1 COLLATE "C"', [
      email.trim(),
    ]);
    if (usuario.rowCount === 0) return undefined;

    const token = randomBytes(32).toString("hex");
    await client.query("DELETE FROM tokens_redefinicao_senha WHERE usuario_id = $1", [usuario.rows[0]?.id]);
    await client.query(
      "INSERT INTO tokens_redefinicao_senha (token_hash, usuario_id, expira_em) VALUES ($1, $2, now() + interval '1 hour')",
      [hashToken(token), usuario.rows[0]?.id],
    );
    return token;
  });
}

export async function redefinirSenhaComToken(token: string, novaSenha: string): Promise<boolean> {
  return emTransacao(async (client) => {
    const encontrado = await client.query<{ usuario_id: string }>(
      "SELECT usuario_id FROM tokens_redefinicao_senha WHERE token_hash = $1 AND expira_em > now()",
      [hashToken(token)],
    );

    const linha = encontrado.rows[0];
    if (!linha) return false;

    await client.query("UPDATE usuarios SET senha = $1 WHERE id = $2", [criarHashSenha(novaSenha), linha.usuario_id]);
    // Uso único: o token é consumido, mesmo que a senha volte a ser trocada.
    await client.query("DELETE FROM tokens_redefinicao_senha WHERE token_hash = $1", [hashToken(token)]);
    return true;
  });
}

export function atualizarSenhaUsuario(id: string, senha: string) {
  return obterPool().query("UPDATE usuarios SET senha = $1 WHERE id = $2", [criarHashSenha(senha), id]);
}

// ── Sessões ────────────────────────────────────────────────────────────────

/**
 * Sessões persistidas no banco.
 *
 * Antes era um `Map` em memória, que perdia toda sessão a cada reinício do
 * processo e não era compartilhado entre instâncias — o que quebrava em
 * serverless, onde cada requisição pode cair numa instância diferente.
 *
 * O que se guarda é o **hash** do token, nunca o token. Quem tiver acesso de
 * leitura ao banco não consegue forjar uma sessão, porque precisaria do valor
 * original, que só existe no cookie do cliente.
 */
export async function criarSessao(token: string, usuarioId: string, duracaoMs: number): Promise<void> {
  // O hash é calculado aqui dentro, e não no chamador, para que não exista
  // caminho que grave o token cru. É a fronteira de segurança: o valor original
  // só pode existir no cookie do cliente.
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // Remove as sessões do mesmo usuário antes de criar uma nova, senão abrir
  // cinco abas deixa cinco registros válidos até expirarem, e um logout só
  // derrubaria um deles.
  await obterPool().query("DELETE FROM sessoes WHERE usuario_id = $1", [usuarioId]);
  await obterPool().query(
    "INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES ($1, $2, now() + ($3::bigint * interval '1 millisecond'))",
    [tokenHash, usuarioId, String(duracaoMs)],
  );
}

/** Devolve o id do usuário da sessão, ou `undefined` se não existir ou tiver expirado. */
export async function obterSessao(tokenHash: string): Promise<string | undefined> {
  const resultado = await obterPool().query<{ usuario_id: string }>(
    "SELECT usuario_id FROM sessoes WHERE token_hash = $1 AND expira_em > now()",
    [tokenHash],
  );
  return resultado.rows[0]?.usuario_id;
}

export function encerrarSessao(tokenHash: string) {
  return obterPool().query("DELETE FROM sessoes WHERE token_hash = $1", [tokenHash]);
}

/** Apaga todas as sessões. Usado entre cenários de teste. */
export function expirarSessao() {
  return obterPool().query("DELETE FROM sessoes");
}

/**
 * Remove sessões vencidas.
 *
 * Sem isso a tabela só cresce: uma sessão expirada continua no banco até
 * alguém reapresentar o token. Rodar na inicialização do servidor resolve,
 * porque o custo é de uma única consulta.
 */
export function limparSessoesExpiradas(): Promise<{ rowCount: number | null }> {
  return obterPool().query("DELETE FROM sessoes WHERE expira_em <= now()");
}

// ── Auditoria ──────────────────────────────────────────────────────────────

/**
 * Registra uma mudança para auditoria.
 *
 * Guarda o antes e o depois em JSONB, o que permite reconstruir a alteração
 * sem depender do estado atual. `usuario_id` é quem executou, não quem é
 * dono da entidade: a diferença importa quando um admin edita o pedido de
 * outra pessoa.
 */
export function registrarAuditoria(entrada: {
  entidade: string;
  entidadeId: string;
  acao: string;
  antes?: Record<string, unknown> | null;
  depois?: Record<string, unknown> | null;
  usuarioId?: string | null;
}) {
  return obterPool().query(
    "INSERT INTO auditoria (id, entidade, entidade_id, acao, antes, depois, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      randomUUID(),
      entrada.entidade,
      entrada.entidadeId,
      entrada.acao,
      entrada.antes ? JSON.stringify(entrada.antes) : null,
      entrada.depois ? JSON.stringify(entrada.depois) : null,
      entrada.usuarioId ?? null,
    ],
  );
}

export async function listarAuditoria(entidade: string, entidadeId: string) {
  const resultado = await obterPool().query(
    `SELECT a.id, a.acao, a.antes, a.depois, a.criado_em, u.nome AS usuario
     FROM auditoria a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.entidade = $1 AND a.entidade_id = $2
     ORDER BY a.criado_em DESC
     LIMIT 50`,
    [entidade, entidadeId],
  );
  return resultado.rows;
}

// ── Usuários ───────────────────────────────────────────────────────────────

/** Garante que existe um administrador, criando-o com senha padrão se preciso. */
export async function garantirAdministrador(): Promise<void> {
  await emTransacao(async (client) => {
    const existente = await client.query<{ id: string; senha: string }>(
      "SELECT id, senha FROM usuarios WHERE email = $1",
      ["admin@lojaficticia.com"],
    );

    const linha = existente.rows[0];
    if (!linha) {
      await client.query("INSERT INTO usuarios (id, nome, email, senha, role) VALUES ($1, $2, $3, $4, 'admin')", [
        "usr-admin",
        "Administrador",
        "admin@lojaficticia.com",
        criarHashSenha("admin123"),
      ]);
      return;
    }

    await client.query("UPDATE usuarios SET role = 'admin' WHERE id = $1", [linha.id]);
    // Migra senhas em texto puro de instalações antigas para scrypt.
    if (!linha.senha.startsWith("scrypt$")) {
      await client.query("UPDATE usuarios SET senha = $1 WHERE id = $2", [criarHashSenha(linha.senha), linha.id]);
    }
  });
}

export async function buscarUsuarioPorEmail(email: string) {
  const resultado = await obterPool().query(
    'SELECT id, nome, email, senha, role FROM usuarios WHERE email = $1 COLLATE "C"',
    [email.trim()],
  );
  return resultado.rows[0] as { id: string; nome: string; email: string; senha: string; role: string } | undefined;
}

export async function buscarUsuarioPorId(id: string) {
  const resultado = await obterPool().query("SELECT id, nome, email, role FROM usuarios WHERE id = $1", [id]);
  return resultado.rows[0] as { id: string; nome: string; email: string; role: string } | undefined;
}

export async function criarUsuario(usuario: { id: string; nome: string; email: string; senha: string }) {
  await obterPool().query("INSERT INTO usuarios (id, nome, email, senha, role) VALUES ($1, $2, $3, $4, 'cliente')", [
    usuario.id,
    usuario.nome,
    usuario.email,
    criarHashSenha(usuario.senha),
  ]);
}

export async function buscarPerfilUsuario(id: string) {
  const resultado = await obterPool().query(
    "SELECT id, nome, email, role, cep, rua, numero, complemento, bairro, cidade, estado, criado_em FROM usuarios WHERE id = $1",
    [id],
  );
  return resultado.rows[0];
}

export function atualizarEnderecoUsuario(id: string, endereco: Record<string, string>) {
  return obterPool().query(
    "UPDATE usuarios SET cep = $2, rua = $3, numero = $4, complemento = $5, bairro = $6, cidade = $7, estado = $8 WHERE id = $1",
    [
      id,
      endereco.cep,
      endereco.rua,
      endereco.numero,
      endereco.complemento,
      endereco.bairro,
      endereco.cidade,
      endereco.estado,
    ],
  );
}

// ── Produtos ───────────────────────────────────────────────────────────────

export async function listarProdutos(incluirInativos = false) {
  const filtro = incluirInativos ? "" : "WHERE p.ativo = true";
  const resultado = await obterPool().query(
    `SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.quantidade, p.imagem, p.ativo, c.nome AS categoria
     FROM produtos p
     INNER JOIN categorias c ON c.id = p.categoria_id
     ${filtro}
     ORDER BY p.nome ASC`,
  );
  return resultado.rows.map((linha) => ({
    ...linha,
    preco: linha.preco_centavos / 100,
    imagem: linha.imagem ?? undefined,
  }));
}

export async function listarCategorias() {
  const resultado = await obterPool().query("SELECT id, nome FROM categorias ORDER BY nome ASC");
  return resultado.rows;
}

export async function listarMaisVendidos() {
  const resultado = await obterPool().query(
    `SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.quantidade, p.imagem, p.ativo,
            c.nome AS categoria, COALESCE(SUM(i.quantidade), 0)::int AS vendidos
     FROM produtos p
     LEFT JOIN itens_pedido i ON i.produto_id = p.id
     INNER JOIN categorias c ON c.id = p.categoria_id
     WHERE p.ativo = true
     GROUP BY p.id, c.nome
     ORDER BY vendidos DESC, p.nome ASC
     LIMIT 3`,
  );
  return resultado.rows.map((linha) => ({
    ...linha,
    preco: linha.preco_centavos / 100,
    imagem: linha.imagem ?? undefined,
  }));
}

export async function inserirProduto(produto: {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  quantidade: number;
  categoria_id: string;
  imagem?: string;
}) {
  await obterPool().query(
    "INSERT INTO produtos (id, nome, descricao, preco_centavos, quantidade, categoria_id, imagem) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      produto.id,
      produto.nome,
      produto.descricao,
      Math.round(produto.preco * 100),
      produto.quantidade,
      produto.categoria_id,
      produto.imagem ?? null,
    ],
  );
}

export async function atualizarProduto(
  id: string,
  produto: {
    nome: string;
    descricao?: string;
    preco: number;
    quantidade: number;
    categoria_id: string;
    imagem?: string;
    ativo?: boolean;
  },
) {
  await emTransacao(async (client) => {
    const anterior = await client.query<{ quantidade: number }>(
      "SELECT quantidade FROM produtos WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (anterior.rowCount === 0) throw new Error("Produto não encontrado.");

    await client.query(
      "UPDATE produtos SET nome = $2, descricao = $3, preco_centavos = $4, quantidade = $5, categoria_id = $6, imagem = $7, ativo = $8 WHERE id = $1",
      [
        id,
        produto.nome,
        produto.descricao ?? "",
        Math.round(produto.preco * 100),
        produto.quantidade,
        produto.categoria_id,
        produto.imagem ?? null,
        produto.ativo ?? true,
      ],
    );

    const diferenca = produto.quantidade - (anterior.rows[0]?.quantidade ?? 0);
    if (diferenca !== 0) {
      await client.query(
        "INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade, motivo) VALUES ($1, $2, $3, $4, $5)",
        [randomUUID(), id, diferenca > 0 ? "entrada" : "ajuste", diferenca, "Ajuste administrativo"],
      );
    }
  });
}

export function inativarProduto(id: string) {
  return obterPool().query("UPDATE produtos SET ativo = false WHERE id = $1", [id]);
}

// ── Cupons ─────────────────────────────────────────────────────────────────

type LinhaCupom = {
  id: string;
  codigo: string;
  desconto_centavos: number;
  porcentagem_desconto: number;
  tipo_desconto: string;
  valor_minimo_centavos: number;
  limite_uso: number | null;
  usos: number;
  ativo: boolean;
};

/**
 * Coleta as condições de validade do cupom em um único `WHERE`.
 *
 * `limite_uso` e `usos` são inteiros, então não podem usar a comparação
 * `> NULL` do SQLite: `limite_uso <= usos` seria NULL e o cupom pareceria
 * válido. O `IS` do PostgreSQL compara com NULL sem propagar o desconhecido.
 */
const CONDICAO_CUPOM = `
  codigo = $1 COLLATE "C"
  AND ativo = true
  AND (inicio_em IS NULL OR inicio_em <= now())
  AND (fim_em IS NULL OR fim_em >= now())
  AND (limite_uso IS NULL OR usos < limite_uso)`;

export async function validarCupomCodigo(codigo: string) {
  const resultado = await obterPool().query<LinhaCupom>(
    `SELECT id, codigo, desconto_centavos, porcentagem_desconto, tipo_desconto,
            valor_minimo_centavos, limite_uso, usos, ativo
     FROM cupons WHERE ${CONDICAO_CUPOM}`,
    [codigo.trim().toUpperCase()],
  );

  const cupom = resultado.rows[0];
  if (!cupom) return { valido: false as const, erro: "Cupom inválido ou expirado." };

  return {
    valido: true as const,
    codigo: cupom.codigo,
    tipoDesconto: cupom.tipo_desconto,
    porcentagemDesconto: cupom.porcentagem_desconto,
    descontoCentavos: cupom.desconto_centavos,
    valorMinimoCentavos: cupom.valor_minimo_centavos,
  };
}

export async function listarCuponsAtivos() {
  const resultado = await obterPool().query(
    `SELECT codigo, tipo_desconto, porcentagem_desconto, desconto_centavos, valor_minimo_centavos
     FROM cupons
     WHERE ativo = true
       AND (inicio_em IS NULL OR inicio_em <= now())
       AND (fim_em IS NULL OR fim_em >= now())
     ORDER BY codigo ASC`,
  );
  return resultado.rows;
}

export async function criarCupom(cupom: {
  id: string;
  codigo: string;
  descontoCentavos: number;
  porcentagemDesconto: number;
  tipoDesconto: string;
  valorMinimoCentavos: number;
  limiteUso?: number | null;
}) {
  await obterPool().query(
    "INSERT INTO cupons (id, codigo, desconto_centavos, porcentagem_desconto, tipo_desconto, valor_minimo_centavos, limite_uso) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      cupom.id,
      cupom.codigo,
      cupom.descontoCentavos,
      cupom.porcentagemDesconto,
      cupom.tipoDesconto,
      cupom.valorMinimoCentavos,
      cupom.limiteUso ?? null,
    ],
  );
}

// ── Pedidos ────────────────────────────────────────────────────────────────

const FRETE_GRATIS_A_PARTIR_DE_CENTAVOS = 150_00;
const FRETE_CENTAVOS = 20_00;

/**
 * Cria um pedido dentro de uma transação.
 *
 * O `SELECT ... FOR UPDATE` no produto trava a linha até o commit. Sem ele,
 * duas requisições simultâneas leem o mesmo estoque, as duas passam na
 * verificação e as duas descontam — o mesmo defeito que os testes de
 * integração não conseguiam cobrir, porque rodavam em série.
 */
export async function criarPedido(
  usuarioId: string,
  itens: Array<{ produtoId: string; quantidade: number }>,
  codigoCupom?: string,
  pagamento = "pix",
) {
  // `async` de propósito: sem isso o `throw` do carrinho vazio sai de forma
  // síncrona e vira exceção em vez de rejeição, obrigando o chamador a tratar
  // os dois casos. Sendo async, todo erro é rejeição.
  if (!itens.length) throw new Error("O carrinho está vazio.");

  const pedidoId = `PED-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;

  return emTransacao(async (client) => {
    let subtotal = 0;
    const itensCalculados: Array<{ produtoId: string; quantidade: number; preco: number }> = [];

    for (const item of itens) {
      const produto = await client.query<{ id: string; preco_centavos: number; quantidade: number }>(
        "SELECT id, preco_centavos, quantidade FROM produtos WHERE id = $1 FOR UPDATE",
        [item.produtoId],
      );

      const linha = produto.rows[0];
      if (!linha || !Number.isInteger(item.quantidade) || item.quantidade < 1) {
        throw new Error("Produto ou quantidade inválida.");
      }
      if (linha.quantidade < item.quantidade) throw new Error("Um dos produtos não tem estoque suficiente.");

      subtotal += linha.preco_centavos * item.quantidade;
      itensCalculados.push({ produtoId: linha.id, quantidade: item.quantidade, preco: linha.preco_centavos });

      await client.query("UPDATE produtos SET quantidade = quantidade - $2 WHERE id = $1", [linha.id, item.quantidade]);
    }

    let desconto = 0;
    let frete = FRETE_CENTAVOS;
    let cupomAplicado: LinhaCupom | null = null;

    if (codigoCupom) {
      const consulta = await client.query<LinhaCupom>(
        `SELECT id, codigo, desconto_centavos, porcentagem_desconto, tipo_desconto, valor_minimo_centavos, limite_uso, usos, ativo
         FROM cupons WHERE ${CONDICAO_CUPOM} FOR UPDATE`,
        [codigoCupom.trim().toUpperCase()],
      );

      cupomAplicado = consulta.rows[0] ?? null;
      if (!cupomAplicado) throw new Error("Cupom inválido ou inativo.");
      if (subtotal < cupomAplicado.valor_minimo_centavos)
        throw new Error("O valor mínimo para este cupom não foi atingido.");

      if (cupomAplicado.tipo_desconto === "valor_fixo") {
        desconto = Math.min(subtotal, cupomAplicado.desconto_centavos);
      } else if (cupomAplicado.tipo_desconto === "porcentagem") {
        // Math.round fecha a conta em centavos, o que a divisão real não faz.
        desconto = Math.round((subtotal * cupomAplicado.porcentagem_desconto) / 100);
      }

      if (cupomAplicado.tipo_desconto === "frete_gratis" || subtotal - desconto >= FRETE_GRATIS_A_PARTIR_DE_CENTAVOS) {
        frete = 0;
      }
    } else if (subtotal >= FRETE_GRATIS_A_PARTIR_DE_CENTAVOS) {
      frete = 0;
    }

    const total = subtotal - desconto + frete;

    await client.query(
      `INSERT INTO pedidos (id, usuario_id, subtotal_centavos, desconto_centavos, frete_centavos, total_centavos,
                             status, metodo_pagamento, status_pagamento,
                             cep_entrega, rua_entrega, numero_entrega, complemento_entrega,
                             bairro_entrega, cidade_entrega, estado_entrega)
       SELECT $1, u.id, $3, $4, $5, $6, 'processando', $7, 'aprovado',
              u.cep, u.rua, u.numero, u.complemento, u.bairro, u.cidade, u.estado
       FROM usuarios u WHERE u.id = $2`,
      [pedidoId, usuarioId, subtotal, desconto, frete, total, pagamento],
    );

    for (const item of itensCalculados) {
      await client.query(
        "INSERT INTO itens_pedido (id, pedido_id, produto_id, quantidade, preco_unitario_centavos, subtotal_centavos) VALUES ($1, $2, $3, $4, $5, $6)",
        [randomUUID(), pedidoId, item.produtoId, item.quantidade, item.preco, item.preco * item.quantidade],
      );
    }

    if (cupomAplicado) {
      await client.query("UPDATE cupons SET usos = usos + 1 WHERE id = $1", [cupomAplicado.id]);
    }

    return {
      id: pedidoId,
      subtotal: subtotal / 100,
      desconto: desconto / 100,
      frete: frete / 100,
      total_final: total / 100,
      status: "processando",
      metodo_pagamento: pagamento,
      status_pagamento: "aprovado",
    };
  });
}

export async function listarPedidosDoUsuario(usuarioId: string) {
  const pedidos = await obterPool().query(
    `SELECT id, subtotal_centavos, desconto_centavos, frete_centavos, total_centavos,
            status, metodo_pagamento, status_pagamento, criado_em
     FROM pedidos WHERE usuario_id = $1 ORDER BY criado_em DESC`,
    [usuarioId],
  );

  if (pedidos.rowCount === 0) return [];

  const itens = await obterPool().query(
    `SELECT i.pedido_id, i.produto_id, i.quantidade, i.preco_unitario_centavos, i.subtotal_centavos, p.nome
     FROM itens_pedido i
     INNER JOIN produtos p ON p.id = i.produto_id
     WHERE i.pedido_id = ANY($1::text[])`,
    [pedidos.rows.map((linha) => linha.id)],
  );

  return pedidos.rows.map((linha) => ({
    ...linha,
    subtotal: linha.subtotal_centavos / 100,
    desconto: linha.desconto_centavos / 100,
    frete: linha.frete_centavos / 100,
    total_final: linha.total_centavos / 100,
    itens: itens.rows
      .filter((item) => item.pedido_id === linha.id)
      .map((item) => ({
        produto_id: item.produto_id,
        nome: item.nome,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario_centavos / 100,
        subtotal: item.subtotal_centavos / 100,
      })),
  }));
}

export async function listarPedidosAdmin() {
  const resultado = await obterPool().query(
    `SELECT p.id, p.total_centavos, p.status, p.status_pagamento, p.metodo_pagamento, p.criado_em, u.nome AS cliente
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.usuario_id
     ORDER BY p.criado_em DESC`,
  );
  return resultado.rows.map((linha) => ({ ...linha, total_final: linha.total_centavos / 100 }));
}

export async function atualizarStatusPedido(id: string, status: string) {
  const permitidos = ["processando", "enviado", "finalizado", "cancelado"];
  if (!permitidos.includes(status)) throw new Error("Status de pedido inválido.");

  // Cancelar precisa devolver o estoque. Sem isso, um pedido cancelado deixa
  // o produto invisível para sempre.
  await emTransacao(async (client) => {
    const pedido = await client.query<{ status: string; usuario_id: string | null }>(
      "SELECT status, usuario_id FROM pedidos WHERE id = $1 FOR UPDATE",
      [id],
    );
    const linha = pedido.rows[0];
    if (!linha) throw new Error("Pedido não encontrado.");
    if (linha.status === status) return;

    await client.query("UPDATE pedidos SET status = $1 WHERE id = $2", [status, id]);

    if (status === "cancelado" && linha.status !== "cancelado") {
      const itens = await client.query<{ produto_id: string; quantidade: number }>(
        "SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = $1",
        [id],
      );
      for (const item of itens.rows) {
        await client.query("UPDATE produtos SET quantidade = quantidade + $2 WHERE id = $1", [
          item.produto_id,
          item.quantidade,
        ]);
      }
    } else if (linha.status === "cancelado" && status !== "cancelado") {
      const itens = await client.query<{ produto_id: string; quantidade: number }>(
        "SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = $1",
        [id],
      );
      for (const item of itens.rows) {
        await client.query("UPDATE produtos SET quantidade = GREATEST(0, quantidade - $2) WHERE id = $1", [
          item.produto_id,
          item.quantidade,
        ]);
      }
    }
  });
}

export async function listarDashboard() {
  const [produtos, usuarios, pedidos, vendas] = await Promise.all([
    obterPool().query("SELECT COUNT(*)::int AS total FROM produtos WHERE ativo = true"),
    obterPool().query("SELECT COUNT(*)::int AS total FROM usuarios"),
    obterPool().query("SELECT COUNT(*)::int AS total FROM pedidos"),
    obterPool().query(
      "SELECT COALESCE(SUM(total_centavos), 0) AS total, COALESCE(SUM(subtotal_centavos - desconto_centavos), 0) AS liquido FROM pedidos WHERE status <> 'cancelado'",
    ),
  ]);

  const totalVendas = Number(vendas.rows[0]?.total ?? 0) / 100;
  const quantidadePedidos = Number(pedidos.rows[0]?.total ?? 0);
  const ticket = quantidadePedidos > 0 ? totalVendas / quantidadePedidos : 0;

  const [recentes, porDia, porCategoria, porStatus, estoqueBaixo, maisVendidos] = await Promise.all([
    obterPool().query(
      `SELECT p.id, COALESCE(u.nome, 'Visitante') AS cliente, p.total_centavos, p.status, p.criado_em
       FROM pedidos p LEFT JOIN usuarios u ON u.id = p.usuario_id
       ORDER BY p.criado_em DESC LIMIT 5`,
    ),
    obterPool().query(
      `SELECT to_char(date_trunc('day', criado_em), 'YYYY-MM-DD') AS dia, SUM(total_centavos) AS total
       FROM pedidos WHERE status <> 'cancelado' AND criado_em >= now() - interval '30 days'
       GROUP BY 1 ORDER BY 1 ASC`,
    ),
    obterPool().query(
      `SELECT c.nome AS categoria, SUM(i.quantidade)::int AS quantidade
       FROM itens_pedido i
       INNER JOIN produtos p ON p.id = i.produto_id
       INNER JOIN categorias c ON c.id = p.categoria_id
       INNER JOIN pedidos pe ON pe.id = i.pedido_id
       WHERE pe.status <> 'cancelado'
       GROUP BY c.nome ORDER BY quantidade DESC`,
    ),
    obterPool().query("SELECT status, COUNT(*)::int AS total FROM pedidos GROUP BY status"),
    obterPool().query(
      "SELECT id, nome, quantidade FROM produtos WHERE ativo = true AND quantidade <= 5 ORDER BY quantidade ASC, nome ASC LIMIT 5",
    ),
    obterPool().query(
      `SELECT p.id, p.nome, p.preco_centavos, SUM(i.quantidade)::int AS vendidos
       FROM produtos p INNER JOIN itens_pedido i ON i.produto_id = p.id
       INNER JOIN pedidos pe ON pe.id = i.pedido_id
       WHERE pe.status <> 'cancelado'
       GROUP BY p.id ORDER BY vendidos DESC LIMIT 5`,
    ),
  ]);

  return {
    totalProdutos: Number(produtos.rows[0]?.total ?? 0),
    totalUsuarios: Number(usuarios.rows[0]?.total ?? 0),
    totalPedidos: quantidadePedidos,
    totalVendas,
    ticketMedio: ticket,
    produtosVendidos: Number(maisVendidos.rows.reduce((soma, linha) => soma + linha.vendidos, 0)),
    vendasRecentes: recentes.rows.map((linha) => ({ ...linha, valor: Number(linha.total_centavos) / 100 })),
    vendasPorDia: porDia.rows.map((linha) => ({ dia: linha.dia, total: Number(linha.total) / 100 })),
    vendasPorCategoria: porCategoria.rows,
    pedidosPorStatus: Object.fromEntries(porStatus.rows.map((linha) => [linha.status, linha.total])),
    estoqueBaixo: estoqueBaixo.rows,
    maisVendidos: maisVendidos.rows.map((linha) => ({ ...linha, preco: Number(linha.preco_centavos) / 100 })),
  };
}

// ── Favoritos e avaliações ─────────────────────────────────────────────────

export async function listarFavoritos(usuarioId: string) {
  const resultado = await obterPool().query(
    `SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.quantidade, p.imagem, c.nome AS categoria
     FROM favoritos f
     INNER JOIN produtos p ON p.id = f.produto_id
     INNER JOIN categorias c ON c.id = p.categoria_id
     WHERE f.usuario_id = $1 ORDER BY f.criado_em DESC`,
    [usuarioId],
  );
  return resultado.rows.map((linha) => ({
    ...linha,
    preco: linha.preco_centavos / 100,
    imagem: linha.imagem ?? undefined,
  }));
}

export async function alternarFavorito(usuarioId: string, produtoId: string) {
  const removido = await obterPool().query("DELETE FROM favoritos WHERE usuario_id = $1 AND produto_id = $2", [
    usuarioId,
    produtoId,
  ]);
  if (removido.rowCount && removido.rowCount > 0) return false;
  await obterPool().query("INSERT INTO favoritos (usuario_id, produto_id) VALUES ($1, $2)", [usuarioId, produtoId]);
  return true;
}

export async function listarAvaliacoes(produtoId: string) {
  const resultado = await obterPool().query(
    `SELECT a.nota, a.comentario, a.criado_em, u.nome
     FROM avaliacoes a INNER JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.produto_id = $1 ORDER BY a.criado_em DESC`,
    [produtoId],
  );
  return resultado.rows;
}

export async function salvarAvaliacao(usuarioId: string, produtoId: string, nota: number, comentario: string) {
  await obterPool().query(
    `INSERT INTO avaliacoes (id, usuario_id, produto_id, nota, comentario)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (usuario_id, produto_id)
     DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, criado_em = now()`,
    [randomUUID(), usuarioId, produtoId, nota, comentario],
  );
}

// ── Inicialização ──────────────────────────────────────────────────────────

export async function inicializarBanco(): Promise<string[]> {
  const aplicadas = await aplicarMigracoes();
  await garantirAdministrador();
  return aplicadas;
}

export { emTransacao, obterPool };
export type { PoolClient };
