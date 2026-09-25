/**
 * Contratos compartilhados entre a API e o frontend.
 *
 * Este pacote é o motivo de o projeto ser um monorepo: a mesma definição
 * valida a requisição no servidor e, por inferência de tipo, chega ao
 * componente React sem nenhuma anotação manual.
 *
 * Hoje ele está praticamente vazio de propósito. Os schemas Zod entram na
 * Fase 3, junto com a migração para Fastify — criá-los agora exigiria
 * antecipar a forma da API nova, e qualquer divergência vira correção
 * duplicada.
 */

/** Papel de um usuário na base. */
export const ROLES = ["cliente", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Situações possíveis de um pedido, na ordem do fluxo. */
export const STATUS_PEDIDO = ["processando", "enviado", "finalizado", "cancelado"] as const;
export type StatusPedido = (typeof STATUS_PEDIDO)[number];

/** Métodos de pagamento aceitos. Todos demonstrativos por enquanto. */
export const METODOS_PAGAMENTO = ["pix", "cartao", "boleto"] as const;
export type MetodoPagamento = (typeof METODOS_PAGAMENTO)[number];

/** Erro devolvido pela API, com o formato único usado em toda resposta. */
export type ErroApi = {
  erro: string;
};

/** Envelope de sessão. `usuario` é nulo para visitante anônimo. */
export type Sessao = {
  usuario: {
    id: string;
    nome: string;
    email: string;
    role: Role;
  } | null;
};

/** Campos de endereço de entrega, como persistidos. */
export type Endereco = {
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
};

/** Campos de endereço que a API aceita, todos opcionais na entrada. */
export const CAMPOS_ENDERECO = [
  "cep",
  "rua",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado",
] as const satisfies readonly (keyof Endereco)[];
