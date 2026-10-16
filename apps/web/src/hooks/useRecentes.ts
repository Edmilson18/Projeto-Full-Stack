import { useState, useEffect } from "react";
import type { ProdutoResponse } from "@loja/shared";

/**
 * Os produtos vistos recentemente.
 *
 * O localStorage guarda só os **ids**, e os dados completos vêm do catálogo ao
 * renderizar. Antes a gente gravava o produto inteiro, e a foto ficava
 * congelada da primeira visita: a vitrine e os destaques pegam `/api/produtos`
 * e mudam na hora, mas o histórico continuava mostrando a foto antiga, até
 * alguém limpar o navegador. Agora o histórico resolve contra o catálogo vivo,
 * e a foto que sai é a de hoje.
 */
export function useRecentes(catalogo: ProdutoResponse[]) {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem("recentesLoja") || "[]");
      if (!Array.isArray(salvo)) return [];
      // Aceita os dois formatos: o antigo guardava o produto completo, então um
      // item antigo é um objeto com `id`, e o novo é o próprio id.
      return salvo
        .map((item: unknown) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "id" in item) {
            return String(item.id);
          }
          return "";
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("recentesLoja", JSON.stringify(ids));
  }, [ids]);

  const adicionarRecente = (produtoId: string) => {
    setIds((atuais) => [produtoId, ...atuais.filter((id) => id !== produtoId)].slice(0, 4));
  };

  // Resolve os ids contra o catálogo de hoje: foto, nome e preço vêm frescos, e
  // um produto que saiu do catálogo desaparece, em vez de ficar como item
  // fantasma.
  const recentes = ids
    .map((id) => catalogo.find((produto) => produto.id === id))
    .filter((produto): produto is ProdutoResponse => produto !== undefined);

  return { recentes, adicionarRecente };
}
