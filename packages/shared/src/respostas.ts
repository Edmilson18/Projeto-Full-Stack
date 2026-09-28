/**
 * Respostas da API.
 *
 * O objetivo é duplo:
 *
 * 1. O servidor valida a própria saída, então um campo renomeado no banco
 *    vira erro de teste em vez de `undefined` silencioso na tela.
 * 2. O frontend infere o tipo daqui, e para de usar `as` e `String(x)` para
 *    calar o compilador. Era essa falta de contrato que produzia os avisos de
 *    `no-unsafe-type-assertion` e `no-base-to-string`.
 *
 * O custo é uma validação por requisição. Para as respostas desta API — que
 * são pequenas e em memória — o custo é de fração de milissegundo, muito
 * abaixo do tempo que a consulta ao Postgres já consome.
 *
 * As respostas ficam num arquivo separado das entradas porque têm um trade-off
 * diferente: uma entrada inválida é erro do cliente e vale barrar; uma saída
 * inválida é bug do servidor, e o objetivo é que ela **falhe no teste** em vez
 * de chegar ao navegador como `undefined`.
 */
import { z } from "zod";

import { metodoPagamento, statusPedido, usuarioPublico } from "./schemas.js";

/** Preço em reais, como o cliente vê. Vem de centavos divided por 100. */
export const preco = z.number().nonnegative();

export const produtoResponse = z.object({
  id: z.string(),
  nome: z.string(),
  descricao: z.string().nullish(),
  preco,
  quantidade: z.number().int(),
  categoria: z.string(),
  imagem: z.string().nullish(),
  ativo: z.boolean().nullish(),
});
export type ProdutoResponse = z.infer<typeof produtoResponse>;

export const listaProdutos = z.array(produtoResponse);
export type ListaProdutos = z.infer<typeof listaProdutos>;

export const categoriaResponse = z.object({ id: z.string(), nome: z.string() });
export type CategoriaResponse = z.infer<typeof categoriaResponse>;

export const listaCategorias = z.array(categoriaResponse);
export type ListaCategorias = z.infer<typeof listaCategorias>;

export const maisVendido = produtoResponse.extend({ vendidos: z.number().int() });
export type MaisVendido = z.infer<typeof maisVendido>;

/** Favoritos e "vistos recentemente" devolvem produto sem a categoria. */
export const produtoSemCategoria = produtoResponse.omit({ categoria: true });
export type ProdutoSemCategoria = z.infer<typeof produtoSemCategoria>;

export const cupomDisponivel = z.object({
  codigo: z.string(),
  tipoDesconto: z.string(),
  porcentagemDesconto: z.number(),
  valorMinimo: z.number(),
});
export type CupomDisponivel = z.infer<typeof cupomDisponivel>;

export const listaCupons = z.array(cupomDisponivel);
export type ListaCupons = z.infer<typeof listaCupons>;

export const avaliacaoResponse = z.object({
  nota: z.number().int(),
  comentario: z.string().nullish(),
  criado_em: z.string().nullish(),
  nome: z.string(),
});
export type AvaliacaoResponse = z.infer<typeof avaliacaoResponse>;

export const listaAvaliacoes = z.array(avaliacaoResponse);
export type ListaAvaliacoes = z.infer<typeof listaAvaliacoes>;

// ── Pedidos ────────────────────────────────────────────────────────────────

export const itemPedidoResponse = z.object({
  produto_id: z.string(),
  nome: z.string(),
  quantidade: z.number().int(),
  preco_unitario: preco,
  subtotal: preco,
});
export type ItemPedidoResponse = z.infer<typeof itemPedidoResponse>;

export const pedidoResponse = z.object({
  id: z.string(),
  subtotal: preco,
  desconto: preco,
  frete: preco,
  total_final: preco,
  status: statusPedido,
  metodo_pagamento: z.string().nullish(),
  status_pagamento: z.string().nullish(),
  criado_em: z.string().nullish(),
  itens: z.array(itemPedidoResponse).nullish(),
});
export type PedidoResponse = z.infer<typeof pedidoResponse>;

/** A criação devolve o resumo, sem os itens. */
export const pedidoCriado = pedidoResponse.omit({ itens: true, criado_em: true });
export type PedidoCriado = z.infer<typeof pedidoCriado>;

export const listaPedidosUsuario = z.array(pedidoResponse);
export type ListaPedidosUsuario = z.infer<typeof listaPedidosUsuario>;

export const pedidoAdmin = z.object({
  id: z.string(),
  total_final: preco,
  status: statusPedido,
  status_pagamento: z.string().nullish(),
  metodo_pagamento: metodoPagamento.nullish(),
  criado_em: z.string().nullish(),
  cliente: z.string().nullish(),
});
export type PedidoAdmin = z.infer<typeof pedidoAdmin>;

export const listaPedidosAdmin = z.array(pedidoAdmin);
export type ListaPedidosAdmin = z.infer<typeof listaPedidosAdmin>;

// ── Conta ──────────────────────────────────────────────────────────────────

/**
 * Campos de endereço na resposta.
 *
 * `.partial()` não serve: ele aceita `undefined` (a chave ausente), e o banco
 * devolve `null` (a chave presente, sem valor). São coisas diferentes, e o
 * Zod trata diferente — daí o mapa explícito em vez de `partial()`.
 */
const enderecoNulo = {
  cep: z.string().nullish(),
  rua: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  estado: z.string().nullish(),
};

export const perfil = usuarioPublico.extend({
  ...enderecoNulo,
  criado_em: z.string().nullish(),
});
export type Perfil = z.infer<typeof perfil>;

export const conta = z.object({
  perfil,
  pedidos: listaPedidosUsuario,
  favoritos: z.array(produtoSemCategoria),
});
export type Conta = z.infer<typeof conta>;

// ── Dashboard ──────────────────────────────────────────────────────────────

export const dashboard = z.object({
  totalProdutos: z.number().int(),
  totalUsuarios: z.number().int(),
  totalPedidos: z.number().int(),
  totalVendas: preco,
  ticketMedio: preco,
  produtosVendidos: z.number().int(),
  vendasRecentes: z.array(
    z.object({
      id: z.string(),
      cliente: z.string().nullish(),
      valor: preco,
      status: statusPedido,
      criado_em: z.string().nullish(),
    }),
  ),
  vendasPorDia: z.array(z.object({ dia: z.string().nullish(), total: preco })),
  vendasPorCategoria: z.array(z.object({ categoria: z.string(), quantidade: z.number().int() })),
  pedidosPorStatus: z.record(z.string(), z.number().int()),
  estoqueBaixo: z.array(z.object({ id: z.string(), nome: z.string(), quantidade: z.number().int() })),
  maisVendidos: z.array(z.object({ id: z.string(), nome: z.string(), preco, vendidos: z.number().int() })),
});
export type Dashboard = z.infer<typeof dashboard>;

// ── Auditoria ──────────────────────────────────────────────────────────────

export const registroAuditoria = z.object({
  id: z.string(),
  acao: z.string(),
  antes: z.record(z.string(), z.unknown()).nullish(),
  depois: z.record(z.string(), z.unknown()).nullish(),
  criado_em: z.string().nullish(),
  usuario: z.string().nullish(),
});
export type RegistroAuditoria = z.infer<typeof registroAuditoria>;

export const listaAuditoria = z.array(registroAuditoria);
export type ListaAuditoria = z.infer<typeof listaAuditoria>;

// ── Envelopes simples ──────────────────────────────────────────────────────

export const mensagem = z.object({ mensagem: z.string() });
export type Mensagem = z.infer<typeof mensagem>;

export const listaVazia = z.array(z.unknown());
