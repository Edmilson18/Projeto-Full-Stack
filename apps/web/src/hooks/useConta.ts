import { useCallback, useEffect, useRef, useState } from "react";
import type { Conta } from "@loja/shared";
import { api } from "../lib/api.js";
import { escopoSessaoAtual } from "../lib/sessao.js";

type Opcoes = {
  usuarioId: string | null;
  onFavoritos: (ids: string[]) => void;
  onErro: (mensagem: string) => void;
};

export function useConta({ usuarioId, onFavoritos, onErro }: Opcoes) {
  const [estado, setEstado] = useState<{ usuarioId: string; dados: Conta } | null>(null);
  const requisicao = useRef(0);
  const usuarioAtual = useRef(usuarioId);

  const carregarConta = useCallback(async () => {
    if (!usuarioId || usuarioAtual.current !== usuarioId) return;
    const atual = ++requisicao.current;
    const escopo = escopoSessaoAtual();
    try {
      const dados = await api.get<Conta>("/conta");
      if (atual !== requisicao.current || escopo !== escopoSessaoAtual()) return;
      setEstado({ usuarioId, dados });
      onFavoritos(dados.favoritos.map((produto) => produto.id));
    } catch (erro) {
      if (atual === requisicao.current && escopo === escopoSessaoAtual()) {
        onErro(erro instanceof Error ? erro.message : "Não foi possível carregar a conta.");
      }
    }
  }, [usuarioId, onFavoritos, onErro]);

  useEffect(() => {
    usuarioAtual.current = usuarioId;
    if (usuarioId) void carregarConta();
    else setEstado(null);
    return () => {
      requisicao.current++;
      usuarioAtual.current = null;
    };
  }, [usuarioId, carregarConta]);

  const salvarEndereco = useCallback(
    async (endereco: Record<string, string>) => {
      if (!usuarioId || usuarioAtual.current !== usuarioId) return;
      const atual = ++requisicao.current;
      const escopo = escopoSessaoAtual();
      const dados = await api.put<{ perfil: Conta["perfil"] }>("/conta/endereco", endereco);
      if (atual !== requisicao.current || escopo !== escopoSessaoAtual()) return;
      setEstado((anterior) =>
        anterior?.usuarioId === usuarioId
          ? { usuarioId, dados: { ...anterior.dados, perfil: dados.perfil } }
          : anterior,
      );
    },
    [usuarioId],
  );

  return { dadosConta: estado?.usuarioId === usuarioId ? estado.dados : null, carregarConta, salvarEndereco };
}
