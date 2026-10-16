/**
 * Contratos de entrada da API e tipos de domínio.
 *
 * São os schemas Zod que o Fastify valida. O tipo inferido de cada um é o
 * que o `apps/web` recebe, então mudar a entrada muda os dois lados juntos.
 *
 * As respostas em `./respostas.ts` derivam destes modelos e são validadas
 * antes de sair do servidor. Entradas podem normalizar valores; saídas não
 * devem mascarar uma violação do contrato.
 */
import { z } from "zod";

export const idTexto = z.string().min(1).max(64);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "E-mail inválido.");

export const senha = z.string().min(6, "A senha deve ter pelo menos 6 caracteres.").max(200);

export const nome = z.string().trim().min(2, "Informe seu nome completo.").max(120);

export const money = z.number().nonnegative();

/** CEP brasileiro, apenas dígitos internamente. */
export const cep = z
  .string()
  .trim()
  .transform((valor) => valor.replace(/\D/g, ""))
  .refine((valor) => valor.length === 8, "Informe um CEP com 8 números.");

// ── Sessão e papéis ────────────────────────────────────────────────────────

export const ROLES = ["cliente", "admin"] as const;
export const role = z.enum(ROLES);
export type Role = z.infer<typeof role>;

export const STATUS_PEDIDO = ["processando", "enviado", "finalizado", "cancelado"] as const;
export const statusPedido = z.enum(STATUS_PEDIDO);
export type StatusPedido = z.infer<typeof statusPedido>;

export const TRANSICOES_PEDIDO: Record<StatusPedido, readonly StatusPedido[]> = {
  processando: ["enviado", "cancelado"],
  enviado: ["finalizado"],
  finalizado: [],
  cancelado: ["processando"],
};

export const METODOS_PAGAMENTO = ["pix", "cartao", "boleto"] as const;
export const metodoPagamento = z.enum(METODOS_PAGAMENTO);
export type MetodoPagamento = z.infer<typeof metodoPagamento>;

// ── Modelo do usuário ──────────────────────────────────────────────────────

export const usuarioPublico = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string(),
  role,
});
export type UsuarioPublico = z.infer<typeof usuarioPublico>;

export const sessao = z.object({ usuario: usuarioPublico.nullable() });
export type Sessao = z.infer<typeof sessao>;

// ── Endereço ───────────────────────────────────────────────────────────────

export const CAMPOS_ENDERECO = ["cep", "rua", "numero", "complemento", "bairro", "cidade", "estado"] as const;

export const UF = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
export const estadoBrasileiro = z.enum(UF, { error: "Informe uma UF brasileira válida." });

export const endereco = z.object({
  cep: z.string(),
  rua: z.string(),
  numero: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  cidade: z.string(),
  estado: estadoBrasileiro,
});
export type Endereco = z.infer<typeof endereco>;

/** Entrada do endereço: o `estado` é obrigatório e tem exatamente 2 letras. */
export const enderecoInput = z.object({
  cep: cep,
  rua: z.string().trim().min(1, "Informe a rua."),
  numero: z.string().trim().min(1, "Informe o número."),
  complemento: z.string().trim().default(""),
  bairro: z.string().trim().min(1, "Informe o bairro."),
  cidade: z.string().trim().min(1, "Informe a cidade."),
  estado: z.string().trim().toUpperCase().pipe(estadoBrasileiro),
});
export type EnderecoInput = z.infer<typeof enderecoInput>;

// ── Produto ────────────────────────────────────────────────────────────────

export const produto = z.object({
  id: z.string(),
  nome: z.string(),
  descricao: z.string().nullish(),
  preco: money,
  quantidade: z.number().int().nonnegative(),
  categoria: z.string(),
  imagem: z.string().nullish(),
  ativo: z.boolean().nullish(),
});
export type Produto = z.infer<typeof produto>;

// Valida o protocolo sem `new URL()`: o pacote shared roda no Node e no
// browser, e não declara `lib: DOM`. Usar o construtor exigiria adicionar DOM
// ao pacote, o que vazaria o global para o lado do servidor.
const protocoloHttp = /^https?:\/\//i;

// Caminho local servido pelo próprio site (`/imagens/teclado.jpg`), que é o
// formato das fotos do seed. Um caminho relativo que não começa com `/` fica
// de fora: sem a barra o navegador resolveria contra a página atual
// (`/produto/imagens/x.jpg`) e a foto quebraria sem erro nenhum.
const caminhoLocal = /^\/\S*$/;

