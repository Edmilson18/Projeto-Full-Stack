export type Usuario = {
  id: string;
  nome: string;
  email?: string;
  cuponsPossuidos: Cupom[];
};

export type Produto = {
  id: string;
  nome: string;
  preco: number;
  quantidade: number;
  categoria: string;
  descricao?: string;
};

export type Cupom = {
  codigo: string;
  porcentagemDesconto: number;
};

export type ResultadoCarrinho = {
  itensAgrupados: Array<Produto & { quantidade: number; subtotal: number }>;
  subtotal: number;
  desconto: number;
  frete: number;
  totalFinal: number;
};

export type Pedido = {
  id: string;
  usuarioId?: string;
  itens: Array<Produto & { quantidade: number; subtotal: number }>;
  subtotal: number;
  desconto: number;
  frete: number;
  totalFinal: number;
  status: "pendente" | "finalizado" | "cancelado";
};
