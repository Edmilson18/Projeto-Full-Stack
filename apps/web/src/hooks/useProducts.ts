import { useCallback, useEffect, useRef, useState } from "react";
import type { ProdutoResponse } from "@loja/shared";
import { api } from "../lib/api.js";

export function useProducts() {
  const [produtos, setProdutos] = useState<ProdutoResponse[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const requisicao = useRef(0);

  const carregar = useCallback(async () => {
    const atual = ++requisicao.current;
    try {
      setCarregando(true);
      setErro(null);
      const dados = await api.get<ProdutoResponse[]>("/produtos");
      // Os produtos entram como vieram do servidor. Este hook usava
      // preencher `imagem` aqui, pela posição do produto na resposta, e era essa
      // a origem da troca: o índice da lista mudava com o filtro de busca e com
      // a ordenação, e a foto mudava junto. Pior, o `imagem` gravado ficava
      // mentindo no estado — depois disso já não dava para saber se a foto era
      // do produto ou um preenchimento.
      //
      // Quem decide a foto agora é `imagemDe`, na hora de desenhar, a partir do
      // próprio produto.
      if (atual === requisicao.current) setProdutos(Array.isArray(dados) ? dados : []);
    } catch (e) {
      if (atual === requisicao.current) setErro(e instanceof Error ? e.message : "Erro ao carregar produtos");
    } finally {
      if (atual === requisicao.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    return () => {
      requisicao.current++;
    };
  }, [carregar]);

  return { produtos, carregando, erro, recarregar: carregar };
}
