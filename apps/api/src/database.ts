import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import type { MetodoPagamento, PedidoCriado } from "@loja/shared";
import { enderecoInput, statusPedido, TRANSICOES_PEDIDO } from "@loja/shared";
import { emTransacao, obterPool } from "./postgres.js";
import { aplicarMigracoes } from "./postgres.js";
import { ErroApp } from "./erros.js";

const MAX_CENTAVOS = 2_147_483_647;

/**
 * Converte `Date` em string ISO.
 *
 * O driver `pg` devolve `TIMESTAMPTZ` como objeto `Date`, que só vira string
 * quando o `JSON.stringify` passa por ele. Deixar o `Date` vazar para dentro
 * da aplicação faz o tipo(valor) depender da serialização, e a validação da
 * resposta — que roda antes dela — receberia um `Date` onde o schema espera
 * string. Converter aqui deixa o contrato correto em qualquer camada.
 */
function iso(valor: Date | string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  return valor instanceof Date ? valor.toISOString() : valor;
}

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
    const usuario = await client.query<{ id: string }>("SELECT id FROM usuarios WHERE email = $1", [
      email.trim().toLowerCase(),
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
      "DELETE FROM tokens_redefinicao_senha WHERE token_hash = $1 AND expira_em > now() RETURNING usuario_id",
      [hashToken(token)],
    );

    const linha = encontrado.rows[0];
    if (!linha) return false;

    await client.query("UPDATE usuarios SET senha = $1 WHERE id = $2", [criarHashSenha(novaSenha), linha.usuario_id]);
    // A troca e o consumo do token são revertidos juntos se alguma escrita falhar.
    await client.query("DELETE FROM sessoes WHERE usuario_id = $1", [linha.usuario_id]);
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
  await emTransacao(async (client) => {
    // Serializa logins do mesmo usuário, inclusive quando ainda não há sessão.
    await client.query("SELECT id FROM usuarios WHERE id = $1 FOR UPDATE", [usuarioId]);
    await client.query("DELETE FROM sessoes WHERE usuario_id = $1", [usuarioId]);
    await client.query(
      "INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES ($1, $2, now() + ($3::bigint * interval '1 millisecond'))",
      [tokenHash, usuarioId, String(duracaoMs)],
    );
  });
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
export function registrarAuditoria(
  entrada: {
    entidade: string;
    entidadeId: string;
    acao: string;
    antes?: Record<string, unknown> | null;
    depois?: Record<string, unknown> | null;
    usuarioId?: string | null;
  },
  /**
   * Cliente da transação em curso, quando a auditoria precisa ser atômica com a
   * escrita que ela registra. Sem ele a inserção usa o pool, e aí uma falha
   * depois do commit deixa a alteração feita sem rastro — ou o inverso, um
   * registro de algo que não foi gravado.
   */
  client?: Pick<PoolClient, "query">,
) {
  return (client ?? obterPool()).query(
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
  return resultado.rows.map((linha) => ({ ...linha, criado_em: iso(linha.criado_em) }));
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
      // Em produção, a senha do admin deve ser definida via variável de ambiente.
      // Em desenvolvimento, usa uma senha padrão para facilitar o uso local.
      const configurada = process.env.ADMIN_PASSWORD;
      if (process.env.NODE_ENV === "production" && !configurada?.trim()) {
        throw new Error("ADMIN_PASSWORD é obrigatório em produção e não pode ser vazio.");
      }
      const senhaAdmin = configurada?.trim() ? configurada : "admin123";
      await client.query("INSERT INTO usuarios (id, nome, email, senha, role) VALUES ($1, $2, $3, $4, 'admin')", [
        "usr-admin",
        "Administrador",
        "admin@lojaficticia.com",
        criarHashSenha(senhaAdmin),
      ]);
      return;
    }

    // Só uma instalação antiga, que guardava a senha em texto puro, tem o
    // papel e a senha restaurados.
    //
    // Uma conta já migrada para scrypt fica como está. Sem essa distinção,
    // qualquer pessoa que se cadastrasse com `admin@lojaficticia.com` — que o
    // `/api/cadastro` aceita e cria com `role = 'cliente'` — viraria admin no
    // boot seguinte do servidor.
    if (linha.senha.startsWith("scrypt$")) return;

    await client.query("UPDATE usuarios SET role = 'admin', senha = $1 WHERE id = $2", [
      criarHashSenha(linha.senha),
      linha.id,
    ]);
  });
}

