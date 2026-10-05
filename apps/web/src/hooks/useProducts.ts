import { useCallback, useEffect, useState } from "react";
import type { ProdutoResponse } from "@loja/shared";
import { api } from "../lib/api.js";
import { imagemDe } from "../lib/utils.js";

export function useProducts() {
  const [produtos, setProdutos] = useState<ProdutoResponse[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setCarregando(true);
      setErro(null);
      const dados = await api.get<ProdutoResponse[]>("/produtos");
      const itens = Array.isArray(dados)
        ? dados.map((produto, index) => ({
            ...produto,
            imagem: produto.imagem || imagemDe(produto, index),
          }))
        : [];
      setProdutos(itens);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar produtos");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return { produtos, carregando, erro, recarregar: carregar };
}