export const produtoInput = z.object({
  nome: z.string().trim().min(2, "Informe um nome válido para o produto.").max(160),
  descricao: z.string().trim().max(800, "A descrição pode ter no máximo 800 caracteres.").default(""),
  preco: money.max(21_474_836.47, "O preço ultrapassa o limite permitido."),
  quantidade: z.number().int().nonnegative().max(2_147_483_647, "O estoque ultrapassa o limite permitido."),
  categoriaId: z.string().trim().min(1, "Selecione uma categoria."),
  imagem: z
    .string()
    .trim()
    // `refine` e não `.regex()`: o valor aceito tem dois formatos, o endereço
    // externo e o caminho local, e cada um tem o próprio desenho. Uma única
    // regex combinando os dois leria pior e não dizia qual dos dois falhou.
    .refine((valor) => protocoloHttp.test(valor) || caminhoLocal.test(valor), {
      message: "A imagem deve usar um endereço http/https ou começar com `/`.",
    })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type ProdutoInput = z.infer<typeof produtoInput>;

// ── Pedido ─────────────────────────────────────────────────────────────────

export const itemPedidoInput = z.object({
  produtoId: z.string().min(1),
  quantidade: z.number().int().min(1).max(999),
});
export type ItemPedidoInput = z.infer<typeof itemPedidoInput>;

export const pedidoInput = z.object({
  chaveIdempotencia: z.uuid().optional(),
  itens: z.array(itemPedidoInput).min(1, "O carrinho está vazio."),
  cupomCodigo: z.string().trim().min(1).optional(),
  metodoPagamento: metodoPagamento.default("pix"),
});
export type PedidoInput = z.infer<typeof pedidoInput>;

export const pedido = z.object({
  id: z.string(),
  subtotal: money,
  desconto: money,
  frete: money,
  total_final: money,
  status: statusPedido,
  metodo_pagamento: metodoPagamento.nullish(),
  status_pagamento: z.string().nullish(),
  criado_em: z.string().nullish(),
});
export type Pedido = z.infer<typeof pedido>;

// ── Autenticação ───────────────────────────────────────────────────────────

export const loginBody = z.object({ email, senha });
export type LoginBody = z.infer<typeof loginBody>;

export const cadastroBody = z.object({ nome, email, senha });
export type CadastroBody = z.infer<typeof cadastroBody>;

export const recuperarSenhaBody = z.object({ email });
export type RecuperarSenhaBody = z.infer<typeof recuperarSenhaBody>;

export const redefinirSenhaBody = z.object({
  token: z.string().min(32, "Token inválido."),
  senha,
});
export type RedefinirSenhaBody = z.infer<typeof redefinirSenhaBody>;

// ── Erro ───────────────────────────────────────────────────────────────────

export const erroApi = z.object({ erro: z.string() });
export type ErroApi = z.infer<typeof erroApi>;

// ── Cupom ──────────────────────────────────────────────────────────────────

export const cupomValidado = z.object({
  valido: z.literal(true),
  codigo: z.string(),
  tipoDesconto: z.string(),
  porcentagemDesconto: z.number(),
  descontoCentavos: z.number(),
  valorMinimoCentavos: z.number(),
});
export type CupomValidado = z.infer<typeof cupomValidado>;

export const cupomInvalido = z.object({ valido: z.literal(false), erro: z.string() });

export const resultadoCupom = z.discriminatedUnion("valido", [cupomValidado, cupomInvalido]);
export type ResultadoCupom = z.infer<typeof resultadoCupom>;

export const cupomValidarInput = z.object({
  codigo: z.string().trim().min(1, "Informe um código de cupom."),
});
export type CupomValidarInput = z.infer<typeof cupomValidarInput>;

// ── Avaliação ───────────────────────────────────────────────────────────────

export const avaliacaoInput = z.object({
  nota: z.number().int().min(1, "A nota deve ser um inteiro de 1 a 5.").max(5, "A nota deve ser um inteiro de 1 a 5."),
  comentario: z.string().trim().max(600, "O comentário pode ter no máximo 600 caracteres.").default(""),
});
export type AvaliacaoInput = z.infer<typeof avaliacaoInput>;

export const statusPedidoInput = z.object({
  status: statusPedido,
});
export type StatusPedidoInput = z.infer<typeof statusPedidoInput>;