export async function buscarUsuarioPorEmail(email: string) {
  const resultado = await obterPool().query("SELECT id, nome, email, senha, role FROM usuarios WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);
  return resultado.rows[0] as unknown as
    { id: string; nome: string; email: string; senha: string; role: string } | undefined;
}

export async function buscarUsuarioPorId(id: string) {
  const resultado = await obterPool().query("SELECT id, nome, email, role FROM usuarios WHERE id = $1", [id]);
  return resultado.rows[0] as unknown as { id: string; nome: string; email: string; role: string } | undefined;
}

export async function criarUsuario(usuario: { id: string; nome: string; email: string; senha: string }) {
  await emTransacao(async (client) => {
    await client.query("INSERT INTO usuarios (id, nome, email, senha, role) VALUES ($1, $2, $3, $4, 'cliente')", [
      usuario.id,
      usuario.nome,
      usuario.email,
      criarHashSenha(usuario.senha),
    ]);
  });
}

export async function buscarPerfilUsuario(id: string) {
  const resultado = await obterPool().query(
    "SELECT id, nome, email, role, cep, rua, numero, complemento, bairro, cidade, estado, criado_em FROM usuarios WHERE id = $1",
    [id],
  );
  const linha = resultado.rows[0];
  return linha ? { ...linha, criado_em: iso(linha.criado_em) } : undefined;
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

/**
 * Projeção de produto, compartilhada pela listagem e pela busca por id.
 *
 * `INNER JOIN categorias` porque `categoria` é o **nome** da categoria, e não
 * o id: o que o contrato `produtoResponse` devolve é o nome.
 */
const COLUNAS_PRODUTO = `
  SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.quantidade, p.imagem, p.ativo, c.nome AS categoria
  FROM produtos p
  INNER JOIN categorias c ON c.id = p.categoria_id`;

type LinhaProduto = {
  id: string;
  nome: string;
  descricao: string | null;
  preco_centavos: number;
  quantidade: number;
  imagem: string | null;
  ativo: boolean;
  categoria: string;
};

/** Centavos viram reais só aqui, na fronteira da resposta. */
function paraProduto(linha: LinhaProduto) {
  return {
    ...linha,
    preco: linha.preco_centavos / 100,
    imagem: linha.imagem ?? undefined,
  };
}

export async function listarProdutos(incluirInativos = false) {
  const filtro = incluirInativos ? "" : "WHERE p.ativo = true";
  const resultado = await obterPool().query<LinhaProduto>(`${COLUNAS_PRODUTO} ${filtro} ORDER BY p.nome ASC`);
  return resultado.rows.map(paraProduto);
}

/**
 * Produto pelo id, ou `undefined`.
 *
 * Existe para as rotas que precisam responder 404 em vez de deixar a operação
 * seguinte lançar "não encontrado" — e para devolver o produto criado sem
 * varrer a lista inteira.
 */
export async function buscarProduto(id: string) {
  const resultado = await obterPool().query<LinhaProduto>(`${COLUNAS_PRODUTO} WHERE p.id = $1`, [id]);
  const linha = resultado.rows[0];
  return linha ? paraProduto(linha) : undefined;
}

/**
 * Existe a linha? Existe para devolver 404 em vez de deixar a restrição de
 * chave estrangeira do banco estourar e virar 500.
 *
 * `produtos` só é inativado, nunca apagado, então a checagem não corre risco
 * de mudar de resposta entre a verificação e a escrita.
 */
async function existeEm(tabela: "produtos" | "categorias", id: string): Promise<boolean> {
  const resultado = await obterPool().query<{ existe: number }>(`SELECT 1 AS existe FROM ${tabela} WHERE id = $1`, [
    id,
  ]);
  return (resultado.rows[0]?.existe ?? 0) > 0;
}

export function produtoExiste(id: string): Promise<boolean> {
  return existeEm("produtos", id);
}

export function categoriaExiste(id: string): Promise<boolean> {
  return existeEm("categorias", id);
}

export async function listarCategorias() {
  const resultado = await obterPool().query("SELECT id, nome FROM categorias ORDER BY nome ASC");
  return resultado.rows;
}

export async function listarMaisVendidos() {
  // `LEFT JOIN pedidos` com a condição `status <> 'cancelado'` no ON (não no
  // WHERE) é o que preserva os produtos que nunca foram vendidos: filtrar no
  // WHERE os transformaria em zero linhas. Cancelar devolve estoque, então
  // contar essas unidades como venda mostraria na vitrine o que não foi
  // vendido. O `listarDashboard` já filtra, e os dois números precisam bater.
  const resultado = await obterPool().query(
    `SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.quantidade, p.imagem, p.ativo,
            c.nome AS categoria, COALESCE(SUM(i.quantidade) FILTER (WHERE pe.status <> 'cancelado'), 0)::int AS vendidos
     FROM produtos p
     LEFT JOIN itens_pedido i ON i.produto_id = p.id
     LEFT JOIN pedidos pe ON pe.id = i.pedido_id
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
  await emTransacao(async (client) => {
    await client.query(
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
  });
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
    if (anterior.rowCount === 0) throw ErroApp.naoEncontrado("Produto não encontrado.");

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
  codigo = $1
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
       AND (limite_uso IS NULL OR usos < limite_uso)
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
  await emTransacao(async (client) => {
    await client.query(
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
  });
}

// ── Pedidos ────────────────────────────────────────────────────────────────

const FRETE_GRATIS_A_PARTIR_DE_CENTAVOS = 150_00;
const FRETE_CENTAVOS = 20_00;

/**
 * Cria um pedido dentro de uma transação.
 *
 * Os erros de regra de negócio são `ErroApp`, e não `Error` genérico: é o que
 * permite ao tratador global responder 4xx com a mensagem escrita aqui. Um
 * `Error` qualquer é falha inesperada e vira 500 sem detalhe interno — inclusive
 * quando o que estourou foi uma restrição do banco.
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
  pagamento: MetodoPagamento = "pix",
  chaveIdempotencia?: string,
): Promise<PedidoCriado> {
  // `async` de propósito: sem isso o `throw` do carrinho vazio sai de forma
  // síncrona e vira exceção em vez de rejeição, obrigando o chamador a tratar
  // os dois casos. Sendo async, todo erro é rejeição.
  if (!itens.length) throw ErroApp.badRequest("O carrinho está vazio.");

  const pedidoId = `PED-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const itensOrdenados = itens.toSorted((a, b) =>
    a.produtoId < b.produtoId ? -1 : a.produtoId > b.produtoId ? 1 : a.quantidade - b.quantidade,
  );
  const requisicaoHash = hashToken(
    JSON.stringify({ itens: itensOrdenados, cupom: codigoCupom?.trim().toUpperCase() ?? null, pagamento }),
  );

  return emTransacao(async (client) => {
    if (chaveIdempotencia) {
      // Também serializa a primeira tentativa, antes de existir um registro.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [usuarioId, chaveIdempotencia]);
      const anterior = await client.query<{ requisicao_hash: string; resposta: PedidoCriado }>(
        "SELECT requisicao_hash, resposta FROM pedidos_idempotencia WHERE usuario_id = $1 AND chave = $2",
        [usuarioId, chaveIdempotencia],
      );
      if (anterior.rows[0]) {
        if (anterior.rows[0].requisicao_hash !== requisicaoHash) {
          throw ErroApp.conflito("Esta tentativa de compra já foi usada com outros itens ou condições.");
        }
        return anterior.rows[0].resposta;
      }
    }

    let subtotal = 0;
    const itensCalculados: Array<{ produtoId: string; quantidade: number; preco: number }> = [];

    // Todos os carrinhos bloqueiam produtos na mesma ordem, evitando A/B contra B/A.
    for (const item of itensOrdenados) {
      const produto = await client.query<{ id: string; preco_centavos: number; quantidade: number; ativo: boolean }>(
        "SELECT id, preco_centavos, quantidade, ativo FROM produtos WHERE id = $1 FOR UPDATE",
        [item.produtoId],
      );

      const linha = produto.rows[0];
      if (!linha || !linha.ativo || !Number.isInteger(item.quantidade) || item.quantidade < 1) {
        throw ErroApp.badRequest("Produto ou quantidade inválida.");
      }
      if (linha.quantidade < item.quantidade) throw ErroApp.badRequest("Um dos produtos não tem estoque suficiente.");

      subtotal += linha.preco_centavos * item.quantidade;
      if (!Number.isSafeInteger(subtotal) || subtotal > MAX_CENTAVOS) {
        throw ErroApp.badRequest("O valor do pedido ultrapassa o limite permitido.");
      }
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
      if (!cupomAplicado) throw ErroApp.badRequest("Cupom inválido ou inativo.");
      if (subtotal < cupomAplicado.valor_minimo_centavos)
        throw ErroApp.badRequest("O valor mínimo para este cupom não foi atingido.");

      if (cupomAplicado.tipo_desconto === "valor_fixo") {
        desconto = Math.min(subtotal, cupomAplicado.desconto_centavos);
      } else if (cupomAplicado.tipo_desconto === "porcentagem") {
        // Math.round fecha a conta em centavos, o que a divisão real não faz.
        desconto = Math.round((subtotal * cupomAplicado.porcentagem_desconto) / 100);
      }

      // Frete grátis: cupom de frete grátis sempre zera o frete (se passou no valor mínimo).
      // Sem cupom, o frete é grátis quando o subtotal (sem desconto) atinge o limite.
      if (cupomAplicado.tipo_desconto === "frete_gratis") {
        frete = 0;
      } else if (subtotal >= FRETE_GRATIS_A_PARTIR_DE_CENTAVOS) {
        frete = 0;
      }
    } else if (subtotal >= FRETE_GRATIS_A_PARTIR_DE_CENTAVOS) {
      frete = 0;
    }

    const total = subtotal - desconto + frete;
    if (!Number.isSafeInteger(total) || total > MAX_CENTAVOS) {
      throw ErroApp.badRequest("O valor do pedido ultrapassa o limite permitido.");
    }

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

    // A auditoria entra na mesma transação do pedido. Escrita fora dela, uma
    // falha aqui devolveria 500 para quem já teve o pedido criado — ou, se o
    // pedido fosse desfeito depois, deixaria rastro de algo que não existe.
    await registrarAuditoria(
      {
        entidade: "pedido",
        entidadeId: pedidoId,
        acao: "criado",
        depois: { status: "processando", metodo_pagamento: pagamento, total_final: total / 100 },
        usuarioId,
      },
      client,
    );

    const resposta: PedidoCriado = {
      id: pedidoId,
      subtotal: subtotal / 100,
      desconto: desconto / 100,
      frete: frete / 100,
      total_final: total / 100,
      status: "processando",
      metodo_pagamento: pagamento,
      status_pagamento: "aprovado",
    };
    if (chaveIdempotencia) {
      await client.query(
        "INSERT INTO pedidos_idempotencia (usuario_id, chave, requisicao_hash, pedido_id, resposta) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [usuarioId, chaveIdempotencia, requisicaoHash, pedidoId, JSON.stringify(resposta)],
      );
    }
    return resposta;
  });
}

export async function listarPedidosDoUsuario(usuarioId: string) {
  return emTransacao(async (client) => {
    const pedidos = await client.query(
      `SELECT id, subtotal_centavos, desconto_centavos, frete_centavos, total_centavos,
              status, metodo_pagamento, status_pagamento, criado_em
       FROM pedidos WHERE usuario_id = $1 ORDER BY criado_em DESC`,
      [usuarioId],
    );

    if (pedidos.rowCount === 0) return [];

    const itens = await client.query(
      `SELECT i.pedido_id, i.produto_id, i.quantidade, i.preco_unitario_centavos, i.subtotal_centavos, p.nome
       FROM itens_pedido i
       INNER JOIN produtos p ON p.id = i.produto_id
       WHERE i.pedido_id = ANY($1::text[])`,
      [pedidos.rows.map((linha) => linha.id)],
    );

    return pedidos.rows.map((linha) => ({
      ...linha,
      criado_em: iso(linha.criado_em),
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
  });
}

export async function listarPedidosAdmin() {
  return emTransacao(async (client) => {
    const resultado = await client.query(
      `SELECT p.id, p.total_centavos, p.status, p.status_pagamento, p.metodo_pagamento, p.criado_em, u.nome AS cliente
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       ORDER BY p.criado_em DESC`,
    );
    return resultado.rows.map((linha) => ({
      ...linha,
      criado_em: iso(linha.criado_em),
      total_final: linha.total_centavos / 100,
    }));
  });
}

/**
 * Muda o status do pedido e devolve o estoque quando ele é cancelado.
 *
 * `usuarioId` é quem executou a mudança, e não o dono do pedido: o admin que
 * edita o pedido de outra pessoa precisa aparecer como autor na auditoria.
 */
export async function atualizarStatusPedido(id: string, status: string, usuarioId?: string) {
  const destino = statusPedido.safeParse(status);
  if (!destino.success) throw ErroApp.badRequest("Status de pedido inválido.");

  await emTransacao(async (client) => {
    const pedido = await client.query<{ status: string; usuario_id: string | null; endereco: unknown }>(
      `SELECT status, usuario_id, jsonb_build_object(
        'cep', cep_entrega, 'rua', rua_entrega, 'numero', numero_entrega,
        'complemento', COALESCE(complemento_entrega, ''), 'bairro', bairro_entrega,
        'cidade', cidade_entrega, 'estado', estado_entrega
       ) AS endereco FROM pedidos WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const linha = pedido.rows[0];
    if (!linha) throw ErroApp.naoEncontrado("Pedido não encontrado.");
    // Pedido já no estado pedido não é transição: registrar auditoria aqui
    // criaria rastro de uma alteração que não aconteceu.
    if (linha.status === status) return;

    const origem = statusPedido.parse(linha.status);
    if (!TRANSICOES_PEDIDO[origem].includes(destino.data)) {
      throw ErroApp.conflito(`Não é possível alterar o pedido de ${origem} para ${status}.`);
    }
    if (status === "enviado") {
      // A simulação pode criar pedidos antes do endereço, mas não despachá-los.
      // Preserva o endereço completo da compra. Se estava incompleto, captura
      // o perfil atual antes do despacho e mantém esse snapshot no pedido.
      let endereco = enderecoInput.safeParse(linha.endereco);
      if (!endereco.success) {
        const perfil = await client.query(
          "SELECT cep, rua, numero, COALESCE(complemento, '') AS complemento, bairro, cidade, estado FROM usuarios WHERE id = $1 FOR SHARE",
          [linha.usuario_id],
        );
        endereco = enderecoInput.safeParse(perfil.rows[0]);
      }
      if (!endereco.success) {
        throw ErroApp.conflito("Preencha um endereço de entrega válido antes de enviar o pedido.");
      }
      const e = endereco.data;
      await client.query(
        `UPDATE pedidos SET cep_entrega = $2, rua_entrega = $3, numero_entrega = $4,
         complemento_entrega = $5, bairro_entrega = $6, cidade_entrega = $7, estado_entrega = $8 WHERE id = $1`,
        [id, e.cep, e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.estado],
      );
    }

    // Registrar `antes` com o valor lido na mesma transação é o que garante que
    // a auditoria descreve a transição real, e não o estado que a listagem
    // mostrava antes de outra requisição mexer no pedido.
    await registrarAuditoria(
      {
        entidade: "pedido",
        entidadeId: id,
        acao: "status_alterado",
        antes: { status: linha.status },
        depois: { status },
        usuarioId: usuarioId ?? linha.usuario_id,
      },
      client,
    );

    await client.query("UPDATE pedidos SET status = $1 WHERE id = $2", [status, id]);

    if (status === "cancelado" && linha.status !== "cancelado") {
      const itens = await client.query<{ produto_id: string; quantidade: number }>(
        "SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = $1 ORDER BY produto_id",
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
        "SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = $1 ORDER BY produto_id",
        [id],
      );
      for (const item of itens.rows) {
        const reserva = await client.query(
          "UPDATE produtos SET quantidade = quantidade - $2 WHERE id = $1 AND ativo = true AND quantidade >= $2 RETURNING id",
          [item.produto_id, item.quantidade],
        );
        if (!reserva.rowCount) {
          throw ErroApp.conflito("Não é possível reativar o pedido: produto indisponível ou estoque insuficiente.");
        }
      }
    }
  });
}

export async function listarDashboard() {
  return emTransacao(async (client) => {
    // Uma transação usa uma conexão: o pg executa suas consultas em sequência.
    const [produtos, usuarios, pedidos, vendas] = [
      await client.query("SELECT COUNT(*)::int AS total FROM produtos WHERE ativo = true"),
      await client.query("SELECT COUNT(*)::int AS total FROM usuarios"),
      await client.query(
        "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status <> 'cancelado')::int AS ativos FROM pedidos",
      ),
      await client.query(
        "SELECT COALESCE(SUM(total_centavos), 0) AS total, COALESCE(SUM(subtotal_centavos - desconto_centavos), 0) AS liquido FROM pedidos WHERE status <> 'cancelado'",
      ),
    ] as const;

    const totalVendasCentavos = Number(vendas.rows[0]?.total ?? 0);
    const quantidadePedidos = Number(pedidos.rows[0]?.total ?? 0);
    // Calcula em centavos para evitar perda de precisão, depois divide por 100.
    const pedidosAtivos = Number(pedidos.rows[0]?.ativos ?? 0);
    const ticket = pedidosAtivos > 0 ? totalVendasCentavos / pedidosAtivos / 100 : 0;

    const [recentes, porDia, porCategoria, porStatus, estoqueBaixo, maisVendidos] = [
      await client.query(
        `SELECT p.id, COALESCE(u.nome, 'Visitante') AS cliente, p.total_centavos, p.status, p.criado_em
         FROM pedidos p LEFT JOIN usuarios u ON u.id = p.usuario_id
         ORDER BY p.criado_em DESC LIMIT 5`,
      ),
      await client.query(
        `SELECT to_char(date_trunc('day', criado_em), 'YYYY-MM-DD') AS dia, SUM(total_centavos) AS total
         FROM pedidos WHERE status <> 'cancelado' AND criado_em >= now() - interval '30 days'
         GROUP BY 1 ORDER BY 1 ASC`,
      ),
      await client.query(
        `SELECT c.nome AS categoria, SUM(i.quantidade)::int AS quantidade
         FROM itens_pedido i
         INNER JOIN produtos p ON p.id = i.produto_id
         INNER JOIN categorias c ON c.id = p.categoria_id
         INNER JOIN pedidos pe ON pe.id = i.pedido_id
         WHERE pe.status <> 'cancelado'
         GROUP BY c.nome ORDER BY quantidade DESC`,
      ),
      await client.query("SELECT status, COUNT(*)::int AS total FROM pedidos GROUP BY status"),
      await client.query(
        "SELECT id, nome, quantidade FROM produtos WHERE ativo = true AND quantidade <= 5 ORDER BY quantidade ASC, nome ASC LIMIT 5",
      ),
      await client.query(
        `SELECT p.id, p.nome, p.preco_centavos, SUM(i.quantidade)::int AS vendidos
         FROM produtos p INNER JOIN itens_pedido i ON i.produto_id = p.id
         INNER JOIN pedidos pe ON pe.id = i.pedido_id
         WHERE pe.status <> 'cancelado'
         GROUP BY p.id ORDER BY vendidos DESC LIMIT 5`,
      ),
    ] as const;

    return {
      totalProdutos: Number(produtos.rows[0]?.total ?? 0),
      totalUsuarios: Number(usuarios.rows[0]?.total ?? 0),
      totalPedidos: quantidadePedidos,
      // A soma do banco vem em centavos; a resposta sai em reais, como as
      // demais. Sem a conversão, o campo viraria `undefined` e o
      // `dashboardSchema.parse()` derrubaria a rota com 500.
      totalVendas: totalVendasCentavos / 100,
      ticketMedio: ticket,
      produtosVendidos: Number(
        // Soma sobre `porCategoria`, que já agrega **todos** os itens de todos
        // os pedidos não cancelados. Somar a lista de mais vendidos (limitada a
        // 5) faria o total depender de um `LIMIT`: com 6 produtos vendidos, o
        // painel diria 5.
        porCategoria.rows.reduce((soma, linha) => soma + linha.quantidade, 0),
      ),
      vendasRecentes: recentes.rows.map((linha) => ({
        ...linha,
        criado_em: iso(linha.criado_em),
        valor: Number(linha.total_centavos) / 100,
      })),
      vendasPorDia: porDia.rows.map((linha) => ({ dia: linha.dia, total: Number(linha.total) / 100 })),
      vendasPorCategoria: porCategoria.rows,
      pedidosPorStatus: Object.fromEntries(porStatus.rows.map((linha) => [linha.status, linha.total])),
      estoqueBaixo: estoqueBaixo.rows,
      maisVendidos: maisVendidos.rows.map((linha) => ({ ...linha, preco: Number(linha.preco_centavos) / 100 })),
    };
  });
}

// ── Favoritos e avaliações ─────────────────────────────────────────────────

export async function listarFavoritos(usuarioId: string) {
  return emTransacao(async (client) => {
    const resultado = await client.query(
      `SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.quantidade, p.imagem
       FROM favoritos f
       INNER JOIN produtos p ON p.id = f.produto_id
       WHERE f.usuario_id = $1 ORDER BY f.criado_em DESC`,
      [usuarioId],
    );
    return resultado.rows.map((linha) => ({
      ...linha,
      preco: linha.preco_centavos / 100,
      imagem: linha.imagem ?? undefined,
    }));
  });
}

/**
 * Favoritos são gravados pelo estado desejado, e não por um "alternar".
 *
 * Um toggle no servidor obriga o cliente a calcular o mesmo toggle para
 * desenhar a tela. Quando os dois discordam do estado atual — dois cliques
 * rápidos, uma requisição repetida, uma aba que ficou aberta enquanto o estado
 * mudava em outro lugar — cada clique avança navegador e banco em direções
 * opostas e o favorito fica invertido sem que nada tenha erro. Escrever o
 * estado desejado deixa a operação idempotente: repetir a mesma chamada N vezes
 * termina no mesmo resultado.
 */
export async function favoritarProduto(usuarioId: string, produtoId: string) {
  await emTransacao(async (client) => {
    await client.query("INSERT INTO favoritos (usuario_id, produto_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      usuarioId,
      produtoId,
    ]);
  });
  return true;
}

export async function desfavoritarProduto(usuarioId: string, produtoId: string) {
  await emTransacao(async (client) => {
    await client.query("DELETE FROM favoritos WHERE usuario_id = $1 AND produto_id = $2", [usuarioId, produtoId]);
  });
  return false;
}

export async function listarAvaliacoes(produtoId: string) {
  return emTransacao(async (client) => {
    const resultado = await client.query(
      `SELECT a.nota, a.comentario, a.criado_em, u.nome
       FROM avaliacoes a INNER JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.produto_id = $1 ORDER BY a.criado_em DESC`,
      [produtoId],
    );
    return resultado.rows.map((linha) => ({ ...linha, criado_em: iso(linha.criado_em) }));
  });
}

/**
 * Avaliações que a pessoa já deixou, para o formulário vir preenchido.
 *
 * `listarAvaliacoes` é pública e devolve `nome` em vez de id, então a interface
 * não tem como reconhecer a própria opinião — e nome não serve, porque duas
 * pessoas podem ter o mesmo. Esta consulta é da conta, que já exige sessão, e
 * por isso devolve o id: é o que permite mostrar "atualizar avaliação" com a
 * nota anterior em vez de pedir uma nova.
 */
export async function listarAvaliacoesDoUsuario(usuarioId: string) {
  return emTransacao(async (client) => {
    const resultado = await client.query(
      `SELECT produto_id, nota, comentario, criado_em FROM avaliacoes WHERE usuario_id = $1`,
      [usuarioId],
    );
    return resultado.rows.map((linha) => ({ ...linha, criado_em: iso(linha.criado_em) }));
  });
}

export async function salvarAvaliacao(usuarioId: string, produtoId: string, nota: number, comentario: string) {
  await emTransacao(async (client) => {
    // Uma trava por usuário/produto protege inclusive a primeira avaliação,
    // quando ainda não existe linha para bloquear com FOR UPDATE.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      `avaliacao:${usuarioId}`,
      produtoId,
    ]);
    // Cancelar ou reativar os pedidos elegíveis espera a conclusão da avaliação.
    await client.query(
      `SELECT p.id FROM pedidos p WHERE p.usuario_id = $1 AND p.status <> 'cancelado'
       AND EXISTS (SELECT 1 FROM itens_pedido i WHERE i.pedido_id = p.id AND i.produto_id = $2)
       ORDER BY p.id FOR SHARE`,
      [usuarioId, produtoId],
    );
    if (!(await consultarPermissaoAvaliacao(client, usuarioId, produtoId))) {
      throw ErroApp.semPermissao(
        "A avaliação só fica disponível logo após uma nova compra que não esteja cancelada.",
        "avaliacao_fora_da_janela",
      );
    }
    await client.query(
      `INSERT INTO avaliacoes (id, usuario_id, produto_id, nota, comentario, criado_em)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp())
       ON CONFLICT (usuario_id, produto_id)
       DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, criado_em = EXCLUDED.criado_em`,
      [randomUUID(), usuarioId, produtoId, nota, comentario],
    );
  });
}

/**
 * Diz se a pessoa pode avaliar o produto **agora**.
 *
 * Não basta ter comprado: avaliar é uma janela que abre a cada compra e fecha
 * assim que a pessoa avalia. Por isso a comparação é entre a data da última
 * compra e a data da avaliação:
 *
 * - comprou e nunca avaliou            → liberada
 * - comprou, avaliou, não comprou mais  → bloqueada
 * - comprou de novo depois de avaliar  → liberada de novo, para atualizar a nota
 *
 * Comprado `cancelado` não conta em nenhum dos casos. `EXISTS` sobre a última
 * compra devolveria "comprou" para sempre, que é justamente o que a regra
 * proíbe: o mesmo produto com avaliação feita não pode ser avaliado de novo
 * só porque a pessoa abriu a página.
 *
 * O `-infinity` é o caso de nunca ter avaliado, que precisa contar como mais
 * antigo que qualquer compra. O resultado sai direto como booleano.
 */
export async function podeAvaliarProduto(usuarioId: string, produtoId: string): Promise<boolean> {
  return emTransacao((client) => consultarPermissaoAvaliacao(client, usuarioId, produtoId));
}

async function consultarPermissaoAvaliacao(client: PoolClient, usuarioId: string, produtoId: string): Promise<boolean> {
  const resultado = await client.query(
    `SELECT (
         c.em IS NOT NULL
         AND COALESCE(a.criado_em, '-infinity'::timestamptz) < c.em
       ) AS pode
       FROM (
         SELECT max(p.criado_em) AS em
           FROM itens_pedido i
           INNER JOIN pedidos p ON p.id = i.pedido_id
          WHERE i.produto_id = $1
            AND p.usuario_id = $2
            AND p.status <> 'cancelado'
       ) c
       LEFT JOIN (
         SELECT criado_em FROM avaliacoes WHERE usuario_id = $2 AND produto_id = $1
       ) a ON true`,
    [produtoId, usuarioId],
  );
  return resultado.rows[0]?.pode ?? false;
}

// ── Inicialização ──────────────────────────────────────────────────────────

export async function inicializarBanco(): Promise<string[]> {
  const aplicadas = await aplicarMigracoes();
  await garantirAdministrador();
  return aplicadas;
}

// Re-export para compatibilidade com código existente.
export { emTransacao, obterPool } from "./postgres.js";
export type { PoolClient } from "pg";
