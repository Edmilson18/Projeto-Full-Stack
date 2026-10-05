import { useState, useEffect } from "react";
import type { ProdutoResponse } from "@loja/shared";

export type ItemCarrinho = ProdutoResponse & { quantidadeCarrinho: number };

export function useCarrinho() {
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("carrinho") || "[]") as ItemCarrinho[];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("carrinho", JSON.stringify(carrinho));
  }, [carrinho]);

  const adicionarAoCarrinho = (produto: ProdutoResponse) => {
    if (produto.quantidade < 1) return;
    setCarrinho((itens) => {
      const existente = itens.find((item) => item.id === produto.id);
      if (existente) {
        return itens.map((item) =>
          item.id === produto.id
            ? { ...item, quantidadeCarrinho: Math.min(item.quantidadeCarrinho + 1, produto.quantidade) }
            : item,
        );
      }
      return [...itens, { ...produto, quantidadeCarrinho: 1 }];
    });
  };

  const alterarQuantidade = (produtoId: string, variacao: number) => {
    setCarrinho((itens) =>
      itens
        .map((item) =>
          item.id === produtoId
            ? {
                ...item,
                quantidadeCarrinho: Math.min(item.quantidade, Math.max(0, item.quantidadeCarrinho + variacao)),
              }
            : item,
        )
        .filter((item) => item.quantidadeCarrinho > 0),
    );
  };

  const limparCarrinho = () => setCarrinho([]);

  const totalCarrinho = carrinho.reduce((total, item) => total + item.preco * item.quantidadeCarrinho, 0);
  const quantidadeCarrinho = carrinho.reduce((total, item) => total + item.quantidadeCarrinho, 0);

  return {
    carrinho,
    setCarrinho,
    adicionarAoCarrinho,
    alterarQuantidade,
    limparCarrinho,
    totalCarrinho,
    quantidadeCarrinho,
  };
}
