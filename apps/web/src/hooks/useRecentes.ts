import { useState, useEffect } from "react";
import type { ProdutoResponse } from "@loja/shared";

export function useRecentes() {
  const [recentes, setRecentes] = useState<ProdutoResponse[]>(() =>
    JSON.parse(localStorage.getItem("recentesLoja") || "[]"),
  );

  useEffect(() => {
    localStorage.setItem("recentesLoja", JSON.stringify(recentes));
  }, [recentes]);

  const adicionarRecente = (produto: ProdutoResponse) => {
    setRecentes((itens) => [produto, ...itens.filter((item) => item.id !== produto.id)].slice(0, 4));
  };

  return { recentes, adicionarRecente };
}
