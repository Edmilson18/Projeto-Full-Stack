import { useState, useEffect } from "react";
import type { ProdutoResponse } from "@loja/shared";

export type ItemCarrinho = ProdutoResponse & { quantidadeCarrinho: number };

/**
 * O que guarda no carrinho.
 *
 * Só `id` e quantidade, e não o produto inteiro: o produto completo no
 * localStorage congelava a foto, o nome e o preço no momento em que o item
 * entrou no carrinho, e a vitrine explicava uma coisa e o carrinho mostrava
 * outra. Ao ler, o item é remontado com os dados de hoje do catálogo.
 */
export type CarrinhoEntrada = { id: string; quantidadeCarrinho: number };

export function useCarrinho(catalogo: ProdutoResponse[]) {
  const [entradas, setEntradas] = useState<CarrinhoEntrada[]>(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem("carrinho") || "[]");
      if (!Array.isArray(salvo)) return [];
      // Aceita o formato antigo, que gravava o produto completo: dele ficam
      // só o id e a quantidade.
      return salvo
        .map((item: unknown) => {
          if (item && typeof item === "object") {
            const e = item as Record<string, unknown>;
            const id = typeof e.id === "string" ? e.id : "";
            const quantidadeCarrinho = Number(e.quantidadeCarrinho);
            if (id && quantidadeCarrinho > 0) return { id, quantidadeCarrinho };
          }
          return null;
        })
        .filter((entrada): entrada is CarrinhoEntrada => entrada !== null);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("carrinho", JSON.stringify(entradas));
  }, [entradas]);

  // Remonta o carrinho com os dados de hoje do catálogo. Um produto fora de
  // catálogo some da lista, em vez de aparecer com preço congelado.
  const carrinho: ItemCarrinho[] = entradas
    .map((entrada) => {
      const produto = catalogo.find((p) => p.id === entrada.id);
      return produto ? { ...produto, quantidadeCarrinho: entrada.quantidadeCarrinho } : null;
    })
    .filter((item): item is ItemCarrinho => item !== null);

  const adicionarAoCarrinho = (produto: ProdutoResponse) => {
    if (produto.quantidade < 1) return;
    setEntradas((itens) => {
      const existente = itens.find((item) => item.id === produto.id);
      if (existente) {
        return itens.map((item) =>
          item.id === produto.id
            ? { ...item, quantidadeCarrinho: Math.min(item.quantidadeCarrinho + 1, produto.quantidade) }
            : item,
        );
      }
      return [...itens, { id: produto.id, quantidadeCarrinho: 1 }];
    });
  };

  const alterarQuantidade = (produtoId: string, variacao: number) => {
    setEntradas((itens) =>
      itens
        .map((entrada) => {
          if (entrada.id !== produtoId) return entrada;
          // O estoque vem do catálogo de hoje, não de um número guardado há
          // uma semana: se o fornecedor baixou, o carrinho respeita.
          const produto = catalogo.find((p) => p.id === produtoId);
          const estoque = produto?.quantidade ?? entrada.quantidadeCarrinho;
          return {
            ...entrada,
            quantidadeCarrinho: Math.min(estoque, Math.max(0, entrada.quantidadeCarrinho + variacao)),
          };
        })
        .filter((entrada) => entrada.quantidadeCarrinho > 0),
    );
  };

  const limparCarrinho = () => setEntradas([]);

  /**
   * Substitui a lista de entradas. Aceita função como o `setState`, para o
   * `App` desligar a entrada do pedido quando a compra passa — sem saber nada
   * do formato gravado.
   */
  const setCarrinho = (acao: ItemCarrinho[] | ((atual: ItemCarrinho[]) => ItemCarrinho[])) => {
    setEntradas((atuais) => {
      const produtosAtuais = atuais
        .map((entrada) => {
          const produto = catalogo.find((item) => item.id === entrada.id);
          return produto ? { ...produto, quantidadeCarrinho: entrada.quantidadeCarrinho } : null;
        })
        .filter((item): item is ItemCarrinho => item !== null);
      const novaLista = typeof acao === "function" ? acao(produtosAtuais) : acao;
      return novaLista.map((item) => ({ id: item.id, quantidadeCarrinho: item.quantidadeCarrinho }));
    });
  };

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
