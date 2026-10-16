import { useCallback, useEffect, useRef, useState } from "react";
import type { AvaliacaoResponse } from "@loja/shared";
import { api } from "../lib/api.js";

export function useAvaliacoes(produtoId: string | null, onErro: (mensagem: string) => void) {
  const [estado, setEstado] = useState<{ produtoId: string; lista: AvaliacaoResponse[] } | null>(null);
  const produtoAtual = useRef(produtoId);
  const requisicao = useRef(0);

  const recarregar = useCallback(
    async (id = produtoId) => {
      if (!id || id !== produtoAtual.current) return;
      const atual = ++requisicao.current;
      try {
        const lista = await api.get<AvaliacaoResponse[]>(`/avaliacoes/${encodeURIComponent(id)}`);
        if (atual === requisicao.current && id === produtoAtual.current) {
          setEstado({ produtoId: id, lista: Array.isArray(lista) ? lista : [] });
        }
      } catch {
        if (atual === requisicao.current && id === produtoAtual.current)
          onErro("Não foi possível carregar as avaliações agora.");
      }
    },
    [produtoId, onErro],
  );

  useEffect(() => {
    produtoAtual.current = produtoId;
    if (produtoId) void recarregar(produtoId);
    return () => {
      requisicao.current++;
      produtoAtual.current = null;
    };
  }, [produtoId, recarregar]);

  return { avaliacoes: estado?.produtoId === produtoId ? estado.lista : [], recarregar };
}
